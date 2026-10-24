/**
 * Logging.
 *
 * A single sink fans out to three destinations:
 *   1. the panel's log pane, live, via the CEP bridge;
 *   2. an optional plain-text log file beside the output;
 *   3. (implicitly) the ExtendScript console via `$.writeln`, for when the
 *      engine is run outside a panel.
 *
 * File output is buffered and flushed in batches: writing a line at a time to a
 * File object on Windows is slow enough to show up inside a large batch.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.log = (function () {

    var FLUSH_EVERY = 25;

    var threshold = BM.LOG_LEVELS.info;
    var label = BM.APP.NAME;
    var filePath = '';
    var pending = [];
    var written = 0;
    var echo = false;

    function severityRank(level) {
        return BM.LOG_LEVELS[level] !== undefined ? BM.LOG_LEVELS[level] : BM.LOG_LEVELS.info;
    }

    function writeToFile(lines) {
        var file, i;
        if (!filePath || lines.length === 0) { return; }
        try {
            file = new File(filePath);
            file.encoding = 'UTF-8';
            if (file.open('a')) {
                for (i = 0; i < lines.length; i++) {
                    file.write(lines[i] + '\n');
                }
                file.close();
                written += lines.length;
            }
        } catch (e) {
            // Never let diagnostics take down the run.
            filePath = '';
        }
    }

    function flush() {
        var batch = pending;
        pending = [];
        writeToFile(batch);
    }

    var api = {};

    /**
     * Begin a logging session.
     *
     * @param {Object=} options `{ file, level, label, echo }`
     */
    api.start = function (options) {
        options = options || {};
        threshold = severityRank(options.level || BM.DEFAULTS.logLevel);
        label = options.label || BM.APP.NAME;
        echo = !!options.echo;
        filePath = options.file || '';
        pending = [];
        written = 0;

        if (filePath) {
            // Start each run from a clean file so old runs cannot be mistaken
            // for the current one when a user sends us a log.
            try {
                var file = new File(filePath);
                file.encoding = 'UTF-8';
                if (file.open('w')) {
                    file.write('--------------------------------------------------------------------\n');
                    file.write(BM.APP.NAME + ' v' + BM.APP.VERSION + '  ·  ' + BM.util.dateStamp() + ' ' + BM.util.timeStamp() + '\n');
                    file.write('--------------------------------------------------------------------\n');
                    file.close();
                }
            } catch (e) {
                filePath = '';
            }
        }
        return api;
    };

    /**
     * Emit one record.
     *
     * @param {string} level   debug | info | success | warn | error
     * @param {string} message Human readable text.
     * @param {Object=} meta   Optional structured extras shown on hover.
     */
    api.write = function (level, message, meta) {
        var stamp, line, payload;
        if (severityRank(level) < threshold) { return; }

        stamp = BM.util.timeStamp();
        line = '[' + stamp + '] ' + BM.util.padLeft(level.toUpperCase(), 7, ' ') + ' ' + message;

        if (filePath) {
            pending.push(line);
            if (pending.length >= FLUSH_EVERY) { flush(); }
        }
        if (echo) {
            try { $.writeln(line); } catch (e) { /* console unavailable */ }
        }

        payload = { type: BM.EVENT.LOG, level: level, message: message, time: stamp };
        if (meta) { payload.meta = meta; }
        BM.cep.emit(BM.EVENT.LOG, payload);
    };

    api.debug = function (message, meta) {
        api.write('debug', message, meta);
    };

    api.info = function (message, meta) {
        api.write('info', message, meta);
    };

    api.success = function (message, meta) {
        api.write('success', message, meta);
    };

    api.warn = function (message, meta) {
        api.write('warn', message, meta);
    };

    api.error = function (message, meta) {
        api.write('error', message, meta);
    };

    /** Current log file path, or '' when file logging is off. */
    api.filePath = function () {
        return filePath;
    };

    /** Number of lines persisted to disk. */
    api.writtenCount = function () {
        return written;
    };

    /** End the session, flushing anything still buffered. */
    api.finish = function () {
        flush();
        var total = written;
        filePath = '';
        pending = [];
        return total;
    };

    return api;
}());
