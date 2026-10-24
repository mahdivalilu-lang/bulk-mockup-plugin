/**
 * ui.js — all DOM mutation lives here.
 *
 * The app controller decides *what* happened; this module decides how it looks.
 * Keeping them apart is what makes the panel testable-ish and re-themeable.
 */
window.BMUI = window.BMUI || {};

(function (ns) {
    'use strict';

    var MAX_LOG_LINES = 1500;

    function $(id) { return document.getElementById(id); }

    /* ------------------------------------------------------------------- text */

    function pad2(value) { return value < 10 ? '0' + value : String(value); }

    function timeNow() {
        var d = new Date();
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }

    function formatDuration(ms) {
        if (!isFinite(ms) || ms < 0) { return '—'; }
        if (ms < 1000) { return Math.round(ms) + 'ms'; }
        var seconds = Math.round(ms / 1000);
        if (seconds < 60) { return seconds + 's'; }
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) { return minutes + 'm ' + pad2(seconds % 60) + 's'; }
        return Math.floor(minutes / 60) + 'h ' + pad2(minutes % 60) + 'm';
    }

    function formatEta(ms) {
        if (!isFinite(ms) || ms <= 0) { return '—'; }
        if (ms < 2000) { return 'almost done'; }
        return formatDuration(ms) + ' left';
    }

    /* ------------------------------------------------------------------- logs */

    var logNode = null;
    var logCount = 0;
    var logScrollTimer = null;

    /**
     * Coalesce auto-scroll into one write per 80ms.
     *
     * Reading `scrollHeight` after every line forces a synchronous layout in
     * old CEF builds, so a fast batch could reflow hundreds of times a second.
     * One deferred write keeps the newest line visible without the thrash.
     */
    function scheduleLogScroll() {
        if (logScrollTimer) { return; }
        logScrollTimer = window.setTimeout(function () {
            logScrollTimer = null;
            var node = logNodeEnsure();
            var toggle = $('autoScroll');
            if (node && toggle && toggle.checked) {
                node.scrollTop = node.scrollHeight;
            }
        }, 80);
    }

    function logNodeEnsure() {
        if (!logNode) { logNode = $('log'); }
        return logNode;
    }

    function log(level, message) {
        var node = logNodeEnsure();
        if (!node) { return; }

        if (logCount === 0) { node.innerHTML = ''; }

        var line = document.createElement('div');
        line.className = 'log-line';
        line.dataset.level = level || 'info';

        var time = document.createElement('span');
        time.className = 't';
        time.textContent = timeNow();

        var body = document.createElement('span');
        body.className = 'm';
        body.textContent = message;

        line.appendChild(time);
        line.appendChild(body);
        node.appendChild(line);

        logCount += 1;

        while (logCount > MAX_LOG_LINES && node.firstChild) {
            node.removeChild(node.firstChild);
            logCount -= 1;
        }

        if ($('autoScroll') && $('autoScroll').checked) {
            scheduleLogScroll();
        }
    }

    function clearLog() {
        var node = logNodeEnsure();
        if (!node) { return; }
        node.innerHTML = '<div class="log-empty">Nothing yet.</div>';
        logCount = 0;
    }

    function logText() {
        var node = logNodeEnsure();
        if (!node) { return ''; }
        var out = [];
        Array.prototype.forEach.call(node.children, function (line) {
            if (line.classList.contains('log-empty')) { return; }
            var time = line.querySelector('.t');
            var body = line.querySelector('.m');
            out.push('[' + (time ? time.textContent : '--:--:--') + '] ' + (body ? body.textContent : line.textContent));
        });
        return out.join('\r\n');
    }

    /* ------------------------------------------------------------------ toasts */

    var toastTimer = null;

    /**
     * Show a short message in the single in-flow status line above the footer.
     *
     * No nodes are created or destroyed and there is no overlay: the line is a
     * normal block that is display:none while idle. A single timer owns the
     * auto-hide, so rapid messages cannot accumulate timers.
     */
    function toast(message, level, durationMs) {
        var node = $('toast');
        if (!node) { return; }

        if (toastTimer) {
            window.clearTimeout(toastTimer);
            toastTimer = null;
        }

        node.textContent = message;
        node.dataset.level = level || 'info';
        node.hidden = false;

        toastTimer = window.setTimeout(function () {
            toastTimer = null;
            var current = $('toast');
            if (current) { current.hidden = true; }
        }, durationMs || (level === 'error' ? 7000 : 3500));
    }

    /* ------------------------------------------------------------------- modal */

    var modalState = { details: '' };

    /**
     * Blocking alert used for anything the user must not miss.
     *
     * @param {string}   title
     * @param {string}   message
     * @param {Object=}  options `{ hint, list, detail, level }`
     */
    function alert(title, message, options) {
        options = options || {};
        var modal = $('modal');
        var body = $('modalBody');
        if (!modal || !body) { return; }

        body.innerHTML = '';

        var paragraph = document.createElement('p');
        paragraph.textContent = message;
        body.appendChild(paragraph);

        if (options.hint) {
            var hint = document.createElement('p');
            hint.className = 'faint';
            hint.textContent = options.hint;
            body.appendChild(hint);
        }

        if (options.list && options.list.length) {
            var list = document.createElement('ul');
            options.list.slice(0, 12).forEach(function (entry) {
                var item = document.createElement('li');
                item.textContent = entry;
                list.appendChild(item);
            });
            if (options.list.length > 12) {
                var more = document.createElement('li');
                more.textContent = '…and ' + (options.list.length - 12) + ' more (see the report file).';
                list.appendChild(more);
            }
            body.appendChild(list);
        }

        if (options.detail) {
            var code = document.createElement('code');
            code.textContent = options.detail;
            body.appendChild(code);
        }

        $('modalTitle').textContent = title || 'Notice';
        modalState.details = [title, message, options.hint, options.detail].filter(Boolean).join('\n');
        $('modalCopyBtn').hidden = !modalState.details;
        modal.hidden = false;

        // The notice is a normal card at the top of the scroll area. A single
        // property write is enough to bring it into view; no layout measurement
        // and no overlay/focus trap.
        var main = $('panelMain');
        if (main) { main.scrollTop = 0; }

        $('modalCloseBtn').focus();
    }

    function closeModal() {
        var modal = $('modal');
        if (modal) { modal.hidden = true; }
    }

    /* ------------------------------------------------------------------- status */

    function setStatus(state, text) {
        var pill = $('statusPill');
        if (!pill) { return; }
        pill.dataset.state = state;
        pill.textContent = text;
    }

    function showBanner(message, level) {
        var banner = $('connectBanner');
        if (!banner) { return; }
        if (!message) { banner.hidden = true; return; }
        banner.dataset.level = level || 'warn';
        $('connectBannerText').textContent = message;
        banner.hidden = false;
    }

    /* ---------------------------------------------------------------- progress */

    var progress = { active: false, startedAt: 0 };

    function resetProgress() {
        progress.active = false;
        progress.startedAt = 0;
        setProgressFill(0, false);
        $('progressPercent').textContent = '0%';
        $('progressFile').textContent = 'Waiting to start…';
        $('statOk').textContent = '0';
        $('statFail').textContent = '0';
        $('statRemaining').textContent = '0';
        $('statEta').textContent = '—';
    }

    function setProgressFill(percent, indeterminate) {
        var track = $('progressTrack');
        var fill = $('progressFill');
        if (!track || !fill) { return; }
        track.classList.toggle('indeterminate', !!indeterminate);
        if (!indeterminate) {
            fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        }
    }

    /**
     * @param {Object} payload Engine progress event.
     */
    function updateProgress(payload) {
        if (!payload) { return; }

        if (!progress.active) {
            progress.active = true;
            progress.startedAt = Date.now();
        }

        var percent = typeof payload.percent === 'number' ? payload.percent : 0;
        setProgressFill(percent, payload.phase === 'starting' && percent === 0 && payload.done === 0);

        $('progressPercent').textContent = percent + '%';
        $('progressFile').textContent = payload.file
            ? (payload.done !== undefined ? ('[' + payload.done + '/' + payload.total + '] ') : '') + payload.file
            : (payload.phase === 'starting' ? 'Opening the mockup…' : 'Working…');

        $('statOk').textContent = String(payload.succeeded || 0);
        $('statFail').textContent = String(payload.failed || 0);
        $('statRemaining').textContent = String(payload.remaining || 0);

        var elapsed = typeof payload.elapsedMs === 'number' && payload.elapsedMs > 0
            ? payload.elapsedMs
            : (progress.startedAt ? Date.now() - progress.startedAt : 0);

        // While running, the elapsed slot doubles as an ETA readout, which is
        // the number people actually want during a long batch.
        $('statEta').textContent = elapsed ? formatDuration(elapsed) : '—';

        if (payload.etaMs > 0) {
            $('progressFile').title = formatEta(payload.etaMs);
        }
    }

    function finishProgress(summary) {
        progress.active = false;
        setProgressFill(100, false);
        $('progressPercent').textContent = '100%';
        $('progressFile').textContent = summary.cancelled
            ? 'Cancelled after ' + summary.processed + ' of ' + summary.total + '.'
            : 'Finished in ' + formatDuration(summary.durationMs || 0) + '.';
        $('statOk').textContent = String(summary.succeeded || 0);
        $('statFail').textContent = String(summary.failed || 0);
        $('statRemaining').textContent = String(Math.max(0, (summary.total || 0) - (summary.processed || 0)));
        $('statEta').textContent = formatDuration(summary.durationMs || 0);
    }

    /* ---------------------------------------------------------------- checklist */

    /**
     * Render the pre-flight report.
     *
     * @param {Object} report Result of `BulkMockup.inspect`.
     */
    function renderChecks(report) {
        var host = $('checks');
        var summaryNode = $('validateSummary');
        if (!host) { return; }

        host.innerHTML = '';

        if (!report || !report.checks) {
            host.innerHTML = '<div class="log-empty">No report.</div>';
            return;
        }

        report.checks.forEach(function (check) {
            var line = document.createElement('div');
            line.className = 'check-line';
            line.dataset.status = check.status;

            var dot = document.createElement('span');
            dot.className = 'dot';
            dot.textContent = check.status === 'ok' ? '✓' : (check.status === 'warn' ? '!' : '×');

            var text = document.createElement('span');
            var label = document.createElement('strong');
            label.textContent = check.label + ': ';
            text.appendChild(label);
            text.appendChild(document.createTextNode(check.detail));

            line.appendChild(dot);
            line.appendChild(text);
            host.appendChild(line);
        });

        if (summaryNode) {
            var errors = report.checks.filter(function (c) { return c.status === 'error'; }).length;
            var warnings = report.checks.filter(function (c) { return c.status === 'warn'; }).length;
            if (errors) {
                summaryNode.textContent = errors + ' problem' + (errors === 1 ? '' : 's') + ' to fix';
            } else if (warnings) {
                summaryNode.textContent = 'Ready — ' + warnings + ' warning' + (warnings === 1 ? '' : 's');
            } else {
                summaryNode.textContent = report.counts && report.counts.designs
                    ? 'Ready to run ' + report.counts.designs + ' design' + (report.counts.designs === 1 ? '' : 's')
                    : 'Ready';
            }
        }
    }

    /* ------------------------------------------------------------------ helpers */

    function setBusy(busy) {
        $('startBtn').disabled = busy;
        $('cancelBtn').disabled = !busy;
        $('validateBtn').disabled = busy;
        $('browseMockup').disabled = busy;
        $('browseDesigns').disabled = busy;
        $('browseOutput').disabled = busy;
        $('findLayers').disabled = busy;
    }

    ns.ui = {
        log: log,
        clearLog: clearLog,
        logText: logText,
        toast: toast,
        alert: alert,
        closeModal: closeModal,
        setStatus: setStatus,
        showBanner: showBanner,
        resetProgress: resetProgress,
        updateProgress: updateProgress,
        finishProgress: finishProgress,
        renderChecks: renderChecks,
        setBusy: setBusy,
        formatDuration: formatDuration,
        modalDetails: function () { return modalState.details; }
    };
}(window.BMUI));
