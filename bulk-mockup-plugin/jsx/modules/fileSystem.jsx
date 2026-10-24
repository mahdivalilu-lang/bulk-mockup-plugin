/**
 * File system helpers.
 *
 * Wraps ExtendScript's `File` / `Folder` so the rest of the plugin can assume
 * that paths are resolved, folders exist and inputs have been validated before
 * Photoshop is asked to open anything.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.fs = (function () {

    var api = {};

    /* ---------------------------------------------------------------- paths */

    /**
     * Normalise a path that may have arrived from the panel.
     *
     * CEP hands back `file://`-style URIs on some platforms, percent-encoded
     * paths on others, and raw native paths the rest of the time. Fold all of
     * that down to something `File` / `Folder` understands.
     */
    api.normalizePath = function (path) {
        var text = BM.util.trim(path);
        if (!text) { return ''; }
        if (BM.util.startsWith(text.toLowerCase(), 'file://')) {
            text = text.substring(7);
            try { text = decodeURI(text); } catch (e) { /* keep raw */ }
            // A Windows drive URI arrives as "/C:/folder"; drop that extra slash.
            if (/^\/[A-Za-z]:[\\\/]/.test(text)) { text = text.substring(1); }
        }
        return text;
    };

    /** Resolve to a `File`, or null when the path is empty. */
    api.toFile = function (path) {
        var text = api.normalizePath(path);
        return text ? new File(text) : null;
    };

    /** Resolve to a `Folder`, or null when the path is empty. */
    api.toFolder = function (path) {
        var text = api.normalizePath(path);
        return text ? new Folder(text) : null;
    };

    /** Absolute, platform-native path suitable for display and for CSV rows. */
    api.fsName = function (fileOrFolder) {
        if (!fileOrFolder) { return ''; }
        try { return fileOrFolder.fsName; } catch (e) { return String(fileOrFolder); }
    };

    /* ------------------------------------------------------------- existence */

    api.fileExists = function (path) {
        var file = api.toFile(path);
        return !!(file && file.exists);
    };

    /** True when `path` points at an existing file of a usable size. */
    api.isReadableFile = function (path) {
        var file = api.toFile(path);
        if (!file || !file.exists) { return false; }
        try {
            return file.length > 0;
        } catch (e) {
            return true;
        }
    };

    api.folderExists = function (path) {
        var folder = api.toFolder(path);
        return !!(folder && folder.exists);
    };

    /**
     * Resolve a folder, creating it when asked.
     *
     * @param {string}  path   Folder path.
     * @param {boolean} create Create missing directories (recursively).
     * @return {Folder} The resolved folder.
     * @throws {BM.Error} When the folder is missing and cannot be created.
     */
    api.requireFolder = function (path, create) {
        var folder;
        if (!BM.util.trim(path)) {
            bmFail(BM.ERROR_CODES.BAD_CONFIG, 'No folder path was provided.');
        }
        folder = api.toFolder(path);

        if (!folder.exists) {
            if (!create) {
                bmFail(BM.ERROR_CODES.DESIGNS_MISSING, api.fsName(folder));
            }
            if (!folder.create()) {
                bmFail(BM.ERROR_CODES.OUTPUT_UNWRITABLE, api.fsName(folder));
            }
        }
        return folder;
    };

    /** Verify a folder can actually be written to, by writing and removing a probe. */
    api.assertWritable = function (folder) {
        var probe = new File(folder.fsName + '/.bulkmockup-write-test');
        var ok = false;
        try {
            if (probe.open('w')) {
                probe.write('ok');
                probe.close();
                ok = true;
            }
        } catch (e) {
            ok = false;
        }
        if (ok) {
            try { probe.remove(); } catch (e) { /* harmless */ }
            return true;
        }
        bmFail(
            BM.ERROR_CODES.OUTPUT_NOT_WRITABLE,
            api.fsName(folder),
            'Close any application that may be holding the folder, or choose a different output location.'
        );
        return false;
    };

    /* --------------------------------------------------------------- designs */

    /** A fresh `RegExp` matching every extension the panel advertises. */
    api.imagePattern = function () {
        return new RegExp('\\.(' + BM.SUPPORTED_IMAGE_EXTENSIONS.join('|') + ')$', 'i');
    };

    /**
     * Duck-type a `File` entry.
     *
     * `instanceof File` is tempting but brittle: host objects can come from a
     * different scripting context, and `Folder` shares the `name` property.
     * `open()` is what only a File has.
     */
    api.isFileEntry = function (entry) {
        if (!entry) { return false; }
        if (typeof Folder !== 'undefined' && entry instanceof Folder) { return false; }
        return typeof entry.name === 'string' && typeof entry.open === 'function';
    };

    api.isSupportedImage = function (file) {
        return api.isFileEntry(file) && api.imagePattern().test(file.name);
    };

    api.isSupportedMockup = function (file) {
        if (!file || typeof file.name !== 'string') { return false; }
        return BM.util.indexOf(BM.MOCKUP_EXTENSIONS, BM.util.extensionOf(file.name)) >= 0;
    };

    function comparatorFor(sort) {
        if (sort === 'nameDesc') {
            return function (a, b) { return -BM.util.compareNatural(a.name, b.name); };
        }
        if (sort === 'date') {
            return function (a, b) { return b.modified.getTime() - a.modified.getTime(); };
        }
        if (sort === 'dateDesc') {
            return function (a, b) { return a.modified.getTime() - b.modified.getTime(); };
        }
        if (sort === 'size') {
            return function (a, b) { return b.length - a.length; };
        }
        return function (a, b) { return BM.util.compareNatural(a.name, b.name); };
    }

    /**
     * Collect the designs to process.
     *
     * Unsupported files and anything the user filtered out are returned rather
     * than silently dropped, so the panel can report "142 found, 7 skipped".
     *
     * @param  {Folder} folder
     * @param  {Object=} options `{ sort, nameFilter, limit, startAt, recursive }`
     * @return {Object} `{ files, scanned, skipped, filteredOut }`
     */
    api.listDesigns = function (folder, options) {
        options = options || {};

        var scanned = folder.getFiles();
        var supported = [];
        var skipped = [];
        var i, entry, name;

        for (i = 0; i < scanned.length; i++) {
            entry = scanned[i];
            if (!api.isFileEntry(entry)) { continue; }       // subfolders, oddities
            name = entry.name;
            if (name.charAt(0) === '.' || name.charAt(0) === '~') { continue; }
            if (api.isSupportedImage(entry)) {
                supported.push(entry);
            } else {
                skipped.push(name);
            }
        }

        var filtered = [];
        var filteredOut = 0;
        var filter = BM.util.trim(options.nameFilter || '');
        for (i = 0; i < supported.length; i++) {
            if (!filter || BM.util.containsIgnoreCase(supported[i].name, filter)) {
                filtered.push(supported[i]);
            } else {
                filteredOut += 1;
            }
        }

        filtered.sort(comparatorFor(options.sort));

        var startAt = Math.max(1, BM.util.number(options.startAt, 1, 1, 1000000));
        var limit = Math.max(0, BM.util.number(options.limit, 0, 0, 1000000));
        var slice = filtered.slice(startAt - 1);
        if (limit > 0) {
            slice = slice.slice(0, limit);
        }

        return {
            files: slice,
            scanned: scanned.length,
            matched: filtered.length,
            skipped: skipped,
            filteredOut: filteredOut
        };
    };

    /* --------------------------------------------------------------- outputs */

    /** Avoid clobbering: `design.jpg` -> `design (2).jpg`. */
    api.uniqueFile = function (folder, baseName, extension) {
        var candidate = new File(folder.fsName + '/' + baseName + '.' + extension);
        var counter = 2;
        while (candidate.exists && counter < 10000) {
            candidate = new File(folder.fsName + '/' + baseName + ' (' + counter + ').' + extension);
            counter += 1;
        }
        return candidate;
    };

    /* ----------------------------------------------------------------- cancel */

    /** Sentinel file the panel writes to request cancellation mid-run. */
    api.cancelFilePath = function () {
        return Folder.temp.fsName + '/bulkmockup.cancel';
    };

    api.clearCancelFlag = function () {
        try {
            var file = new File(api.cancelFilePath());
            if (file.exists) { file.remove(); }
        } catch (e) { /* ignored */ }
    };

    api.isCancelRequested = function () {
        try {
            return new File(api.cancelFilePath()).exists;
        } catch (e) {
            return false;
        }
    };

    /* ------------------------------------------------------------------ text */

    api.writeText = function (path, text) {
        var file = new File(path);
        file.encoding = 'UTF-8';
        if (!file.open('w')) { return false; }
        file.write(text);
        file.close();
        return true;
    };

    return api;
}());
