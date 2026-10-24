@echo off
rem ===========================================================================
rem  Bulk Mockup - one-click Windows installer
rem
rem  Double-click this file. It will:
rem    1. remove an older installation that used the plain folder name
rem    2. copy the extension into
rem         %APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel.debug
rem    3. set PlayerDebugMode = 1 for CSXS.9 through CSXS.16
rem       (CEP 9+ hosts, i.e. Photoshop CC 2019 and later)
rem    4. verify the result and tell you to restart Photoshop
rem
rem  The folder name ends in .debug on purpose: CEP only reads the bundled
rem  .debug file (the DevTools port) when the extension folder ends that way.
rem  The bundle id itself stays com.bulkmockup.panel, as declared in the
rem  manifest; CEP strips the suffix for identity purposes.
rem
rem  Options (for advanced users):
rem    install.bat --link       link to this folder instead of copying (for
rem                             development, so edits apply without reinstalling)
rem    install.bat --no-pause   do not wait for a key press at the end
rem    install.bat --help
rem
rem  Administrator rights are not normally needed: everything is written to
rem  the current user's profile. If a write is refused, the installer asks for
rem  elevation and continues.
rem ===========================================================================

setlocal EnableExtensions EnableDelayedExpansion
title Bulk Mockup Installer

set "BUNDLE_ID=com.bulkmockup.panel"
set "SOURCE=%~dp0"
if "%SOURCE:~-1%"=="\" set "SOURCE=%SOURCE:~0,-1%"
set "LINK_MODE=0"
set "ELEVATED=0"
set "NO_PAUSE=0"
set "REG_FAILED=0"
set "SKIP_COPY=0"

rem ---------------------------------------------------------------- arguments
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--link"     set "LINK_MODE=1"
if /i "%~1"=="--elevated" set "ELEVATED=1"
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"
if /i "%~1"=="--help"     goto show_help
if /i "%~1"=="-h"         goto show_help
if /i "%~1"=="/?"         goto show_help
shift
goto parse_args
:args_done

rem The elevated instance may be running as a different administrator. The
rem original profile path is handed over in a file, because quoting paths
rem through PowerShell's RunAs is fragile. If it is not there, we fall back to
rem the current profile, which is correct for the usual same-user consent.
if "%ELEVATED%"=="1" (
    if exist "%TEMP%\bulkmockup-appdata.txt" (
        set /p HANDOFF_APPDATA=<"%TEMP%\bulkmockup-appdata.txt"
        if exist "!HANDOFF_APPDATA!\Adobe" set "APPDATA=!HANDOFF_APPDATA!"
        del "%TEMP%\bulkmockup-appdata.txt" >nul 2>&1
    )
)

set "EXT_ROOT=%APPDATA%\Adobe\CEP\extensions"
set "TARGET=%EXT_ROOT%\%BUNDLE_ID%.debug"
set "LEGACY=%EXT_ROOT%\%BUNDLE_ID%"

for %%I in ("%SOURCE%") do set "SOURCE_FULL=%%~fI"
for %%I in ("%TARGET%") do set "TARGET_FULL=%%~fI"
for %%I in ("%LEGACY%") do set "LEGACY_FULL=%%~fI"

echo.
echo  ===========================================================
echo   Bulk Mockup  -  Photoshop CEP panel installer
echo  ===========================================================
echo.
echo   From : %SOURCE%
echo   Into : %TARGET%
if exist "%LEGACY%" (
    call :is_under "%SOURCE_FULL%" "%LEGACY_FULL%"
    if errorlevel 1 (
        echo   Old  : %LEGACY%  ^(will be removed^)
    ) else (
        echo   Old  : %LEGACY%  ^(kept: this project^)
    )
)
echo.

rem ------------------------------------------------------------------ preflight
if not exist "%SOURCE%\CSXS\manifest.xml" (
    set "ERROR_MESSAGE=This folder is not a complete copy of Bulk Mockup."
    set "ERROR_HINT=CSXS\manifest.xml is missing. Extract the whole project archive, then run install.bat from inside it."
    goto :failed
)
if not exist "%SOURCE%\client\index.html" (
    set "ERROR_MESSAGE=This folder is not a complete copy of Bulk Mockup."
    set "ERROR_HINT=client\index.html is missing. Extract the whole project archive, then run install.bat from inside it."
    goto :failed
)

for %%I in ("%SOURCE%") do set "SOURCE_FULL=%%~fI"
for %%I in ("%TARGET%") do set "TARGET_FULL=%%~fI"
for %%I in ("%LEGACY%") do set "LEGACY_FULL=%%~fI"

call :can_write
if errorlevel 1 (
    if "%ELEVATED%"=="1" (
        set "ERROR_MESSAGE=The installer is not allowed to write to the CEP extensions folder."
        set "ERROR_HINT=Close Photoshop, check the permissions on %EXT_ROOT%, then run the installer again."
        goto :failed
    )
    goto :elevate
)

rem -------------------------------------------------------------------- install
rem If the installer is being run from the installed plugin itself, there is
rem nothing to copy. The same is true when this project lives inside the
rem target folder, which would otherwise be deleted below.
if exist "%TARGET%" (
    call :is_under "%SOURCE_FULL%" "%TARGET_FULL%"
    if not errorlevel 1 set "SKIP_COPY=1"
)

if "%SKIP_COPY%"=="1" (
    echo   [skip] This folder is already the installed plugin.
    goto :verify
)

rem Replace the previous .debug installation. `rmdir` without /s removes a
rem junction or a symlink itself and never the folder it points at; the /s
rem retry only runs when that refused, which means a real, non-empty folder.
if exist "%TARGET%" (
    rmdir "%TARGET%" >nul 2>&1
    if exist "%TARGET%" rmdir /s /q "%TARGET%" >nul 2>&1
)
if exist "%TARGET%" (
    set "ERROR_MESSAGE=The previous plugin folder could not be replaced."
    set "ERROR_HINT=Close Photoshop and any Explorer window showing %TARGET%, then run the installer again."
    goto :failed
)

if "%LINK_MODE%"=="1" (
    echo   Linking to this project folder ...
    mklink /J "%TARGET%" "%SOURCE%" >nul 2>&1
    if errorlevel 1 (
        set "ERROR_MESSAGE=The folder junction could not be created."
        set "ERROR_HINT=Run install.bat without --link to copy the files instead."
        goto :failed
    )
    echo   [ok] Linked. Edits in this folder are picked up after a panel reload.
) else (
    echo   Copying the plugin files ...
    robocopy "%SOURCE%" "%TARGET%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP ^
        /XD ".git" "node_modules" "dist" "docs" "tools" ".vscode" ".idea" "__pycache__" ^
        /XF "*.log" "*.zxp" "*.pyc" "*.cpuprofile" >nul
    if !ERRORLEVEL! GEQ 8 (
        set "ERROR_MESSAGE=Copying the plugin files failed (robocopy code !ERRORLEVEL!)."
        set "ERROR_HINT=Close Photoshop and try again. If it keeps failing, copy the folder manually - see docs\INSTALL.md."
        goto :failed
    )
    echo   [ok] Files copied.
)

rem ------------------------------------------------------------------- verify
:verify
if not exist "%TARGET%\CSXS\manifest.xml" (
    set "ERROR_MESSAGE=The manifest is missing from the installed folder."
    set "ERROR_HINT=Antivirus software may have blocked the copy. Check %TARGET%, then see docs\INSTALL.md."
    goto :failed
)
if not exist "%TARGET%\client\index.html" (
    set "ERROR_MESSAGE=The panel files are missing from the installed folder."
    set "ERROR_HINT=Antivirus software may have blocked the copy. Check %TARGET%, then see docs\INSTALL.md."
    goto :failed
)

rem ------------------------------------------------- remove old non-debug copy
rem A folder named just com.bulkmockup.panel would load the same bundle id.
rem CEP would then have two copies and pick one arbitrarily, often the stale
rem one, which is exactly the "panel does not update" failure. Remove it, but
rem never remove the folder this installer is running from.
call :remove_legacy
if errorlevel 3 goto :legacy_done
if errorlevel 2 (
    echo.
    echo   [warn] The old non-debug folder is this project folder, so it was kept:
    echo        %LEGACY%
    echo        Delete it yourself once the new panel works.
    goto :legacy_done
)
if errorlevel 1 (
    set "ERROR_MESSAGE=The new panel is installed, but the old non-debug folder could not be removed."
    set "ERROR_HINT=Close Photoshop and any Explorer window showing %LEGACY%, then run the installer again. If it still fails, run install.bat as administrator."
    goto :failed
)
echo   [ok] Removed the old non-debug installation.
:legacy_done

rem ------------------------------------------------------------------- registry
echo.
echo   Enabling CEP debug mode (required for unsigned panels) ...
for %%V in (9 10 11 12 13 14 15 16) do (
    reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
    if errorlevel 1 (
        echo   [warn] CSXS.%%V  PlayerDebugMode could not be set
        set /a REG_FAILED+=1
    ) else (
        echo   [ok] CSXS.%%V  PlayerDebugMode = 1
    )
)

if !REG_FAILED! GTR 0 (
    if "%ELEVATED%"=="0" goto :elevate
    set "ERROR_MESSAGE=CEP debug mode could not be enabled."
    set "ERROR_HINT=Create HKCU\Software\Adobe\CSXS.9 ... CSXS.16 with a String value PlayerDebugMode = 1. See docs\INSTALL.md."
    goto :failed
)

echo.
echo  ===========================================================
echo   Installation complete
echo  ===========================================================
echo.
echo   Plugin : %TARGET%
if "%LINK_MODE%"=="1" (
    echo   Mode   : linked to this project folder
) else (
    echo   Mode   : copied ^(the project folder can be moved afterwards^)
)
echo   CEP    : PlayerDebugMode = 1 for CSXS.9 - CSXS.16
echo.
echo   Next steps:
echo     1. Quit Photoshop completely ^(File ^> Exit, not just the window^).
echo     2. Start Photoshop again.
echo     3. Choose  Window ^> Extensions ^> Bulk Mockup
echo.
echo   The .debug suffix makes CEP read the bundled .debug file, so the
echo   DevTools are available at http://localhost:8088 while Photoshop runs.
echo   The panel remembers your paths, so this is configured once.
echo   To uninstall, delete the plugin folder above and the
echo   PlayerDebugMode values. Full details: docs\INSTALL.md
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 0

rem ------------------------------------------------------------------- helpers

:can_write
if not exist "%EXT_ROOT%" mkdir "%EXT_ROOT%" 2>nul
if not exist "%TARGET%" mkdir "%TARGET%" 2>nul
mkdir "%TARGET%\.bulkmockup-write-test" 2>nul
if not exist "%TARGET%\.bulkmockup-write-test" exit /b 1
rmdir "%TARGET%\.bulkmockup-write-test" 2>nul
exit /b 0

:is_under
rem Usage: call :is_under "<path>" "<parent>"
rem Returns 0 when path equals parent or lives inside it, 1 otherwise.
setlocal EnableDelayedExpansion
set "CHILD=%~1"
set "PARENT=%~2"
if /i "!CHILD!"=="!PARENT!" (endlocal & exit /b 0)
set "REST=!PARENT!\"
set "N=0"
:iu_len
if not defined REST goto iu_cmp
set "REST=!REST:~1!"
set /a N+=1
goto iu_len
:iu_cmp
set "HEAD=!CHILD:~0,%N%!"
if /i "!HEAD!"=="!PARENT!\" (endlocal & exit /b 0)
endlocal & exit /b 1

:remove_legacy
rem Returns 3 when there is nothing to remove, 2 when the old folder is the
rem project we are installing from, 1 when removal failed, 0 on success.
if not exist "%LEGACY%" exit /b 3
call :is_under "%SOURCE_FULL%" "%LEGACY_FULL%"
if not errorlevel 1 exit /b 2
rmdir "%LEGACY%" >nul 2>&1
if not exist "%LEGACY%" exit /b 0
if exist "%LEGACY%\" (
    rmdir /s /q "%LEGACY%" >nul 2>&1
) else (
    del /f /q "%LEGACY%" >nul 2>&1
)
if exist "%LEGACY%" exit /b 1
exit /b 0

:elevate
echo.
echo   Administrator rights are needed to finish the installation.
echo   Windows will ask for permission in a moment - choose "Yes".
echo.
> "%TEMP%\bulkmockup-appdata.txt" echo %APPDATA%
set "SELF=%~f0"
set "ELEVATE_ARGS=--elevated"
if "%LINK_MODE%"=="1" set "ELEVATE_ARGS=%ELEVATE_ARGS% --link"
if "%NO_PAUSE%"=="1" set "ELEVATE_ARGS=%ELEVATE_ARGS% --no-pause"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%SELF%' -ArgumentList '%ELEVATE_ARGS%' -Verb RunAs"
if errorlevel 1 (
    set "ERROR_MESSAGE=The administrator prompt was cancelled or could not be opened."
    set "ERROR_HINT=Right-click install.bat and choose "Run as administrator"."
    goto :failed
)
echo   A second window is opening with administrator rights.
echo   You can close this one now.
if "%NO_PAUSE%"=="0" timeout /t 3 /nobreak >nul
exit /b 0

:show_help
echo.
echo  Bulk Mockup installer
echo.
echo    install.bat              Install the panel into your user profile (recommended).
echo    install.bat --link       Link instead of copy, so edits apply live.
echo    install.bat --no-pause   Run without waiting for a key press.
echo    install.bat --help       Show this message.
echo.
echo  Installs to:
echo    %%APPDATA%%\Adobe\CEP\extensions\com.bulkmockup.panel.debug
echo.
echo  Enables PlayerDebugMode for CSXS.9 - CSXS.16 (CEP 9+, so Photoshop
echo  CC 2019 and later) and removes an older com.bulkmockup.panel folder.
echo  Administrator rights are not normally required; if a write is refused,
echo  the installer asks for elevation.
echo.
echo  Manual installation and other options: docs\INSTALL.md
echo.
exit /b 0

:failed
echo.
echo  [X] %ERROR_MESSAGE%
if defined ERROR_HINT echo      %ERROR_HINT%
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 1
