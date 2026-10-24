/**
 * Headless test harness for the ExtendScript engine.
 *
 * The engine cannot be unit-tested by launching Photoshop on CI, so this runs
 * the real source files inside a `vm` context against a small in-memory stand-in
 * for Photoshop's `File`, `Folder` and `app` objects. That covers everything
 * that is pure logic — JSON, path handling, configuration coercion, pre-flight
 * validation — which is where the interesting bugs actually live.
 *
 * Run with:  npm test        (node --test tools/test-engine.mjs)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSX = path.join(ROOT, 'jsx');

/** Modules that contain no Photoshop-only entry points. */
const MODULES = [
    'lib/json2.jsx',
    'core/constants.jsx',
    'core/errors.jsx',
    'core/utils.jsx',
    'core/cep.jsx',
    'core/logger.jsx',
    'modules/fileSystem.jsx',
    'modules/photoshop.jsx',
    'modules/smartObject.jsx',
    'modules/placement.jsx',
    'modules/exporter.jsx',
    'services/batchRunner.jsx',
    'api.jsx'
];

/* --------------------------------------------------------------------------
 * A tiny in-memory file system shaped like ExtendScript's File / Folder.
 * ------------------------------------------------------------------------ */

function slash(p) {
    return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirname(p) {
    const s = slash(p);
    const i = s.lastIndexOf('/');
    return i <= 0 ? '/' : s.slice(0, i);
}

function makeFileSystem(seed) {
    /** path -> { kind: 'file' | 'folder', size, modified } */
    const nodes = new Map();

    for (const [p, meta] of Object.entries(seed)) {
        nodes.set(slash(p), { kind: meta.kind ?? 'file', size: meta.size ?? 1024, modified: meta.modified ?? new Date() });
        // Materialise implied parents so Folder.exists behaves.
        let parent = dirname(p);
        while (parent && parent !== '/' && !nodes.has(parent)) {
            nodes.set(parent, { kind: 'folder', size: 0, modified: new Date() });
            parent = dirname(parent);
        }
    }
    nodes.set('/', { kind: 'folder', size: 0, modified: new Date() });

    function lookup(p) {
        return nodes.get(slash(p));
    }

    class FakeFile {
        constructor(p) {
            this.path = slash(p);
            this.encoding = 'UTF-8';
            this._handle = null;
        }
        get fsName() { return this.path; }
        get name() { return this.path.split('/').pop() ?? ''; }
        get parent() { return new FakeFolder(dirname(this.path)); }
        get exists() { return lookup(this.path)?.kind === 'file'; }
        get length() { return lookup(this.path)?.size ?? 0; }
        get modified() { return lookup(this.path)?.modified ?? new Date(0); }
        get hidden() { return this.name.startsWith('.'); }
        open() { this._handle = ''; return true; }
        write(text) { this._handle += text; return true; }
        close() {
            if (this._handle !== null) {
                nodes.set(this.path, { kind: 'file', size: this._handle.length, modified: new Date() });
                this._handle = null;
            }
            return true;
        }
        remove() { return nodes.delete(this.path); }
        execute() { return true; }
    }

    class FakeFolder {
        constructor(p) {
            this.path = slash(p);
        }
        get fsName() { return this.path; }
        get name() { return this.path.split('/').pop() ?? ''; }
        get exists() { return lookup(this.path)?.kind === 'folder'; }
        create() {
            if (!nodes.has(this.path)) {
                nodes.set(this.path, { kind: 'folder', size: 0, modified: new Date() });
            }
            return true;
        }
        getFiles() {
            const prefix = this.path === '/' ? '/' : `${this.path}/`;
            const out = [];
            for (const [p, meta] of nodes.entries()) {
                if (p === this.path || !p.startsWith(prefix)) continue;
                if (p.slice(prefix.length).includes('/')) continue; // direct children only
                out.push(meta.kind === 'folder' ? new FakeFolder(p) : new FakeFile(p));
            }
            return out;
        }
        execute() { return true; }
    }

    FakeFolder.temp = new FakeFolder('/tmp');
    nodes.set('/tmp', { kind: 'folder', size: 0, modified: new Date() });

    return { File: FakeFile, Folder: FakeFolder, nodes, lookup };
}

/* --------------------------------------------------------------------------
 * Engine loader
 * ------------------------------------------------------------------------ */

function loadEngine(seed = {}) {
    const fsx = makeFileSystem(seed);
    const writes = new Map();

    // Capture text written through File.open('w') for assertions.
    const OriginalFile = fsx.File;
    class InstrumentedFile extends OriginalFile {
        close() {
            const text = this._handle;
            const ok = super.close();
            if (text !== null && text !== undefined) writes.set(this.path, text);
            return ok;
        }
    }

    const context = vm.createContext({
        console,
        Date,
        Math,
        JSON,
        parseFloat,
        parseInt,
        isNaN,
        isFinite,
        String,
        Number,
        Boolean,
        Object,
        Array,
        RegExp,
        Error,
        SyntaxError,
        UnitValue: undefined,
        File: InstrumentedFile,
        Folder: fsx.Folder,
        ExternalObject: undefined,
        CSXSEvent: undefined,
        $: { os: 'Windows 10', writeln: () => {}, sleep: () => {} },
        app: {
            name: 'Adobe Photoshop',
            version: '25.0.0',
            build: '1000',
            documents: [],
            displayDialogs: 'DIALOGMODE_NONE'
        },
        DialogModes: { NO: 3, YES: 1, ALL: 0 },
        SaveOptions: { DONOTSAVECHANGES: 2, SAVECHANGES: 1, PROMPTTOSAVECHANGES: 3 },
        Extension: { LOWERCASE: 2 },
        DocumentMode: { RGB: 3, GRAYSCALE: 1, CMYK: 4, LAB: 7, BITMAP: 5, INDEXEDCOLOR: 2, DUOTONE: 8, MULTICHANNEL: 9 },
        ChangeMode: { RGB: 3, GRAYSCALE: 1, CMYK: 4, LAB: 7, BITMAP: 5, INDEXEDCOLOR: 2, DUOTONE: 8, MULTICHANNEL: 9 },
        BitsPerChannelType: { EIGHT: 8, SIXTEEN: 16, THIRTYTWO: 32 },
        LayerKind: { SMARTOBJECT: 17, NORMAL: 1 },
        AnchorPosition: { MIDDLECENTER: 5, TOPLEFT: 1 },
        ElementPlacement: { PLACEATBEGINNING: 1, PLACEATEND: 3 },
        ResampleMethod: { BICUBICSHARPER: 5 },
        FormatOptions: { STANDARDBASELINE: 1 },
        MatteType: { WHITE: 1 },
        JPEGSaveOptions: function () {},
        PNGSaveOptions: function () {},
        SolidColor: function () {},
        ActionDescriptor: function () {},
        charIDToTypeID: (s) => s,
        stringIDToTypeID: (s) => s,
        typeIDToCharID: (s) => s,
        executeAction: () => {},
        decodeURI,
        encodeURI
    });

    // Provide the required save options shaped like Photoshop's.
    vm.runInContext(`
        JPEGSaveOptions = function () { this.quality = 12; };
        PNGSaveOptions = function () { this.compression = 6; };
        SolidColor = function () { this.rgb = {}; };
        ActionDescriptor = function (o) { this.o = o; };
        ActionDescriptor.prototype.putPath = function (k, v) { this.o[k] = v; };
        ActionDescriptor.prototype.putInteger = function (k, v) { this.o[k] = v; };
    `, context);

    const source = MODULES
        .map((relative) => fs.readFileSync(path.join(JSX, relative), 'utf8'))
        .join('\n;\n');

    vm.runInContext(source, context, { filename: 'bulk-mockup-engine.js' });
    return { context, BM: context.BM, writes, fsx };
}

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const BASE_SEED = {
    'C:/work/mockup.psd': { kind: 'file', size: 4_500_000 },
    'C:/work/designs/a-track.png': { kind: 'file', size: 1200 },
    'C:/work/designs/b-track.jpg': { kind: 'file', size: 900 },
    'C:/work/designs/c-track.jpeg': { kind: 'file', size: 800 },
    'C:/work/designs/notes.txt': { kind: 'file', size: 10 },
    'C:/work/designs/readme.md': { kind: 'file', size: 10 },
    'C:/work/out': { kind: 'folder' }
};

const BASE_CONFIG = {
    mockupPath: 'C:/work/mockup.psd',
    designsFolder: 'C:/work/designs',
    outputFolder: 'C:/work/out',
    smartObjectLayer: 'tst-music copy'
};

/**
 * Re-materialise a value produced inside the `vm` realm as plain host-realm
 * objects, so `deepStrictEqual` compares shapes rather than prototypes.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/* --------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------ */

const { test } = await import('node:test');

test('json: stringify/parse round-trips the messy cases', () => {
    const { BM } = loadEngine();
    const value = {
        text: 'quote " backslash \\ newline \n tab \t unicode \u00e9 \u06a9',
        nested: { list: [1, 2.5, -3, true, false, null], empty: {}, emptyList: [] },
        path: 'C:\\Users\\mahdi\\Desktop\\mockup.psd'
    };
    const text = BM.json.stringify(value);
    assert.deepEqual(plain(BM.json.parse(text)), value);
    assert.equal(BM.json.stringify({ a: undefined, b: 1 }), '{"b":1}');
    assert.equal(BM.json.stringify(null), 'null');
    assert.equal(BM.json.parse('  {"a": 1}  ').a, 1);
    assert.deepEqual(plain(BM.json.parse('[1,{"b":[null]}]')), [1, { b: [null] }]);
    assert.throws(() => BM.json.parse('{"a":}'), /JSON\.parse/);
    assert.throws(() => BM.json.parse('{a:1}'), /JSON\.parse/);
    assert.throws(() => BM.json.parse('{"a":1,}'), /JSON\.parse/);
    assert.throws(() => BM.json.parse('"unterminated'), /JSON\.parse/);
});

test('utils: natural sort, filename sanitation, templates and colours', () => {
    const { BM } = loadEngine();
    const u = BM.util;

    assert.ok(u.compareNatural('shot2.png', 'shot10.png') < 0);
    assert.ok(u.compareNatural('alpha', 'beta') < 0);
    assert.equal(u.compareNatural('same.png', 'same.png'), 0);

    assert.equal(u.sanitizeFilename('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i');
    assert.equal(u.sanitizeFilename('   '), 'untitled');
    assert.equal(u.sanitizeFilename('trailing...'), 'trailing');
    assert.equal(u.sanitizeFilename('x'.repeat(200)).length, 120);

    assert.equal(u.applyTemplate('{name}_mockup', { name: 'track 1' }), 'track 1_mockup');
    assert.equal(u.applyTemplate('', { name: 'x' }), 'x', 'blank template falls back to {name}');
    assert.equal(u.applyTemplate('constant', { name: 'x' }), 'constant');
    assert.equal(u.applyTemplate('{unknown}', { name: 'x' }), '{unknown}', 'unknown tokens survive');
    assert.equal(u.applyTemplate('{index}-{name}', { index: '007', name: 'a' }), '007-a');

    assert.equal(u.normalizeHexColor('#fff'), '#FFFFFF');
    assert.equal(u.normalizeHexColor('1a2b3c'), '#1A2B3C');
    assert.equal(u.normalizeHexColor('nope'), '');
    assert.equal(u.normalizeHexColor(''), '');

    assert.equal(u.basename('C:\\a\\b\\c.psd'), 'c.psd');
    assert.equal(u.basename('/a/b/c.psd'), 'c.psd');
    assert.equal(u.stripExtension('c.tar.gz'), 'c.tar');
    assert.equal(u.extensionOf('Photo.JPG'), 'jpg');

    assert.equal(u.padLeft(7, 3), '007');
    assert.equal(u.oneOf('ReplaceContents', ['auto', 'replaceContents', 'editContents'], 'auto'), 'replaceContents');
    assert.equal(u.oneOf('nonsense', ['a', 'b'], 'a'), 'a');
    assert.equal(u.bool('yes'), true);
    assert.equal(u.bool('0'), false);
    assert.equal(u.bool(undefined, true), true);
    assert.equal(u.number('12', 0, 0, 10), 10);
    assert.equal(u.formatDuration(65_000), '1m 05s');
});

test('errors: describeError never leaks a raw host exception', () => {
    const { BM } = loadEngine();
    const typed = BM.describeError(new BM.Error(BM.ERROR_CODES.LAYER_MISSING, 'tst-music copy'));
    assert.equal(typed.code, 'BM_LAYER_MISSING');
    assert.match(typed.message, /Smart Object layer was not found/);
    assert.equal(typed.detail, 'tst-music copy');

    const host = BM.describeError(new Error('something exploded\nLine: 42\n-> xyz'));
    assert.equal(host.message, 'something exploded');

    const viaAttempt = BM.attempt(() => { throw new BM.Error(BM.ERROR_CODES.NO_DESIGNS); });
    assert.equal(viaAttempt.ok, false);
    assert.equal(viaAttempt.error.code, 'BM_NO_DESIGNS');

    const okAttempt = BM.attempt(() => 42);
    assert.deepEqual(plain(okAttempt), { ok: true, data: 42 });
});

test('config: normalize applies defaults and coerces every field', () => {
    const { BM } = loadEngine();
    const c = BM.batch.normalize({ ...BASE_CONFIG, quality: '150', fitMode: 'COVER', overwrite: 'no', namingTemplate: '  ' });

    assert.equal(c.quality, 100, 'quality clamps to 100%');
    assert.equal(c.fitMode, 'cover', 'fit mode is canonicalised');
    assert.equal(c.overwrite, false);
    assert.equal(c.namingTemplate, '{name}', 'blank template falls back');
    assert.equal(c.filenamePrefix, '', 'blank prefixes are empty, not “untitled”');
    assert.equal(c.filenameSuffix, '');
    assert.equal(c.strategy, 'auto');
    assert.equal(c.format, 'jpg');
    assert.deepEqual(c.fallbackLayerNames, BM.DEFAULTS.fallbackLayerNames);
    assert.equal(BM.batch.normalize({}).smartObjectLayer, 'tst-music copy', 'legacy layer name is the default');
    assert.equal(BM.batch.normalize({}).quality, 85, 'quality defaults to 85%');
    assert.equal(BM.batch.normalize({ quality: 0 }).quality, 1, 'quality never goes below 1%');
    assert.equal(BM.batch.normalize({ fitMode: 'CENTER' }).fitMode, 'center');
    const affixed = BM.batch.normalize({ filenamePrefix: ' client/2026 ', filenameSuffix: ' final ' });
    assert.equal(affixed.filenamePrefix, 'client_2026', 'affixes are trimmed and sanitised');
    assert.equal(affixed.filenameSuffix, 'final');
    assert.equal(BM.batch.normalize({ paddingPercent: 900 }).paddingPercent, 45);
});

test('config: coerceConfig accepts an object or a JSON string, and rejects junk', () => {
    const { BM } = loadEngine();
    assert.equal(BM.batch.coerceConfig('{"a":1}').a, 1);
    assert.equal(BM.batch.coerceConfig({ a: 1 }).a, 1);
    assert.equal(BM.batch.coerceConfig(null).a, undefined);
    assert.throws(
        () => BM.batch.coerceConfig('{oops'),
        (e) => e.code === BM.ERROR_CODES.BAD_CONFIG
    );
});

test('placement: fit modes compute the documented scale factors', () => {
    const { BM } = loadEngine();

    assert.deepEqual(
        plain(BM.placement.computeScale(100, 50, 100, 100, 'contain')),
        { x: 100, y: 100, uniform: 100 },
        'contain uses the smaller factor'
    );
    assert.deepEqual(
        plain(BM.placement.computeScale(100, 50, 100, 100, 'cover')),
        { x: 200, y: 200, uniform: 200 },
        'cover uses the larger factor'
    );
    assert.deepEqual(
        plain(BM.placement.computeScale(100, 50, 100, 100, 'center')),
        { x: 100, y: 100, uniform: 100 },
        'center always keeps the native size'
    );
    assert.deepEqual(
        plain(BM.placement.computeScale(100, 50, 100, 100, 'stretch')),
        { x: 100, y: 200, uniform: 0 },
        'stretch may distort independently on each axis'
    );
});

test('placement: center keeps the native size and only moves the layer', () => {
    const { BM } = loadEngine();
    const calls = [];
    const layer = {
        bounds: [0, 0, 200, 100],
        resize(x, y) { calls.push(['resize', x, y]); },
        translate(x, y) {
            calls.push(['translate', x, y]);
            this.bounds = [this.bounds[0] + x, this.bounds[1] + y, this.bounds[2] + x, this.bounds[3] + y];
        }
    };

    const result = BM.placement.fitAndCenter({ width: 100, height: 100 }, layer, {
        fitMode: 'center',
        paddingPercent: 0
    });

    assert.equal(result.scaled, false, 'center never calls resize');
    assert.equal(calls.some((call) => call[0] === 'resize'), false);
    assert.deepEqual(plain(layer.bounds), [-50, 0, 150, 100], 'the larger artwork is centred, not shrunk');
    assert.equal(result.translated, true);
});

test('designs: listing finds images, sorts naturally and reports what it skipped', () => {
    const { BM } = loadEngine({
        ...BASE_SEED,
        'C:/work/designs/design10.png': { kind: 'file', size: 10 },
        'C:/work/designs/design2.png': { kind: 'file', size: 10 },
        'C:/work/designs/.hidden.png': { kind: 'file', size: 10 }
    });
    const folder = BM.fs.toFolder('C:/work/designs');

    const listing = BM.fs.listDesigns(folder, { sort: 'name' });
    const names = plain(listing.files.map((f) => f.name));
    assert.deepEqual(names, ['a-track.png', 'b-track.jpg', 'c-track.jpeg', 'design2.png', 'design10.png']);
    assert.ok(!names.includes('.hidden.png'), 'dotfiles are ignored');
    assert.deepEqual(plain(listing.skipped).sort(), ['notes.txt', 'readme.md']);

    assert.equal(
        BM.fs.listDesigns(folder, { sort: 'nameDesc' }).files.map((f) => f.name)[0],
        'design10.png'
    );
    assert.deepEqual(
        plain(BM.fs.listDesigns(folder, { nameFilter: 'TRACK' }).files.map((f) => f.name)),
        ['a-track.png', 'b-track.jpg', 'c-track.jpeg']
    );

    const windowed = BM.fs.listDesigns(folder, { sort: 'name', startAt: 2, limit: 2 });
    assert.deepEqual(plain(windowed.files.map((f) => f.name)), ['b-track.jpg', 'c-track.jpeg']);
    assert.equal(windowed.filteredOut, 0);
});

test('inspect: a complete configuration is runnable', () => {
    const { BM } = loadEngine(BASE_SEED);
    const report = BM.batch.inspect(BASE_CONFIG);

    assert.equal(report.ok, true);
    assert.equal(report.canRun, true);
    assert.equal(report.counts.designs, 3);
    assert.equal(report.counts.skipped, 2);
    assert.equal(plain(report.checks.filter((c) => c.status === 'error')).length, 0);
    assert.equal(report.checks.find((c) => c.id === 'mockup').status, 'ok');
});

test('inspect: every input problem is reported instead of throwing', () => {
    const { BM } = loadEngine(BASE_SEED);

    const missing = BM.batch.inspect({ ...BASE_CONFIG, mockupPath: 'C:/nope.psd' });
    assert.equal(missing.canRun, false);
    assert.match(missing.checks.find((c) => c.id === 'mockup').detail, /not found/i);

    const wrongType = BM.batch.inspect({ ...BASE_CONFIG, mockupPath: 'C:/work/designs/a-track.png' });
    assert.match(wrongType.checks.find((c) => c.id === 'mockup').detail, /\.psd or \.psb/);

    const noDesigns = BM.batch.inspect({ ...BASE_CONFIG, designsFolder: 'C:/work/empty' });
    assert.equal(noDesigns.canRun, false);
    assert.match(noDesigns.checks.find((c) => c.id === 'designs').detail, /folder not found/i);

    const emptyFolder = BM.batch.inspect({ ...BASE_CONFIG, designsFolder: 'C:/work/out' });
    assert.match(emptyFolder.checks.find((c) => c.id === 'designs').detail, /No JPG or PNG/);

    const unset = BM.batch.inspect({});
    assert.equal(unset.canRun, false);
    assert.equal(unset.checks.filter((c) => c.status === 'error').length, 3, 'mockup, designs and output all complain');
});

test('inspect: warns when replaceContents would silently ignore fit options', () => {
    const { BM } = loadEngine(BASE_SEED);
    const report = BM.batch.inspect({ ...BASE_CONFIG, strategy: 'replaceContents', fitMode: 'cover', paddingPercent: 5 });
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /Replace contents/);
});

test('paths: CEP-style file URIs and percent-encoding are normalised', () => {
    const { BM } = loadEngine();
    assert.equal(BM.fs.normalizePath('file:///C:/my%20mockups/a.psd'), 'C:/my mockups/a.psd');
    assert.equal(BM.fs.normalizePath('file:///Users/me/a.psd'), '/Users/me/a.psd');
    assert.equal(BM.fs.normalizePath('  C:/plain.psd  '), 'C:/plain.psd');
    assert.equal(BM.fs.normalizePath(''), '');
    assert.equal(BM.fs.toFile(''), null, 'empty path yields no File');
});

test('outputs: naming, deduplication and long-edge maths', () => {
    const { BM } = loadEngine({
        'C:/work/out/track.jpg': { kind: 'file', size: 10 }
    });
    const folder = BM.fs.toFolder('C:/work/out');
    const design = new (makeFileSystem({}).File)('C:/work/designs/track.png');

    const keepBoth = BM.exporter.buildOutputFile(folder, design, 1, { namingTemplate: '{name}', format: 'jpg', overwrite: false });
    assert.equal(keepBoth.deduplicated, true);
    assert.equal(keepBoth.file.name, 'track (2).jpg');

    const replace = BM.exporter.buildOutputFile(folder, design, 1, { namingTemplate: '{name}', format: 'jpg', overwrite: true });
    assert.equal(replace.deduplicated, false);
    assert.equal(replace.file.name, 'track.jpg');

    const templated = BM.exporter.buildOutputFile(folder, design, 7, { namingTemplate: '{index}_{name}_mockup', format: 'png', overwrite: true });
    assert.equal(templated.file.name, '007_track_mockup.png');

    const affixed = BM.exporter.buildOutputFile(folder, design, 3, {
        namingTemplate: '{name}', format: 'png', overwrite: true,
        filenamePrefix: 'client', filenameSuffix: 'v2'
    });
    assert.equal(affixed.file.name, 'client_track_v2.png');

    const prefixOnly = BM.exporter.buildOutputFile(folder, design, 3, {
        namingTemplate: '{name}', format: 'jpg', overwrite: true,
        filenamePrefix: 'client', filenameSuffix: ''
    });
    assert.equal(prefixOnly.file.name, 'client_track.jpg');
});

test('engine: a run without a mockup fails cleanly instead of throwing', () => {
    const { BM } = loadEngine(BASE_SEED);
    const summary = BM.batch.run({ ...BASE_CONFIG, mockupPath: '' });
    assert.equal(summary.ok, false);
    assert.equal(summary.error.code, 'BM_MOCKUP_MISSING');
    assert.equal(summary.succeeded, 0);
});

test('engine: an empty designs folder aborts before opening the mockup', () => {
    const { BM } = loadEngine(BASE_SEED);
    const summary = BM.batch.run({ ...BASE_CONFIG, designsFolder: 'C:/work/out' });
    assert.equal(summary.ok, false);
    assert.equal(summary.error.code, 'BM_NO_DESIGNS');
});

test('export: a document needing no conversion is written without duplication', () => {
    const { BM, context } = loadEngine({ 'C:/work/out/hero.jpg': { kind: 'file', size: 10 } });
    const doc = {
        width: 1200,
        height: 900,
        resolution: 72,
        mode: 3, // DocumentMode.RGB
        bitsPerChannel: 8,
        duplicate() { throw new Error('the mockup must not be duplicated'); },
        resizeImage() { throw new Error('unexpected resize'); },
        saveAs(file, options) { this.savedTo = file.fsName; this.savedOptions = options; }
    };

    assert.equal(BM.exporter.jpegQuality(100), 12);
    assert.equal(BM.exporter.jpegQuality(85), 10, '85% maps to Photoshop quality 10');
    assert.equal(BM.exporter.jpegQuality(1), 0);

    const result = plain(BM.exporter.save(doc, new context.File('C:/work/out/hero.jpg'), {
        format: 'jpg',
        quality: 85
    }));

    assert.equal(doc.savedTo, 'C:/work/out/hero.jpg', 'the original document is exported directly');
    assert.equal(doc.savedOptions.quality, 10, 'the mapped quality reaches JPEGSaveOptions');
    assert.deepEqual(result.notes, [], 'nothing was converted, so no notes are reported');
    assert.equal(result.path, 'C:/work/out/hero.jpg');
    assert.equal(result.width, 1200);
    assert.equal(result.height, 900);
});

test('api: savePanelLog accepts the JSON string the panel sends', () => {
    const { BM, context, writes } = loadEngine({
        ...BASE_SEED,
        'C:/work/logs': { kind: 'folder' }
    });

    const envelope = JSON.parse(context.BulkMockup.savePanelLog(
        BM.json.stringify({ folder: 'C:/work/logs', text: 'line one\nline two' })
    ));

    assert.equal(envelope.ok, true);
    assert.match(envelope.data.path, /bulkmockup_panel_[^/]+\.log$/);
    assert.equal(writes.get(envelope.data.path), 'line one\nline two');
});
