/**
 * Small, dependency-free helpers shared by the engine modules.
 *
 * ExtendScript is ES3: no `Array.prototype.map`, no `String.prototype.trim`, no
 * `Object.keys`. Anything the rest of the plugin needs lives here instead.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.util = (function () {

    var api = {};

    /* ---------------------------------------------------------------- strings */

    api.trim = function (value) {
        return String(value === null || value === undefined ? '' : value).replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
    };

    api.isString = function (value) {
        return typeof value === 'string';
    };

    api.endsWith = function (haystack, needle) {
        haystack = String(haystack);
        return haystack.length >= needle.length &&
            haystack.substring(haystack.length - needle.length) === needle;
    };

    api.startsWith = function (haystack, needle) {
        return String(haystack).substring(0, needle.length) === needle;
    };

    /** Case-insensitive substring test. */
    api.containsIgnoreCase = function (haystack, needle) {
        if (!needle) { return true; }
        return String(haystack).toLowerCase().indexOf(String(needle).toLowerCase()) >= 0;
    };

    api.padLeft = function (value, width, padChar) {
        var text = String(value);
        padChar = padChar || '0';
        while (text.length < width) { text = padChar + text; }
        return text;
    };

    /* ------------------------------------------------------------- coercion */

    /** Coerce to a finite number, clamping into [min, max] when provided. */
    api.number = function (value, fallback, min, max) {
        var n = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(n) || !isFinite(n)) { n = fallback; }
        if (typeof min === 'number' && n < min) { n = min; }
        if (typeof max === 'number' && n > max) { n = max; }
        return n;
    };

    /** Coerce an "on"/"off", 1/0, "true"/"false" value to a real boolean. */
    api.bool = function (value, fallback) {
        if (value === true || value === false) { return value; }
        if (value === null || value === undefined || value === '') { return !!fallback; }
        if (typeof value === 'number') { return value !== 0; }
        var text = api.trim(value).toLowerCase();
        if (text === 'true' || text === 'yes' || text === 'on' || text === '1') { return true; }
        if (text === 'false' || text === 'no' || text === 'off' || text === '0') { return false; }
        return !!fallback;
    };

    /**
     * Pick one of `allowed`, falling back when the value is not recognised.
     *
     * Matches case-insensitively but returns the *canonical* entry from
     * `allowed`, so callers never have to re-case a value coming from the panel.
     */
    api.oneOf = function (value, allowed, fallback) {
        var text = api.trim(value).toLowerCase();
        var i;
        for (i = 0; i < allowed.length; i++) {
            if (String(allowed[i]).toLowerCase() === text) { return allowed[i]; }
        }
        return fallback;
    };

    /** Normalise a `#rrggbb` / `#rgb` / "rrggbb" string, or '' when invalid. */
    api.normalizeHexColor = function (value) {
        var text = api.trim(value).replace(/^#/, '');
        if (!text) { return ''; }
        if (/^[0-9a-fA-F]{3}$/.test(text)) {
            return ('#' + text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2)).toUpperCase();
        }
        if (/^[0-9a-fA-F]{6}$/.test(text)) {
            return ('#' + text).toUpperCase();
        }
        return '';
    };

    /* ------------------------------------------------------------------ units */

    /**
     * Read a Photoshop measurement as pixels.
     *
     * Photoshop hands back `UnitValue` objects whose value depends on the user's
     * ruler preference, which is exactly the bug that makes naive scripts behave
     * differently on different machines. Always asking for pixels fixes it.
     */
    api.px = function (value, fallback) {
        var n;
        if (value === null || value === undefined) { return typeof fallback === 'number' ? fallback : 0; }
        if (typeof value === 'number') { return value; }
        try {
            if (typeof value.as === 'function') { return value.as('px'); }
        } catch (e) { /* fall through to parsing */ }
        n = parseFloat(String(value).replace(/[^\d\.\-eE]/g, ''));
        return isNaN(n) ? (typeof fallback === 'number' ? fallback : 0) : n;
    };

    /** Construct a pixel UnitValue when the host exposes the constructor. */
    api.pxUnit = function (value) {
        try {
            return new UnitValue(value, 'px');
        } catch (e) {
            return value;
        }
    };

    /* ------------------------------------------------------------------ paths */

    /** Final path segment for both slash flavours. */
    api.basename = function (path) {
        var text = String(path).replace(/[\\\/]+$/, '');
        var index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
        return index >= 0 ? text.substring(index + 1) : text;
    };

    /** File name without its extension. */
    api.stripExtension = function (name) {
        var index = String(name).lastIndexOf('.');
        return index > 0 ? String(name).substring(0, index) : String(name);
    };

    /** Lower-case extension without the dot, or '' when there is none. */
    api.extensionOf = function (name) {
        var base = api.basename(name);
        var index = base.lastIndexOf('.');
        return index > 0 ? base.substring(index + 1).toLowerCase() : '';
    };

    /** Replace characters that are illegal in file names, and trim length. */
    api.sanitizeFilename = function (name, maxLength) {
        var text = String(name).replace(BM.INVALID_FILENAME_CHARS, '_');
        text = api.trim(text).replace(/[\.\s]+$/, '');
        if (!text) { text = 'untitled'; }
        maxLength = maxLength || 120;
        if (text.length > maxLength) {
            text = text.substring(0, maxLength);
        }
        return text;
    };

    /**
     * Expand `{token}` placeholders in the output naming template.
     *
     * @param {string} template e.g. "{name}_mockup"
     * @param {Object} tokens   Map of token name to replacement text.
     */
    api.applyTemplate = function (template, tokens) {
        var text = api.isString(template) && api.trim(template) ? template : '{name}';
        var key;
        for (key in tokens) {
            if (Object.prototype.hasOwnProperty.call(tokens, key)) {
                text = text.split('{' + key + '}').join(String(tokens[key]));
            }
        }
        return text;
    };

    /* ------------------------------------------------------------------ dates */

    api.now = function () {
        return new Date().getTime();
    };

    api.dateStamp = function (date) {
        date = date || new Date();
        return [
            date.getFullYear(),
            api.padLeft(date.getMonth() + 1, 2),
            api.padLeft(date.getDate(), 2)
        ].join('-');
    };

    api.timeStamp = function (date) {
        date = date || new Date();
        return [
            api.padLeft(date.getHours(), 2),
            api.padLeft(date.getMinutes(), 2),
            api.padLeft(date.getSeconds(), 2)
        ].join('-');
    };

    /* ------------------------------------------------------------------- time */

    /** "7.2s", "1m 04s", "1h 12m". */
    api.formatDuration = function (ms) {
        var totalSeconds, minutes, seconds;
        if (!isFinite(ms) || ms < 0) { return '—'; }
        if (ms < 1000) { return Math.round(ms) + 'ms'; }
        totalSeconds = Math.round(ms / 1000);
        if (totalSeconds < 60) { return totalSeconds + 's'; }
        minutes = Math.floor(totalSeconds / 60);
        seconds = totalSeconds % 60;
        if (minutes < 60) { return minutes + 'm ' + api.padLeft(seconds, 2) + 's'; }
        return Math.floor(minutes / 60) + 'h ' + api.padLeft(minutes % 60, 2) + 'm';
    };

    /** Rough "about 2m 10s left" phrasing for the progress readout. */
    api.formatEta = function (remainingMs) {
        if (!isFinite(remainingMs) || remainingMs <= 0) { return '—'; }
        if (remainingMs < 2000) { return 'almost done'; }
        return api.formatDuration(remainingMs) + ' left';
    };

    /* ------------------------------------------------------------ collections */

    api.indexOf = function (list, value) {
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i] === value) { return i; }
        }
        return -1;
    };

    /** Shallow clone of an object, optionally overridden by another object. */
    api.assign = function (target, source) {
        var key;
        for (key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                target[key] = source[key];
            }
        }
        return target;
    };

    /** Natural comparison: "shot2" sorts before "shot10". */
    api.compareNatural = function (a, b) {
        var ax = String(a).toLowerCase().split(/(\d+)/);
        var bx = String(b).toLowerCase().split(/(\d+)/);
        var i, na, nb;
        for (i = 0; i < Math.max(ax.length, bx.length); i++) {
            if (ax[i] === undefined) { return -1; }
            if (bx[i] === undefined) { return 1; }
            if (ax[i] === bx[i]) { continue; }
            na = parseInt(ax[i], 10);
            nb = parseInt(bx[i], 10);
            if (!isNaN(na) && !isNaN(nb)) { return na - nb; }
            return ax[i] < bx[i] ? -1 : 1;
        }
        return 0;
    };

    /** RFC-4180-ish CSV escaping. */
    api.csvCell = function (value) {
        var text = value === null || value === undefined ? '' : String(value);
        if (/[",\r\n]/.test(text)) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    };

    return api;
}());
