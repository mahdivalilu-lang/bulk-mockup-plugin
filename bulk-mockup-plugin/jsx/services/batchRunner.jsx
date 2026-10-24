/**
 * The batch engine.
 *
 * `inspect()` answers "would this run work?" without touching anything, and
 * `run()` performs the work while streaming progress to the panel.
 *
 * Design notes:
 *  - The mockup is opened once and reused; `reopenMockupPerDesign` exists for
 *    the rare mockup whose Smart Object misbehaves when replaced repeatedly.
 *  - A document the user already had open is never closed, and the mockup is
 *    never saved over — the original PSD is treated as read-only input.
 *  - Cancellation goes through a sentinel file rather than a second script
 *    call, because ExtendScript is single-threaded: a queued evalScript cannot
 *    run until the batch it wants to interrupt has already finished.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.batch = (function () {

    var MAX_REPORTED_ERRORS = 50;

    var api = {};

    /* ------------------------------------------------------------- normalisation */

    /** Merge panel input with BM.DEFAULTS and coerce every field. */
    api.normalize = function (raw) {
        var d = BM.DEFAULTS;
        var c = {};
        raw = raw || {};

        c.mockupPath = BM.fs.normalizePath(raw.mockupPath || '');
        c.designsFolder = BM.fs.normalizePath(raw.designsFolder || '');
        c.outputFolder = BM.fs.normalizePath(raw.outputFolder || '');

        c.smartObjectLayer = BM.util.trim(raw.smartObjectLayer) || d.smartObjectLayer;
        c.fallbackLayerNames = (raw.fallbackLayerNames && raw.fallbackLayerNames.length)
            ? raw.fallbackLayerNames
            : d.fallbackLayerNames;
        c.autoDetectLayer = BM.util.bool(raw.autoDetectLayer, d.autoDetectLayer);
        c.autoConvertToSmartObject = BM.util.bool(raw.autoConvertToSmartObject, d.autoConvertToSmartObject);

        c.fitMode = BM.util.oneOf(raw.fitMode, ['contain', 'cover', 'center', 'stretch'], d.fitMode);
        c.paddingPercent = BM.util.number(raw.paddingPercent, d.paddingPercent, 0, 45);
        c.strategy = BM.util.oneOf(raw.strategy, ['auto', 'replaceContents', 'editContents'], d.strategy);

        c.format = BM.util.oneOf(raw.format, ['jpg', 'png'], d.format);
        c.quality = BM.util.number(raw.quality, d.quality, 1, 100);
        c.pngCompression = BM.util.number(raw.pngCompression, d.pngCompression, 0, 9);
        c.maxOutputSize = BM.util.number(raw.maxOutputSize, d.maxOutputSize, 0, 100000);
        c.backgroundFill = BM.util.normalizeHexColor(raw.backgroundFill || '');

        c.namingTemplate = BM.util.trim(raw.namingTemplate) || d.namingTemplate;
        c.filenamePrefix = BM.util.trim(raw.filenamePrefix);
        c.filenameSuffix = BM.util.trim(raw.filenameSuffix);
        if (c.filenamePrefix) { c.filenamePrefix = BM.util.sanitizeFilename(c.filenamePrefix, 60); }
        if (c.filenameSuffix) { c.filenameSuffix = BM.util.sanitizeFilename(c.filenameSuffix, 60); }
        c.overwrite = BM.util.bool(raw.overwrite, d.overwrite);

        c.sort = BM.util.oneOf(raw.sort, ['name', 'nameDesc', 'date', 'dateDesc', 'size'], d.sort);
        c.nameFilter = BM.util.trim(raw.nameFilter || '');
        c.limit = BM.util.number(raw.limit, d.limit, 0, 1000000);
        c.startAt = BM.util.number(raw.startAt, d.startAt, 1, 1000000);

        c.reopenMockupPerDesign = BM.util.bool(raw.reopenMockupPerDesign, d.reopenMockupPerDesign);
        c.delayMs = BM.util.number(raw.delayMs, d.delayMs, 0, 5000);

        c.writeLogFile = BM.util.bool(raw.writeLogFile, d.writeLogFile);
        c.writeCsvReport = BM.util.bool(raw.writeCsvReport, d.writeCsvReport);
        c.logLevel = BM.util.oneOf(raw.logLevel, BM.LOG_ORDER, d.logLevel);

        return c;
    };

    /** Accept either a parsed object or the JSON string the panel sends. */
    api.coerceConfig = function (raw) {
        var parsed;
        if (typeof raw === 'string') {
            try {
                parsed = BM.json.parse(raw);
            } catch (e) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'The settings could not be read: ' + e.message);
            }
        } else {
            parsed = raw || {};
        }
        return parsed;
    };

    /* -------------------------------------------------------------- inspection */

    /**
     * Pre-flight check. Never opens a Photoshop document, so it is instant and
     * safe to call on every keystroke.
     *
     * @return {Object} `{ ok, canRun, checks, counts, warnings, config }`
     */
    api.inspect = function (raw) {
        var config = api.normalize(raw);
        var checks = [];
        var counts = { designs: 0, skipped: 0, filteredOut: 0, limitedTo: 0 };

        function check(id, label, status, detail) {
            checks.push({ id: id, label: label, status: status, detail: detail || '' });
        }

        BM.ps.assertHost();

        /* Mockup */
        var mockupFile = BM.fs.toFile(config.mockupPath);
        if (!config.mockupPath) {
            check('mockup', 'Mockup PSD', 'error', 'No file selected.');
        } else if (!mockupFile.exists) {
            check('mockup', 'Mockup PSD', 'error', 'File not found: ' + BM.fs.fsName(mockupFile));
        } else if (!BM.fs.isSupportedMockup(mockupFile)) {
            check('mockup', 'Mockup PSD', 'error', 'Expected a .psd or .psb file, got “' + mockupFile.name + '”.');
        } else if (!BM.fs.isReadableFile(config.mockupPath)) {
            check('mockup', 'Mockup PSD', 'warn', 'The file looks empty or is locked by another application.');
        } else {
            check('mockup', 'Mockup PSD', 'ok', mockupFile.name + ' · ' + Math.round(mockupFile.length / 1024) + ' KB');
        }

        /* Designs */
        var designsFolder = BM.fs.toFolder(config.designsFolder);
        if (!config.designsFolder) {
            check('designs', 'Designs folder', 'error', 'No folder selected.');
        } else if (!designsFolder || !designsFolder.exists) {
            check('designs', 'Designs folder', 'error', 'Folder not found: ' + config.designsFolder);
        } else {
            var listing = BM.fs.listDesigns(designsFolder, config);
            counts.designs = listing.files.length;
            counts.skipped = listing.skipped.length;
            counts.filteredOut = listing.filteredOut;
            counts.limitedTo = listing.matched;

            if (listing.matched === 0) {
                check('designs', 'Designs folder', 'error', 'No JPG or PNG files found.');
            } else if (listing.files.length === 0) {
                check('designs', 'Designs folder', 'error',
                    listing.matched + ' images matched, but the range/filter excluded all of them.');
            } else {
                var detail = listing.files.length + ' image' + (listing.files.length === 1 ? '' : 's') + ' queued';
                if (listing.matched > listing.files.length) { detail += ' of ' + listing.matched + ' matched'; }
                if (listing.skipped.length) { detail += ' · ' + listing.skipped.length + ' unsupported file' + (listing.skipped.length === 1 ? '' : 's') + ' skipped'; }
                check('designs', 'Designs folder', 'ok', detail);
            }
        }

        /* Output */
        var outputFolder = BM.fs.toFolder(config.outputFolder);
        if (!config.outputFolder) {
            check('output', 'Output folder', 'error', 'No folder selected.');
        } else if (outputFolder && outputFolder.exists) {
            check('output', 'Output folder', 'ok', config.outputFolder + (config.overwrite ? '' : ' · existing files will be kept'));
        } else {
            check('output', 'Output folder', 'warn', 'Will be created on the first run.');
        }

        /* Layer name sanity — the definitive check needs the PSD open. */
        check('layer', 'Target layer', config.autoDetectLayer ? 'ok' : 'warn',
            '“' + config.smartObjectLayer + '”' + (config.autoDetectLayer ? ' · falls back to the only Smart Object if absent' : ' · no fallback'));

        /* Interaction warnings that would otherwise silently surprise people. */
        var warnings = [];
        if (config.strategy === 'replaceContents') {
            if (config.fitMode !== 'contain' || config.paddingPercent > 0) {
                warnings.push('Fit mode and padding are ignored by the “Replace contents” strategy, which keeps the Smart Object’s existing transform. Use “Edit contents” to control the fit.');
            }
            if (config.backgroundFill) {
                warnings.push('The background fill only applies to the “Edit contents” strategy.');
            }
        }
        if (config.strategy === 'auto' &&
                (config.fitMode !== 'contain' || config.paddingPercent > 0 || config.backgroundFill)) {
            warnings.push('Auto will use “Edit contents” for this run so the fit, padding and background settings are applied.');
        }
        if (config.fitMode === 'center' && config.paddingPercent > 0) {
            warnings.push('Padding has no effect with the Center fit mode because the artwork is not scaled.');
        }
        if (config.maxOutputSize > 0) {
            warnings.push('Outputs will be capped to ' + config.maxOutputSize + ' px on the long edge.');
        }

        var failed = 0;
        var i;
        for (i = 0; i < checks.length; i++) {
            if (checks[i].status === 'error') { failed += 1; }
        }

        return {
            ok: true,
            canRun: failed === 0,
            checks: checks,
            counts: counts,
            warnings: warnings,
            config: config
        };
    };

    /* ---------------------------------------------------------------- progress */

    function makeReporter(total, startedAt) {
        var state = { done: 0, succeeded: 0, failed: 0 };

        return {
            state: state,
            progress: function (index, fileName) {
                var elapsed = BM.util.now() - startedAt;
                var average = state.done > 0 ? (elapsed / state.done) : 0;
                var payload = {
                    type: BM.EVENT.PROGRESS,
                    index: index,
                    total: total,
                    done: state.done,
                    succeeded: state.succeeded,
                    failed: state.failed,
                    remaining: Math.max(0, total - state.done),
                    percent: total > 0 ? Math.round((state.done / total) * 100) : 0,
                    file: fileName || '',
                    elapsedMs: elapsed,
                    etaMs: (average > 0 && state.done > 0) ? Math.round(average * (total - state.done)) : -1
                };
                BM.cep.emit(BM.EVENT.PROGRESS, payload);
                return payload;
            }
        };
    }

    /* -------------------------------------------------------------------- run */

    /**
     * Execute the batch.
     *
     * @param {Object|string} raw Panel configuration.
     * @return {Object} Run summary, safe to hand straight back to the panel.
     */
    api.run = function (raw) {
        var config = api.normalize(api.coerceConfig(raw));
        var startedAt = BM.util.now();
        var reporter = null;
        var previousDialogs = null;
        var mockupDoc = null;
        var mockupWasOpenedByUs = false;
        var outputFolder = null;
        var targetLayer = null;
        var results = [];
        var errors = [];
        var cancelled = false;
        var i;

        var summary = {
            ok: false,
            cancelled: false,
            total: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            durationMs: 0,
            startedAt: new Date().toString(),
            outputFolder: '',
            logFile: '',
            csvFile: '',
            mockup: null,
            targetLayer: '',
            strategy: config.strategy,
            results: [],
            errors: []
        };

        function recordError(fileName, info) {
            var entry = { design: fileName, code: info.code, message: info.message, detail: info.detail || '' };
            errors.push(entry);
            return entry;
        }

        /** Resolve the Smart Object to work on for the current mockup document. */
        function resolveLayer(doc) {
            var resolved = BM.so.resolveTargetLayer(doc, {
                name: config.smartObjectLayer,
                fallbackNames: config.fallbackLayerNames,
                autoDetect: config.autoDetectLayer
            });
            var layer = resolved.layer;

            if (!BM.so.isSmartObject(layer)) {
                if (config.autoConvertToSmartObject) {
                    BM.log.warn('“' + resolved.resolvedName + '” is not a Smart Object; converting it in place.');
                    layer = BM.so.convertToSmartObject(doc, layer);
                } else {
                    bmFail(
                        BM.ERROR_CODES.LAYER_NOT_SMART,
                        '“' + resolved.resolvedName + '” is a ' + layer.typename + ', not a Smart Object.',
                        'Enable “Convert a matching plain layer to a Smart Object”, or pick a different layer.'
                    );
                }
            }

            if (resolved.matchedBy !== 'name') {
                BM.log.warn('Using “' + resolved.resolvedName + '” (' + resolved.matchedBy + ') instead of “' + config.smartObjectLayer + '”.');
            }
            summary.targetLayer = resolved.resolvedName;
            return layer;
        }

        /** The fast path cannot honour fit, padding or background fill. */
        function needsPrecisePlacement() {
            return config.fitMode !== 'contain' || config.paddingPercent > 0 || !!config.backgroundFill;
        }

        /** Swap the contents, honouring the configured strategy. */
        function applyDesign(doc, layer, designFile) {
            function fastReplace() {
                BM.ps.activateLayer(doc, layer);
                BM.so.replaceContents(layer, designFile);
            }

            function precise() {
                BM.ps.activateLayer(doc, layer);
                var contentsDoc = BM.so.openContents(layer);
                var artwork = null;
                try {
                    artwork = BM.placement.importFileAsLayer(contentsDoc, designFile, 'Bulk Mockup Artwork');
                    BM.placement.removeLayersExcept(contentsDoc, artwork);
                    if (config.backgroundFill) {
                        BM.placement.addBackgroundFill(contentsDoc, config.backgroundFill);
                    }
                    BM.placement.fitAndCenter(contentsDoc, artwork, config);
                } catch (thrown) {
                    BM.so.discardContents(contentsDoc);
                    BM.ps.setActiveDocument(doc);
                    throw thrown;
                }
                BM.so.commitContents(contentsDoc);
                BM.ps.setActiveDocument(doc);
            }

            if (config.strategy === 'editContents') { precise(); return 'editContents'; }
            if (config.strategy === 'replaceContents') { fastReplace(); return 'replaceContents'; }
            if (needsPrecisePlacement()) { precise(); return 'editContents'; }

            try {
                fastReplace();
                return 'replaceContents';
            } catch (thrown) {
                BM.log.debug('Native replace failed (' + (thrown && thrown.message ? thrown.message : thrown) + '); switching to editContents for this file.');
                precise();
                return 'editContents';
            }
        }

        try {
            /* ---------------------------------------------------------- validate */
            BM.ps.assertHost();

            var mockupFile = BM.fs.toFile(config.mockupPath);
            if (!config.mockupPath || !mockupFile.exists) {
                bmFail(BM.ERROR_CODES.MOCKUP_MISSING, config.mockupPath || 'not set');
            }
            if (!BM.fs.isSupportedMockup(mockupFile)) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'The mockup must be a .psd or .psb file, got “' + mockupFile.name + '”.');
            }

            var designsFolder = BM.fs.requireFolder(config.designsFolder, false);
            outputFolder = BM.fs.requireFolder(config.outputFolder, true);
            BM.fs.assertWritable(outputFolder);
            summary.outputFolder = BM.fs.fsName(outputFolder);

            var listing = BM.fs.listDesigns(designsFolder, config);
            if (listing.matched === 0) {
                bmFail(BM.ERROR_CODES.NO_DESIGNS, BM.fs.fsName(designsFolder));
            }
            if (listing.files.length === 0) {
                bmFail(BM.ERROR_CODES.NO_DESIGNS, 'The range or filter excluded every matched image.');
            }

            /* ------------------------------------------------------------ logging */
            var stamp = BM.util.dateStamp() + '_' + BM.util.timeStamp();
            var logPath = config.writeLogFile ? (outputFolder.fsName + '/bulkmockup_' + stamp + '.log') : '';
            BM.log.start({ level: config.logLevel, file: logPath });
            summary.logFile = logPath;

            BM.log.info(BM.APP.NAME + ' v' + BM.APP.VERSION + ' — run started');
            BM.log.info('Mockup: ' + BM.fs.fsName(mockupFile));
            BM.log.info('Designs: ' + listing.files.length + ' image(s) from ' + BM.fs.fsName(designsFolder));
            BM.log.info('Output: ' + BM.fs.fsName(outputFolder) + '  ·  ' + config.format.toUpperCase() + (config.format === 'jpg' ? ' quality ' + config.quality + '%' : ''));
            BM.log.info('Target layer: “' + config.smartObjectLayer + '”  ·  strategy: ' + config.strategy + '  ·  fit: ' + config.fitMode);
            if (listing.skipped.length) {
                BM.log.warn('Skipped ' + listing.skipped.length + ' unsupported file(s): ' + listing.skipped.slice(0, 8).join(', ') + (listing.skipped.length > 8 ? '…' : ''));
            }
            if (config.backgroundFill) {
                BM.log.debug('Background fill: ' + config.backgroundFill);
            }

            /* --------------------------------------------------------------- setup */
            BM.fs.clearCancelFlag();
            previousDialogs = BM.ps.pushQuiet();

            var total = listing.files.length;
            summary.total = total;
            reporter = makeReporter(total, startedAt);

            var opened = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE);
            mockupDoc = opened.doc;
            mockupWasOpenedByUs = !opened.wasAlreadyOpen;

            if (opened.wasAlreadyOpen) {
                BM.log.warn('The mockup was already open in Photoshop. It will be left open, and never saved over.');
            }

            var mockupInfo = BM.ps.size(mockupDoc);
            summary.mockup = {
                name: mockupDoc.name,
                width: Math.round(mockupInfo.width),
                height: Math.round(mockupInfo.height),
                resolution: Math.round(mockupInfo.resolution)
            };
            BM.log.info('Mockup canvas: ' + summary.mockup.width + '×' + summary.mockup.height + ' px @ ' + summary.mockup.resolution + ' ppi');

            if (!config.reopenMockupPerDesign) {
                targetLayer = resolveLayer(mockupDoc);
            }

            BM.cep.emit(BM.EVENT.PROGRESS, {
                type: BM.EVENT.PROGRESS,
                index: 0, total: total, done: 0, succeeded: 0, failed: 0, remaining: total,
                percent: 0, file: '', elapsedMs: 0, etaMs: -1, phase: 'starting'
            });

            /* ----------------------------------------------------------- the loop */
            for (i = 0; i < listing.files.length; i++) {
                var designFile = listing.files[i];
                var position = i + 1;

                if (BM.fs.isCancelRequested()) {
                    cancelled = true;
                    BM.log.warn('Cancellation requested — stopping after ' + reporter.state.done + ' of ' + total + '.');
                    break;
                }

                var itemStartedAt = BM.util.now();
                var result = {
                    index: position,
                    design: designFile.name,
                    status: 'ok',
                    output: '',
                    message: '',
                    durationMs: 0
                };

                try {
                    if (config.reopenMockupPerDesign) {
                        mockupDoc = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE).doc;
                        targetLayer = resolveLayer(mockupDoc);
                    }

                    var strategyUsed = applyDesign(mockupDoc, targetLayer, designFile);

                    var output = BM.exporter.buildOutputFile(outputFolder, designFile, position, config);
                    var written = BM.exporter.save(mockupDoc, output.file, config);

                    result.output = written.path;
                    result.bytes = written.bytes;
                    result.strategy = strategyUsed;
                    if (output.deduplicated) { result.message = 'saved as “' + output.file.name + '” to avoid overwriting'; }
                    if (written.notes && written.notes.length) {
                        result.message = BM.util.trim((result.message ? result.message + ' · ' : '') + written.notes.join(' · '));
                    }

                    reporter.state.succeeded += 1;
                    BM.log.success('[' + position + '/' + total + '] ' + designFile.name + ' → ' + output.file.name +
                        (result.message ? '  (' + result.message + ')' : ''));

                    if (config.reopenMockupPerDesign) {
                        BM.ps.closeDocument(mockupDoc, false);
                        mockupDoc = null;
                    }
                } catch (thrown) {
                    var info = BM.describeError(thrown);
                    result.status = 'failed';
                    result.message = info.message + (info.detail ? ' (' + info.detail + ')' : '');
                    reporter.state.failed += 1;
                    recordError(designFile.name, info);
                    BM.log.error('[' + position + '/' + total + '] ' + designFile.name + ' failed — ' + result.message);
                    if (info.hint) { BM.log.debug('   hint: ' + info.hint); }

                    // A broken Smart Object leaves the mockup in an unknown
                    // state; re-open it so the rest of the batch still has a
                    // chance of succeeding.
                    if (!config.reopenMockupPerDesign) {
                        try {
                            BM.ps.closeDocument(mockupDoc, false);
                        } catch (e) { /* ignored */ }
                        try {
                            mockupDoc = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE).doc;
                            targetLayer = resolveLayer(mockupDoc);
                        } catch (e) {
                            BM.log.error('Could not re-open the mockup; aborting the run.');
                            recordError('(mockup)', BM.describeError(e));
                            break;
                        }
                    }
                }

                result.durationMs = BM.util.now() - itemStartedAt;
                results.push(result);
                reporter.state.done += 1;
                reporter.progress(position, designFile.name);

                BM.cep.emit(BM.EVENT.ITEM, {
                    type: BM.EVENT.ITEM,
                    index: position,
                    total: total,
                    design: designFile.name,
                    status: result.status,
                    output: result.output,
                    message: result.message,
                    durationMs: result.durationMs
                });

                BM.cep.breathe(config.delayMs);
            }

            /* ------------------------------------------------------------- finish */
            summary.results = results;
            summary.errors = errors.slice(0, MAX_REPORTED_ERRORS);
            summary.processed = reporter.state.done;
            summary.succeeded = reporter.state.succeeded;
            summary.failed = reporter.state.failed;
            summary.cancelled = cancelled;
            summary.durationMs = BM.util.now() - startedAt;
            summary.ok = !cancelled && reporter.state.failed === 0;

            if (config.writeCsvReport) {
                var csvPath = outputFolder.fsName + '/bulkmockup_' + stamp + '.csv';
                var rows = [];
                for (i = 0; i < results.length; i++) {
                    rows.push({
                        design: results[i].design,
                        status: results[i].status,
                        output: results[i].output,
                        message: results[i].message
                    });
                }
                if (BM.exporter.writeCsvReport(csvPath, rows)) {
                    summary.csvFile = csvPath;
                    BM.log.info('Report written to ' + csvPath);
                }
            }

            BM.log.info('Finished: ' + summary.succeeded + ' exported, ' + summary.failed + ' failed, ' +
                'in ' + BM.util.formatDuration(summary.durationMs));

        } catch (thrown) {
            var failure = BM.describeError(thrown);
            summary.ok = false;
            summary.error = failure;
            BM.log.error(failure.message + (failure.detail ? ' — ' + failure.detail : ''));
            if (failure.hint) { BM.log.debug('   hint: ' + failure.hint); }
        } finally {
            /* ------------------------------------------------------------- cleanup */
            try { BM.ps.popQuiet(previousDialogs); } catch (e) { /* ignored */ }

            if (mockupDoc) {
                if (mockupWasOpenedByUs) {
                    BM.ps.closeDocument(mockupDoc, false);
                    BM.log.debug('Closed the mockup without saving.');
                } else {
                    BM.log.debug('Left the user’s own mockup document open and unsaved.');
                }
                mockupDoc = null;
            }

            try { BM.fs.clearCancelFlag(); } catch (e) { /* ignored */ }

            if (reporter && !summary.durationMs) {
                summary.durationMs = BM.util.now() - startedAt;
                summary.processed = reporter.state.done;
                summary.succeeded = reporter.state.succeeded;
                summary.failed = reporter.state.failed;
            }

            var logLines = 0;
            try { logLines = BM.log.finish(); } catch (e) { /* ignored */ }
            summary.logLines = logLines;

            BM.cep.emit(BM.EVENT.DONE, { type: BM.EVENT.DONE, summary: summary });
        }

        return summary;
    };

    return api;
}());
