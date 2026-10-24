/**
 * store.js — panel state that survives a restart.
 *
 * Photoshoppers close panels constantly, so paths and options are persisted to
 * `localStorage` and re-applied on load. Everything is versioned and read
 * defensively: a corrupt or stale entry must never stop the panel from opening.
 */
window.BMUI = window.BMUI || {};

(function (ns) {
    'use strict';

    var KEY = 'bulkmockup.settings.v2';
    var LEGACY_KEY = 'bulkmockup.settings.v1';

    /** Which DOM controls hold which config field, and how to read them. */
    var FIELDS = [
        { id: 'mockupPath',               kind: 'value' },
        { id: 'designsFolder',            kind: 'value' },
        { id: 'outputFolder',             kind: 'value' },
        { id: 'smartObjectLayer',         kind: 'value' },
        { id: 'autoDetectLayer',          kind: 'checked' },
        { id: 'autoConvertToSmartObject', kind: 'checked' },
        { id: 'fitMode',                  kind: 'value' },
        { id: 'paddingPercent',           kind: 'value' },
        { id: 'strategy',                 kind: 'value' },
        { id: 'format',                   kind: 'value' },
        { id: 'quality',                  kind: 'value' },
        { id: 'pngCompression',           kind: 'value' },
        { id: 'maxOutputSize',            kind: 'value' },
        { id: 'useBackgroundFill',        kind: 'checked' },
        { id: 'backgroundFill',           kind: 'value' },
        { id: 'namingTemplate',           kind: 'value' },
        { id: 'filenamePrefix',           kind: 'value' },
        { id: 'filenameSuffix',           kind: 'value' },
        { id: 'overwrite',                kind: 'checked' },
        { id: 'sort',                     kind: 'value' },
        { id: 'nameFilter',               kind: 'value' },
        { id: 'startAt',                  kind: 'value' },
        { id: 'limit',                    kind: 'value' },
        { id: 'reopenMockupPerDesign',    kind: 'checked' },
        { id: 'delayMs',                  kind: 'value' },
        { id: 'logLevel',                 kind: 'value' },
        { id: 'writeLogFile',             kind: 'checked' },
        { id: 'writeCsvReport',           kind: 'checked' },
        { id: 'autoScroll',               kind: 'checked' }
    ];

    function elements() {
        var found = {};
        FIELDS.forEach(function (field) {
            found[field.id] = document.getElementById(field.id);
        });
        return found;
    }

    function safeStorage() {
        try {
            var probe = '__bulkmockup_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return window.localStorage;
        } catch (e) {
            // Private mode, or a host that blocks storage entirely.
            var memory = {};
            return {
                getItem: function (k) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null; },
                setItem: function (k, v) { memory[k] = String(v); },
                removeItem: function (k) { delete memory[k]; }
            };
        }
    }

    var storage = safeStorage();

    var api = {};

    /** Read every tracked control into a plain object. */
    api.read = function () {
        var nodes = elements();
        var state = {};

        FIELDS.forEach(function (field) {
            var node = nodes[field.id];
            if (!node) { return; }
            if (field.kind === 'checked') {
                state[field.id] = !!node.checked;
            } else {
                state[field.id] = node.value;
            }
        });

        return state;
    };

    /** Apply a previously saved object to the controls. Unknown keys are ignored. */
    api.apply = function (state) {
        if (!state || typeof state !== 'object') { return; }
        var nodes = elements();

        /*
         * Programmatic writes do not fire input/change in Chromium, but keeping
         * a guard around the whole block means any future derived control or
         * host shim that does dispatch an event cannot feed back into the store.
         * try/finally guarantees the flag is released even if one control is
         * malformed and throws halfway through.
         */
        var previous = !!ns.isSyncing;
        ns.isSyncing = true;

        try {
            FIELDS.forEach(function (field) {
                var node = nodes[field.id];
                if (!node || !Object.prototype.hasOwnProperty.call(state, field.id)) { return; }

                if (field.kind === 'checked') {
                    node.checked = !!state[field.id];
                } else if (state[field.id] !== undefined && state[field.id] !== null) {
                    node.value = String(state[field.id]);
                }
            });
        } finally {
            ns.isSyncing = previous;
        }
    };

    api.save = function () {
        try {
            storage.setItem(KEY, JSON.stringify(api.read()));
        } catch (e) { /* a full disk must not break the panel */ }
    };

    /**
     * v1 stored JPEG quality on Photoshop's 0..12 scale. The panel now uses
     * 1..100 so the value can be shown as a percentage; translate old settings
     * instead of silently turning a quality of 12 into 12%.
     */
    function migrateLegacy(raw) {
        var state;
        try {
            state = JSON.parse(raw);
        } catch (e) {
            return '';
        }
        if (!state || typeof state !== 'object') { return ''; }

        var oldQuality = parseFloat(state.quality);
        if (isFinite(oldQuality)) {
            state.quality = String(Math.max(1, Math.min(100, Math.round(oldQuality / 12 * 100))));
        }
        return JSON.stringify(state);
    }

    /** Restore on startup, tolerating anything that was left behind. */
    api.load = function () {
        var raw = storage.getItem(KEY);
        var migrated = false;

        if (!raw) {
            raw = storage.getItem(LEGACY_KEY);
            if (raw) {
                raw = migrateLegacy(raw);
                migrated = true;
            }
        }
        if (!raw) { return false; }

        try {
            api.apply(JSON.parse(raw));
            if (migrated) {
                storage.removeItem(LEGACY_KEY);
                api.save();
            }
            return true;
        } catch (e) {
            storage.removeItem(KEY);
            return false;
        }
    };

    api.clear = function () {
        storage.removeItem(KEY);
        storage.removeItem(LEGACY_KEY);
    };

    /** Ids that legitimately hold a path, so the app can re-validate on change. */
    api.pathFieldIds = ['mockupPath', 'designsFolder', 'outputFolder'];

    ns.store = api;
}(window.BMUI));
