# Installing Bulk Mockup

There are four ways to install, in order of convenience:

1. [One-click installer](#1-one-click-installer-recommended) — **recommended for everyone**.
2. [Manual install](#2-manual-install-advanced) — by hand, useful for debugging an install.
3. [Signed ZXP](#3-signed-zxp-distribution) — for distributing to other people.
4. [Standalone script](#4-standalone-script-no-panel) — no extension at all.

All four use the same engine; nothing extra is needed per route.

---

## Requirements

| Component | Minimum | Notes |
|---|---|---|
| Photoshop | CC 2019 (v20.0) | Manifest allows `16.0`–`99.9`; `RequiredRuntime` 9.0 skips CC 2015–2018 (CEP 6–8). |
| CEP runtime | 9 | Bundled with Photoshop CC 2019+. CEP 11+/2022+ is the tuned target. |
| Windows | 10 / 11 | |
| macOS | 11 Big Sur | |
| Node.js | 18 | **Tooling only** — not needed to install or run the panel. |

Check the version in **Photoshop → Help → About Photoshop** (Windows) or **Photoshop → About Photoshop** (macOS). The CEP version follows the app: 2019/2020 → CEP 9, 2021 → CEP 10, 2022/2023 → CEP 11, 2024/2025 → CEP 11/12, and 2015–2018 → CEP 6–8, below this panel's minimum. The installer enables debug mode for `CSXS.9` through `CSXS.16`, which covers everything from CC 2019 onward.

---

## 1. One-click installer (recommended)

### Windows

1. If you downloaded a ZIP, extract it first — you cannot run an installer from inside the archive.
2. Double-click **`install.bat`**.
3. Approve the Windows prompt **only if it appears**. A normal per-user install needs no administrator rights.
4. Read the summary the installer prints, then quit Photoshop completely and start it again.

If Windows SmartScreen shows "Windows protected your PC" (common for downloaded `.bat` files), choose **More info → Run anyway**. The script is plain text; you can open it in Notepad and read every line before running it.

The installer:

- creates `%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel.debug`;
- copies only what the panel needs (`CSXS`, `client`, `jsx`, `assets`, plus `README.md`, `CHANGELOG.md`, `LICENSE` and the two installers) — `tools/`, `docs/` and `.git` stay behind;
- removes an older `com.bulkmockup.panel` folder left by previous versions, so CEP cannot load a stale copy;
- sets `PlayerDebugMode = 1` for `HKCU\Software\Adobe\CSXS.9` … `.16`, which unsigned CEP panels require;
- verifies that `CSXS\manifest.xml` and `client\index.html` arrived;
- prints the plugin path and the three steps to open the panel.

The folder ends in `.debug` on purpose: CEP only reads the bundled `.debug` file — the DevTools port — when the extension folder ends that way. The bundle id in the manifest stays `com.bulkmockup.panel`; CEP strips the suffix for identity, so the panel appears once, not twice.

It is safe to run again: it replaces the previous installation and is how you update a copied install.

**Options**

```bat
install.bat --link       link to this folder instead of copying (development)
install.bat --no-pause   do not wait for a key press at the end
install.bat --help
```

`--link` creates a directory junction, so edits in the project folder are picked up when the panel is reloaded. It needs no administrator rights. A normal copy is independent of the project folder afterwards.

**Elevation.** Everything is written to your own profile, so administrator rights are normally unnecessary. If a write is refused (an old install owned by another account, a locked folder, an antivirus hook), the installer relaunches itself elevated, carries your original profile path across, and continues. If you cancel the UAC prompt it exits cleanly without changing anything. To force elevation from the start, right-click `install.bat` → **Run as administrator**.

### macOS

1. Open **Terminal** in the project folder — in Finder, right-click the folder → **Services → New Terminal at Folder**.
2. Run:

   ```bash
   bash install.sh
   ```

3. Quit Photoshop completely (`Cmd+Q`) and start it again.

Do **not** use `sudo`. The installer refuses to run as root, because the panel belongs in your user profile; `sudo` would install it into root's home directory where Photoshop will never look.

The installer:

- creates `~/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel.debug`;
- copies the same subset as the Windows installer (using `rsync`, or `tar` if rsync is unavailable);
- removes an older `com.bulkmockup.panel` folder left by previous versions, so CEP cannot load a stale copy;
- runs `defaults write com.adobe.CSXS.9` … `.16 PlayerDebugMode 1` and refreshes `cfprefsd`;
- verifies the manifest and panel files, then prints the result.

Double-clicking `install.sh` in Finder does not run it (macOS opens it in an editor, or warns about an unidentified developer). Calling it with `bash` avoids that entirely. If you downloaded the project as an archive and macOS quarantined the file, running it through Terminal is still fine; only remove the quarantine attribute (`xattr -d com.apple.quarantine install.sh`) if you trust the source.

**Options**

```bash
bash install.sh --link     # symlink instead of copy (development)
bash install.sh --help
```

### After either installer

1. **Quit Photoshop completely.** Closing the window is not enough; CEP enumerates extensions at launch.
2. Start Photoshop.
3. Open **Window → Extensions → Bulk Mockup**.

The panel remembers your mockup, folders and options, so this is configured once. Your existing mockup PSD needs no changes — `tst-music copy` is still the default layer name.

If the menu entry is missing, jump to [Diagnosing a panel that does not load](#diagnosing-a-panel-that-does-not-load).

### Updating

Run the installer again. It replaces the panel files, removes an older non-debug copy, and leaves your saved panel settings alone. A copied install does not need the project folder after installation; a `--link` install obviously does.

---

## 2. Manual install (advanced)

Use this if the installer is blocked, or if you want to control the install location yourself. The examples use the same `.debug` folder name as the installer.

### Step 1 — put it where CEP looks

CEP scans one directory per user:

| OS | Extensions directory |
|---|---|
| Windows | `%APPDATA%\Adobe\CEP\extensions` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions` |

The convention is to name the folder after the bundle id, `com.bulkmockup.panel` — not `bulk-mockup-plugin`. CEP scans every subfolder that contains `CSXS/manifest.xml`, so either form loads; the suffix changes one thing:

- `com.bulkmockup.panel.debug` — CEP reads the `.debug` file in the project root and opens the DevTools port (8088). This is what the installers create.
- `com.bulkmockup.panel` — plain release form, no DevTools port.

The trailing `.debug` is stripped for identity purposes, so the panel still appears once. Never keep both forms at the same time — same bundle id, and CEP may load the stale one.

**Windows (Command Prompt, as your normal user)**

```bat
mklink /D "%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel.debug" "C:\Users\you\Desktop\bulk-mockup-plugin"
```

Drop the `.debug` suffix if you do not need remote debugging:

```bat
mklink /D "%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel" "C:\Users\you\Desktop\bulk-mockup-plugin"
```

If the extensions directory does not exist yet, create it first:

```bat
mkdir "%APPDATA%\Adobe\CEP\extensions"
```

`mklink` needs no administrator rights when the target is a directory and the parent exists; if it complains, use `xcopy` instead:

```bat
xcopy /E /I "C:\Users\you\Desktop\bulk-mockup-plugin" "%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel.debug"
```

**macOS**

```bash
mkdir -p "$HOME/Library/Application Support/Adobe/CEP/extensions"
ln -s "/Users/you/Desktop/bulk-mockup-plugin" \
      "$HOME/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel.debug"
```

Again, remove the `.debug` suffix if you do not want the DevTools port. Use one or the other, never both.

### Step 2 — allow unsigned extensions

Unsigned CEP extensions only load when `PlayerDebugMode` is `1` for the CSXS version the host uses. Photoshop CC 2019/2020 use 9, 2021 uses 10, 2022+ use 11/12, and future builds may use 13+. Setting all of them — `.9` through `.16` — is harmless and is what the installer does. (CC 2015–2018 use CEP 6–8, below the panel's `RequiredRuntime` 9.0.)

**Windows**

```bat
reg add HKCU\Software\Adobe\CSXS.9 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.10 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.13 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.14 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.15 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.16 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

PowerShell users must quote the key:

```powershell
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

**macOS**

```bash
defaults write com.adobe.CSXS.9 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
defaults write com.adobe.CSXS.13 PlayerDebugMode 1
defaults write com.adobe.CSXS.14 PlayerDebugMode 1
defaults write com.adobe.CSXS.15 PlayerDebugMode 1
defaults write com.adobe.CSXS.16 PlayerDebugMode 1
killall cfprefsd
```

### Step 3 — restart and open

Quit Photoshop completely and relaunch. The panel is under **Window → Extensions → Bulk Mockup**.

### Step 4 — optional: remote debugging

`.debug` in the project root enables the Chrome DevTools port:

```xml
<Host Name="PHXS" Port="8088" />
```

Open `http://localhost:8088` in Chrome or Edge while Photoshop is running and click the panel's page. This is the only practical way to see a JavaScript error in `client/js`; the engine side is covered by the panel's `debug` log level and the `.log` file it writes.

---

## 3. Signed ZXP (distribution)

A `.zxp` is a ZIP with an Adobe signature. Users install it with [ZXPInstaller](https://zxpinstaller.com/) or Adobe's `ExManCmd`, and still need `PlayerDebugMode` unless the signing certificate is trusted by their machine (self-signed is not).

### Build one

1. Download `ZXPSignCmd` from the [CEP resources repository](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD) and put it on your `PATH` (or point `ZXPSIGNCMD` at it).
2. Create a self-signed certificate (once):

   ```bash
   ZXPSignCmd -selfSignedCert IR IR "Bulk Mockup" secret cert.p12
   ```

3. Package:

   ```bash
   ZXPSIGNCMD=/path/to/ZXPSignCmd \
   CERT_P12=./cert.p12 \
   CERT_PASS=secret \
   npm run pack
   ```

The script stages `CSXS`, `client`, `jsx`, `assets`, `README.md` and `LICENSE` into `dist/`, then signs `dist/BulkMockup-1.0.0.zxp`. If `ZXPSignCmd` is missing it stops with the download link rather than producing a file that fails to install.

### Install one

- **ZXPInstaller:** drag the `.zxp` in, restart Photoshop.
- **ExManCmd:** `ExManCmd /install BulkMockup-1.0.0.zxp` (Windows) or `./ExManCmd --install ...` (macOS).

ZXP-installed copies land in `CEP/extensions/com.bulkmockup.panel` — the plain, non-debug folder. Do **not** keep the installer's `com.bulkmockup.panel.debug` folder alongside it: two copies of the same bundle id, and the winner is undefined. The one-click installer removes the plain folder, so uninstall a ZXP copy with `ExManCmd /remove com.bulkmockup.panel` before running it.

---

## 4. Standalone script (no panel)

`jsx/standalone/BulkMockupStandalone.jsx` is the entire engine in one file, with every `#include` already expanded.

1. In Photoshop: **File → Scripts → Browse…**
2. Select `jsx/standalone/BulkMockupStandalone.jsx`.
3. Answer four prompts: mockup PSD, designs folder, output folder, layer name.
4. A summary alert appears when the run ends. A `.log` and `.csv` are written next to the outputs.

Keyboard shortcut: put the file in `Presets/Scripts` (inside the Photoshop application folder) and it appears in the **File → Scripts** menu permanently.

The standalone file is generated: edit the modules under `jsx/`, then run `npm run build`. Editing the generated file directly means the next build silently discards your changes.

---

## Updating

| Install route | How to update |
|---|---|
| One-click installer (copy) | Run `install.bat` / `bash install.sh` again, restart Photoshop. |
| One-click installer (`--link`) | `git pull` (or edit the files), reload the panel, restart Photoshop for engine changes. |
| Manual symlink | `git pull`, then restart Photoshop — CEP caches the panel HTML. Use `Ctrl+R`/`Cmd+R` in the panel only for CSS/JS changes. |
| Manual copy | Replace the folder contents, restart Photoshop. |
| ZXP | Install the newer `.zxp` over the old one; ExManCmd upgrades in place. |
| Standalone | Replace the `.jsx`; nothing else to update. |

Restarting Photoshop is required whenever `CSXS/manifest.xml`, the file list, or the ExtendScript changes. `client/` changes alone can be picked up by closing and reopening the panel.

---

## Uninstalling

1. Close Photoshop.

2. Delete the extension folder — and the plain folder too, if an older install left one behind. **Windows:**

   ```bat
   rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel.debug"
   rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.bulkmockup.panel"
   ```

   **macOS:**

   ```bash
   rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel.debug"
   rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel"
   ```

   If it was installed via ZXP, use `ExManCmd /remove com.bulkmockup.panel` instead.

3. Optionally remove the debug flags. They are shared with every other unsigned CEP extension on the machine, so removing them disables those too — skip this if you use other development panels.

   **Windows** (Command Prompt; `%v` is the loop variable):

   ```bat
   for /l %v in (9,1,16) do reg delete HKCU\Software\Adobe\CSXS.%v /v PlayerDebugMode /f
   ```

   **macOS:**

   ```bash
   for v in 9 10 11 12 13 14 15 16; do defaults delete com.adobe.CSXS.$v PlayerDebugMode; done
   ```

4. Panel settings live in the panel's `localStorage` under `bulkmockup.settings.v1`, inside CEP's per-user storage — not in the extension folder. Removing the extension's CEP cache resets them; you can also press **Reset to defaults** in Options. Losing them only means the pickers start empty.

Nothing is installed into the Photoshop application folder, and no user documents are modified.

---

## Diagnosing a panel that does not load

Work through these in order; each one is a superset of the previous.

1. **Is the manifest where CEP expects it?** `<extensions>/<any folder>/CSXS/manifest.xml` must exist. The installer creates `com.bulkmockup.panel.debug`; a plain `com.bulkmockup.panel` also loads, and the `.debug` suffix is required only for the DevTools port. If both folders exist, CEP can load either — the installer removes the plain one for exactly this reason.
2. **Is debug mode on for the right CSXS version?** Read the value back:

   ```bat
   reg query HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode
   ```

   ```bash
   defaults read com.adobe.CSXS.11 PlayerDebugMode
   ```

3. **Did Photoshop fully restart?** CEP enumerates extensions at launch.
4. **Read the CEP log.** It names the manifest error, the missing file, or the signature complaint:

   | OS | Log |
   |---|---|
   | Windows | `%APPDATA%\Adobe\CEP\logs\CEP-*.log` |
   | macOS | `~/Library/Logs/CSXS/CEP-*.log` |

   Raise the log level by adding `<LogLevel>5</LogLevel>` inside `<ExtensionManifest>` (temporarily) — 5 is verbose.
5. **Manifest well-formed?** A stray `&` or an unclosed tag makes CEP skip the extension with only a log line.
6. **Is a required file missing?** `MainPath` (`client/index.html`) and `ScriptPath` (`jsx/engine.jsx`) must exist relative to the extension folder. A broken `<Icons>` path does not stop loading; a missing `MainPath` does.
7. **Installer ran but the panel is old?** Check that only one `com.bulkmockup.panel*` folder exists in the extensions directory. Two folders with the same bundle id make the loaded copy arbitrary — this is the most common cause of "I installed it but nothing changed". A `--link` install also follows the project folder; a copy does not. Re-run the installer and check the file dates in the installed folder.

### Panel loads but is empty or unresponsive

- Open `http://localhost:8088` (with the `.debug` folder name), pick the panel target, and look at the console. A single `SyntaxError` in `client/js/*` prevents `app.js` from booting, leaving the static HTML visible with no behaviour.
- The panel shows a red banner if the engine is unreachable. Read the banner text: it includes the ExtendScript error message.

### "The extension is not signed" on launch

`PlayerDebugMode` is missing or set for a different CSXS version. See step 2. Photoshop 2024+ may also honour a machine-wide `HKLM\Software\Adobe\CSXS.12\PlayerDebugMode`; the per-user value is enough.

### Two Photoshop versions installed

Each version reads the same `CEP/extensions` folder but may use a different CSXS runtime. If the panel appears in one and not the other, set `PlayerDebugMode` for that version's runtime number as well.

---

## Manual smoke test after installing

Run this once per Photoshop major version; it takes two minutes and catches every host-integration break.

1. Open the panel; the status pill reads **Ready** within a second or two.
2. Pick any multi-layer mockup PSD with a Smart Object.
3. **Find layers** → the dropdown lists at least one entry.
4. Pick a folder with 2–3 JPG/PNG files as designs, and an empty folder as output.
5. **Validate** → four green lines, no warnings.
6. **Start batch** → progress advances, log lines appear, and the output folder receives one file per design.
7. Open one output: the artwork is centred and contained, not stretched.
8. Run again with *Overwrite existing files* off → files gain ` (2)` suffixes.
9. Start a batch of 20+ designs and press **Cancel** after the second → the run stops at the next file, the panel returns to **Ready**, and the mockup is not left open or modified.
10. Close Photoshop, reopen it, open the panel: your previous paths are restored.
