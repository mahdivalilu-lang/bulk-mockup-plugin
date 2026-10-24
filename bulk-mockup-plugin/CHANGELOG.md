# Changelog

All notable changes to Bulk Mockup are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Fit mode `center`.** The artwork keeps its native pixel size and is only translated so its centre matches the Smart Object canvas — useful when the design is already authored at the exact size and must not be resampled.
- **Percentage-based JPEG quality.** The panel now offers a 1–100 slider (default 85%) and the exporter maps it onto Photoshop's 0–12 `JPEGSaveOptions.quality` scale.
- **Filename prefix and suffix.** Optional text fields wrap the name template, producing `prefix_original_name_suffix.ext` without needing a second template.
- **Settings migration.** Existing `localStorage` settings are read from the v1 key, their 0–12 JPEG quality is converted to a percentage, and they are rewritten under the v2 key.
- **One-click installers.** `install.bat` (Windows) and `install.sh` (macOS) install the panel into the per-user CEP extensions folder, enable `PlayerDebugMode` for `CSXS.9`–`CSXS.16`, remove an older non-debug copy, verify the result and print the restart instructions. No terminal knowledge required on Windows (double-click), one command on macOS.
- `install.bat` requests elevation only when a write is refused, then continues automatically; it does not require Administrator rights for a normal user install. `install.sh` refuses to run under `sudo` so the panel cannot land in root's home directory.
- `--link` mode for both installers: a junction (Windows) or symlink (macOS) instead of a copy, for development. `--no-pause` and `--help` for automation and discovery.
- Both installers are idempotent: re-running replaces the previous installation and leaves saved panel settings intact.
- The Windows installer removes a previous junction without touching the folder it points at, which is covered by an explicit test.

### Changed

- **`auto` honours the placement options.** When the fit, padding or background fill differs from the defaults, `auto` now uses the precise `editContents` path instead of native *Replace Contents*, which cannot apply those settings. The fast path is still used for the default contain/no-padding/no-fill run.
- JPEG quality is now displayed and stored as 1–100 instead of Photoshop's 0–12 scale; the engine converts at export time.
- The installers now use `com.bulkmockup.panel.debug` instead of the plain folder name. CEP reads the bundled `.debug` file — and therefore the remote DevTools port — only when the folder ends that way. The manifest bundle id is unchanged.
- `PlayerDebugMode` coverage widened from `CSXS.11`–`.14` to `CSXS.9`–`.16`, covering Photoshop CC 2019 (CEP 9) through current builds.
- Both installers remove a leftover `com.bulkmockup.panel` folder before finishing. Two folders with the same bundle id make CEP load an arbitrary copy, which is the classic "installed but nothing changed" failure. The folder the installer is running from is never removed.
- **Older Photoshop support.** The manifest now advertises PHXS/PHSP `[16.0,99.9]` and requires CSXS `9.0`, so the panel loads on Photoshop CC 2019 (CEP 9) and later instead of 2022+ only. The manifest schema version was lowered from `10.0` to `7.0` because CEP 9 cannot parse a newer manifest version.
- **CEP 9/10 layout fallback.** Those engines (Chromium 61/74) have no flexbox `gap`; `index.html` now measures support once and `panel.css` switches to sibling-margin spacing when it is missing. Current CEP keeps the original gap-based layout. `grid-gap` and `-webkit-appearance` were added for the same reason.
- `README.md`, `docs/INSTALL.md` and `docs/UXP-MIGRATION.md` now state CC 2019+/CEP 9 as the minimum, with 2022+/CEP 11 as the tuned target.
- `README.md` now presents the one-click installer as the primary installation method; the manual symlink, ZXP and standalone routes moved to `docs/INSTALL.md`.
- `docs/INSTALL.md` restructured around the installer, with the manual route kept for troubleshooting and remote debugging.

### Fixed

- **Restored settings left derived UI state stale.** Slider labels and the JPEG/PNG field visibility were only refreshed when defaults were applied, not when `localStorage` restored a session, so a saved PNG format could leave the JPEG quality slider on screen. The panel now syncs those fields immediately after restoring.
- **The panel could not reach the engine on Photoshop 2021.** The manifest's `ScriptPath` was `jsx/index.jsx`, but CEP evaluates that file's *contents* as a script string, where relative `#include`s resolve against Photoshop's working directory and fail. The entry point is now `jsx/engine.jsx`, a generated flattened copy of the same tree; `jsx/index.jsx` remains the `#include` source for development.
- **ExtendScript rejected `function native()`.** `native` is a reserved word in ExtendScript, so `jsx/services/batchRunner.jsx` failed to compile and the entire engine stayed undefined (`EvalScript error.` for every call). The helper is now `fastReplace`, and `npm run check:panel` fails if any ExtendScript-reserved identifier is used as a declaration.
- The panel's fallback loader now re-evaluates the flattened `jsx/engine.jsx` rather than the include tree.
- **Progress events were disabled on Photoshop 2021.** `PlugPlugExternalObject` is exposed as `lib:PlugPlugExternalObject` there; the engine only tried the `lib:\\PlugPlugExternalObject` spelling, so `BM.cep.available` was false and the panel received no live progress. Both spellings are now probed.
- **Live events were dropped once delivered.** Photoshop 2021/CEP 10 hands the panel a parsed object as `event.data` when the payload looks like JSON; the bridge only accepted strings and returned early. It now accepts both shapes.

## [1.0.0] — 2026-10-21

First release. The engine is a rewrite of `bulkMockup .jsx`; the behaviour for the default configuration is intentionally identical.

### Added

**Panel**

- CEP panel with pickers for the mockup PSD, the designs folder and the output folder, all persisted between sessions.
- `Find layers` lists every Smart Object in the mockup and fills the target-layer field.
- Pre-flight validation with per-field status (`ok`/`warn`/`error`), design counts, and warnings for option combinations that would be silently ignored.
- Live progress: percentage, current file, exported/failed/remaining counters, elapsed time and ETA.
- Activity log with levels, copy, save-for-support and clear; the panel's own log can be written to disk for bug reports.
- Cancel button that stops the run after the current design.
- About dialog with engine version, host build and event count.

**Engine**

- Modular ExtendScript tree (`core/`, `modules/`, `services/`, `api.jsx`) loaded by a single `#include` entry point.
- JSON envelope for every API call, so host exceptions never surface as `"EvalScript error."`.
- Two Smart Object replacement strategies — native replace-contents and precise edit-contents — plus an `auto` mode that falls back from the fast one to the precise one per design.
- Fit modes `contain`/`cover`/`stretch`, padding as a percentage of the canvas, and centring computed from the artwork's own bounds.
- Layer resolution by exact name → ordered fallbacks → the only Smart Object, with an optional conversion of a plain layer into a Smart Object.
- JPEG (quality 0–12, embedded profile, baseline) and PNG (compression 0–9) output; long-edge downsampling with bicubic sharper; automatic RGB/8-bit conversion for JPEG on a duplicate.
- File-name templates (`{name}`, `{index}`, `{date}`, `{time}`, `{ext}`), illegal-character sanitising, overwrite-or-keep-both (`name (2).jpg`).
- Natural sort, newest/oldest/largest ordering, substring filter, start-at and limit.
- Optional `.log` and per-design `.csv` report next to the outputs.
- Per-design error isolation: one unreadable image fails one design, not the batch.
- Cancellation via a sentinel file in the temp directory, because ExtendScript cannot be interrupted by a queued `evalScript`.
- `BulkMockup.runInteractive()` and a generated single-file `jsx/standalone/BulkMockupStandalone.jsx` as a drop-in replacement for the legacy script.

**Project**

- CEP manifest targeting Photoshop 2022+ (PHXS/PHSP `23.0`–`99.9`, CSXS 11), vendored `CSInterface.js`, `.debug` remote-debugging config.
- Branding assets generated by `tools/make_logo.py`: panel logo, panel icon, light-background mark, SVG, 1280×360 README banner.
- Tooling: standalone builder, ZXP packager (`ZXPSignCmd`), CSInterface vendoring, panel consistency checker, browser preview harness with a mock CEP runtime, `npm run verify`.
- 15 headless engine tests that execute the real `.jsx` sources in a Node `vm` against fake `File`/`Folder`/`app` objects.
- Documentation: install guide, architecture (module map, protocol, cancellation, strategies, error model), UXP migration notes, manual test checklist.

### Changed from the legacy script

- Hard-coded `~/Desktop/...` paths replaced by pickers. The default layer name is still `tst-music copy` and the default fit is still contain-and-centre.
- The mockup PSD is treated as read-only input. Export happens on a duplicate; the original is never saved, and documents the plugin did not open are never closed.
- The stale-artwork layer is removed **by layer id** instead of "the bottom-most layer", which was only correct for two-layer Smart Objects.
- Importing artwork duplicates the layer directly; the clipboard is used only as a fallback, so a normal run does not touch it.
- Dialog suppression is scoped with `pushQuiet`/`popQuiet` and restored in a `finally`, rather than setting `DialogModes.NO` globally.
- A missing layer, an unreadable image or an unwritable output no longer aborts the run silently; each has a stable `BM_*` error code and a readable message.

### Fixed

These were found while porting and are covered by tests:

- `file:///C:/…` URIs (what CEP's pickers return) were not accepted by `File`; paths are now normalised, including percent-encoding and surrounding whitespace.
- `instanceof File` is unreliable across ExtendScript realms and was replaced with duck-typed entry checks, so folder listings no longer drop valid files.
- Enum-like config values (`fitMode: "COVER"`) were not canonicalised; `oneOf` now matches case-insensitively and falls back to the documented default.
- Slider defaults were applied from the store but not reflected in the HTML `value` attributes, so the first paint showed 0% padding and the wrong quality.
- Transparency fill was being added to the mockup document during export, mutating the user's source PSD one layer per design. It is now applied only inside the Smart Object's contents.
- `savePanelLog` received a JSON string from the panel and silently fell back to the temp directory with empty text; it now coerces the argument like every other entry point.
- A run that needs no RGB/bit-depth/resize no longer duplicates the document just to export it.

### Known limitations

- Cancellation is checked between designs, not inside a single export or Smart Object commit.
- The native replace-contents strategy cannot honour fit, padding or background fill; Pre-flight says so rather than pretending otherwise.
- Photoshop 2021 and older were excluded by the 1.0.0 manifest host range (`23.0`+); the Unreleased section above lowers it to Photoshop 16.0 / CEP 9.
- Link-based Smart Objects that Photoshop refuses to relink, and PDFs with unreadable fonts, still fail — they fail as one design with a message now.
- Engine tests plus panel checks pass headlessly, but this release has not been exercised against every Photoshop version in the host range. Use the manual checklist in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#manual-test-checklist) after installing.
- UXP is not implemented; see [`docs/UXP-MIGRATION.md`](docs/UXP-MIGRATION.md).

### Verification

```
npm run verify
  ✓ check:panel — 74 ids, 73 referenced, 5 scripts in order
  ✓ 15 engine tests pass
  ✓ standalone build (110 KB)
```
