/**
 * Public API surface.
 *
 * This is the only object the panel ever talks to. Every entry point returns a
 * JSON *string* rather than a raw value, because `CSInterface.evalScript` can
 * only hand a string back across the bridge, and because a JSON envelope means
 * a thrown error can never surface as the dreaded opaque
 * "EvalScript error.".
 *
 * Envelope shape, always:
 *     { "ok": true,  "data":  { … } }
 *     { "ok": false, "error": { code, message, detail, hint } }
 */

var BulkMockup = (function () {

    function respond(envelope) {
        return BM.json.stringify(envelope);
    }

    /** Run `fn` defensively and serialise whatever comes back. */
    function invoke(fn) {
        var envelope = BM.attempt(fn);
        if (!envelope.ok && envelope.error) {
            try { BM.log.error(envelope.error.message); } catch (e) { /* logger may not be running */ }
        }
        return respond(envelope);
    }

    var api = {};

    /* ------------------------------------------------------------- diagnostics */

    /** Cheap liveness probe; the panel calls this on load. */
    api.ping = function () {
        return invoke(function () {
            BM.ps.assertHost();
            return {
                version: BM.APP.VERSION,
                name: BM.APP.NAME,
                host: BM.ps.info(),
                events: BM.cep.available,
                cancelFile: BM.fs.cancelFilePath(),
                tempFolder: Folder.temp.fsName,
                platform: $.os,
                defaults: BM.DEFAULTS,
                supportedImages: BM.SUPPORTED_IMAGE_EXTENSIONS
            };
        });
    };

    /** Current log file path, so the panel can offer "reveal log". */
    api.logInfo = function () {
        return invoke(function () {
            return { path: BM.log.filePath(), lines: BM.log.writtenCount(), events: BM.cep.count() };
        });
    };

    /* ---------------------------------------------------------------- discovery */

    /**
     * List the layers in a mockup, flagging the Smart Objects.
     *
     * Opens the document read-only, then closes it again — and only closes it
     * when this call was the one that opened it.
     *
     * @param {string} mockupPath
     */
    api.listSmartObjectLayers = function (mockupPath) {
        return invoke(function () {
            BM.ps.assertHost();

            var path = BM.fs.normalizePath(mockupPath);
            var file = BM.fs.toFile(path);
            if (!file || !file.exists) {
                bmFail(BM.ERROR_CODES.MOCKUP_MISSING, path || 'not set');
            }
            if (!BM.fs.isSupportedMockup(file)) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'Expected a .psd or .psb file.');
            }

            var previousDialogs = BM.ps.pushQuiet();
            var opened = null;
            try {
                opened = BM.ps.openDocument(file, BM.ERROR_CODES.MOCKUP_UNREADABLE);
                var records = BM.ps.flattenLayers(opened.doc);
                var layers = [];
                var i;
                for (i = 0; i < records.length; i++) {
                    layers.push({
                        name: records[i].name,
                        path: records[i].path,
                        depth: records[i].depth,
                        isGroup: records[i].isGroup,
                        isSmartObject: records[i].isSmartObject,
                        visible: records[i].visible
                    });
                }

                var size = BM.ps.size(opened.doc);
                return {
                    file: file.name,
                    document: {
                        name: opened.doc.name,
                        width: Math.round(size.width),
                        height: Math.round(size.height),
                        resolution: Math.round(size.resolution)
                    },
                    layers: layers,
                    smartObjects: (function () {
                        var out = [];
                        for (var j = 0; j < records.length; j++) {
                            if (records[j].isSmartObject) { out.push(records[j].path); }
                        }
                        return out;
                    }())
                };
            } finally {
                if (opened && !opened.wasAlreadyOpen) {
                    BM.ps.closeDocument(opened.doc, false);
                }
                BM.ps.popQuiet(previousDialogs);
            }
        });
    };

    /* -------------------------------------------------------------- validation */

    /** Pre-flight report. Never modifies anything. */
    api.inspect = function (config) {
        return invoke(function () {
            return BM.batch.inspect(BM.batch.coerceConfig(config));
        });
    };

    /* -------------------------------------------------------------------- run */

    /**
     * Run the batch. Blocks the ExtendScript engine until it finishes; progress
     * arrives in the panel as CEP events on BM.EVENT.CHANNEL.
     */
    api.start = function (config) {
        return invoke(function () {
            return BM.batch.run(BM.batch.coerceConfig(config));
        });
    };

    /* ------------------------------------------------------------ panel helpers */

    /** Path the panel writes to request cancellation. */
    api.cancelPath = function () {
        return invoke(function () {
            return { path: BM.fs.cancelFilePath() };
        });
    };

    /** Clear a stale cancellation flag (panel calls this before every run). */
    api.clearCancel = function () {
        return invoke(function () {
            BM.fs.clearCancelFlag();
            return { cleared: true };
        });
    };

    /** Open a folder in Explorer / Finder. */
    api.revealFolder = function (path) {
        return invoke(function () {
            var folder = BM.fs.toFolder(path);
            if (!folder || !folder.exists) {
                bmFail(BM.ERROR_CODES.OUTPUT_UNWRITABLE, path || 'not set');
            }
            folder.execute();
            return { path: folder.fsName };
        });
    };

    /** Open a file's containing folder and select nothing more than that. */
    api.revealFile = function (path) {
        return invoke(function () {
            var file = BM.fs.toFile(path);
            if (!file || !file.exists) {
                bmFail(BM.ERROR_CODES.OUTPUT_UNWRITABLE, path || 'not set');
            }
            file.parent.execute();
            return { path: BM.fs.fsName(file) };
        });
    };

    /**
     * Persist the panel's own console, for bug reports.
     *
     * @param {Object} options `{ folder, text }`
     */
    api.savePanelLog = function (options) {
        return invoke(function () {
            // The panel passes a JSON string here, not an object.
            options = BM.batch.coerceConfig(options);
            var folder = BM.fs.toFolder(options.folder);
            if (!folder || !folder.exists) {
                folder = Folder.temp;
            }
            var file = new File(folder.fsName + '/bulkmockup_panel_' + BM.util.dateStamp() + '_' + BM.util.timeStamp() + '.log');
            if (!BM.fs.writeText(BM.fs.fsName(file), String(options.text || ''))) {
                bmFail(BM.ERROR_CODES.OUTPUT_NOT_WRITABLE, BM.fs.fsName(file));
            }
            return { path: BM.fs.fsName(file) };
        });
    };

    /** Environment summary for the About dialog. */
    api.about = function () {
        return invoke(function () {
            BM.ps.assertHost();
            var info = BM.ps.info();
            return {
                name: BM.APP.NAME,
                version: BM.APP.VERSION,
                tagline: BM.APP.TAGLINE,
                host: info.name + ' ' + info.version + ' (build ' + info.build + ')',
                events: BM.cep.available,
                defaults: BM.DEFAULTS
            };
        });
    };

    /* ------------------------------------------------------- panel-free running */

    /**
     * Interactive run for people who are not using the panel.
     *
     * This is what `jsx/standalone/BulkMockupStandalone.jsx` calls: it asks for
     * the three paths and the layer name with the native ExtendScript dialogs,
     * then runs the exact same engine the panel uses. It is the closest thing
     * to the original `bulkMockup.jsx`, minus the sharp edges.
     */
    api.runInteractive = function () {
        BM.ps.assertHost();
        BM.fs.clearCancelFlag();

        var mockupFile = File.openDialog('Choose the mockup PSD (contains the Smart Object)');
        if (!mockupFile) { return; }
        if (!BM.fs.isSupportedMockup(mockupFile)) {
            alert('That is not a .psd or .psb file.\n\n' + mockupFile.fsName);
            return;
        }

        var designsFolder = Folder.selectDialog('Choose the folder containing your designs');
        if (!designsFolder) { return; }

        var outputFolder = Folder.selectDialog('Choose where to write the finished mockups');
        if (!outputFolder) { return; }

        var layerName = prompt('Name of the Smart Object layer to replace:', BM.DEFAULTS.smartObjectLayer);
        if (layerName === null) { return; }

        var summary = BM.batch.run({
            mockupPath: mockupFile.fsName,
            designsFolder: designsFolder.fsName,
            outputFolder: outputFolder.fsName,
            smartObjectLayer: layerName,
            writeLogFile: true,
            writeCsvReport: true
        });

        var message = summary.error
            ? ('Could not run:\n\n' + summary.error.message + (summary.error.detail ? '\n\n' + summary.error.detail : ''))
            : (summary.succeeded + ' of ' + summary.total + ' exported in ' + BM.util.formatDuration(summary.durationMs) +
                (summary.failed ? ('\n' + summary.failed + ' failed — see the CSV report.') : '') +
                '\n\nOutput: ' + summary.outputFolder +
                (summary.cancelled ? '\n\n(cancelled)' : ''));

        alert(message);
        return summary;
    };

    return api;
}());
