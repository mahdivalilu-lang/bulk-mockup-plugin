/**
 * Browser stand-in for the CEP runtime.
 *
 * Lets `tools/preview/panel-preview.html` run the *real* panel code outside
 * Photoshop, which is how the README screenshots are produced and how the panel
 * can be iterated on without relaunching the host. Nothing in here ships with
 * the extension; `client/lib/CSInterface.js` is replaced by this file in the
 * preview only.
 *
 *   npm run preview   ->  opens the panel in your default browser
 */
(function () {
    'use strict';

    var CHANNEL = 'com.bulkmockup.event';
    var listeners = {};
    var calls = [];

    window.__calls = calls;

    /* ------------------------------------------------------------ fake answers */

    var DEFAULTS = {
        smartObjectLayer: 'tst-music copy',
        fallbackLayerNames: ['tst-music copy', 'Mockup', 'mockup', 'Design', 'Smart Object'],
        autoDetectLayer: true,
        autoConvertToSmartObject: false,
        fitMode: 'contain',
        paddingPercent: 0,
        strategy: 'auto',
        format: 'jpg',
        quality: 12,
        pngCompression: 6,
        maxOutputSize: 0,
        backgroundFill: '',
        namingTemplate: '{name}',
        overwrite: true,
        sort: 'name',
        nameFilter: '',
        limit: 0,
        startAt: 1,
        reopenMockupPerDesign: false,
        delayMs: 0,
        writeLogFile: true,
        writeCsvReport: true,
        logLevel: 'info'
    };

    var ANSWERS = {
        ping: {
            version: '1.0.0',
            name: 'Bulk Mockup',
            host: { name: 'Adobe Photoshop', version: '26.1.0', build: '121', documents: 1 },
            events: true,
            cancelFile: 'C:\\Users\\mahdi\\AppData\\Local\\Temp\\bulkmockup.cancel',
            tempFolder: 'C:\\Users\\mahdi\\AppData\\Local\\Temp',
            platform: 'Windows 11',
            defaults: DEFAULTS,
            supportedImages: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'psd', 'pdf']
        },

        listSmartObjectLayers: {
            file: 'album-mockup.psd',
            document: { name: 'album-mockup.psd', width: 2400, height: 2400, resolution: 300 },
            layers: [],
            smartObjects: ['tst-music copy', 'Disc face', 'Booklet / Inner spread']
        },

        inspect: {
            ok: true,
            canRun: true,
            checks: [
                { id: 'mockup', label: 'Mockup PSD', status: 'ok', detail: 'album-mockup.psd · 4.3 MB' },
                { id: 'designs', label: 'Designs folder', status: 'ok', detail: '48 images queued · 2 unsupported files skipped' },
                { id: 'output', label: 'Output folder', status: 'ok', detail: 'C:\\Users\\mahdi\\Desktop\\mockup-out' },
                { id: 'layer', label: 'Target layer', status: 'ok', detail: '“tst-music copy” · falls back to the only Smart Object if absent' }
            ],
            counts: { designs: 48, skipped: 2, filteredOut: 0, limitedTo: 50 },
            warnings: [],
            config: DEFAULTS
        },

        clearCancel: { cleared: true },
        cancelPath: { path: 'C:\\Users\\mahdi\\AppData\\Local\\Temp\\bulkmockup.cancel' },
        revealFolder: { path: '' },
        revealFile: { path: '' },
        logInfo: { path: '', lines: 0, events: 0 },
        savePanelLog: { path: 'C:\\Users\\mahdi\\Desktop\\mockup-out\\bulkmockup_panel.log' },
        about: {
            name: 'Bulk Mockup',
            version: '1.0.0',
            tagline: 'Batch-replace Smart Objects with live progress',
            host: 'Adobe Photoshop 26.1.0 (build 121)',
            events: true,
            defaults: DEFAULTS
        }
    };

    function envelope(method) {
        if (ANSWERS[method]) { return { ok: true, data: ANSWERS[method] }; }
        return { ok: true, data: null };
    }

    /* --------------------------------------------------------------- CSInterface */

    window.SystemPath = {
        EXTENSION: 'extension',
        USER_DATA: 'userData',
        HOST_APPLICATION: 'hostApplication',
        MY_DOCUMENTS: 'myDocuments',
        COMMON_FILES: 'commonFiles'
    };

    window.CSInterface = function CSInterface() {};
    window.CSInterface.prototype.evalScript = function (script, callback) {
        var match = /BulkMockup\.([A-Za-z0-9_]+)\s*\(/.exec(script);
        var method = match ? match[1] : '(inline)';
        calls.push({ method: method, script: script.slice(0, 140) });

        window.setTimeout(function () {
            callback(JSON.stringify(envelope(method)));
        }, 25);
    };
    window.CSInterface.prototype.addEventListener = function (type, handler) {
        (listeners[type] = listeners[type] || []).push(handler);
    };
    window.CSInterface.prototype.removeEventListener = function (type, handler) {
        listeners[type] = (listeners[type] || []).filter(function (h) { return h !== handler; });
    };
    window.CSInterface.prototype.getSystemPath = function () { return '/preview'; };
    window.CSInterface.prototype.getHostEnvironment = function () {
        return { appName: 'PHXS', appVersion: '[26.1,26.1]', appLocale: 'en_US' };
    };

    /* ------------------------------------------------------------------ cep.fs */

    window.cep = {
        fs: {
            showOpenDialog: function () { return { err: 1, data: [] }; },
            writeFile: function () { return { err: 0 }; },
            deleteFile: function () { return { err: 0 }; },
            readFile: function () { return { err: 0, data: '' }; }
        }
    };

    /* --------------------------------------------------------------- test hooks */

    /** Push a fake engine event into the panel exactly as CEP would. */
    window.__emit = function (payload) {
        (listeners[CHANNEL] || []).slice().forEach(function (handler) {
            handler({ type: CHANNEL, data: JSON.stringify(payload) });
        });
    };

    /** Fill the panel with a plausible, ready-to-run state. */
    window.__populate = function () {
        var values = {
            mockupPath: 'C:\\Users\\mahdi\\Desktop\\album-mockup.psd',
            designsFolder: 'C:\\Users\\mahdi\\Desktop\\designs',
            outputFolder: 'C:\\Users\\mahdi\\Desktop\\mockup-out',
            smartObjectLayer: 'tst-music copy'
        };
        Object.keys(values).forEach(function (id) {
            var node = document.getElementById(id);
            if (node) { node.value = values[id]; }
        });
        document.getElementById('designsInfo').textContent = '48 queued of 50 matched · 2 unsupported skipped';
        document.getElementById('mockupInfo').textContent = 'album-mockup.psd · 2400×2400 px · 3 Smart Objects';
    };

    /** Replay a mid-run batch so screenshots show the panel doing its job. */
    window.__stream = function () {
        var lines = [
            ['info', 'Bulk Mockup v1.0.0 — run started'],
            ['info', 'Mockup: C:\\Users\\mahdi\\Desktop\\album-mockup.psd'],
            ['info', 'Designs: 48 image(s) from C:\\Users\\mahdi\\Desktop\\designs'],
            ['info', 'Output: C:\\Users\\mahdi\\Desktop\\mockup-out  ·  JPG q12'],
            ['info', 'Target layer: “tst-music copy”  ·  strategy: auto  ·  fit: contain'],
            ['warn', 'Skipped 2 unsupported file(s): notes.txt, palette.pal'],
            ['info', 'Mockup canvas: 2400×2400 px @ 300 ppi'],
            ['success', '[1/48] night-drive cover.png → night-drive cover.jpg'],
            ['success', '[2/48] night-drive back.png → night-drive back.jpg'],
            ['success', '[3/48] single-artwork.jpg → single-artwork.jpg'],
            ['success', '[4/48] deluxe-gatefold.png → deluxe-gatefold.jpg  (resized to 1200×1200)'],
            ['success', '[5/48] bonus-disc.png → bonus-disc.jpg'],
            ['success', '[6/48] lyric-book-01.png → lyric-book-01.jpg']
        ];

        lines.forEach(function (line) {
            window.__emit({ type: 'log', level: line[0], message: line[1] });
        });

        window.__emit({
            type: 'progress',
            index: 7, total: 48, done: 7, succeeded: 7, failed: 0, remaining: 41,
            percent: 15, file: 'lyric-book-02.png', elapsedMs: 41_000, etaMs: 240_000
        });
    };
}());
