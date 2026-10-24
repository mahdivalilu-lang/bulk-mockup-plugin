/**
 * Smart Object operations.
 *
 * Two strategies are supported, because they trade precision against speed:
 *
 *  - `replaceContents` — Photoshop's native "Replace Contents". One action per
 *    design, no nested document is ever opened, so a 200-image batch stays
 *    responsive. Photoshop re-uses the Smart Object's existing transform, so
 *    the design lands exactly where the previous content sat.
 *
 *  - `editContents` — open the Smart Object, place the design, fit and centre
 *    it explicitly, then save and close. Slower, but it guarantees the result
 *    is fitted and centred regardless of how the mockup's Smart Object was
 *    authored. This is what the legacy script attempted.
 *
 * `auto` starts with the fast path and transparently falls back to the precise
 * one when the host refuses the action.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.so = (function () {

    var api = {};

    api.isSmartObject = function (layer) {
        return BM.ps.isSmartObject(layer);
    };

    /* --------------------------------------------------------- replace in place */

    /**
     * Swap a Smart Object's contents for `file`, keeping its transform.
     *
     * @param {Layer} layer Smart Object layer, already activated.
     * @param {File}  file  Replacement image.
     */
    api.replaceContents = function (layer, file) {
        var descriptor = new ActionDescriptor();
        descriptor.putPath(charIDToTypeID('null'), file);
        descriptor.putInteger(stringIDToTypeID('PgNm'), 1);
        executeAction(stringIDToTypeID('placedLayerReplaceContents'), descriptor, DialogModes.NO);
    };

    /* ------------------------------------------------------------ edit contents */

    /**
     * Open a Smart Object's contents for editing.
     *
     * @return {Document} The now-active contents document.
     */
    api.openContents = function (layer) {
        try {
            executeAction(stringIDToTypeID('placedLayerEditContents'), undefined, DialogModes.NO);
        } catch (thrown) {
            bmFail(
                BM.ERROR_CODES.SMART_OBJECT_FAILED,
                'Could not open the Smart Object contents — ' + (thrown && thrown.message ? thrown.message : thrown),
                'Make sure the layer is an embedded Smart Object and not a linked file on an unavailable drive.'
            );
        }
        return app.activeDocument;
    };

    /** Save the edited contents and hand control back to the mockup. */
    api.commitContents = function (contentsDoc) {
        BM.ps.closeDocument(contentsDoc, true);
    };

    /** Abandon the edited contents, leaving the Smart Object untouched. */
    api.discardContents = function (contentsDoc) {
        BM.ps.closeDocument(contentsDoc, false);
    };

    /* ------------------------------------------------------------- conversion */

    /**
     * Turn a plain layer into a Smart Object in place.
     *
     * Lets the plugin cope with mockups where the target layer was rasterised
     * after the fact, which used to make the legacy script fail outright.
     */
    api.convertToSmartObject = function (doc, layer) {
        BM.ps.activateLayer(doc, layer);
        executeAction(stringIDToTypeID('newPlacedLayer'), undefined, DialogModes.NO);
        return doc.activeLayer;
    };

    /* -------------------------------------------------------------- discovery */

    /**
     * Resolve the layer to work on.
     *
     * @param  {Document} doc
     * @param  {Object}   options `{ name, fallbackNames, autoDetect }`
     * @return {Object} `{ layer, resolvedName, matchedBy }`
     */
    api.resolveTargetLayer = function (doc, options) {
        options = options || {};

        var candidates = [BM.util.trim(options.name)];
        var fallbacks = options.fallbackNames || [];
        var i, record, layer;

        for (i = 0; i < fallbacks.length; i++) {
            if (BM.util.indexOf(candidates, BM.util.trim(fallbacks[i])) === -1) {
                candidates.push(BM.util.trim(fallbacks[i]));
            }
        }

        for (i = 0; i < candidates.length; i++) {
            if (!candidates[i]) { continue; }
            layer = BM.ps.findLayerByName(doc, candidates[i]);
            if (layer) {
                return {
                    layer: layer,
                    resolvedName: layer.name,
                    matchedBy: i === 0 ? 'name' : 'fallback'
                };
            }
        }

        if (options.autoDetect) {
            var smartObjects = BM.ps.allSmartObjects(doc);
            if (smartObjects.length === 1) {
                record = smartObjects[0];
                return { layer: record.layer, resolvedName: record.name, matchedBy: 'auto-detect' };
            }
            if (smartObjects.length > 1) {
                bmFail(
                    BM.ERROR_CODES.LAYER_MISSING,
                    'None of the candidate names matched, and the mockup has ' + smartObjects.length + ' Smart Objects to choose from.',
                    'Pick the exact layer name from the list in the panel.'
                );
            }
            bmFail(
                BM.ERROR_CODES.NO_SMART_OBJECTS,
                'No Smart Object layers were found in ' + doc.name + '.',
                'Vector or rasterised layers cannot be replaced. Convert the mockup layer to a Smart Object first.'
            );
        }

        bmFail(
            BM.ERROR_CODES.LAYER_MISSING,
            '"' + BM.util.trim(options.name) + '" is not in this mockup.',
            'Use “Find layers” in the panel to list the Smart Objects it contains.'
        );
        return null; // unreachable
    };

    return api;
}());
