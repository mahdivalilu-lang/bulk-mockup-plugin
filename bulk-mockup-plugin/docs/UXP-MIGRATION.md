# UXP migration notes

This plugin is a **CEP** extension. That is a deliberate choice, not an oversight, and this document explains why, what a UXP port would involve, and how the current code is shaped so the port is a rewrite of the host layer rather than of the batch logic.

Nothing here is implemented. There is no UXP build in this repository.

## Why CEP today

| | CEP (current) | UXP |
|---|---|---|
| Runs in | Chromium (CEF) + separate ExtendScript engine | Photoshop's own JS runtime (no ExtendScript) |
| Language | Panel: ES5+; engine: **ES3** | Modern JS (ES2020+), but no DOM, no browser APIs |
| UI | Any HTML/CSS/JS you like, no build step | HTML + CSS subset, Spectrum Web Components, no `<iframe>`, limited layout |
| Photoshop API | Full ExtendScript DOM + Action Manager | `require('photoshop')` + `batchPlay`, modal-scoped writes |
| File I/O | Synchronous `File`/`Folder` | Async `fs` (or the UXP storage APIs) |
| Distribution | `.zxp` / folder in `CEP/extensions` | Folder in `UXP/plugins`, or Creative Cloud Marketplace |
| Host support | Photoshop CC 2019+ ships CEP 9+; 2022+ ships CEP 11 | Photoshop 22+ ships UXP; 23+ for the full API |

The deciding factor is that the batch logic is **already written and battle-tested in ExtendScript**. A CEP port reuses it verbatim (that is literally what the `jsx/` engine is), while a UXP port rewrites every document operation against a different API and loses the ability to test the engine headlessly in Node. CEP is also still shipped with every Photoshop release covered by the manifest, so the panel works today on CC 2019 through the current release (CEP 9+, tuned for 2022+/CEP 11).

The long-term direction from Adobe is UXP, and at some point CEP will stop being updated. When that happens, this document is the escape route.

## What changes, concretely

### 1. No ExtendScript engine, and no bridge

The single biggest difference: there is no second runtime. The panel *is* the plugin. `CSInterface.evalScript` and the `CSXSEvent` channel disappear, because the code that used to live in Photoshop now runs in the same context as the UI.

```
CEP                                    UXP
┌─ Chromium ──────────┐                ┌─ Photoshop UXP runtime ─────────────┐
│ panel JS            │                │ panel JS + engine JS (same context) │
│   │ evalScript       │                │   │ await photoshop API           │
│   ▼                  │                │   ▼                               │
│ ExtendScript engine  │                │ (no separate engine)               │
│   │ CSXSEvent        │                │                                     │
│   ▼                  │                │                                     │
│ panel JS             │                │                                     │
└──────────────────────┘                └─────────────────────────────────────┘
```

Consequences:

- The JSON envelope (`{ok,data}` / `{ok,error}`) becomes redundant at the transport level — but keep it as an internal result type, because the panel already renders `code/message/detail/hint` and that error model is still right.
- Progress no longer needs a file or a global channel: the run loop can call an `onProgress` callback directly.
- Cancellation no longer needs a sentinel file: an `AbortSignal`-style flag is enough, because the loop can actually be interrupted between `await`s.

### 2. `executeAsModal` changes the shape of the run loop

UXP requires document mutations to happen inside `core.executeAsModal(callback, {commandName})`. Two patterns work:

```js
// A. One modal scope per design — safer, slower, yields between designs.
for (const design of designs) {
    await core.executeAsModal(async () => {
        await replaceContents(design);
    }, { commandName: `Bulk Mockup: ${design.name}` });
    onProgress(design);           // outside the modal scope
    await new Promise(r => setTimeout(r, delayMs));
}
```

```js
// B. One long modal scope — faster, but blocks the UI and can hit history limits.
await core.executeAsModal(async (ctx) => {
    for (const design of designs) {
        if (aborted) break;
        await replaceContents(design);
        if (typeof ctx.reportProgress === 'function') ctx.reportProgress(percent / 100);
    }
}, { commandName: 'Bulk Mockup batch' });
```

Option A is the better default: it gives every design its own undo step, keeps Photoshop responsive, and maps 1:1 onto the current per-design isolation. Option B is worth offering as an "advanced" toggle because opening and closing a modal scope 300 times is noticeably slower.

### 3. The Photoshop API mapping

| Current (ExtendScript) | UXP equivalent | Notes |
|---|---|---|
| `app.open(file)` | `app.open(fileEntry)` | Async; fails on some cloud documents |
| `doc.close(SaveOptions.DONOTSAVECHANGES)` | `doc.close(photoshop.constants.SaveOptions.DONOTSAVECHANGES)` | Still inside a modal scope |
| `doc.artLayers.getByName(name)` | `doc.layers.find(l => l.name === name)` | Recursive for groups; no equivalent of `getByName` |
| `layer.kind === LayerKind.SMARTOBJECT` | `layer.kind === constants.LayerKind.SMARTOBJECT` | |
| `layer.resize(%, %, AnchorPosition.MIDDLECENTER)` | `layer.scale(x, y, constants.AnchorPosition.MIDDLECENTER)` | Percent vs factor: UXP `scale` takes percentages too, but check the sign convention for flips |
| `layer.translate(dx, dy)` | `layer.translate(dx, dy)` | Async |
| `layer.bounds` (Array of UnitValues) | `layer.bounds` (`{left, top, right, bottom}` numbers) | Distinct from `boundsNoEffects`; use the same one the engine uses |
| `executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc)` | `action.batchPlay([{_obj: 'placedLayerReplaceContents', null: {_path: token}}], {})` | Needs a `token` from `fs.createSessionToken(file)`, not a string path |
| `executeAction('placedLayerEditContents')` | `batchPlay` with the same descriptor | Returns with the Smart Object document active |
| `File` / `Folder` | `require('uxp').storage.localFileSystem` | Async; `getTemporaryFolder()` replaces `Folder.temp` |
| `file.open('w')` + `write` + `close` | `await file.write(text, {format: formats.utf8})` | One call |
| `$.sleep(ms)` | `await new Promise(r => setTimeout(r, ms))` | UXP has real timers |
| `app.refresh()` | Not needed; the UI thread is not blocked the same way | Progress repaints happen between `await`s |
| `DialogModes.NO` | `batchPlay(..., {modalBehavior: 'execute'})` on each call | No global dialog suppression; descriptor calls default to non-interactive |
| `Folder.selectDialog()` | `fs.getFolder()` | Opens the OS picker |
| `alert()` | `core.showAlert({message})` | Or a DOM dialog, as the panel already has |
| `app.activeDocument` | `app.activeDocument` | Throws when no document is open — keep the existing guard |

`placedLayerReplaceContents` and `placedLayerEditContents` both survive as batchPlay descriptors, which is why the two replacement strategies port with their logic intact. The one change is the path argument: UXP wants a **session token** for the file, not a filesystem path.

### 4. The panel UI

- HTML is parsed by UXP's own engine, not Chromium: no `<iframe>`, no `<object>`, no arbitrary inline event handlers, and a CSS subset (no `gap` in older UXP versions; flexbox support is partial).
- The current stylesheet is plain flexbox + CSS custom properties. It already carries a sibling-margin fallback for CEP 9/10, where flexbox `gap` is missing; UXP has a similar limitation (`row-gap`/`column-gap` on flex containers is spotty before UXP 7.x), so the same fallback idea applies there.
- The pragmatic route is [Spectrum Web Components](https://opensource.adobe.com/spectrum-web-components/) (`sp-button`, `sp-textfield`, `sp-progress-bar`), which also makes the panel feel native. That is a UI rewrite, not a port.
- `localStorage` exists in UXP but is not guaranteed across versions; `fs` with a JSON file in the plugin's data folder is the safer store. The shape of `store.js` (one versioned key, defensive reads) survives.

### 5. Manifest and packaging

| CEP | UXP |
|---|---|
| `CSXS/manifest.xml` (XML, `ExtensionBundleId`, `HostList`) | `manifest.json` (`manifestVersion: 5`, `id`, `host.app: "PS"`, `host.minVersion`) |
| `<ScriptPath>` + `<MainPath>` | `entrypoints: [{type: "panel", id: "main", main: "index.html"}]` |
| `%APPDATA%\Adobe\CEP\extensions\<id>` | `%APPDATA%\Adobe\UXP\plugins\<id>` (macOS: `~/Library/Application Support/Adobe/UXP/plugins`) |
| `PlayerDebugMode` registry key | Developer Tool via UXP Developer Tool (`udt`), no registry edit |
| `ZXPSignCmd` → `.zxp` | Creative Cloud Marketplace, or direct distribution of the plugin folder |

There is no `#include` in UXP. The engine modules become ES modules (`import`/`export`) bundled by esbuild — or kept as one file, since there is no ES3 constraint forcing the split.

## What ports unchanged

- **The config schema** (`BM.DEFAULTS`): every field survives as-is, including `{name}`/`{index}` templates, fit modes and padding. It is a data structure, not host code.
- **The error codes and messages.** They are user-facing copy; keep them and the panel's error modal.
- **The pre-flight rules** (`inspect`): the only host-coupled part is "does this PSD exist and is it a PSD", which becomes an `fs` stat.
- **The placement maths** (`computeScale`, centre-by-bounds). Pure arithmetic — port it literally, and keep the unit tests.
- **The naming/deduplication logic** (`buildOutputFile`, `sanitizeFilename`, long-edge cap).
- **The CSV report** format.
- **Most of `panel.css`**, modulo `gap` and any `backdrop-filter`.
- **The test suite**, if the host calls are kept behind a thin adapter (see below).

## Suggested shape

```
plugin/
├── manifest.json                 v5
├── index.html
├── css/panel.css
├── js/
│   ├── main.js                   entrypoint: create panel, wire UI
│   ├── ui/                       (was client/js, minus bridge)
│   ├── engine/
│   │   ├── host.js               THE adapter: every photoshop/fs call lives here
│   │   ├── smartObject.js        resolve, replace, edit — same structure as today
│   │   ├── placement.js          pure maths + host calls
│   │   ├── exporter.js
│   │   └── batchRunner.js        async loop, per-design modal scope
│   └── config/defaults.js
└── test/
    ├── host.fake.js              the Node stand-in, as tools/test-engine.mjs has now
    └── *.test.js
```

The key structural move is `engine/host.js`: an async interface with methods like `openDocument(file)`, `closeDocument(doc, save)`, `replaceSmartObject(layer, token)`, `openSmartObjectContents(layer)`, `listLayers(doc)`. Two implementations — one against `require('photoshop')`, one against fakes — and the batch logic stays testable in Node exactly as it is today. That adapter does not exist in the current code because ExtendScript's globals made it unnecessary; introducing it now is the single change that would make the port cheap later.

## Migration plan

Phased, with the intent that each phase ships something usable.

| Phase | Work | Rough size |
|---|---|---|
| 0 | Extract `host.js` in the *current* engine so all Photoshop access goes through one surface. No behaviour change. | 1–2 days |
| 1 | Skeleton UXP plugin: manifest v5, empty panel, `executeAsModal` smoke test, `fs` paths, `listSmartObjectLayers`. | 2–3 days |
| 2 | `replaceContents` strategy via batchPlay + session tokens; one design end-to-end, JPEG export. | 2–4 days |
| 3 | `editContents` strategy: `placedLayerEditContents`, layer import, fit/centre, purge by id, commit. | 3–5 days |
| 4 | Batch loop with per-design modal scopes, progress callbacks, cancellation, CSV/log. | 2–3 days |
| 5 | Panel UI port to Spectrum components; keep the DOM ids and ids-based controller where possible. | 3–5 days |
| 6 | Packaging, icons, a UXP-specific install doc, side-by-side testing on 23/24/25. | 1–2 days |

Total: roughly 2–3 weeks of focused work, dominated by phase 3 (Smart Object contents) and phase 5 (UI), not by the batch logic.

## Risks and gotchas

- **`executeAsModal` nesting.** `placedLayerEditContents` opens a document *inside* the modal scope; the subsequent import must stay in the same scope. Scope leaks are the classic UXP bug: a thrown error inside the callback still ends the scope, but a `return` before the mutation can leave state half-applied. Wrap each design in `try/finally` exactly as `applyDesign` does now.
- **Session tokens.** A `File` object is meaningless to batchPlay; `fs.createSessionToken(entry)` must be created inside the modal scope and is only valid for that scope. Do not cache tokens across designs.
- **No `DialogModes.NO`.** Descriptor calls are non-interactive by default, but `app.open` can still surface a colour-profile or missing-fonts prompt. Test with awkward files (CMYK JPEG, 16-bit PNG, PDF).
- **Layer identities.** UXP layer objects are handles; after a `batchPlay` call that changes the document, re-fetch rather than reuse. The current `removeLayersExcept` compares `layer.id`, and UXP exposes `layer.id` too — but only after refresh in some versions.
- **History.** One modal scope per design means one undo step per design; a 500-design batch produces 500 history states. Consider `app.activeDocument.suspendHistory` (or `executeAsModal` with `historyStateInfo`) around the whole batch.
- **Progress granularity.** UXP has real timers, so the current `pace`/`breathe` dance is unnecessary — but the modal scope must actually `await` between designs or the panel never repaints.
- **Testing.** The current 17 tests run the real engine in Node. That only remains possible if the host adapter is dependency-injected. Decide this in phase 0, not phase 4.

## If you only need this to keep working

Nothing here needs doing. The CEP panel targets Photoshop CC 2019+ (CEP 9+), and CEP is still shipped with current releases. The migration becomes urgent only when:
- Adobe announces a Photoshop version without CEP, or
- you need Marketplace distribution (UXP only), or
- you want to support Photoshop on the web / iPad (UXP only).

Until then, the highest-value work is keeping the engine tests green and the standalone script building, because those are the two things that survive the port.
