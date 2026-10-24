/**
 * CEP bridge — the one place that talks to the host panel.
 *
 * Photoshop's ExtendScript engine cannot call into the panel directly, so
 * progress is pushed through `PlugPlugExternalObject`. When the script runs
 * outside CEP (ExtendScript Toolkit, `File > Scripts > Browse…`, a `.jsx` run
 * from the command line) the bridge silently degrades to a no-op and the
 * engine keeps working, just without live updates.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.cep = (function () {

    var plugPlug = null;
    var available = false;
    var dispatchCount = 0;

    // Loading the library is what defines the global CSXSEvent constructor.
    // The accepted path differs between CEP builds (`lib:\PlugPlug…` on some,
    // `lib:PlugPlug…` on others), so try both before giving up.
    try {
        if (typeof ExternalObject !== 'undefined') {
            var candidates = ['lib:PlugPlugExternalObject', 'lib:\\PlugPlugExternalObject'];
            var i;
            for (i = 0; i < candidates.length && !available; i++) {
                try {
                    plugPlug = new ExternalObject(candidates[i]);
                    available = (typeof CSXSEvent !== 'undefined');
                } catch (candidateError) {
                    plugPlug = null;
                }
            }
        }
    } catch (e) {
        plugPlug = null;
        available = false;
    }

    var api = {};

    /** True when the panel can receive events from this engine. */
    api.available = available;

    /** Number of events pushed so far; surfaced in diagnostics. */
    api.count = function () {
        return dispatchCount;
    };

    /**
     * Push an event to the panel.
     *
     * @param  {string} type    Payload `type` (see BM.EVENT).
     * @param  {Object=} payload JSON-serialisable payload.
     * @return {boolean} Whether the event left the engine.
     */
    api.emit = function (type, payload) {
        var event, body;
        if (!available) { return false; }
        try {
            body = payload === undefined || payload === null ? {} : payload;
            if (typeof body === 'object' && !body.type) { body.type = type; }

            event = new CSXSEvent();
            event.type = BM.EVENT.CHANNEL;
            event.data = BM.json.stringify(body);
            event.dispatch();
            dispatchCount += 1;
            return true;
        } catch (e) {
            // A dead panel must never break a long batch.
            return false;
        }
    };

    /** Convenience wrapper for progress payloads. */
    api.emitProgress = function (payload) {
        return api.emit(BM.EVENT.PROGRESS, payload);
    };

    /**
     * Hand the UI thread a moment to paint.
     *
     * Photoshop keeps painting its own canvas even while ExtendScript is busy,
     * but `app.refresh()` exists on most versions and makes heavy batch runs
     * feel considerably less like a freeze.
     */
    api.breathe = function (delayMs) {
        try { app.refresh(); } catch (e) { /* not available on all versions */ }
        if (delayMs > 0) {
            try { $.sleep(delayMs); } catch (e) { /* ignored */ }
        }
    };

    return api;
}());
