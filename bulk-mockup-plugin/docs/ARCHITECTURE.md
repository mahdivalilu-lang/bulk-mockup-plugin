# Architecture

Bulk Mockup is two programs that share one vocabulary:

- **The panel** (`client/`) — HTML/CSS/JavaScript in Chromium, extended by Adobe's CEP runtime. It owns all UI, persistence and error presentation.
- **The engine** (`jsx/`) — ExtendScript inside Photoshop, ES3 only. It owns everything that touches documents: opening, layer resolution, placement, export.

They meet at exactly one seam: `CSInterface.evalScript` going down, a `CSXSEvent` channel coming back.

```
┌─────────────────────────────── Panel (Chromium, ES5+) ───────────────────────────────┐
│                                                                                      │
│  index.html ── store.js ── pickers.js ── ui.js ── app.js                             │
│       │                                            │                                 │
│       │                                    bridge.js ──── evalScript("BulkMockup.x()") │
│       │                                            │                                 │
│       └──────────── CSXSEvent "com.bulkmockup.event" ◄───── progress/log/item/done ──┐│
└──────────────────────────────────────────────────────────────────────────────────────┼┘
                                                                                       │
┌─────────────────────────────── Engine (ExtendScript, ES3) ───────────────────────────┼┐
│                                                                                      ││
│  engine.jsx (flattened from the #include tree)                                      ││
│    core/      constants · errors · utils · cep ──────────────────────────────────────┘│
│               logger                                                                  │
│    modules/   fileSystem · photoshop · smartObject · placement · exporter              │
│    services/  batchRunner   (normalize → inspect → run)                                │
│    api.jsx    the JSON API the panel calls, plus runInteractive()                      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## Design principles

1. **The mockup is read-only input.** It is opened, never saved, and closed only if the engine opened it. Export happens on a duplicate.
2. **Nothing is global in the panel; everything is global in the engine.** ExtendScript has no modules, so `index.jsx` includes files in dependency order and each one augments a single `BM` object. `npm run build` flattens that tree into `engine.jsx`, which is what CEP actually loads. The panel uses the `BMUI` namespace and IIFEs.
3. **Every boundary crossing is a JSON envelope.** A thrown engine error can never reach the panel as the opaque `"EvalScript error."`.
4. **Per-design isolation.** One bad image must cost one design, not the batch.
5. **`try`/`finally` over hope.** Dialog modes, scratch documents and the active document are restored on every exit path, including exceptions.

## Load order

`CSXS/manifest.xml` points `ScriptPath` at `jsx/engine.jsx`, the flattened build of `index.jsx`. Photoshop evaluates it once, the first time the panel is shown:

```
lib/json2.jsx            JSON for ExtendScript (no built-in JSON in ES3)
core/constants.jsx       BM.APP, BM.DEFAULTS, BM.EVENT, error codes
core/errors.jsx          BM.Error, bmFail(), BM.attempt(), describeError()
core/utils.jsx           paths, naming, number coercion, timing, natural sort
core/cep.jsx             PlugPlugExternalObject → CSXSEvent bridge (no-op outside CEP)
core/logger.jsx          levels, file sink, event sink
modules/fileSystem.jsx   path normalisation, design listing, cancel sentinel, text I/O
modules/photoshop.jsx    units, document open/close, layer walking, dialog suppression
modules/smartObject.jsx  resolve, replace, open/commit/discard contents
modules/placement.jsx    import as layer, fit + centre, remove old artwork, backdrop
modules/exporter.jsx     output naming, JPEG/PNG write, CSV
services/batchRunner.jsx config normalisation, pre-flight, the run loop
api.jsx                  BulkMockup.* — returns JSON strings
```

`#include` is resolved relative to the including file, so the tree is relocatable. CEP, however, evaluates `ScriptPath` as a **string** — not with `$.evalFile` — so a relative `#include` is looked up against Photoshop's working directory and fails. `npm run build` therefore emits two flat files: `jsx/engine.jsx` (the manifest entry, no entry call) and `jsx/standalone/BulkMockupStandalone.jsx` (runs interactively from File > Scripts).

## Module map

### Panel

| File | Responsibility | Notable details |
|---|---|---|
| `js/bridge.js` | The only ExtendScript caller | `toLiteral()` serialises objects **twice** (JSON, then as a JS string literal) because `evalScript` takes source text. `unwrap()` turns `{ok,error}` into a rejected promise with `code/message/detail/hint`. `ensureEngine()` re-evaluates `engine.jsx` if `ping` fails. |
| `js/store.js` | Persistence | One `localStorage` key (`bulkmockup.settings.v1`). Read defensively; `applyDefaults()` only runs when nothing is stored. Falls back to an in-memory object if storage is blocked. |
| `js/pickers.js` | File/folder dialogs, layer list | Uses `cep.fs.showOpenDialog` — the only dialog guaranteed modal to Photoshop. When CEP's shim is missing it fails with `BM_BRIDGE` instead of falling back to `<input type="file">`, which returns fake paths. All paths go through `fs.normalizePath`. |
| `js/ui.js` | Toasts, modal, log, progress | Log is capped (newest kept); auto-scroll is respected. Errors render `message`, `detail` and `hint` separately. |
| `js/app.js` | Controller | Debounced validate → start → progress → summary. Owns the sentinel write/clear around a run. |
| `lib/CSInterface.js` | Adobe's library | Vendored; regenerate with `npm run vendor:csinterface`. |

### Engine

| File | Responsibility | Key functions |
|---|---|---|
| `core/constants.jsx` | Single source of truth for defaults, enums, error codes | `BM.DEFAULTS`, `BM.ERROR_CODES`, `BM.EVENT` |
| `core/errors.jsx` | Structured errors | `bmFail(code, detail, hint)` throws `BM.Error`; `BM.attempt(fn)` wraps it in an envelope; `describeError` never leaks a raw host exception |
| `core/utils.jsx` | Pure helpers | `naturalCompare`, `sanitizeFilename`, `applyTemplate`, `px`, `number`, `bool`, `oneOf`, `now`, `formatDuration`, `csvCell` |
| `core/cep.jsx` | Event dispatch | `BM.cep.emit(type, payload)`, `emitProgress`, `breathe(ms)` |
| `core/logger.jsx` | Levels + sinks | `BM.log.start({level, file, label, echo})`, `debug/info/success/warn/error`, `stop()` |
| `modules/fileSystem.jsx` | Paths and disk | `normalizePath` (handles `file:///C:/…` and `%20`), `listDesigns`, `uniqueFile`, `assertWritable`, `isCancelRequested` |
| `modules/photoshop.jsx` | Host wrapper | `assertHost`, `openDocument`, `closeDocument`, `duplicate`, `setActiveDocument`, `pushQuiet`/`popQuiet`, `info` |
| `modules/smartObject.jsx` | Smart Object lifecycle | `resolveTargetLayer`, `replaceContents`, `openContents`, `commitContents`, `discardContents`, `convertToSmartObject` |
| `modules/placement.jsx` | Geometry | `computeScale`, `importFileAsLayer`, `fitAndCenter`, `removeLayersExcept`, `addBackgroundFill` |
| `modules/exporter.jsx` | Writing files | `buildOutputFile`, `save`, `writeCsvReport` |
| `services/batchRunner.jsx` | Orchestration | `normalize`, `coerceConfig`, `inspect`, `run` |
| `api.jsx` | Boundary | One function per panel action, each returning a JSON string |

## The API surface

`bridge.call('start', config)` becomes `BulkMockup.start(<string literal>)`. Objects arrive as JSON **strings**, which is why each entry point starts with `batch.coerceConfig`.

| Function | Argument | Returns (`data`) |
|---|---|---|
| `ping()` | — | `{name, version, build, events, …}` — used as the liveness probe |
| `listSmartObjectLayers(path)` | path string | `{file, document: {name,width,height,resolution}, layers: [{name,path,depth,isGroup,isSmartObject,visible}], smartObjects: [layerPath]}` — opens the PSD, lists it, closes it again if it was closed |
| `inspect(config)` | config JSON | `{ok, canRun, checks, counts, warnings, config}` |
| `start(config)` | config JSON | Run summary — resolves only when the batch **finishes**; progress arrives meanwhile as events |
| `cancelPath()` | — | `{path}` — where the panel must create the sentinel |
| `clearCancel()` | — | `{cleared}` |
| `revealFolder(path)` / `revealFile(path)` | path string | `{path}` |
| `savePanelLog({folder,text})` | JSON | `{path}` — the panel's log, for bug reports |
| `about()` | — | Version, host build, event count |
| `runInteractive()` | — | Prompts for the four paths, runs, alerts a summary. Used by the standalone script. |

### Envelope

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "BM_LAYER_MISSING", "message": "…", "detail": "…", "hint": "…" } }
```

`BM.attempt()` produces both shapes, so an unexpected exception still becomes a valid envelope with `BM_UNKNOWN`. `bridge.unwrap()` rejects with a plain object carrying the same four fields, which is what `app.js` renders in the modal.

## Event protocol

One channel — `com.bulkmockup.event` — multiplexed by a `type` field. The engine never blocks on a listener; if the panel is gone, `emit` returns `false` and the batch continues.

| `type` | Payload |
|---|---|
| `log` | `{level, message, time, meta?}` |
| `progress` | `{index, total, done, succeeded, failed, remaining, percent, file, elapsedMs, etaMs}` — `etaMs: -1` until the first item completes |
| `item` | `{index, total, design, status, output, message, durationMs}` — emitted after every design, including failures |
| `done` | `{summary}` — the same object `start()` returns |

`etaMs` is the average of completed items times the remainder; it deliberately ignores the current item, so it is pessimistic rather than jumpy.

## Cancellation

ExtendScript is single-threaded and `evalScript` is queued on that thread. Calling `BulkMockup.cancel()` while a batch runs would execute **after** the batch, which is useless. A file on disk is visible immediately, so cancellation is a sentinel:

```
panel                                  engine (inside a running loop)
  │                                      │
  ├─ GET  BulkMockup.cancelPath() ──────►│  {path}
  │◄─────────────────────────────────────┤
  ├─ create  <temp>/bulkmockup.cancel     │
  │                                      ├─ ...after each design:
  │                                      │   isCancelRequested()
  │                                      │     = new File(path).exists
  │                                      ├─ true → break, finish report
  │◄──── done {summary.cancelled:true} ───┤
  ├─ next run: clearCancel() ────────────►│ deletes a stale sentinel
```

- The sentinel is `<system temp>/bulkmockup.cancel` (`Folder.temp`), so no permissions beyond a normal user are needed.
- The panel writes it and never deletes it; the engine does `clearCancelFlag()` at the start of every run, and the panel calls `clearCancel` before `start`. That makes a crash mid-run self-healing instead of leaving a file that cancels the following run.
- Granularity is one design. A 30-second export is not interrupted mid-write.
- `bridge.writeSentinel` prefers `cep.fs.writeFile`, falls back to Node's `fs` when `--enable-nodejs` is on, and finally tries an engine-side `File.open('w')` — the last one is queued behind the batch, so it only helps if the engine is idle.

## Replacement strategies

The config field is `strategy`: `auto` | `replaceContents` | `editContents`.

### `replaceContents` — fast

Photoshop's native *Replace Contents*, via `placedLayerReplaceContents` with the design's path in the descriptor.

- Replaces the Smart Object's source file, so the layer keeps its existing transform, effects and mask.
- Does **not** honour fit, padding or background fill — Photoshop re-renders the old placement. `inspect()` warns about this instead of silently ignoring the options.
- Fastest by a wide margin: no Smart Object document is opened.
- Fails when the source is a vector PDF, an odd colour mode, or a linked Smart Object that Photoshop refuses to relink.

### `editContents` — precise

1. `openContents(layer)` — `placedLayerEditContents`, which opens the Smart Object as a temporary document.
2. `importFileAsLayer(contentsDoc, file)` — opens the design, duplicates its layer into the contents document (`ElementPlacement.PLACEATBEGINNING`), and closes the design with `DONOTSAVECHANGES`. The system clipboard is only a fallback for a document that refuses a cross-document duplicate.
3. `removeLayersExcept(contentsDoc, artwork)` — removes the previous artwork **by layer id**, walking backwards so indices stay valid.
4. `addBackgroundFill(contentsDoc, colour)` when requested — a solid layer at the back, added *after* the purge so it is not removed with the old artwork.
5. `fitAndCenter(contentsDoc, artwork, {fitMode, paddingPercent})` — scale from the artwork layer's own bounds, then translate so its centre matches the canvas centre. `contain`, `cover` and the legacy `stretch` resize first; `center` skips the resize entirely. The backdrop is not scaled.
6. `commitContents(contentsDoc)` — closes with `SAVECHANGES`, which is what makes Photoshop re-render the Smart Object.

### `auto` — try, then fall back

`auto` uses `replaceContents` for the default placement (contain, no padding, no background fill), and switches straight to `editContents` when the run asks for a different fit, padding or a background fill — the fast path cannot honour those options. If the fast path throws, it falls back to `editContents`. If the fallback also throws, the design fails with `BM_SMART_OBJECT_FAILED` and the run continues.

### Placement maths

`computeScale` implements the fit modes on the *layer's current bounds*, not the document size, so a Smart Object occupying a corner of the mockup still centres correctly:

```
contain : s = min(availW / w, availH / h)     // whole artwork visible
cover   : s = max(availW / w, availH / h)     // fills, crops the overflow
center  : s = 1                                // native size, centred
stretch : separate sx, sy                     // explicit distortion
```

`availW/H` is the canvas inset by `paddingPercent` on each side. Padding is clamped to 45% internally (the UI offers 0–20) because 50% collapses the available area to zero. Padding is ignored by `center`, which never scales. After scaling, the layer is translated by `(canvasCentre − boundsCentre)`, which is robust to Smart Objects with unequal layer margins — the legacy script's `Math.min` on document sizes was not.

## Export pipeline

1. `buildOutputFile(folder, designFile, index, options)` resolves the name template, wraps it in the optional prefix/suffix, sanitises the result, and — when not overwriting — finds the next free `name (2).jpg`.
2. If the document needs RGB, 8-bit or a long-edge resize, it is `duplicate()`d and the copy is transformed. Otherwise the document is exported directly, which keeps the common path free of an extra document.
3. JPEG: the panel's 1–100 quality is mapped to Photoshop's 0–12 scale by `jpegQuality()` (85% → 10), with an embedded colour profile, standard baseline, white matte, saved as a copy with `Extension.LOWERCASE`.
4. PNG: compression 0–9, not interlaced.
5. The duplicate is closed with `DONOTSAVECHANGES` on both the success and failure paths, so a failed `saveAs` cannot leak a document.
6. The CSV report is written after the loop: `design,status,output,message`, with RFC-4180-style quoting via `csvCell`.

## Error model

`BM.ERROR_CODES` are stable strings; the panel may map them to copy but never has to parse a message.

| Code | When |
|---|---|
| `BM_NO_APP` | Not running inside Photoshop |
| `BM_BAD_CONFIG` | Unparseable config JSON |
| `BM_MOCKUP_MISSING` / `BM_MOCKUP_UNREADABLE` | Mockup absent, wrong extension, or won't open |
| `BM_DESIGNS_MISSING` / `BM_NO_DESIGNS` | Folder absent, or no supported images |
| `BM_OUTPUT_UNWRITABLE` / `BM_OUTPUT_NOT_WRITABLE` | Cannot create or write |
| `BM_LAYER_MISSING` / `BM_LAYER_NOT_SMART` / `BM_NO_SMART_OBJECTS` | Layer resolution |
| `BM_IMAGE_UNREADABLE` / `BM_UNSUPPORTED_FORMAT` | Per-design input problems |
| `BM_SMART_OBJECT_FAILED` / `BM_EXPORT_FAILED` | Per-design processing problems |
| `BM_DOC_OPEN_FAILED` | Document could not be opened or duplicated |
| `BM_CANCELLED` | Run stopped by the user |
| `BM_UNKNOWN` | Everything else; always carries the host message in `detail` |

Severity is decided by the caller, not the code: the same `BM_IMAGE_UNREADABLE` is fatal in pre-flight and non-fatal inside the loop. Fatal errors abort the run and land in `summary.error`; per-design errors land in `summary.errors` (capped at `MAX_REPORTED_ERRORS`) and the CSV.

## Pre-flight

`inspect(config)` never opens a document, so it is safe to call on every keystroke (the panel debounces it anyway). It returns:

- `checks[]` — `{id, label, status: 'ok'|'warn'|'error', detail}`, ids: `mockup`, `designs`, `output`, `layer`.
- `counts` — `{designs, skipped}` from a real folder listing.
- `warnings[]` — option combinations that would surprise you, e.g. fit/padding ignored by `replaceContents`, background fill ignored, outputs capped.
- `canRun` — no `error` checks.

The layer check cannot be definitive without opening the PSD, so it validates the *name* and warns when the fallback is off.

## Testing

```bash
npm test
```

`tools/test-engine.mjs` loads the real `.jsx` files into a Node `vm` context with stand-ins for `File`, `Folder` and `app`. 17 tests cover:

- JSON round-tripping of the awkward values ExtendScript's `json2` must survive
- natural sort, filename sanitising, name templates, colour parsing
- error description never leaking host internals
- config normalisation and clamping; JSON-string vs object coercion
- fit-mode maths, including `center` never resizing the artwork
- design listing: extension filtering, dotfiles, skipped files, filters, windowing
- pre-flight: complete config, every failure mode, replacement warnings
- CEP path forms (`file:///C:/…`, `%20`, whitespace)
- output naming, deduplication, prefix/suffix wrapping, long-edge maths
- a run aborting cleanly with no mockup, and with an empty designs folder
- export writing the original document when no conversion is needed, and the percentage-to-Photoshop JPEG quality mapping
- `savePanelLog` accepting the JSON string the panel sends

What the harness cannot do: open real PSDs, exercise Smart Object descriptors, or confirm JPEG bytes. Those are covered by the manual checklist below.

`npm run check:panel` complements it from the other side: every `$('id')` in `client/js` must exist in `client/index.html`, every `<script>`/`<link>` must exist on disk, and no `console.log`/`debugger` may ship.

### Manual test checklist

Run after any change under `jsx/modules/` or `jsx/services/`:

- [ ] Ready pill appears; `Window → Extensions → Bulk Mockup` opens without a banner.
- [ ] `Find layers` lists the Smart Objects of a real mockup.
- [ ] 3-design batch with `auto`: three files, correct artwork, correct names.
- [ ] Same batch with `replaceContents`: faster, and the warning about fit appears in Pre-flight.
- [ ] Same batch with `editContents` + `cover` + `10%` padding: artwork fills and is inset symmetrically.
- [ ] Same batch with `center`: artwork keeps its native pixel size and is centred, not scaled.
- [ ] JPEG quality 20 vs 100: the 100 file is visibly larger.
- [ ] Prefix `client` + suffix `final`: outputs are named `client_track_final.jpg`.
- [ ] PNG design with transparency + JPEG output + fill `#ffffff`: no black edges.
- [ ] Missing layer name with fallback off: a single clear error, mockup not left open.
- [ ] A deliberately corrupt `.jpg` in the folder: one item fails, the other two succeed, CSV marks it.
- [ ] Cancel during a 20-design run: stops after the current design, panel returns to Ready, no sentinel left in `%TEMP%`.
- [ ] Output folder on a read-only location: pre-flight or the first write fails with `BM_OUTPUT_NOT_WRITABLE`.
- [ ] Existing output + overwrite off: `name (2).jpg`.
- [ ] Mockup PSD's modification time is unchanged after a run.
- [ ] `Ctrl+Z` after a run does not resurrect a half-replaced Smart Object (documents were closed, not left dirty).

## Extension points

**A new config field** — add it to `BM.DEFAULTS`, normalize it in `batchRunner.normalize`, add a control with a matching id in `index.html`, and add the field to `store.js` `FIELDS`. `check:panel` will catch a missing id.

**A new output format** — extend `exporter.save` with the format branch and add the extension to `buildOutputFile`. Keep `notes` accurate: it drives the log.

**A new replacement strategy** — add the branch in `app.js`'s strategy select and in `applyDesign` inside `batchRunner.jsx`; keep `replaceContents`/`editContents` as the only two primitives so `auto` stays meaningful.

**A new event** — add the `type` constant to `BM.EVENT` and a case in `bridge.onEvent` (`bridge.js`). The channel itself never changes.
