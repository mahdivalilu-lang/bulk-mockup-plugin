/**
 * Output encoding.
 *
 * Handles the three things that make naive `saveAs` calls fail in the wild:
 *
 *  - JPEG cannot be written from 16/32-bit or CMYK documents, so a scratch
 *    duplicate is down-converted on demand;
 *  - a long-edge cap needs `resizeImage` on that same scratch copy, never on
 *    the mockup the user opened;
 *  - a large batch must not silently overwrite earlier results, or silently
 *    create `design (2).jpg` files the user did not ask for.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.exporter = (function () {

    var api = {};

    /* --------------------------------------------------------------- naming */

    /** Sanitise a non-empty prefix/suffix; blank means "leave it out". */
    function resolveAffix(value, tokens) {
        var text = BM.util.trim(value);
        if (!text) { return ''; }
        return BM.util.sanitizeFilename(BM.util.applyTemplate(text, tokens), 60);
    }

    /**
     * Build the output `File` for one design.
     *
     * @param  {Folder} outputFolder
     * @param  {File}   designFile
     * @param  {number} index        1-based position in the batch.
     * @param  {Object} options      `{ namingTemplate, filenamePrefix, filenameSuffix, format, overwrite }`
     * @return {Object} `{ file, baseName, deduplicated }`
     */
    api.buildOutputFile = function (outputFolder, designFile, index, options) {
        var now = new Date();
        var tokens = {
            name: BM.util.stripExtension(designFile.name),
            index: BM.util.padLeft(index, 3),
            date: BM.util.dateStamp(now),
            time: BM.util.timeStamp(now),
            ext: options.format
        };

        var core = BM.util.applyTemplate(options.namingTemplate, tokens);
        var pieces = [];
        var prefix = resolveAffix(options.filenamePrefix, tokens);
        var suffix = resolveAffix(options.filenameSuffix, tokens);

        if (prefix) { pieces.push(prefix); }
        pieces.push(core);
        if (suffix) { pieces.push(suffix); }

        var baseName = BM.util.sanitizeFilename(pieces.join('_'));
        var file = new File(outputFolder.fsName + '/' + baseName + '.' + options.format);

        if (file.exists && !options.overwrite) {
            return { file: BM.fs.uniqueFile(outputFolder, baseName, options.format), baseName: baseName, deduplicated: true };
        }
        return { file: file, baseName: baseName, deduplicated: false };
    };

    /* --------------------------------------------------------------- export */

    /**
     * Map the panel's 1–100 quality scale onto Photoshop's 0–12 JPEG scale.
     *
     * Photoshop's scripting API only accepts 0..12, while everyone else thinks
     * in percentages. Keeping the user-facing value at 1..100 makes the panel
     * self-explanatory and gives us room to use the same field for future
     * encoders without another schema change.
     */
    api.jpegQuality = function (percent) {
        var value = BM.util.number(percent, BM.DEFAULTS.quality, 1, 100);
        var scaled = Math.round(value * 12 / 100);
        if (scaled < 0) { scaled = 0; }
        if (scaled > 12) { scaled = 12; }
        return scaled;
    };

    /** Figure out the scaled size for a long-edge cap, or null when unnecessary. */
    function targetSize(width, height, maxLongEdge) {
        var longEdge = Math.max(width, height);
        if (!maxLongEdge || maxLongEdge <= 0 || longEdge <= maxLongEdge) { return null; }
        var factor = maxLongEdge / longEdge;
        return {
            width: Math.max(1, Math.round(width * factor)),
            height: Math.max(1, Math.round(height * factor))
        };
    }

    /**
     * Write `doc` to `file`.
     *
     * @param {Document} doc
     * @param {File}     file
     * @param {Object}   options `{ format, quality, pngCompression, maxOutputSize }`
     * @return {Object}  `{ path, bytes, width, height, downConverts, resized }`
     */
    api.save = function (doc, file, options) {
        var format = options.format === 'png' ? 'png' : 'jpg';
        var scratch = null;
        var work = doc;
        var notes = [];
        var size;

        // Transparency is handled where the artwork is placed (see
        // placement.addBackgroundFill): the mockup document itself is treated as
        // read-only input and must never gain a layer as a side effect of export.
        try {
            if (format === 'jpg') {
                if (doc.mode !== DocumentMode.RGB) { notes.push('converted to RGB'); }
                if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) { notes.push('converted to 8 bits'); }
            }
            size = targetSize(BM.util.px(doc.width), BM.util.px(doc.height), options.maxOutputSize);
            if (size) { notes.push('resized to ' + size.width + '×' + size.height); }

            if (notes.length > 0) {
                try {
                    scratch = doc.duplicate();
                } catch (e) {
                    bmFail(BM.ERROR_CODES.EXPORT_FAILED, file.name, 'Photoshop could not duplicate the document for export.');
                }
                work = scratch;

                if (format === 'jpg') {
                    try { if (work.mode !== DocumentMode.RGB) { work.changeMode(ChangeMode.RGB); } } catch (e) { /* try anyway */ }
                    try { if (work.bitsPerChannel !== BitsPerChannelType.EIGHT) { work.bitsPerChannel = BitsPerChannelType.EIGHT; } } catch (e) { /* try anyway */ }
                }
                if (size) {
                    try {
                        work.resizeImage(size.width, size.height, work.resolution, ResampleMethod.BICUBICSHARPER);
                    } catch (e) {
                        notes.push('resize failed');
                    }
                }
            }

            BM.ps.setActiveDocument(work);
            if (format === 'jpg') {
                var jpeg = new JPEGSaveOptions();
                jpeg.quality = api.jpegQuality(options.quality);
                jpeg.embedColorProfile = true;
                jpeg.formatOptions = FormatOptions.STANDARDBASELINE;
                try { jpeg.matte = MatteType.WHITE; } catch (e) { /* optional */ }
                work.saveAs(file, jpeg, true, Extension.LOWERCASE);
            } else {
                var png = new PNGSaveOptions();
                png.compression = BM.util.number(options.pngCompression, 6, 0, 9);
                png.interlaced = false;
                work.saveAs(file, png, true, Extension.LOWERCASE);
            }
        } catch (thrown) {
            if (scratch) { BM.ps.closeDocument(scratch, false); }
            if (thrown instanceof BM.Error) { throw thrown; }
            bmFail(
                BM.ERROR_CODES.EXPORT_FAILED,
                file.name + ' — ' + (thrown && thrown.message ? thrown.message : thrown),
                'Check that the output folder is writable and that the file is not open in another app.'
            );
        }

        if (scratch) { BM.ps.closeDocument(scratch, false); }

        return {
            path: BM.fs.fsName(file),
            bytes: file.exists ? file.length : 0,
            width: size ? size.width : Math.round(BM.util.px(doc.width)),
            height: size ? size.height : Math.round(BM.util.px(doc.height)),
            notes: notes
        };
    };

    /* --------------------------------------------------------------- reports */

    /**
     * Write the per-run CSV report.
     *
     * @param {string} path
     * @param {Array}  rows  `{ design, status, output, message }`
     */
    api.writeCsvReport = function (path, rows) {
        var lines = ['design,status,output,message'];
        var i, row;
        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            lines.push([
                BM.util.csvCell(row.design),
                BM.util.csvCell(row.status),
                BM.util.csvCell(row.output),
                BM.util.csvCell(row.message)
            ].join(','));
        }
        return BM.fs.writeText(path, lines.join('\r\n') + '\r\n');
    };

    return api;
}());
