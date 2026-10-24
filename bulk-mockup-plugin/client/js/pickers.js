/**
 * pickers.js — native file and folder selection.
 *
 * CEP's `window.cep.fs.showOpenDialog` is the only dialog that is guaranteed to
 * be modal to Photoshop (an HTML `<input type="file">` is not, and returns fake
 * paths). Everything here degrades gracefully when the shim is unavailable, so
 * the panel stays usable and simply tells the user to type a path instead.
 */
window.BMUI = window.BMUI || {};

(function (ns) {
    'use strict';

    var bridge = ns.bridge;

    /** Extensions the mockup picker offers. */
    var MOCKUP_TYPES = ['psd', 'psb'];
    /** Extensions the design-folder picker mentions (folders have no filter). */
    var DESIGN_TYPES = ['jpg', 'jpeg', 'png'];

    /**
     * Choose a single file.
     *
     * @param  {Object} options `{ title, initialPath, types }`
     * @return {Promise<string|null>} Chosen path, or null when cancelled.
     */
    function chooseFile(options) {
        options = options || {};
        return bridge.showOpenDialog({
            folder: false,
            multiple: false,
            title: options.title || 'Choose a file',
            initialPath: options.initialPath || '',
            types: options.types || []
        }).then(function (paths) {
            return paths.length ? paths[0] : null;
        });
    }

    /** Choose a single folder. */
    function chooseFolder(options) {
        options = options || {};
        return bridge.showOpenDialog({
            folder: true,
            multiple: false,
            title: options.title || 'Choose a folder',
            initialPath: options.initialPath || ''
        }).then(function (paths) {
            return paths.length ? paths[0] : null;
        });
    }

    /** Parent folder of a file path, for use as a dialog's starting point. */
    function folderOf(path) {
        if (!path) { return ''; }
        var normalised = String(path).replace(/[\\/]+$/, '');
        var index = Math.max(normalised.lastIndexOf('/'), normalised.lastIndexOf('\\'));
        return index > 0 ? normalised.substring(0, index) : '';
    }

    /** Convenience wrappers with the panel's copy baked in. */
    var api = {
        pickMockup: function (currentPath) {
            return chooseFile({
                title: 'Choose the mockup PSD',
                initialPath: folderOf(currentPath),
                types: MOCKUP_TYPES
            });
        },

        pickDesignsFolder: function (currentPath) {
            return chooseFolder({
                title: 'Choose the folder containing your designs',
                initialPath: currentPath || ''
            });
        },

        pickOutputFolder: function (currentPath) {
            return chooseFolder({
                title: 'Choose where to write the finished mockups',
                initialPath: currentPath || ''
            });
        },

        folderOf: folderOf,

        /** True when the native dialog shim is present. */
        isAvailable: function () {
            return !!(window.cep && window.cep.fs && typeof window.cep.fs.showOpenDialog === 'function');
        },

        MOCKUP_TYPES: MOCKUP_TYPES,
        DESIGN_TYPES: DESIGN_TYPES
    };

    ns.pickers = api;
}(window.BMUI));
