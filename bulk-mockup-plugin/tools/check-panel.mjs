/**
 * Panel consistency checks.
 *
 * The panel is plain JavaScript with no bundler, so nothing catches a typo'd
 * element id or a `<script>` tag that was never added until someone opens the
 * panel in Photoshop. This script closes that gap in CI:
 *
 *   1. every `$('foo')` / `getElementById('foo')` in client/js must resolve to
 *      an id that exists in client/index.html;
 *   2. every file referenced by a <script>/<link> in index.html must exist;
 *   3. every id the store persists must exist too;
 *   4. no leftover `console.log`/`debugger` statements ship;
 *   5. the panel scripts load in dependency order;
 *   6. the ExtendScript sources avoid identifiers that ExtendScript reserves;
 *   7. the manifest's flattened engine exists and is self-contained.
 *
 * Run with:  npm run check:panel
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'client', 'index.html');
const CSS_PATH = path.join(ROOT, 'client', 'css', 'panel.css');
const JS_DIR = path.join(ROOT, 'client', 'js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

function collect(html, pattern) {
    const out = new Set();
    for (const match of html.matchAll(pattern)) out.add(match[1]);
    return out;
}

const declaredIds = collect(html, /\sid="([^"]+)"/g);
const referencedAssets = [...collect(html, /(?:src|href)="([^"]+)"/g)].filter((p) => !p.startsWith('#') && !p.startsWith('http'));

/* 1 + 2: referenced assets exist */
const missingAssets = referencedAssets.filter((relative) => !fs.existsSync(path.join(ROOT, 'client', relative)));
assert.deepEqual(missingAssets, [], `index.html references missing files: ${missingAssets.join(', ')}`);

/* 3: every id used from JavaScript exists in the markup */
const jsFiles = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
const usage = new Map();

for (const file of jsFiles) {
    const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    for (const match of source.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
        if (!usage.has(match[1])) usage.set(match[1], []);
        usage.get(match[1]).push(file);
    }
    for (const match of source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        if (!usage.has(match[1])) usage.set(match[1], []);
        usage.get(match[1]).push(file);
    }
    for (const match of source.matchAll(/id:\s*'([^']+)'/g)) {
        if (!usage.has(match[1])) usage.set(match[1], []);
        usage.get(match[1]).push(file);
    }
}

const unknown = [...usage.entries()]
    .filter(([id]) => !declaredIds.has(id))
    .map(([id, files]) => `${id} (used in ${[...new Set(files)].join(', ')})`);

assert.deepEqual(unknown, [], `JavaScript references ids that are not in index.html:\n  ${unknown.join('\n  ')}`);

/* 4: no debug leftovers */
const debugLeftovers = [];
for (const file of jsFiles) {
    const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    if (/^\s*debugger\s*;?\s*$/m.test(source)) debugLeftovers.push(`${file}: debugger statement`);
    if (/console\.log\(/.test(source)) debugLeftovers.push(`${file}: console.log`);
}

assert.deepEqual(debugLeftovers, [], `remove debug code before shipping:\n  ${debugLeftovers.join('\n  ')}`);

/* 5: load order in index.html matches the dependency chain */
const scriptOrder = [...collect(html, /<script src="js\/([^"]+)"/g)];
assert.deepEqual(
    scriptOrder,
    ['bridge.js', 'store.js', 'ui.js', 'pickers.js', 'app.js'],
    'panel scripts must load in dependency order (bridge -> store -> ui -> pickers -> app)'
);

/* 5b: OPTIONS is a JS-driven section, never a native disclosure widget.
 *
 * CEP 9/10 (Chromium 61/74) crashed Photoshop while laying out the Options
 * content inside a <details>/<summary>. Keep the section on the plain
 * div + state-class path, and keep event handlers out of the markup. */
assert.ok(
    !/<details[\s>]/i.test(html) && !/<summary[\s>]/i.test(html),
    'index.html must not use <details>/<summary> — Options is a JS-managed collapsible'
);
assert.ok(
    !/\son(?:click|change|input)\s*=/i.test(html),
    'index.html must not contain inline event handlers — bind them in app.js'
);
assert.ok(
    /\sid="optionsCard"/.test(html) &&
    /\sid="optionsHeader"/.test(html) &&
    /\sid="optionsBody"/.test(html),
    'Options must provide optionsCard, optionsHeader and optionsBody for the collapsible controller'
);
assert.ok(
    /\sid="optionsBody"[^>]*\shidden(?:\s|>)/.test(html),
    'optionsBody must start hidden so its controls are inert before the section is opened'
);
assert.ok(
    /#optionsBody\s*\{[^}]*display:\s*none/.test(css),
    'panel.css must hide #optionsBody with display:none'
);
assert.ok(
    !/max-height\s*:\s*5000px/i.test(css),
    'panel.css must not animate #optionsBody with a large max-height'
);

/* 5c: zero-risk UI invariants.
 *
 * The panel must stay on primitives that every CEF build (Chromium 61+) and
 * the host's compositor handle identically. These checks make a regression
 * impossible to ship silently: no animation/transition/transform, no CSS
 * grid or `gap` (so no feature probe is needed), no fixed overlays, and no
 * layout-measuring JS. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/@keyframes/i.test(cssCode), 'panel.css must not declare @keyframes');
assert.ok(
    !/(?:^|[;{])\s*(?:-webkit-)?animation\s*:/im.test(cssCode),
    'panel.css must not declare animation'
);
assert.ok(
    !/(?:^|[;{])\s*(?:-webkit-)?transition\s*:/im.test(cssCode),
    'panel.css must not declare transition'
);
assert.ok(
    !/(?:^|[;{])\s*(?:-webkit-)?transform\s*:/im.test(cssCode),
    'panel.css must not declare transform'
);
assert.ok(!/position\s*:\s*(?:fixed|sticky)/i.test(cssCode), 'panel.css must not use fixed or sticky positioning');
assert.ok(!/display\s*:\s*grid/i.test(cssCode), 'panel.css must not use CSS grid');
assert.ok(!/\bgap\s*:/i.test(cssCode), 'panel.css must not rely on flex/grid gap');
assert.ok(!/\bresize\s*:/i.test(cssCode), 'panel.css must not expose a manual resize handle');

const clientSources = jsFiles
    .map((file) => fs.readFileSync(path.join(JS_DIR, file), 'utf8'))
    .join('\n');
assert.ok(
    !/requestAnimationFrame|ResizeObserver|MutationObserver|IntersectionObserver|getBoundingClientRect|offsetHeight|scrollIntoView|setInterval\s*\(/.test(clientSources),
    'client JS must not use layout measurement, observers, animation frames or intervals'
);
assert.ok(!/\sstyle\s*=/i.test(html), 'index.html must not contain inline style attributes');
assert.ok(
    /\sid="panelMain"/.test(html) && /\sid="toast"/.test(html),
    'index.html must provide the scroll container and the single in-flow status line'
);
assert.ok(
    !/modal-backdrop|id="toasts"/.test(html),
    'index.html must not use fixed modal/toast overlays'
);

/* 6: no identifiers ExtendScript reserves as keywords.
 *
 * V8 (and therefore `npm test`) happily accepts these, but ExtendScript throws
 * "Expected: (" and the whole engine fails to load — which is exactly how
 * `function native()` shipped once. Keep the list to words that are legal
 * JavaScript identifiers but reserved by ExtendScript.
 */
const EXTENDSCRIPT_RESERVED = [
    'abstract', 'boolean', 'byte', 'char', 'class', 'const', 'debugger', 'double',
    'enum', 'export', 'extends', 'final', 'float', 'goto', 'implements', 'import',
    'int', 'interface', 'long', 'native', 'package', 'private', 'protected',
    'public', 'short', 'static', 'synchronized', 'throws', 'transient', 'volatile'
];
const reservedPattern = new RegExp(`\\b(?:function|var|let|const)\\s+(${EXTENDSCRIPT_RESERVED.join('|')})\\b`, 'g');
const reservedHits = [];
for (const file of walk(path.join(ROOT, 'jsx')).filter((f) => !f.includes(`${path.sep}standalone${path.sep}`))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(reservedPattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        reservedHits.push(`${path.relative(ROOT, file)}:${line}: ${match[1]}`);
    }
}
assert.deepEqual(reservedHits, [], `ExtendScript reserves these identifiers (rename them):\n  ${reservedHits.join('\n  ')}`);

/* 7: the CEP entry point is the flattened build, not the #include tree */
const enginePath = path.join(ROOT, 'jsx', 'engine.jsx');
assert.ok(fs.existsSync(enginePath), 'jsx/engine.jsx is missing — run npm run build');
const engineSource = fs.readFileSync(enginePath, 'utf8');
assert.ok(
    !/^\s*#include\s/m.test(engineSource),
    'jsx/engine.jsx still contains #include — CEP evaluates ScriptPath as text, so run npm run build'
);
assert.ok(
    !/^\s*BulkMockup\.runInteractive\(\);/m.test(engineSource),
    'jsx/engine.jsx must not run interactively — run npm run build'
);

console.log(`panel check passed — ${declaredIds.size} ids, ${usage.size} referenced, ${scriptOrder.length} scripts in order`);
