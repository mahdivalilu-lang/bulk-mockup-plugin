#!/usr/bin/env bash
#
# Bulk Mockup - one-click macOS installer
#
# Usage:
#   bash install.sh            install the panel (recommended)
#   bash install.sh --link     link to this folder instead (for development)
#   bash install.sh --help
#
# What it does:
#   1. removes an older installation that used the plain folder name
#   2. copies the extension to
#      ~/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel.debug
#   3. sets PlayerDebugMode = 1 for CSXS.9 through CSXS.16
#      (CEP 9+ hosts, i.e. Photoshop CC 2019 and later)
#   4. verifies the result and tells you to restart Photoshop
#
# The folder name ends in .debug on purpose: CEP only reads the bundled .debug
# file (the DevTools port) when the extension folder ends that way. The bundle
# id itself stays com.bulkmockup.panel, as declared in the manifest.
#
# Do not run this with sudo: the panel belongs to your user profile, and sudo
# would install it into root's home directory instead.

set -euo pipefail

BUNDLE_ID="com.bulkmockup.panel"
CSXS_VERSIONS=(9 10 11 12 13 14 15 16)
MODE="copy"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    GREEN=$'\033[32m'
    YELLOW=$'\033[33m'
    RED=$'\033[31m'
    RESET=$'\033[0m'
else
    BOLD=""
    DIM=""
    GREEN=""
    YELLOW=""
    RED=""
    RESET=""
fi

ok()   { printf '   %s[ok]%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '   %s[!!]%s %s\n' "$YELLOW" "$RESET" "$1"; }

fail() {
    printf '\n%s[X] %s%s\n' "$RED" "$1" "$RESET" >&2
    if [ $# -gt 1 ]; then
        printf '    %s\n' "$2" >&2
    fi
    printf '\n' >&2
    exit 1
}

usage() {
    cat <<'EOF'

Bulk Mockup installer for macOS

  bash install.sh            Install the panel into your user profile (recommended).
  bash install.sh --link     Link instead of copy, so edits apply live.
  bash install.sh --help     Show this message.

The panel is installed to:
  ~/Library/Application Support/Adobe/CEP/extensions/com.bulkmockup.panel.debug

PlayerDebugMode is enabled for CSXS.9 - CSXS.16, which unsigned panels need.
That covers CEP 9 and newer (Photoshop CC 2019 and later) as well as current
builds, and an older com.bulkmockup.panel folder is removed automatically.
Do not use sudo. After installing, quit Photoshop (Cmd+Q) and start it again,
then open Window > Extensions > Bulk Mockup.

Manual installation and other options: docs/INSTALL.md

EOF
}

# ---------------------------------------------------------------------------
# Arguments and platform checks
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --link)  MODE="link" ;;
        --help|-h) usage; exit 0 ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if [ "$(uname -s)" != "Darwin" ]; then
    fail "This installer is for macOS." "On Windows, double-click install.bat instead."
fi

if [ "$(id -u)" -eq 0 ]; then
    fail "Do not run this installer with sudo." "It writes to your user profile. Run: bash install.sh"
fi

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$EXT_ROOT/$BUNDLE_ID.debug"
LEGACY="$EXT_ROOT/$BUNDLE_ID"

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

printf '\n'
printf ' ===========================================================\n'
printf '  Bulk Mockup  -  Photoshop CEP panel installer\n'
printf ' ===========================================================\n\n'
printf '  From : %s\n' "$SOURCE"
printf '  Into : %s\n' "$TARGET"
if [ -e "$LEGACY" ] || [ -L "$LEGACY" ]; then
    printf '  Old  : %s  (will be removed)\n' "$LEGACY"
fi
printf '\n'

if [ ! -f "$SOURCE/CSXS/manifest.xml" ] || [ ! -f "$SOURCE/client/index.html" ]; then
    fail "This folder is not a complete copy of Bulk Mockup." \
         "CSXS/manifest.xml or client/index.html is missing. Extract the whole project, then run the installer from inside it."
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

mkdir -p "$EXT_ROOT"

if [ "$SOURCE" = "$TARGET" ]; then
    printf '   [skip] This folder is already the installed plugin.\n'
else
    # Remove any previous installation at the .debug path. A symlink is
    # unlinked, never followed: `rm -f` on a symlink removes the link and
    # leaves its target alone.
    if [ -L "$TARGET" ]; then
        rm -f "$TARGET"
    elif [ -d "$TARGET" ]; then
        rm -rf "$TARGET"
    elif [ -e "$TARGET" ]; then
        fail "$TARGET already exists and is not a folder." "Move it out of the way, then run the installer again."
    fi

    if [ "$MODE" = "link" ]; then
        printf '   Linking to this project folder ...\n'
        ln -s "$SOURCE" "$TARGET"
        ok "Linked. Edits in this folder are picked up after a panel reload."
    else
        printf '   Copying the plugin files ...\n'
        mkdir -p "$TARGET"

        if command -v rsync >/dev/null 2>&1; then
            rsync -a \
                --exclude '.git' \
                --exclude 'node_modules' \
                --exclude 'dist' \
                --exclude 'docs' \
                --exclude 'tools' \
                --exclude '.vscode' \
                --exclude '.idea' \
                --exclude '__pycache__' \
                --exclude '*.log' \
                --exclude '*.zxp' \
                --exclude '*.pyc' \
                --exclude '*.cpuprofile' \
                "$SOURCE"/ "$TARGET"/
        else
            # macOS always ships tar; this path only exists for minimal images
            # that somehow lack rsync.
            ( cd "$SOURCE" && tar -cf - \
                --exclude .git \
                --exclude node_modules \
                --exclude dist \
                --exclude docs \
                --exclude tools \
                --exclude .vscode \
                --exclude .idea \
                --exclude __pycache__ \
                --exclude '*.log' \
                --exclude '*.zxp' \
                --exclude '*.pyc' \
                --exclude '*.cpuprofile' \
                . ) | ( cd "$TARGET" && tar -xf - )
        fi
        ok "Files copied."
    fi
fi

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

if [ ! -f "$TARGET/CSXS/manifest.xml" ] || [ ! -f "$TARGET/client/index.html" ]; then
    fail "The panel files are missing from the target folder." \
         "Check $TARGET, then see docs/INSTALL.md."
fi

# ---------------------------------------------------------------------------
# Remove the old non-debug copy
# ---------------------------------------------------------------------------

# A folder named just com.bulkmockup.panel would load the same bundle id, so
# CEP would have two copies and pick one arbitrarily - usually the stale one.
# Never remove the folder this installer is running from, though.
if [ -e "$LEGACY" ] || [ -L "$LEGACY" ]; then
    case "$SOURCE/" in
        "$LEGACY"/*)
            warn "The old folder is this project folder, so it was kept:"
            printf '        %s\n' "$LEGACY"
            printf '        Delete it yourself once the new panel works.\n'
            ;;
        *)
            if [ -L "$LEGACY" ]; then
                rm -f "$LEGACY"
            elif [ -d "$LEGACY" ]; then
                rm -rf "$LEGACY"
            else
                rm -f "$LEGACY"
            fi
            if [ -e "$LEGACY" ] || [ -L "$LEGACY" ]; then
                fail "The new panel is installed, but the old non-debug folder could not be removed." \
                     "Close Photoshop, then delete $LEGACY and run the installer again."
            fi
            ok "Removed the old non-debug installation."
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# Debug mode
# ---------------------------------------------------------------------------

printf '\n   Enabling CEP debug mode (required for unsigned panels) ...\n'

FAILED=0
for version in "${CSXS_VERSIONS[@]}"; do
    if defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null; then
        ok "CSXS.$version  PlayerDebugMode = 1"
    else
        warn "CSXS.$version  PlayerDebugMode could not be set"
        FAILED=$((FAILED + 1))
    fi
done

# preferences are cached per session; this makes the change visible to apps
killall cfprefsd >/dev/null 2>&1 || true

if [ "$FAILED" -gt 0 ]; then
    fail "CEP debug mode could not be enabled." \
         "Run: defaults write com.adobe.CSXS.9 PlayerDebugMode 1 (and .10 through .16), then start Photoshop again."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n'
printf ' ===========================================================\n'
printf '  Installation complete\n'
printf ' ===========================================================\n\n'
printf '  Plugin : %s\n' "$TARGET"
if [ "$MODE" = "link" ]; then
    printf '  Mode   : linked to this project folder\n'
else
    printf '  Mode   : copied (the project folder can be moved afterwards)\n'
fi
printf '  CEP    : PlayerDebugMode = 1 for CSXS.9 - CSXS.16\n'
printf '\n'
printf '  Next steps:\n'
printf '    1. Quit Photoshop completely (Cmd+Q, not just the window).\n'
printf '    2. Start Photoshop again.\n'
printf '    3. Choose  Window > Extensions > Bulk Mockup\n'
printf '\n'
printf '  The .debug suffix makes CEP read the bundled .debug file, so the\n'
printf '  DevTools are available at http://localhost:8088 while Photoshop runs.\n'
printf '  The panel remembers your paths, so this is configured once.\n'
printf '  To uninstall, delete the plugin folder above and the\n'
printf '  PlayerDebugMode values. Full details: docs/INSTALL.md\n'
printf '\n'
