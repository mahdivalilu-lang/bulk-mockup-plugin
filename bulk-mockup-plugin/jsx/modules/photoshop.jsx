/**
 * Photoshop host helpers.
 *
 * Everything that touches `app` or a `Document` goes through here, which keeps
 * the awkward parts — dialog suppression, layer traversal, "did I open this or
 * was it already open?" bookkeeping — in one reviewable place.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.ps = (function () {

    var api = {};

    /* ------------------------------------------------------------ host state */

    /** Throws unless we are actually running inside Photoshop. */
    api.assertHost = function () {
        var name;
        try {
            name = app.name;
        } catch (e) {
            bmFail(BM.ERROR_CODES.NO_APP, '', 'Open the panel inside Photoshop.');
        }
        if (!name || name.indexOf('Photoshop') === -1) {
            bmFail(BM.ERROR_CODES.NO_APP, name || 'unknown host', 'Open the panel inside Photoshop.');
        }
        return true;
    };

    api.info = function () {
        return {
            name: app.name,
            version: app.version,
            build: app.build,
            documents: app.documents.length
        };
    };

    /**
     * Silence Photoshop's modal alerts for the duration of a run.
     *
     * Returns the previous setting so it can be restored in a `finally` block —
     * leaving `DialogModes.NO` behind would quietly break other scripts.
     */
    api.pushQuiet = function () {
        var previous = null;
        try {
            previous = app.displayDialogs;
            app.displayDialogs = DialogModes.NO;
        } catch (e) { /* some hosts refuse; harmless */ }
        return previous;
    };

    api.popQuiet = function (previous) {
        if (previous === null || previous === undefined) { return; }
        try { app.displayDialogs = previous; } catch (e) { /* ignored */ }
    };

    /* -------------------------------------------------------------- documents */

    /** Find an already-open document for `file`, or null. */
    api.findOpenDocument = function (file) {
        var i, doc, name;
        if (!file) { return null; }
        name = String(file.fsName).toLowerCase();
        for (i = 0; i < app.documents.length; i++) {
            doc = app.documents[i];
            try {
                if (String(doc.fullName.fsName).toLowerCase() === name) { return doc; }
            } catch (e) {
                // A never-saved document has no fullName; skip it.
            }
        }
        return null;
    };

    /**
     * Open a document, mapping host failures onto a friendly error.
     *
     * @return {Object} `{ doc, wasAlreadyOpen }`
     */
    api.openDocument = function (file, code) {
        var doc = api.findOpenDocument(file);
        if (doc) { return { doc: doc, wasAlreadyOpen: true }; }
        try {
            doc = app.open(file);
        } catch (thrown) {
            bmFail(code || BM.ERROR_CODES.DOC_OPEN_FAILED, file.name + ' — ' + (thrown && thrown.message ? thrown.message : thrown));
        }
        if (!doc) {
            bmFail(code || BM.ERROR_CODES.DOC_OPEN_FAILED, file.name);
        }
        return { doc: doc, wasAlreadyOpen: false };
    };

    /** Close without ever prompting, ignoring documents the host already closed. */
    api.closeDocument = function (doc, saveChanges) {
        if (!doc) { return; }
        try {
            doc.close(saveChanges ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES);
        } catch (e) {
            // Already closed, or the host refused; nothing useful to do.
        }
    };

    api.setActiveDocument = function (doc) {
        try { app.activeDocument = doc; } catch (e) { /* ignored */ }
        return doc;
    };

    /* ---------------------------------------------------------------- layers */

    api.isSmartObject = function (layer) {
        if (!layer) { return false; }
        try {
            return layer.typename === 'ArtLayer' && layer.kind === LayerKind.SMARTOBJECT;
        } catch (e) {
            return false;
        }
    };

    /**
     * Flatten a document's layer tree.
     *
     * @return {Array} `{ layer, name, depth, isGroup, isSmartObject }` records,
     *                 in Photoshop's own top-to-bottom order.
     */
    api.flattenLayers = function (doc, options) {
        options = options || {};
        var result = [];
        var maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 64;

        function walk(container, depth, prefix) {
            var layers, i, layer, name, children;
            if (depth > maxDepth) { return; }
            try {
                layers = container.layers;
            } catch (e) {
                return;
            }
            if (!layers) { return; }

            for (i = 0; i < layers.length; i++) {
                layer = layers[i];
                try { name = layer.name; } catch (e) { name = '#' + i; }
                children = (layer.typename === 'LayerSet') ? layer.layers : null;

                result.push({
                    layer: layer,
                    name: name,
                    path: prefix ? (prefix + ' / ' + name) : name,
                    depth: depth,
                    isGroup: layer.typename === 'LayerSet',
                    isSmartObject: api.isSmartObject(layer),
                    visible: (function () { try { return layer.visible; } catch (e) { return true; } }())
                });

                if (children) {
                    walk(layer, depth + 1, prefix ? (prefix + ' / ' + name) : name);
                }
            }
        }

        walk(doc, 0, '');
        return result;
    };

    /**
     * Find a layer by exact name (case-insensitive), else by trimmed name.
     *
     * @param  {Document} doc
     * @param  {string}   name
     * @return {Layer|null}
     */
    api.findLayerByName = function (doc, name) {
        var wanted = BM.util.trim(name);
        if (!wanted) { return null; }

        var records = api.flattenLayers(doc);
        var i, record, lowerWanted = wanted.toLowerCase();

        for (i = 0; i < records.length; i++) {
            if (records[i].name.toLowerCase() === lowerWanted) { return records[i].layer; }
        }
        // Fall back to the leaf portion of a group path ("Group / Layer").
        for (i = 0; i < records.length; i++) {
            record = records[i];
            if (BM.util.basename(record.path.replace(/\s*\/\s*/g, '/')).toLowerCase() === lowerWanted) {
                return record.layer;
            }
        }
        return null;
    };

    api.allSmartObjects = function (doc) {
        var records = api.flattenLayers(doc);
        var result = [];
        var i;
        for (i = 0; i < records.length; i++) {
            if (records[i].isSmartObject) { result.push(records[i]); }
        }
        return result;
    };

    api.activateLayer = function (doc, layer) {
        try {
            app.activeDocument = doc;
            doc.activeLayer = layer;
        } catch (e) {
            bmFail(BM.ERROR_CODES.LAYER_NOT_SMART, '', 'The layer could not be selected. Make sure it is visible and not locked.');
        }
        return layer;
    };

    /* -------------------------------------------------------------- geometry */

    api.size = function (doc) {
        return {
            width: BM.util.px(doc.width),
            height: BM.util.px(doc.height),
            resolution: BM.util.px(doc.resolution, 72),
            mode: doc.mode,
            bitsPerChannel: doc.bitsPerChannel
        };
    };

    return api;
}());
