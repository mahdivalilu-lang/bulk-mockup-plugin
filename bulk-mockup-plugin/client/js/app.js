/**
 * app.js — the controller.
 *
 * Owns the panel's state machine (idle → validating → running → done), gathers
 * the configuration out of the DOM, and routes engine events to the UI module.
 * All of the DOM fiddling is delegated to `BMUI.ui`; all of the talking to
 * Photoshop is delegated to `BMUI.bridge`.
 */
window.BMUI = window.BMUI || {};

(function (ns) {
    'use strict';

    var bridge = ns.bridge;
    var store = ns.store;
    var ui = ns.ui;
    var pickers = ns.pickers;

    var $ = function (id) { return document.getElementById(id); };

    var state = {
        running: false,
        cancelPath: '',
        engine: null,
        finished: false,
        validateTimer: null
    };

    var progressTimer = null;
    var pendingProgress = null;

    /**
     * Coalesce engine progress events into at most ~12 DOM updates per second.
     * The engine can emit an event per design; this keeps a large batch from
     * turning into a stream of layout/paint work in an old CEF build.
     */
    function flushProgress() {
        progressTimer = null;
        if (!pendingProgress) { return; }
        var payload = pendingProgress;
        pendingProgress = null;
        ui.updateProgress(payload);
    }

    function queueProgress(payload) {
        pendingProgress = payload;
        if (!progressTimer) {
            progressTimer = window.setTimeout(flushProgress, 80);
        }
    }

    function clearProgressQueue() {
        if (progressTimer) {
            window.clearTimeout(progressTimer);
            progressTimer = null;
        }
        pendingProgress = null;
    }

    /* =================================================================== config */

    function numberOrZero(value) {
        var n = parseFloat(value);
        return isFinite(n) ? n : 0;
    }

    /** Read the whole panel into the engine's config shape. */
    function gather() {
        return {
            mockupPath: $('mockupPath').value,
            designsFolder: $('designsFolder').value,
            outputFolder: $('outputFolder').value,

            smartObjectLayer: $('smartObjectLayer').value,
            autoDetectLayer: $('autoDetectLayer').checked,
            autoConvertToSmartObject: $('autoConvertToSmartObject').checked,

            fitMode: $('fitMode').value,
            paddingPercent: numberOrZero($('paddingPercent').value),
            strategy: $('strategy').value,

            format: $('format').value,
            quality: numberOrZero($('quality').value),
            pngCompression: numberOrZero($('pngCompression').value),
            maxOutputSize: numberOrZero($('maxOutputSize').value),
            backgroundFill: $('useBackgroundFill').checked ? $('backgroundFill').value : '',

            namingTemplate: $('namingTemplate').value,
            filenamePrefix: $('filenamePrefix').value,
            filenameSuffix: $('filenameSuffix').value,
            overwrite: $('overwrite').checked,

            sort: $('sort').value,
            nameFilter: $('nameFilter').value,
            startAt: numberOrZero($('startAt').value) || 1,
            limit: numberOrZero($('limit').value),

            reopenMockupPerDesign: $('reopenMockupPerDesign').checked,
            delayMs: numberOrZero($('delayMs').value),

            writeLogFile: $('writeLogFile').checked,
            writeCsvReport: $('writeCsvReport').checked,
            logLevel: $('logLevel').value
        };
    }

    /* =================================================================== labels */
    function syncLabels() {
        var padNode = $('paddingPercent');
        var pad = padNode ? numberOrZero(padNode.value) : 0;
        var qualNode = $('quality');
        var quality = qualNode ? numberOrZero(qualNode.value) : 0;
        var pngNode = $('pngCompression');
        var png = pngNode ? numberOrZero(pngNode.value) : 0;

        var pv = $('paddingValue');
        if (pv) { pv.textContent = pad + '%'; }
        var qv = $('qualityValue');
        if (qv) { qv.textContent = quality >= 100 ? '100% (maximum)' : quality + '%'; }
        var pngv = $('pngValue');
        if (pngv) { pngv.textContent = String(png); }
    }

    function syncFormatFields() {
        var fmt = $('format');
        if (!fmt) { return; }
        var isPng = fmt.value === 'png';
        var qf = $('qualityField');
        if (qf) { qf.hidden = isPng; }
        var pf = $('pngField');
        if (pf) { pf.hidden = !isPng; }
    }

    function syncBackgroundField() {
        var check = $('useBackgroundFill');
        var input = $('backgroundFill');
        if (check && input) { input.disabled = !check.checked; }
    }

    /* ============================================================== validation */

    function setDesignsInfo(report) {
        var counts = report && report.counts;
        var node = $('designsInfo');
        if (!counts) { node.textContent = 'No folder chosen.'; return; }

        if (!counts.limitedTo) {
            node.textContent = 'No designs found.';
            return;
        }
        var text = counts.designs + ' queued';
        if (counts.limitedTo > counts.designs) { text += ' of ' + counts.limitedTo + ' matched'; }
        if (counts.skipped) { text += ' · ' + counts.skipped + ' unsupported skipped'; }
        node.textContent = text;
    }

    function validate() {
        if (state.running) { return Promise.resolve(null); }

        return bridge.call('inspect', gather()).then(function (report) {
            ui.renderChecks(report);
            setDesignsInfo(report);

            if (report.warnings && report.warnings.length) {
                ui.showBanner(report.warnings[0] + (report.warnings.length > 1 ? ' (+' + (report.warnings.length - 1) + ' more in the log)' : ''), 'warn');
            } else {
                ui.showBanner('');
            }

            (report.warnings || []).forEach(function (warning) {
                ui.log('warn', warning);
            });

            return report;
        }).catch(function (error) {
            ui.renderChecks(null);
            $('validateSummary').textContent = '';
            ui.showBanner(error.message, 'error');
            return null;
        });
    }

    /** Coalesce bursts of keystrokes into one validation pass. */
    function validateSoon(delayMs) {
        if (state.validateTimer) { window.clearTimeout(state.validateTimer); }
        state.validateTimer = window.setTimeout(function () {
            state.validateTimer = null;
            validate();
        }, delayMs === undefined ? 400 : delayMs);
    }

    /* ============================================================== find layers */

    function findLayers() {
        var path = $('mockupPath').value;
        if (!path) {
            ui.toast('Choose a mockup PSD first.', 'warn');
            $('browseMockup').focus();
            return;
        }

        var button = $('findLayers');
        button.disabled = true;
        button.textContent = 'Reading…';
        $('mockupInfo').textContent = 'Reading the mockup…';

        bridge.call('listSmartObjectLayers', path).then(function (data) {
            var select = $('layerSelect');
            select.innerHTML = '';

            if (!data.smartObjects.length) {
                select.innerHTML = '<option value="">— no Smart Objects found —</option>';
                $('mockupInfo').textContent = data.file + ' · ' + data.document.width + '×' + data.document.height + ' px · no Smart Objects';
                ui.alert(
                    'No Smart Objects in this mockup',
                    '“' + data.file + '” has ' + data.layers.length + ' layer(s), but none of them is a Smart Object.',
                    {
                        hint: 'Only Smart Objects can have their contents replaced. Convert the artwork layer to a Smart Object, then try again.',
                        list: data.layers.map(function (layer) { return layer.path; })
                    }
                );
                return;
            }

            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '— pick a Smart Object (' + data.smartObjects.length + ') —';
            select.appendChild(placeholder);

            data.smartObjects.forEach(function (layerPath) {
                var option = document.createElement('option');
                option.value = layerPath.split(' / ').pop();
                option.textContent = layerPath;
                option.dataset.path = layerPath;
                select.appendChild(option);
            });

            // Pre-select whatever is currently in the text field, when present.
            var current = $('smartObjectLayer').value;
            var matched = false;
            Array.prototype.forEach.call(select.options, function (option) {
                if (option.value && option.value === current) { select.value = option.value; matched = true; }
            });
            if (!matched && !current && data.smartObjects.length === 1) {
                select.value = data.smartObjects[0].split(' / ').pop();
                $('smartObjectLayer').value = select.value;
            }

            var info = data.file + ' · ' + data.document.width + '×' + data.document.height + ' px · ' +
                data.smartObjects.length + ' Smart Object' + (data.smartObjects.length === 1 ? '' : 's');
            $('mockupInfo').textContent = info;

            ui.log('info', 'Found ' + data.smartObjects.length + ' Smart Object(s) in ' + data.file + ': ' + data.smartObjects.join(', '));
            ui.toast('Found ' + data.smartObjects.length + ' Smart Object' + (data.smartObjects.length === 1 ? '' : 's') + '.', 'success');
            validateSoon(0);
            store.save();
        }).catch(function (error) {
            $('mockupInfo').textContent = 'Could not read the mockup.';
            ui.log('error', 'Reading layers failed: ' + error.message);
            ui.alert('Could not read the mockup', error.message, { hint: error.hint, detail: error.detail });
        }).then(function () {
            button.disabled = false;
            button.textContent = 'Find layers';
        });
    }

    /* ===================================================================== run */

    function handleEvent(payload) {
        /*
         * This callback is invoked by the CEP/PlugPlug event dispatcher. A DOM
         * exception here must never escape back into the host, so the whole
         * handler is isolated and payloads are validated before use.
         */
        try {
            if (!payload || typeof payload !== 'object') { return; }

            if (payload.type === 'log') {
                ui.log(payload.level, payload.message);
                return;
            }
            if (payload.type === 'progress') {
                queueProgress(payload);
                return;
            }
            if (payload.type === 'item') {
                if (payload.status === 'failed') {
                    ui.log('error', payload.design + ' — ' + payload.message);
                }
                return;
            }
            if (payload.type === 'done') {
                clearProgressQueue();
                completeRun(payload.summary);
            }
        } catch (e) {
            // Swallow panel-side failures at the host boundary.
        }
    }

    function completeRun(summary) {
        if (!summary || state.finished) { return; }
        state.finished = true;
        clearProgressQueue();

        state.running = false;
        ui.setBusy(false);
        ui.finishProgress(summary);

        if (summary.error) {
            ui.setStatus('error', 'Failed');
            ui.alert('The run stopped', summary.error.message, {
                hint: summary.error.hint,
                detail: summary.error.detail
            });
            return;
        }

        if (summary.cancelled) {
            ui.setStatus('idle', 'Cancelled');
            ui.toast('Cancelled after ' + summary.processed + ' of ' + summary.total + '.', 'warn');
            return;
        }

        if (summary.failed > 0) {
            ui.setStatus('error', summary.failed + ' failed');
            ui.alert(
                summary.succeeded + ' exported, ' + summary.failed + ' failed',
                'Some designs could not be processed. The successful mockups are already saved in the output folder.',
                {
                    hint: 'The first fail usually explains the rest — check the log pane and the CSV report.',
                    list: (summary.errors || []).map(function (entry) {
                        return entry.design + ': ' + entry.message;
                    }),
                    detail: summary.csvFile || summary.logFile || ''
                }
            );
            return;
        }

        ui.setStatus('done', 'Done');
        ui.toast('Exported ' + summary.succeeded + ' mockup' + (summary.succeeded === 1 ? '' : 's') + ' in ' + ui.formatDuration(summary.durationMs), 'success');
        if (summary.outputFolder) {
            ui.log('info', 'Output folder: ' + summary.outputFolder);
        }
    }

    function startRun() {
        if (state.running) { return; }

        validate().then(function (report) {
            if (!report) {
                ui.alert('Cannot start', 'The pre-flight check could not run. See the log pane for details.');
                return;
            }
            if (!report.canRun) {
                var problems = report.checks
                    .filter(function (check) { return check.status === 'error'; })
                    .map(function (check) { return check.label + ': ' + check.detail; });
                ui.alert('Fix these before starting', 'The run was not started because the setup is incomplete.', {
                    list: problems
                });
                ui.setStatus('error', 'Not ready');
                return;
            }
            store.save();
            runConfirmed();
        });
    }

    function runConfirmed() {
        state.running = true;
        state.finished = false;
        clearProgressQueue();

        ui.setBusy(true);
        ui.setStatus('running', 'Running');
        ui.resetProgress();
        ui.showBanner('');

        ui.log('info', '──────────────────────────────────');
        ui.log('info', 'Starting batch…');

        var payload = gather();

        // Clear any sentinel left behind by a previous crash, then go.
        bridge.call('clearCancel')
            .then(function () { return bridge.call('start', payload); })
            .then(function (summary) {
                completeRun(summary);
            })
            .catch(function (error) {
                state.running = false;
                state.finished = true;
                ui.setBusy(false);
                ui.setStatus('error', 'Failed');
                ui.log('error', error.message);
                ui.alert('The run could not start', error.message, { hint: error.hint, detail: error.detail });
            })
            .then(function () {
                // Outputs now exist, so the counts and warnings have changed.
                validateSoon(200);
            });
    }

    function requestCancel() {
        if (!state.running) { return; }

        $('cancelBtn').disabled = true;
        ui.setStatus('paused', 'Cancelling');
        ui.log('warn', 'Cancellation requested — finishing the current design, then stopping.');

        bridge.writeSentinel(state.cancelPath, '1').then(function (ok) {
            if (!ok) {
                ui.log('error', 'Could not write the cancellation file; the run will continue.');
                ui.toast('Could not signal Photoshop to stop.', 'error');
            }
        });
    }

    /* ================================================================ clipboard */

    function copyToClipboard(text) {
        if (!text) { return false; }

        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'absolute';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();

        var copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (e) {
            copied = false;
        }
        document.body.removeChild(area);

        if (!copied) {
            ui.toast('Copying is not available in this host — use “Save panel log” instead.', 'warn');
        }
        return copied;
    }

    /* ==================================================================== boot */

    /* -------------------------------------------------------- sync guard */

    /** True while the store or engine is writing into the controls. */
    function isSyncing() {
        return !!ns.isSyncing;
    }

    /**
     * Run a programmatic UI update with listener feedback suppressed.
     * try/finally means a single bad node cannot leave the panel stuck.
     */
    function withSync(fn) {
        var previous = !!ns.isSyncing;
        ns.isSyncing = true;
        try {
            return fn();
        } finally {
            ns.isSyncing = previous;
        }
    }

    /* ------------------------------------------------------ options panel */

    function optionsExpanded() {
        var body = $('optionsBody');
        return !!(body && body.classList && body.classList.contains('expanded'));
    }

    /**
     * Render the Options section from a single boolean.
     *
     * Uses an instant `display:block` / `display:none` state change. There is
     * no transition, animation, max-height or transform involved, and the
     * collapsed subtree is also marked `hidden`, so CEP never lays it out.
     *
     * Deliberately does no persistence, no DOM-wide reads and no timers: the
     * open state is session-only, so a click costs a few class/attribute
     * writes and nothing else.
     */
    function renderOptions(expanded) {
        var card = $('optionsCard');
        var header = $('optionsHeader');
        var body = $('optionsBody');
        if (!card || !header || !body) { return; }

        expanded = !!expanded;

        if (expanded) {
            card.classList.remove('collapsed');
            card.classList.add('expanded');
            body.classList.remove('collapsed');
            body.classList.add('expanded');
        } else {
            card.classList.remove('expanded');
            card.classList.add('collapsed');
            body.classList.remove('expanded');
            body.classList.add('collapsed');
        }

        // Two independent primitive guarantees: the attribute (global
        // `[hidden] { display:none !important }`) and the inline display.
        body.hidden = !expanded;
        body.style.display = expanded ? 'block' : 'none';

        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        body.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    }

    /** Public for the legacy inline callers; all real clicks are bound below. */
    ns.toggleOptions = function (force) {
        var next = typeof force === 'boolean' ? force : !optionsExpanded();
        renderOptions(next);
    };

    /**
     * Seed the controls from the engine's defaults.
     *
     * Only called on a *fresh* profile: once the user has saved settings, those
     * win, otherwise every restart would quietly undo their choices.
     */
    function applyDefaults(defaults) {
        withSync(function () {
            defaults = defaults || {};

            function setValue(id, value) {
                var node = $(id);
                if (node && value !== undefined && value !== null) { node.value = String(value); }
            }

            function setChecked(id, value) {
                var node = $(id);
                if (node) { node.checked = !!value; }
            }

            setValue('smartObjectLayer', defaults.smartObjectLayer);
            setValue('fitMode', defaults.fitMode);
            setValue('strategy', defaults.strategy);
            setValue('format', defaults.format);
            setValue('quality', defaults.quality);
            setValue('pngCompression', defaults.pngCompression);
            setValue('namingTemplate', defaults.namingTemplate);
            setValue('filenamePrefix', defaults.filenamePrefix);
            setValue('filenameSuffix', defaults.filenameSuffix);
            setValue('sort', defaults.sort);
            setValue('startAt', defaults.startAt);
            setValue('limit', defaults.limit);
            setValue('delayMs', defaults.delayMs);
            setValue('logLevel', defaults.logLevel);
            setValue('paddingPercent', defaults.paddingPercent);
            setValue('maxOutputSize', defaults.maxOutputSize || '');
            setValue('backgroundFill', defaults.backgroundFill || '#ffffff');

            setChecked('autoDetectLayer', defaults.autoDetectLayer);
            setChecked('autoConvertToSmartObject', defaults.autoConvertToSmartObject);
            setChecked('overwrite', defaults.overwrite);
            setChecked('writeLogFile', defaults.writeLogFile);
            setChecked('writeCsvReport', defaults.writeCsvReport);
            setChecked('reopenMockupPerDesign', defaults.reopenMockupPerDesign);
            setChecked('useBackgroundFill', false);

            syncLabels();
            syncFormatFields();
            syncBackgroundField();
        });
    }

    function bind() {
        $('browseMockup').addEventListener('click', function () {
            pickers.pickMockup($('mockupPath').value).then(function (path) {
                if (!path) { return; }
                $('mockupPath').value = path;
                $('layerSelect').innerHTML = '<option value="">— run “Find layers” to populate —</option>';
                $('mockupInfo').textContent = 'Reading the mockup…';
                store.save();
                validateSoon(0);
                findLayers();
            }).catch(function (error) {
                ui.alert('Could not open the file dialog', error.message, { hint: error.hint });
            });
        });

        $('browseDesigns').addEventListener('click', function () {
            pickers.pickDesignsFolder($('designsFolder').value).then(function (path) {
                if (!path) { return; }
                $('designsFolder').value = path;
                store.save();
                validate();
            }).catch(function (error) {
                ui.alert('Could not open the folder dialog', error.message, { hint: error.hint });
            });
        });

        $('browseOutput').addEventListener('click', function () {
            pickers.pickOutputFolder($('outputFolder').value).then(function (path) {
                if (!path) { return; }
                $('outputFolder').value = path;
                store.save();
                validate();
            }).catch(function (error) {
                ui.alert('Could not open the folder dialog', error.message, { hint: error.hint });
            });
        });

        $('findLayers').addEventListener('click', findLayers);

        $('layerSelect').addEventListener('change', function () {
            if (isSyncing()) { return; }
            if (this.value) { $('smartObjectLayer').value = this.value; }
            store.save();
            validateSoon();
        });

        $('revealDesigns').addEventListener('click', function () {
            var path = $('designsFolder').value;
            if (!path) { ui.toast('No designs folder chosen yet.', 'warn'); return; }
            bridge.call('revealFolder', path).catch(function (error) {
                ui.alert('Could not open that folder', error.message, { hint: error.hint });
            });
        });

        $('revealOutput').addEventListener('click', function () {
            var path = $('outputFolder').value;
            if (!path) { ui.toast('No output folder chosen yet.', 'warn'); return; }
            bridge.call('revealFolder', path).catch(function (error) {
                ui.alert('Could not open that folder', error.message, { hint: error.hint });
            });
        });

        $('startBtn').addEventListener('click', startRun);
        $('cancelBtn').addEventListener('click', requestCancel);
        $('validateBtn').addEventListener('click', function () { validate(); });

        var optionsHeader = $('optionsHeader');
        if (optionsHeader) {
            optionsHeader.addEventListener('click', function (event) {
                if (event) { event.preventDefault(); }
                ns.toggleOptions();
            });
            optionsHeader.addEventListener('keydown', function (event) {
                var key = event.key || '';
                var code = event.keyCode || 0;
                if (key === 'Enter' || key === ' ' || key === 'Spacebar' || code === 13 || code === 32) {
                    event.preventDefault();
                    ns.toggleOptions();
                }
            });
        }

        var fmt = $('format');
        if (fmt) { fmt.addEventListener('change', function () { if (isSyncing()) { return; } syncFormatFields(); validateSoon(); }); }
        var pad = $('paddingPercent');
        if (pad) { pad.addEventListener('input', function () { if (isSyncing()) { return; } syncLabels(); }); }
        var qual = $('quality');
        if (qual) { qual.addEventListener('input', function () { if (isSyncing()) { return; } syncLabels(); }); }
        var png = $('pngCompression');
        if (png) { png.addEventListener('input', function () { if (isSyncing()) { return; } syncLabels(); }); }
        var bg = $('useBackgroundFill');
        if (bg) { bg.addEventListener('change', function () { if (isSyncing()) { return; } syncBackgroundField(); validateSoon(); }); }

        $('resetOptions').addEventListener('click', function () {
            store.clear();
            window.location.reload();
        });

        $('clearLogBtn').addEventListener('click', ui.clearLog);

        $('copyLogBtn').addEventListener('click', function () {
            if (copyToClipboard(ui.logText())) { ui.toast('Log copied to the clipboard.', 'success'); }
        });

        $('saveLogBtn').addEventListener('click', function () {
            var text = ui.logText();
            if (!text) { ui.toast('The log is empty.', 'warn'); return; }
            bridge.call('savePanelLog', { folder: $('outputFolder').value, text: text })
                .then(function (data) {
                    ui.toast('Panel log saved to ' + data.path, 'success');
                    ui.log('info', 'Panel log saved to ' + data.path);
                })
                .catch(function (error) {
                    ui.alert('Could not save the panel log', error.message, { hint: error.hint });
                });
        });

        $('modalCloseBtn').addEventListener('click', ui.closeModal);
        $('modalCopyBtn').addEventListener('click', function () { copyToClipboard(ui.modalDetails()); });

        $('aboutLink').addEventListener('click', function (event) {
            event.preventDefault();
            var engine = state.engine || {};
            var host = engine.host
                ? (engine.host.name + ' ' + engine.host.version + ' (build ' + engine.host.build + ')')
                : 'unknown host';
            ui.alert('Bulk Mockup ' + (engine.version || ''), engine.tagline || '', {
                hint: 'Running inside ' + host + '.',
                detail: (engine.events ? 'Live progress: connected' : 'Live progress: unavailable (running outside the panel)') +
                    (state.cancelPath ? ' · Cancellation file: ' + state.cancelPath : '')
            });
        });

        // Re-validate as the user edits anything that affects the plan.
        ['smartObjectLayer', 'nameFilter', 'namingTemplate', 'filenamePrefix', 'filenameSuffix',
            'sort', 'strategy', 'fitMode', 'format', 'backgroundFill', 'startAt', 'limit', 'maxOutputSize'].forEach(function (id) {
            var node = $(id);
            if (!node) { return; }
            node.addEventListener('change', function () { if (isSyncing()) { return; } store.save(); validateSoon(250); });
            if (node.tagName === 'INPUT') {
                node.addEventListener('input', function () { if (isSyncing()) { return; } validateSoon(500); });
            }
        });

        ['autoDetectLayer', 'autoConvertToSmartObject', 'overwrite', 'writeLogFile',
            'writeCsvReport', 'reopenMockupPerDesign', 'logLevel', 'delayMs'].forEach(function (id) {
            var node = $(id);
            if (!node) { return; }
            node.addEventListener('change', function () { if (isSyncing()) { return; } store.save(); validateSoon(250); });
        });
    }

    function boot() {
        var restored = store.load();
        bind();

        // OPTIONS always starts collapsed and inert. Re-assert that state once
        // after the markup is live so classes, ARIA and the `hidden` attribute
        // cannot drift apart, and no persisted flag can reopen it.
        renderOptions(false);

        // A restored session sets control values but not the derived labels
        // and visibility rules, so apply them once before anything else.
        syncLabels();
        syncFormatFields();
        syncBackgroundField();

        ui.log('info', 'Bulk Mockup panel ready.' + (restored ? ' Restored your last settings.' : ''));

        bridge.ensureEngine().then(function (info) {
            state.engine = info;
            state.cancelPath = info.cancelFile || '';

            $('footerVersion').textContent = info.name + ' ' + info.version;
            $('brandSub').textContent = 'Photoshop ' + (info.host ? info.host.version : '');
            ui.setStatus('idle', 'Ready');

            if (!info.events) {
                ui.showBanner('Live progress is unavailable, so the panel will only update when the run finishes.', 'warn');
            }

            if (!restored) {
                applyDefaults(info.defaults || {});
                store.save();
            }

            if (!bridge.hostEnvironment()) {
                ui.showBanner('Could not confirm the Photoshop host. Some features may not work.', 'warn');
            }

            ui.log('info', 'Connected to ' + (info.host ? info.host.name + ' ' + info.host.version : 'Photoshop') + '.');

            if (!restored && info.defaults) {
                ui.log('info', 'Tip: press “Find layers” to list the Smart Objects in your mockup.');
            }

            return validate();
        }).catch(function (error) {
            ui.setStatus('error', 'No engine');
            ui.showBanner('The ExtendScript engine is not reachable: ' + error.message, 'error');
            ui.log('error', 'Engine unreachable: ' + error.message + (error.detail ? ' — ' + error.detail : ''));
            ui.alert('Bulk Mockup could not start', error.message, {
                hint: error.hint || 'Make sure the panel is running inside Photoshop (not a browser), then reload the panel.',
                detail: error.detail
            });
        });

        bridge.onEvent(handleEvent);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}(window.BMUI));
