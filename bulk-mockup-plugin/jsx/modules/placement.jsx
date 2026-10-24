/**
 * Placing, fitting and centring artwork.
 *
 * The legacy script copy-pasted through the system clipboard, then deleted the
 * bottom-most layer and hoped it was the stale one. Both of those are fragile:
 * the clipboard is shared with the user, and "last layer" is not "the layer
 * that was there before". Here the design is duplicated straight into the
 * target document and every layer except the new one is removed by identity.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.placement = (function () {

    var api = {};

    /* ------------------------------------------------------------------ maths */

    api.layerBounds = function (layer) {
        var b = layer.bounds;
        var left = BM.util.px(b[0]);
        var top = BM.util.px(b[1]);
        var right = BM.util.px(b[2]);
        var bottom = BM.util.px(b[3]);
        return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
    };

    /**
     * Work out the resize percentages for a given fit mode.
     *
     * @return {Object} `{ x, y, uniform }` in percent.
     */
    api.computeScale = function (sourceWidth, sourceHeight, availableWidth, availableHeight, fitMode) {
        var sx = availableWidth / sourceWidth;
        var sy = availableHeight / sourceHeight;
        var uniform;

        if (fitMode === 'center') {
            // Centre without scaling: the artwork keeps its native pixel size,
            // even when it is larger than the Smart Object canvas.
            return { x: 100, y: 100, uniform: 100 };
        }
        if (fitMode === 'cover') {
            uniform = Math.max(sx, sy);
        } else if (fitMode === 'stretch') {
            return { x: sx * 100, y: sy * 100, uniform: 0 };
        } else {
            uniform = Math.min(sx, sy);
        }
        return { x: uniform * 100, y: uniform * 100, uniform: uniform * 100 };
    };

    /* ------------------------------------------------------------ layer import */

    /** Clipboard fallback for the rare document that refuses a cross-document duplicate. */
    function importViaClipboard(sourceDoc, targetDoc) {
        BM.ps.setActiveDocument(sourceDoc);
        sourceDoc.selection.selectAll();
        sourceDoc.selection.copy();

        BM.ps.setActiveDocument(targetDoc);
        targetDoc.paste();
        return targetDoc.activeLayer;
    }

    /**
     * Bring an image file into `targetDoc` as a new top-level layer.
     *
     * @param  {Document} targetDoc
     * @param  {File}     file
     * @param  {string=}  layerName
     * @return {Layer}
     */
    api.importFileAsLayer = function (targetDoc, file, layerName) {
        var opened = BM.ps.openDocument(file, BM.ERROR_CODES.IMAGE_UNREADABLE);
        var sourceDoc = opened.doc;
        var layer = null;

        try {
            // A grayscale or CMYK source cannot be duplicated into an RGB
            // document, so normalise the source when we own it.
            if (!opened.wasAlreadyOpen) {
                try {
                    if (sourceDoc.mode !== targetDoc.mode) { sourceDoc.changeMode(targetDoc.mode); }
                } catch (e) { /* the clipboard fallback below will cope */ }
            }
            try {
                layer = sourceDoc.activeLayer.duplicate(targetDoc, ElementPlacement.PLACEATBEGINNING);
            } catch (e) {
                layer = importViaClipboard(sourceDoc, targetDoc);
            }
        } finally {
            if (!opened.wasAlreadyOpen) { BM.ps.closeDocument(sourceDoc, false); }
        }

        if (!layer) {
            bmFail(
                BM.ERROR_CODES.IMAGE_UNREADABLE,
                file.name,
                'The image could not be placed. Re-export it as an 8-bit RGB JPG or PNG.'
            );
        }

        if (layerName) {
            try { layer.name = layerName; } catch (e) { /* cosmetic only */ }
        }
        BM.ps.setActiveDocument(targetDoc);
        return layer;
    };

    /* ----------------------------------------------------------------- fitting */

    /**
     * Scale `layer` to fit `doc`, then centre it.
     *
     * @param  {Document} doc
     * @param  {Layer}    layer
     * @param  {Object}   options `{ fitMode, paddingPercent }`
     * @return {Object}   `{ scaled, translated, scale, bounds }`
     */
    api.fitAndCenter = function (doc, layer, options) {
        options = options || {};

        var docSize = BM.ps.size(doc);
        var padding = BM.util.number(options.paddingPercent, 0, 0, 45);
        var availableWidth = Math.max(1, docSize.width * (1 - padding / 100));
        var availableHeight = Math.max(1, docSize.height * (1 - padding / 100));

        var bounds = api.layerBounds(layer);
        if (bounds.width <= 0.01 || bounds.height <= 0.01) {
            // A fully transparent or empty design: nothing to scale.
            return { scaled: false, translated: false, scale: 100, bounds: bounds };
        }

        var scale = api.computeScale(bounds.width, bounds.height, availableWidth, availableHeight, options.fitMode);
        var scaled = options.fitMode !== 'center';
        if (scaled) {
            layer.resize(scale.x, scale.y, AnchorPosition.MIDDLECENTER);
            bounds = api.layerBounds(layer);
        }

        var dx = ((docSize.width - bounds.width) / 2) - bounds.left;
        var dy = ((docSize.height - bounds.height) / 2) - bounds.top;

        var translated = false;
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
            layer.translate(BM.util.pxUnit(dx), BM.util.pxUnit(dy));
            translated = true;
            bounds = api.layerBounds(layer);
        }

        return {
            scaled: scaled,
            translated: translated,
            scale: scale.uniform || scale.x,
            bounds: bounds,
            source: { width: docSize.width, height: docSize.height }
        };
    };

    /* ------------------------------------------------------------- housekeeping */

    /**
     * Remove every layer in `doc` except `keep` (compared by layer id, so a
     * renamed or duplicated layer can never be mistaken for a stale one).
     *
     * @return {number} Layers removed.
     */
    api.removeLayersExcept = function (doc, keep) {
        var keepId = keep && keep.id;
        var removed = 0;

        function walk(container) {
            var layers, i, layer;
            try {
                layers = container.layers;
            } catch (e) {
                return;
            }
            if (!layers) { return; }

            for (i = layers.length - 1; i >= 0; i--) {
                layer = layers[i];
                if (layer.typename === 'LayerSet') { walk(layer); }
                if (layer.id === keepId) { continue; }
                try {
                    layer.remove();
                    removed += 1;
                } catch (e) {
                    // Locked layers refuse to go; that is not fatal.
                }
            }
        }

        walk(doc);
        return removed;
    };

    /**
     * Paint an opaque backdrop behind the artwork.
     *
     * Smart Object canvases are usually transparent, and a transparent PNG
     * design would otherwise export with its alpha intact (or composite onto
     * white for JPEG) — this makes the intent explicit instead of implicit.
     */
    api.addBackgroundFill = function (doc, hexColor) {
        var normalized = BM.util.normalizeHexColor(hexColor);
        if (!normalized) { return null; }

        var layer = doc.artLayers.add();
        layer.name = 'Bulk Mockup Background';

        BM.ps.setActiveDocument(doc);
        doc.selection.selectAll();

        var color = new SolidColor();
        color.rgb.hexValue = normalized.substring(1);
        doc.selection.fill(color);
        doc.selection.deselect();

        try { layer.move(doc, ElementPlacement.PLACEATEND); } catch (e) { /* stays on top */ }
        return layer;
    };

    return api;
}());
