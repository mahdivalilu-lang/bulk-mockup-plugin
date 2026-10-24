/**
 * bridge.js — the only module that talks to ExtendScript.
 *
 * Bundles three concerns that always travel together:
 *   1. turning panel state into a safe `evalScript` expression;
 *   2. turning the JSON envelope that comes back into either a value or a
 *      structured error (never a bare "EvalScript error.");
 *   3. the CEP event channel the engine streams progress over.
 */
window.BMUI = window.BMUI || {};

(function (ns) {
    'use strict';

    var EVENT_CHANNEL = 'com.bulkmockup.event';
    var hostScriptInterface = new CSInterface();
    var pingPromise = null;

    /* ------------------------------------------------------------------ errors */

    function bridgeError(code, message, detail, hint) {
        var error = new Error(message);
        error.code = code || 'BM_BRIDGE';
        error.detail = detail || '';
        error.hint = hint || '';
        return error;
    }

    ns.BMError = bridgeError;

    /* ------------------------------------------------------------------- paths */

    function decodeSystemPath(value) {
        var path = String(value || '');
        if (path.indexOf('file://') === 0) {
            try { return decodeURI(path.substring(7)); } catch (e) { return path.substring(7); }
        }
        return path;
    }

    /* ------------------------------------------------------------------- calls */

    function evalScript(expression) {
        return new Promise(function (resolve) {
            hostScriptInterface.evalScript(expression, function (result) {
                resolve(result);
            });
        });
    }

    /**
     * Build the argument literal for an engine call.
     *
     * `evalScript` takes a string of JavaScript, so anything complex has to be
     * serialised *twice*: once to JSON, once again so it becomes a valid string
     * literal inside the expression we send across.
     */
    function toLiteral(value) {
        if (value === undefined || value === null) { return 'null'; }
        if (typeof value === 'string') { return JSON.stringify(value); }
        return JSON.stringify(JSON.stringify(value));
    }

    function unwrap(method, raw) {
        var envelope;
        if (typeof raw !== 'string' || raw === '' || raw === 'EvalScript error.') {
            throw bridgeError(
                'BM_BRIDGE',
                'Photoshop did not answer ‘' + method + '()’.',
                typeof raw === 'string' ? raw : '',
                'Check that Photoshop is responsive and that no modal dialog is waiting for input.'
            );
        }
        try {
            envelope = JSON.parse(raw);
        } catch (e) {
            throw bridgeError('BM_BRIDGE', 'Unreadable reply from ‘' + method + '()’.', String(raw).slice(0, 400));
        }
        if (!envelope || envelope.ok !== true) {
            var error = (envelope && envelope.error) || {};
            throw bridgeError(error.code, error.message || 'The engine reported a failure.', error.detail, error.hint);
        }
        return envelope.data;
    }

    /* --------------------------------------------------------------------- API */

    var api = {
        /** Raw CSInterface, for anything that needs it directly. */
        cs: hostScriptInterface,

        extensionPath: function () {
            try {
                return decodeSystemPath(hostScriptInterface.getSystemPath(SystemPath.EXTENSION));
            } catch (e) {
                return '';
            }
        },

        systemPath: function (name) {
            try {
                return decodeSystemPath(hostScriptInterface.getSystemPath(name));
            } catch (e) {
                return '';
            }
        },

        hostEnvironment: function () {
            try {
                return hostScriptInterface.getHostEnvironment() || null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Invoke an engine entry point.
         *
         * @param  {string}  method  e.g. 'inspect'
         * @param  {*=}      payload Object (sent as JSON) or string.
         * @return {Promise} Resolves with the unwrapped `data`, rejects with a BMError.
         */
        call: function (method, payload) {
            var expression = 'BulkMockup.' + method + '(' + toLiteral(payload) + ')';
            return evalScript(expression).then(function (raw) {
                return unwrap(method, raw);
            });
        },

        /**
         * Make sure the ExtendScript engine is loaded and reachable.
         *
         * The manifest's `ScriptPath` normally loads it, but a failed load (a
         * syntax error, a stale cached copy) is invisible from the panel, so we
         * probe once and fall back to evaluating the entry point by hand.
         */
        ensureEngine: function () {
            if (pingPromise) { return pingPromise; }

            pingPromise = api.call('ping').catch(function (firstError) {
                var entry = api.extensionPath();
                if (!entry) { throw firstError; }

                return evalScript('$.evalFile(' + JSON.stringify(entry + '/jsx/engine.jsx') + ')')
                    .then(function () { return api.call('ping'); })
                    .catch(function () { throw firstError; });
            });

            return pingPromise;
        },

        /* ------------------------------------------------------------- events */

        /** Subscribe to engine progress events. Returns an unsubscribe function. */
        onEvent: function (handler) {
            var wrapped = function (event) {
                try {
                    var payload = event && event.data;
                    // CEP normally hands us the string the engine set, but some
                    // builds (Photoshop 2021/CEP 10) parse JSON-looking data into
                    // an object before dispatching. Accept both.
                    if (typeof payload === 'string') {
                        try {
                            payload = JSON.parse(payload);
                        } catch (e) {
                            return;
                        }
                    }
                    if (!payload || typeof payload !== 'object') { return; }

                    // The callback does DOM work; keep any panel-side exception
                    // from unwinding into the host's event dispatcher.
                    try {
                        handler(payload);
                    } catch (e) { /* never cross the CEP boundary */ }
                } catch (e) { /* never cross the CEP boundary */ }
            };
            hostScriptInterface.addEventListener(EVENT_CHANNEL, wrapped);
            return function () {
                try { hostScriptInterface.removeEventListener(EVENT_CHANNEL, wrapped); } catch (e) { /* ignored */ }
            };
        },

        /* ------------------------------------------------------------ sentinel */

        /**
         * Write the cancellation sentinel file.
         *
         * Cancellation cannot use `evalScript`: the engine is single-threaded,
         * so a queued call would only run once the batch it wants to interrupt
         * has already finished. A file on disk is visible immediately.
         */
        writeSentinel: function (path, text) {
            if (!path) { return Promise.resolve(false); }

            if (window.cep && window.cep.fs && typeof window.cep.fs.writeFile === 'function') {
                var result = window.cep.fs.writeFile(path, text);
                return Promise.resolve(!result || result.err === 0);
            }

            try {
                if (window.require) {
                    window.require('fs').writeFileSync(path, text);
                    return Promise.resolve(true);
                }
            } catch (e) { /* fall through */ }

            return Promise.resolve(false);
        },

        /** Delete a file via CEP's fs shim, if present. */
        removeSentinel: function (path) {
            if (!path) { return Promise.resolve(false); }
            try {
                if (window.cep && window.cep.fs && typeof window.cep.fs.deleteFile === 'function') {
                    window.cep.fs.deleteFile(path);
                    return Promise.resolve(true);
                }
                if (window.require) {
                    var fs = window.require('fs');
                    if (fs.existsSync(path)) { fs.unlinkSync(path); }
                    return Promise.resolve(true);
                }
            } catch (e) { /* ignored */ }
            return Promise.resolve(false);
        },

        /* --------------------------------------------------------------- files */

        /**
         * Native open dialog.
         *
         * @param  {Object} options `{ folder, multiple, title, initialPath, types }`
         * @return {Promise<string[]>} Chosen paths (empty when cancelled).
         */
        showOpenDialog: function (options) {
            options = options || {};

            return new Promise(function (resolve, reject) {
                if (!window.cep || !window.cep.fs || typeof window.cep.fs.showOpenDialog !== 'function') {
                    reject(bridgeError('BM_BRIDGE', 'Native file dialogs are unavailable in this host.'));
                    return;
                }

                var types = options.types || [];
                var result = window.cep.fs.showOpenDialog(
                    !!options.multiple,
                    !!options.folder,
                    options.title || 'Choose',
                    options.initialPath || '',
                    types.length ? types : undefined
                );

                if (!result || result.err !== 0) {
                    // err 1 is the documented "user cancelled" code.
                    resolve([]);
                    return;
                }
                resolve(result.data || []);
            });
        }
    };

    ns.bridge = api;
}(window.BMUI));
