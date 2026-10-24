/*
 * Bulk Mockup v1.0.0 — CEP engine (generated).
 *
 * GENERATED FILE. Do not edit by hand: edit the modules under jsx/ and run
 * `npm run build`.
 *
 * This is the manifest's `ScriptPath`. CEP reads this file and evaluates its
 * *contents* as a script string, so it must be self-contained: a relative
 * `#include` would be resolved against Photoshop's working directory and fail.
 * That is why the includes are flattened here, and why there is no entry call
 * at the bottom — the panel drives the API with `evalScript` calls.
 */

/* ===== jsx/index.jsx ================================================= */
/**
 * Bulk Mockup — ExtendScript engine entry point.
 *
 * This is the development entry, not the manifest's `ScriptPath`: `#include`
 * is resolved relative to this file, which keeps the tree editable, but CEP
 * evaluates `ScriptPath` as a plain string and cannot resolve relative
 * includes. `npm run build` flattens this tree into `jsx/engine.jsx`, and that
 * is the file the manifest loads. Both define the same `BulkMockup` API.
 *
 * `#include` is resolved relative to *this file*, so the whole tree can be
 * relocated as long as the relative layout is preserved.
 *
 * The same tree can be concatenated into a single self-contained `.jsx` with
 * `npm run build` (see tools/build-standalone.mjs) for use from
 * `File > Scripts > Browse…` or ExtendScript Toolkit — see
 * jsx/standalone/BulkMockupStandalone.jsx.
 */

/* ===== jsx/lib/json2.jsx ============================================= */
/**
 * Minimal JSON implementation for ExtendScript.
 *
 * ExtendScript is ES3 and does not reliably ship `JSON`, so the whole plugin
 * routes serialisation through here. Kept deliberately small, dependency free
 * and eval free (the parser is a hand written recursive descent parser, never
 * `eval`, because `eval` in a host application is a security smell).
 *
 * The global `JSON` is only polyfilled when it is missing, so on hosts that do
 * provide a native implementation we stay out of the way.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

(function () {

    function isArray(value) {
        return Object.prototype.toString.call(value) === '[object Array]';
    }

    function quote(string) {
        var result = '"';
        var i, ch, code;
        for (i = 0; i < string.length; i++) {
            ch = string.charAt(i);
            code = string.charCodeAt(i);
            switch (ch) {
            case '"':  result += '\\"';  break;
            case '\\': result += '\\\\'; break;
            case '\b': result += '\\b';  break;
            case '\f': result += '\\f';  break;
            case '\n': result += '\\n';  break;
            case '\r': result += '\\r';  break;
            case '\t': result += '\\t';  break;
            default:
                if (code < 32 || code === 0x7F) {
                    result += '\\u' + ('0000' + code.toString(16)).slice(-4);
                } else {
                    result += ch;
                }
            }
        }
        return result + '"';
    }

    /**
     * Serialise a value.
     *
     * @param {*}       value   Value to serialise.
     * @param {string=} indent  Current indent (internal).
     * @param {string=} gap     One unit of indentation (internal).
     */
    function serialize(value, indent, gap) {
        var i, key, keys, part, parts, type = typeof value;

        if (value === null) { return 'null'; }
        if (type === 'undefined' || type === 'function') { return undefined; }
        if (type === 'boolean') { return value ? 'true' : 'false'; }
        if (type === 'number') { return isFinite(value) ? String(value) : 'null'; }
        if (type === 'string') { return quote(value); }

        // Fake array-like objects (arguments) and host collections.
        if (value instanceof Date) {
            return quote(isFinite(value.getTime()) ? value.toUTCString() : 'Invalid Date');
        }
        if (typeof value.toJSON === 'function') {
            return serialize(value.toJSON(), indent, gap);
        }

        if (isArray(value)) {
            if (value.length === 0) { return '[]'; }
            parts = [];
            for (i = 0; i < value.length; i++) {
                part = serialize(value[i], indent + gap, gap);
                parts.push(part === undefined ? 'null' : part);
            }
            if (gap === '') { return '[' + parts.join(',') + ']'; }
            return '[\n' + indent + gap + parts.join(',\n' + indent + gap) + '\n' + indent + ']';
        }

        // Generic object. ExtendScript has no Object.keys, so walk it manually.
        keys = [];
        for (key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) { keys.push(key); }
        }
        if (keys.length === 0) { return '{}'; }

        parts = [];
        for (i = 0; i < keys.length; i++) {
            key = keys[i];
            part = serialize(value[key], indent + gap, gap);
            if (part === undefined) { continue; }
            parts.push(quote(key) + (gap === '' ? ':' : ': ') + part);
        }
        if (parts.length === 0) { return '{}'; }
        if (gap === '') { return '{' + parts.join(',') + '}'; }
        return '{\n' + indent + gap + parts.join(',\n' + indent + gap) + '\n' + indent + '}';
    }

    /** Internal parser state, encapsulated so the parser is re-entrant. */
    function Parser(text) {
        this.text = String(text);
        this.at = 0;
        this.ch = this.text.charAt(0);
    }

    Parser.prototype.error = function (message) {
        throw new SyntaxError('JSON.parse: ' + message + ' at position ' + this.at);
    };

    Parser.prototype.next = function () {
        this.at += 1;
        this.ch = this.at < this.text.length ? this.text.charAt(this.at) : '';
        return this.ch;
    };

    Parser.prototype.whitespace = function () {
        while (this.ch && ' \t\n\r'.indexOf(this.ch) >= 0) { this.next(); }
    };

    Parser.prototype.value = function () {
        var result;
        this.whitespace();
        if (this.ch === '{') { result = this.object(); }
        else if (this.ch === '[') { result = this.array(); }
        else if (this.ch === '"') { result = this.string(); }
        else if (this.ch === '-' || (this.ch >= '0' && this.ch <= '9')) { result = this.number(); }
        else if (this.text.substr(this.at, 4) === 'true') { this.skip(4); result = true; }
        else if (this.text.substr(this.at, 5) === 'false') { this.skip(5); result = false; }
        else if (this.text.substr(this.at, 4) === 'null') { this.skip(4); result = null; }
        else { this.error('unexpected character ' + (this.ch ? '"' + this.ch + '"' : 'end of input')); }
        this.whitespace();
        return result;
    };

    Parser.prototype.skip = function (count) {
        for (var i = 0; i < count; i++) { this.next(); }
    };

    Parser.prototype.object = function () {
        var result = {}, key, value;
        this.skip(1); // {
        this.whitespace();
        if (this.ch === '}') { this.next(); return result; }
        for (;;) {
            this.whitespace();
            if (this.ch !== '"') { this.error('expected a key'); }
            key = this.string();
            this.whitespace();
            if (this.ch !== ':') { this.error('expected ":"'); }
            this.next();
            value = this.value();
            result[key] = value;
            this.whitespace();
            if (this.ch === '}') { this.next(); return result; }
            if (this.ch !== ',') { this.error('expected "," or "}"'); }
            this.next();
        }
    };

    Parser.prototype.array = function () {
        var result = [];
        this.skip(1); // [
        this.whitespace();
        if (this.ch === ']') { this.next(); return result; }
        for (;;) {
            result.push(this.value());
            this.whitespace();
            if (this.ch === ']') { this.next(); return result; }
            if (this.ch !== ',') { this.error('expected "," or "]"'); }
            this.next();
        }
    };

    Parser.prototype.string = function () {
        var result = '', ch, hex, i;
        this.skip(1); // opening quote
        for (;;) {
            if (!this.ch) { this.error('unterminated string'); }
            ch = this.ch;
            if (ch === '"') { this.next(); return result; }
            if (ch === '\\') {
                this.next();
                ch = this.ch;
                switch (ch) {
                case '"':  result += '"';  break;
                case '\\': result += '\\'; break;
                case '/':  result += '/';  break;
                case 'b':  result += '\b'; break;
                case 'f':  result += '\f'; break;
                case 'n':  result += '\n'; break;
                case 'r':  result += '\r'; break;
                case 't':  result += '\t'; break;
                case 'u':
                    hex = this.text.substr(this.at + 1, 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) { this.error('bad unicode escape'); }
                    result += String.fromCharCode(parseInt(hex, 16));
                    this.skip(4);
                    break;
                default:
                    this.error('bad escape "\\' + ch + '"');
                }
                this.next();
            } else if (ch < ' ') {
                this.error('control character in string');
            } else {
                result += ch;
                this.next();
            }
        }
        return result; // unreachable, keeps old parsers happy
    };

    Parser.prototype.number = function () {
        var start = this.at, literal;
        if (this.ch === '-') { this.next(); }
        while (this.ch >= '0' && this.ch <= '9') { this.next(); }
        if (this.ch === '.') {
            this.next();
            while (this.ch >= '0' && this.ch <= '9') { this.next(); }
        }
        if (this.ch === 'e' || this.ch === 'E') {
            this.next();
            if (this.ch === '+' || this.ch === '-') { this.next(); }
            while (this.ch >= '0' && this.ch <= '9') { this.next(); }
        }
        literal = this.text.substring(start, this.at);
        if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(literal)) { this.error('bad number ' + literal); }
        return parseFloat(literal);
    };

    var impl = {
        stringify: function (value, _replacer, space) {
            var gap = '';
            var i;
            if (typeof space === 'number') {
                for (i = 0; i < space; i++) { gap += ' '; }
            } else if (typeof space === 'string') {
                gap = space.slice(0, 10);
            }
            return serialize(value, '', gap);
        },
        parse: function (text) {
            var parser = new Parser(text);
            var result = parser.value();
            parser.whitespace();
            if (parser.ch) { parser.error('trailing garbage'); }
            return result;
        }
    };

    // Publish on the plugin namespace, and polyfill the global when absent.
    BM.json = impl;
    if (typeof JSON === 'undefined' || !JSON || typeof JSON.stringify !== 'function') {
        JSON = impl;
    }

}());


/* ===== jsx/core/constants.jsx ======================================== */
/**
 * Plugin-wide constants: identity, defaults, enumerations and error codes.
 *
 * Everything the panel and the engine both need to agree on lives here so a
 * single edit keeps the UI and the batch engine in sync.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

/** Identity strings used for logging, events and the manifest. */
BM.APP = {
    NAME: 'Bulk Mockup',
    BUNDLE_ID: 'com.bulkmockup.panel',
    VERSION: '1.0.0',
    TAGLINE: 'Batch-replace Smart Objects with live progress'
};

/** Channels the engine uses to push real-time updates into the panel. */
BM.EVENT = {
    /** Single multiplexed CEP event; payload carries its own `type` field. */
    CHANNEL: 'com.bulkmockup.event',
    /** Payload `type` values. */
    LOG: 'log',
    PROGRESS: 'progress',
    ITEM: 'item',
    DONE: 'done'
};

/** Log severities, ordered from most to least chatty. */
BM.LOG_LEVELS = { debug: 10, info: 20, success: 25, warn: 30, error: 40, silent: 99 };
BM.LOG_ORDER = ['debug', 'info', 'success', 'warn', 'error'];

/**
 * Default run configuration.
 *
 * These values produce the same result as the original legacy script while
 * being far more careful about failure modes.
 */
BM.DEFAULTS = {
    /** The layer the legacy script hard-coded. Used as the fallback name. */
    smartObjectLayer: 'tst-music copy',
    /** Tried, in order, when the primary layer name is not found. */
    fallbackLayerNames: ['tst-music copy', 'Mockup', 'mockup', 'Design', 'Smart Object'],
    /** When true and no named layer matches, use the first Smart Object found. */
    autoDetectLayer: true,
    /** When true, a plain layer with a matching name is converted to a Smart Object. */
    autoConvertToSmartObject: false,

    /** How the design is fitted into the Smart Object canvas. */
    fitMode: 'contain',          // contain | cover | center | stretch (legacy)
    /** Inset, as a percentage of the Smart Object canvas, applied on all sides. */
    paddingPercent: 0,

    /** How the Smart Object contents get replaced. */
    strategy: 'auto',            // auto | replaceContents | editContents

    /** Output encoding. */
    format: 'jpg',               // jpg | png
    quality: 85,                 // JPEG 1..100 (mapped to Photoshop's 0..12)
    pngCompression: 6,           // PNG 0..9
    /** Long-edge cap in pixels; 0 keeps the mockup's native size. */
    maxOutputSize: 0,
    /** Background painted behind transparent designs, e.g. "#ffffff". Empty keeps transparency. */
    backgroundFill: '',

    /** Output file name template. Tokens: {name} {index} {date} {time} {ext}. */
    namingTemplate: '{name}',
    /** Text added before/after the templated name, joined with an underscore. */
    filenamePrefix: '',
    filenameSuffix: '',
    /** Overwrite existing output files instead of suffixing them. */
    overwrite: true,

    /** Designs ordering. */
    sort: 'name',                // name | nameDesc | date | dateDesc | size
    /** Case-insensitive substring filter applied to design file names. */
    nameFilter: '',
    /** Stop after this many designs; 0 = no limit. */
    limit: 0,
    /** 1-based index of the first design to process. */
    startAt: 1,

    /** Re-open the PSD for every design instead of keeping it in memory. */
    reopenMockupPerDesign: false,
    /** Milliseconds to pause between designs, keeps Photoshop responsive. */
    delayMs: 0,

    /** Diagnostics. */
    writeLogFile: true,
    writeCsvReport: true,
    logLevel: 'info'
};

/** Extensions the panel's design picker accepts. */
BM.SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'psd', 'pdf'];

/** Extensions accepted for the mockup PSD field. */
BM.MOCKUP_EXTENSIONS = ['psd', 'psb'];

/** Stable, machine-readable error codes. The panel maps these to friendly copy. */
BM.ERROR_CODES = {
    NO_APP: 'BM_NO_APP',
    BAD_CONFIG: 'BM_BAD_CONFIG',
    MOCKUP_MISSING: 'BM_MOCKUP_MISSING',
    MOCKUP_UNREADABLE: 'BM_MOCKUP_UNREADABLE',
    DESIGNS_MISSING: 'BM_DESIGNS_MISSING',
    NO_DESIGNS: 'BM_NO_DESIGNS',
    OUTPUT_UNWRITABLE: 'BM_OUTPUT_UNWRITABLE',
    OUTPUT_NOT_WRITABLE: 'BM_OUTPUT_NOT_WRITABLE',
    LAYER_MISSING: 'BM_LAYER_MISSING',
    LAYER_NOT_SMART: 'BM_LAYER_NOT_SMART',
    NO_SMART_OBJECTS: 'BM_NO_SMART_OBJECTS',
    IMAGE_UNREADABLE: 'BM_IMAGE_UNREADABLE',
    UNSUPPORTED_FORMAT: 'BM_UNSUPPORTED_FORMAT',
    EXPORT_FAILED: 'BM_EXPORT_FAILED',
    SMART_OBJECT_FAILED: 'BM_SMART_OBJECT_FAILED',
    DOC_OPEN_FAILED: 'BM_DOC_OPEN_FAILED',
    CANCELLED: 'BM_CANCELLED',
    UNKNOWN: 'BM_UNKNOWN'
};

/** Human-readable text for every error code. */
BM.ERROR_MESSAGES = {
    BM_NO_APP: 'Photoshop could not be reached.',
    BM_BAD_CONFIG: 'The run settings are not valid.',
    BM_MOCKUP_MISSING: 'The mockup PSD file could not be found.',
    BM_MOCKUP_UNREADABLE: 'The mockup PSD could not be opened. It may be corrupt or locked.',
    BM_DESIGNS_MISSING: 'The designs folder does not exist.',
    BM_NO_DESIGNS: 'No usable images were found in the designs folder.',
    BM_OUTPUT_UNWRITABLE: 'The output folder could not be created.',
    BM_OUTPUT_NOT_WRITABLE: 'The output folder is not writable.',
    BM_LAYER_MISSING: 'The Smart Object layer was not found in the mockup.',
    BM_LAYER_NOT_SMART: 'That layer exists but is not a Smart Object.',
    BM_NO_SMART_OBJECTS: 'The mockup contains no Smart Object layers.',
    BM_IMAGE_UNREADABLE: 'The design file could not be opened.',
    BM_UNSUPPORTED_FORMAT: 'That image format is not supported.',
    BM_EXPORT_FAILED: 'The output file could not be written.',
    BM_SMART_OBJECT_FAILED: 'The Smart Object contents could not be replaced.',
    BM_DOC_OPEN_FAILED: 'A Photoshop document could not be opened.',
    BM_CANCELLED: 'The run was cancelled.',
    BM_UNKNOWN: 'Something went wrong.'
};

/** Characters that are illegal in file names on Windows and macOS. */
BM.INVALID_FILENAME_CHARS = /[\\\/:\*\?"<>\|\x00-\x1f]/g;

/* ===== jsx/core/errors.jsx =========================================== */
/**
 * Typed error handling.
 *
 * Every failure that can leave the plugin is expressed as a `BM.Error` carrying
 * a stable code from `BM.ERROR_CODES`, so the panel can show friendly copy and
 * still have a machine-readable identifier for support requests.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

/**
 * @param {string} code   One of BM.ERROR_CODES.
 * @param {string=} detail Extra context, e.g. the offending path.
 * @param {string=} hint   Optional remediation hint shown in the panel.
 */
BM.Error = function (code, detail, hint) {
    this.name = 'BMError';
    this.code = code || BM.ERROR_CODES.UNKNOWN;
    this.detail = detail || '';
    this.hint = hint || '';
    this.message = BM.ERROR_MESSAGES[this.code] || BM.ERROR_MESSAGES[BM.ERROR_CODES.UNKNOWN];
};

BM.Error.prototype.toString = function () {
    return this.detail ? (this.message + ' — ' + this.detail) : this.message;
};

/** Serialise for the panel (never leaks a raw host exception). */
BM.Error.prototype.toJSON = function () {
    return {
        code: this.code,
        message: this.message,
        detail: this.detail,
        hint: this.hint
    };
};

/** Throw a `BM.Error`. Keeps call sites to one line. */
function bmFail(code, detail, hint) {
    throw new BM.Error(code, detail, hint);
}

/**
 * Reduce any thrown value — a `BM.Error`, an ExtendScript `Error`, or a bare
 * string — to a plain object the panel can render.
 */
BM.describeError = function (thrown) {
    var firstLine, code;

    if (thrown instanceof BM.Error) {
        return { code: thrown.code, message: thrown.message, detail: thrown.detail, hint: thrown.hint };
    }

    if (thrown === null || thrown === undefined) {
        return { code: BM.ERROR_CODES.UNKNOWN, message: BM.ERROR_MESSAGES[BM.ERROR_CODES.UNKNOWN], detail: 'Unknown failure', hint: '' };
    }

    if (typeof thrown === 'string') {
        return { code: BM.ERROR_CODES.UNKNOWN, message: thrown, detail: '', hint: '' };
    }

    // Native ExtendScript errors carry a message plus a trace in `message`.
    code = thrown.number ? ('#' + thrown.number) : '';
    firstLine = String(thrown.message || thrown.name || thrown);

    // ExtendScript appends "\nLine: 42\n-> ..." to describe where it blew up.
    if (firstLine.indexOf('\n') >= 0) {
        firstLine = firstLine.split('\n')[0];
    }
    firstLine = BM.util.trim(firstLine);

    // Turn a few of the host's wordings into better advice.
    if (/not a function|is not an object|undefined/i.test(firstLine)) {
        return {
            code: BM.ERROR_CODES.UNKNOWN,
            message: firstLine,
            detail: code,
            hint: 'Photoshop rejected this operation. Confirm the layer is a Smart Object and that no modal dialog is waiting.'
        };
    }
    if (/cannot open|can not open|could not open/i.test(firstLine)) {
        return {
            code: BM.ERROR_CODES.DOC_OPEN_FAILED,
            message: firstLine,
            detail: code,
            hint: 'The file may be open elsewhere or locked by another application.'
        };
    }

    return { code: BM.ERROR_CODES.UNKNOWN, message: firstLine, detail: code, hint: '' };
};

/**
 * Run `fn`, converting anything it throws into a `{ ok: false, error }` result
 * instead of letting the exception escape into the CEP bridge, where it would
 * surface as an opaque "EvalScript error.".
 *
 * @param  {Function} fn Callable that returns the success payload.
 * @return {Object} Either `{ ok: true, data: ... }` or `{ ok: false, error: ... }`.
 */
BM.attempt = function (fn) {
    var data;
    try {
        data = fn();
    } catch (thrown) {
        return { ok: false, error: BM.describeError(thrown) };
    }
    return { ok: true, data: data === undefined ? null : data };
};

/* ===== jsx/core/utils.jsx ============================================ */
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

/* ===== jsx/core/cep.jsx ============================================== */
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

/* ===== jsx/core/logger.jsx =========================================== */
/**
 * Logging.
 *
 * A single sink fans out to three destinations:
 *   1. the panel's log pane, live, via the CEP bridge;
 *   2. an optional plain-text log file beside the output;
 *   3. (implicitly) the ExtendScript console via `$.writeln`, for when the
 *      engine is run outside a panel.
 *
 * File output is buffered and flushed in batches: writing a line at a time to a
 * File object on Windows is slow enough to show up inside a large batch.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.log = (function () {

    var FLUSH_EVERY = 25;

    var threshold = BM.LOG_LEVELS.info;
    var label = BM.APP.NAME;
    var filePath = '';
    var pending = [];
    var written = 0;
    var echo = false;

    function severityRank(level) {
        return BM.LOG_LEVELS[level] !== undefined ? BM.LOG_LEVELS[level] : BM.LOG_LEVELS.info;
    }

    function writeToFile(lines) {
        var file, i;
        if (!filePath || lines.length === 0) { return; }
        try {
            file = new File(filePath);
            file.encoding = 'UTF-8';
            if (file.open('a')) {
                for (i = 0; i < lines.length; i++) {
                    file.write(lines[i] + '\n');
                }
                file.close();
                written += lines.length;
            }
        } catch (e) {
            // Never let diagnostics take down the run.
            filePath = '';
        }
    }

    function flush() {
        var batch = pending;
        pending = [];
        writeToFile(batch);
    }

    var api = {};

    /**
     * Begin a logging session.
     *
     * @param {Object=} options `{ file, level, label, echo }`
     */
    api.start = function (options) {
        options = options || {};
        threshold = severityRank(options.level || BM.DEFAULTS.logLevel);
        label = options.label || BM.APP.NAME;
        echo = !!options.echo;
        filePath = options.file || '';
        pending = [];
        written = 0;

        if (filePath) {
            // Start each run from a clean file so old runs cannot be mistaken
            // for the current one when a user sends us a log.
            try {
                var file = new File(filePath);
                file.encoding = 'UTF-8';
                if (file.open('w')) {
                    file.write('--------------------------------------------------------------------\n');
                    file.write(BM.APP.NAME + ' v' + BM.APP.VERSION + '  ·  ' + BM.util.dateStamp() + ' ' + BM.util.timeStamp() + '\n');
                    file.write('--------------------------------------------------------------------\n');
                    file.close();
                }
            } catch (e) {
                filePath = '';
            }
        }
        return api;
    };

    /**
     * Emit one record.
     *
     * @param {string} level   debug | info | success | warn | error
     * @param {string} message Human readable text.
     * @param {Object=} meta   Optional structured extras shown on hover.
     */
    api.write = function (level, message, meta) {
        var stamp, line, payload;
        if (severityRank(level) < threshold) { return; }

        stamp = BM.util.timeStamp();
        line = '[' + stamp + '] ' + BM.util.padLeft(level.toUpperCase(), 7, ' ') + ' ' + message;

        if (filePath) {
            pending.push(line);
            if (pending.length >= FLUSH_EVERY) { flush(); }
        }
        if (echo) {
            try { $.writeln(line); } catch (e) { /* console unavailable */ }
        }

        payload = { type: BM.EVENT.LOG, level: level, message: message, time: stamp };
        if (meta) { payload.meta = meta; }
        BM.cep.emit(BM.EVENT.LOG, payload);
    };

    api.debug = function (message, meta) {
        api.write('debug', message, meta);
    };

    api.info = function (message, meta) {
        api.write('info', message, meta);
    };

    api.success = function (message, meta) {
        api.write('success', message, meta);
    };

    api.warn = function (message, meta) {
        api.write('warn', message, meta);
    };

    api.error = function (message, meta) {
        api.write('error', message, meta);
    };

    /** Current log file path, or '' when file logging is off. */
    api.filePath = function () {
        return filePath;
    };

    /** Number of lines persisted to disk. */
    api.writtenCount = function () {
        return written;
    };

    /** End the session, flushing anything still buffered. */
    api.finish = function () {
        flush();
        var total = written;
        filePath = '';
        pending = [];
        return total;
    };

    return api;
}());


/* ===== jsx/modules/fileSystem.jsx ==================================== */
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

/* ===== jsx/modules/photoshop.jsx ===================================== */
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

/* ===== jsx/modules/smartObject.jsx =================================== */
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

/* ===== jsx/modules/placement.jsx ===================================== */
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

/* ===== jsx/modules/exporter.jsx ====================================== */
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


/* ===== jsx/services/batchRunner.jsx ================================== */
/**
 * The batch engine.
 *
 * `inspect()` answers "would this run work?" without touching anything, and
 * `run()` performs the work while streaming progress to the panel.
 *
 * Design notes:
 *  - The mockup is opened once and reused; `reopenMockupPerDesign` exists for
 *    the rare mockup whose Smart Object misbehaves when replaced repeatedly.
 *  - A document the user already had open is never closed, and the mockup is
 *    never saved over — the original PSD is treated as read-only input.
 *  - Cancellation goes through a sentinel file rather than a second script
 *    call, because ExtendScript is single-threaded: a queued evalScript cannot
 *    run until the batch it wants to interrupt has already finished.
 */

var BM = (typeof BM !== 'undefined') ? BM : {};

BM.batch = (function () {

    var MAX_REPORTED_ERRORS = 50;

    var api = {};

    /* ------------------------------------------------------------- normalisation */

    /** Merge panel input with BM.DEFAULTS and coerce every field. */
    api.normalize = function (raw) {
        var d = BM.DEFAULTS;
        var c = {};
        raw = raw || {};

        c.mockupPath = BM.fs.normalizePath(raw.mockupPath || '');
        c.designsFolder = BM.fs.normalizePath(raw.designsFolder || '');
        c.outputFolder = BM.fs.normalizePath(raw.outputFolder || '');

        c.smartObjectLayer = BM.util.trim(raw.smartObjectLayer) || d.smartObjectLayer;
        c.fallbackLayerNames = (raw.fallbackLayerNames && raw.fallbackLayerNames.length)
            ? raw.fallbackLayerNames
            : d.fallbackLayerNames;
        c.autoDetectLayer = BM.util.bool(raw.autoDetectLayer, d.autoDetectLayer);
        c.autoConvertToSmartObject = BM.util.bool(raw.autoConvertToSmartObject, d.autoConvertToSmartObject);

        c.fitMode = BM.util.oneOf(raw.fitMode, ['contain', 'cover', 'center', 'stretch'], d.fitMode);
        c.paddingPercent = BM.util.number(raw.paddingPercent, d.paddingPercent, 0, 45);
        c.strategy = BM.util.oneOf(raw.strategy, ['auto', 'replaceContents', 'editContents'], d.strategy);

        c.format = BM.util.oneOf(raw.format, ['jpg', 'png'], d.format);
        c.quality = BM.util.number(raw.quality, d.quality, 1, 100);
        c.pngCompression = BM.util.number(raw.pngCompression, d.pngCompression, 0, 9);
        c.maxOutputSize = BM.util.number(raw.maxOutputSize, d.maxOutputSize, 0, 100000);
        c.backgroundFill = BM.util.normalizeHexColor(raw.backgroundFill || '');

        c.namingTemplate = BM.util.trim(raw.namingTemplate) || d.namingTemplate;
        c.filenamePrefix = BM.util.trim(raw.filenamePrefix);
        c.filenameSuffix = BM.util.trim(raw.filenameSuffix);
        if (c.filenamePrefix) { c.filenamePrefix = BM.util.sanitizeFilename(c.filenamePrefix, 60); }
        if (c.filenameSuffix) { c.filenameSuffix = BM.util.sanitizeFilename(c.filenameSuffix, 60); }
        c.overwrite = BM.util.bool(raw.overwrite, d.overwrite);

        c.sort = BM.util.oneOf(raw.sort, ['name', 'nameDesc', 'date', 'dateDesc', 'size'], d.sort);
        c.nameFilter = BM.util.trim(raw.nameFilter || '');
        c.limit = BM.util.number(raw.limit, d.limit, 0, 1000000);
        c.startAt = BM.util.number(raw.startAt, d.startAt, 1, 1000000);

        c.reopenMockupPerDesign = BM.util.bool(raw.reopenMockupPerDesign, d.reopenMockupPerDesign);
        c.delayMs = BM.util.number(raw.delayMs, d.delayMs, 0, 5000);

        c.writeLogFile = BM.util.bool(raw.writeLogFile, d.writeLogFile);
        c.writeCsvReport = BM.util.bool(raw.writeCsvReport, d.writeCsvReport);
        c.logLevel = BM.util.oneOf(raw.logLevel, BM.LOG_ORDER, d.logLevel);

        return c;
    };

    /** Accept either a parsed object or the JSON string the panel sends. */
    api.coerceConfig = function (raw) {
        var parsed;
        if (typeof raw === 'string') {
            try {
                parsed = BM.json.parse(raw);
            } catch (e) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'The settings could not be read: ' + e.message);
            }
        } else {
            parsed = raw || {};
        }
        return parsed;
    };

    /* -------------------------------------------------------------- inspection */

    /**
     * Pre-flight check. Never opens a Photoshop document, so it is instant and
     * safe to call on every keystroke.
     *
     * @return {Object} `{ ok, canRun, checks, counts, warnings, config }`
     */
    api.inspect = function (raw) {
        var config = api.normalize(raw);
        var checks = [];
        var counts = { designs: 0, skipped: 0, filteredOut: 0, limitedTo: 0 };

        function check(id, label, status, detail) {
            checks.push({ id: id, label: label, status: status, detail: detail || '' });
        }

        BM.ps.assertHost();

        /* Mockup */
        var mockupFile = BM.fs.toFile(config.mockupPath);
        if (!config.mockupPath) {
            check('mockup', 'Mockup PSD', 'error', 'No file selected.');
        } else if (!mockupFile.exists) {
            check('mockup', 'Mockup PSD', 'error', 'File not found: ' + BM.fs.fsName(mockupFile));
        } else if (!BM.fs.isSupportedMockup(mockupFile)) {
            check('mockup', 'Mockup PSD', 'error', 'Expected a .psd or .psb file, got “' + mockupFile.name + '”.');
        } else if (!BM.fs.isReadableFile(config.mockupPath)) {
            check('mockup', 'Mockup PSD', 'warn', 'The file looks empty or is locked by another application.');
        } else {
            check('mockup', 'Mockup PSD', 'ok', mockupFile.name + ' · ' + Math.round(mockupFile.length / 1024) + ' KB');
        }

        /* Designs */
        var designsFolder = BM.fs.toFolder(config.designsFolder);
        if (!config.designsFolder) {
            check('designs', 'Designs folder', 'error', 'No folder selected.');
        } else if (!designsFolder || !designsFolder.exists) {
            check('designs', 'Designs folder', 'error', 'Folder not found: ' + config.designsFolder);
        } else {
            var listing = BM.fs.listDesigns(designsFolder, config);
            counts.designs = listing.files.length;
            counts.skipped = listing.skipped.length;
            counts.filteredOut = listing.filteredOut;
            counts.limitedTo = listing.matched;

            if (listing.matched === 0) {
                check('designs', 'Designs folder', 'error', 'No JPG or PNG files found.');
            } else if (listing.files.length === 0) {
                check('designs', 'Designs folder', 'error',
                    listing.matched + ' images matched, but the range/filter excluded all of them.');
            } else {
                var detail = listing.files.length + ' image' + (listing.files.length === 1 ? '' : 's') + ' queued';
                if (listing.matched > listing.files.length) { detail += ' of ' + listing.matched + ' matched'; }
                if (listing.skipped.length) { detail += ' · ' + listing.skipped.length + ' unsupported file' + (listing.skipped.length === 1 ? '' : 's') + ' skipped'; }
                check('designs', 'Designs folder', 'ok', detail);
            }
        }

        /* Output */
        var outputFolder = BM.fs.toFolder(config.outputFolder);
        if (!config.outputFolder) {
            check('output', 'Output folder', 'error', 'No folder selected.');
        } else if (outputFolder && outputFolder.exists) {
            check('output', 'Output folder', 'ok', config.outputFolder + (config.overwrite ? '' : ' · existing files will be kept'));
        } else {
            check('output', 'Output folder', 'warn', 'Will be created on the first run.');
        }

        /* Layer name sanity — the definitive check needs the PSD open. */
        check('layer', 'Target layer', config.autoDetectLayer ? 'ok' : 'warn',
            '“' + config.smartObjectLayer + '”' + (config.autoDetectLayer ? ' · falls back to the only Smart Object if absent' : ' · no fallback'));

        /* Interaction warnings that would otherwise silently surprise people. */
        var warnings = [];
        if (config.strategy === 'replaceContents') {
            if (config.fitMode !== 'contain' || config.paddingPercent > 0) {
                warnings.push('Fit mode and padding are ignored by the “Replace contents” strategy, which keeps the Smart Object’s existing transform. Use “Edit contents” to control the fit.');
            }
            if (config.backgroundFill) {
                warnings.push('The background fill only applies to the “Edit contents” strategy.');
            }
        }
        if (config.strategy === 'auto' &&
                (config.fitMode !== 'contain' || config.paddingPercent > 0 || config.backgroundFill)) {
            warnings.push('Auto will use “Edit contents” for this run so the fit, padding and background settings are applied.');
        }
        if (config.fitMode === 'center' && config.paddingPercent > 0) {
            warnings.push('Padding has no effect with the Center fit mode because the artwork is not scaled.');
        }
        if (config.maxOutputSize > 0) {
            warnings.push('Outputs will be capped to ' + config.maxOutputSize + ' px on the long edge.');
        }

        var failed = 0;
        var i;
        for (i = 0; i < checks.length; i++) {
            if (checks[i].status === 'error') { failed += 1; }
        }

        return {
            ok: true,
            canRun: failed === 0,
            checks: checks,
            counts: counts,
            warnings: warnings,
            config: config
        };
    };

    /* ---------------------------------------------------------------- progress */

    function makeReporter(total, startedAt) {
        var state = { done: 0, succeeded: 0, failed: 0 };

        return {
            state: state,
            progress: function (index, fileName) {
                var elapsed = BM.util.now() - startedAt;
                var average = state.done > 0 ? (elapsed / state.done) : 0;
                var payload = {
                    type: BM.EVENT.PROGRESS,
                    index: index,
                    total: total,
                    done: state.done,
                    succeeded: state.succeeded,
                    failed: state.failed,
                    remaining: Math.max(0, total - state.done),
                    percent: total > 0 ? Math.round((state.done / total) * 100) : 0,
                    file: fileName || '',
                    elapsedMs: elapsed,
                    etaMs: (average > 0 && state.done > 0) ? Math.round(average * (total - state.done)) : -1
                };
                BM.cep.emit(BM.EVENT.PROGRESS, payload);
                return payload;
            }
        };
    }

    /* -------------------------------------------------------------------- run */

    /**
     * Execute the batch.
     *
     * @param {Object|string} raw Panel configuration.
     * @return {Object} Run summary, safe to hand straight back to the panel.
     */
    api.run = function (raw) {
        var config = api.normalize(api.coerceConfig(raw));
        var startedAt = BM.util.now();
        var reporter = null;
        var previousDialogs = null;
        var mockupDoc = null;
        var mockupWasOpenedByUs = false;
        var outputFolder = null;
        var targetLayer = null;
        var results = [];
        var errors = [];
        var cancelled = false;
        var i;

        var summary = {
            ok: false,
            cancelled: false,
            total: 0,
            processed: 0,
            succeeded: 0,
            failed: 0,
            durationMs: 0,
            startedAt: new Date().toString(),
            outputFolder: '',
            logFile: '',
            csvFile: '',
            mockup: null,
            targetLayer: '',
            strategy: config.strategy,
            results: [],
            errors: []
        };

        function recordError(fileName, info) {
            var entry = { design: fileName, code: info.code, message: info.message, detail: info.detail || '' };
            errors.push(entry);
            return entry;
        }

        /** Resolve the Smart Object to work on for the current mockup document. */
        function resolveLayer(doc) {
            var resolved = BM.so.resolveTargetLayer(doc, {
                name: config.smartObjectLayer,
                fallbackNames: config.fallbackLayerNames,
                autoDetect: config.autoDetectLayer
            });
            var layer = resolved.layer;

            if (!BM.so.isSmartObject(layer)) {
                if (config.autoConvertToSmartObject) {
                    BM.log.warn('“' + resolved.resolvedName + '” is not a Smart Object; converting it in place.');
                    layer = BM.so.convertToSmartObject(doc, layer);
                } else {
                    bmFail(
                        BM.ERROR_CODES.LAYER_NOT_SMART,
                        '“' + resolved.resolvedName + '” is a ' + layer.typename + ', not a Smart Object.',
                        'Enable “Convert a matching plain layer to a Smart Object”, or pick a different layer.'
                    );
                }
            }

            if (resolved.matchedBy !== 'name') {
                BM.log.warn('Using “' + resolved.resolvedName + '” (' + resolved.matchedBy + ') instead of “' + config.smartObjectLayer + '”.');
            }
            summary.targetLayer = resolved.resolvedName;
            return layer;
        }

        /** The fast path cannot honour fit, padding or background fill. */
        function needsPrecisePlacement() {
            return config.fitMode !== 'contain' || config.paddingPercent > 0 || !!config.backgroundFill;
        }

        /** Swap the contents, honouring the configured strategy. */
        function applyDesign(doc, layer, designFile) {
            function fastReplace() {
                BM.ps.activateLayer(doc, layer);
                BM.so.replaceContents(layer, designFile);
            }

            function precise() {
                BM.ps.activateLayer(doc, layer);
                var contentsDoc = BM.so.openContents(layer);
                var artwork = null;
                try {
                    artwork = BM.placement.importFileAsLayer(contentsDoc, designFile, 'Bulk Mockup Artwork');
                    BM.placement.removeLayersExcept(contentsDoc, artwork);
                    if (config.backgroundFill) {
                        BM.placement.addBackgroundFill(contentsDoc, config.backgroundFill);
                    }
                    BM.placement.fitAndCenter(contentsDoc, artwork, config);
                } catch (thrown) {
                    BM.so.discardContents(contentsDoc);
                    BM.ps.setActiveDocument(doc);
                    throw thrown;
                }
                BM.so.commitContents(contentsDoc);
                BM.ps.setActiveDocument(doc);
            }

            if (config.strategy === 'editContents') { precise(); return 'editContents'; }
            if (config.strategy === 'replaceContents') { fastReplace(); return 'replaceContents'; }
            if (needsPrecisePlacement()) { precise(); return 'editContents'; }

            try {
                fastReplace();
                return 'replaceContents';
            } catch (thrown) {
                BM.log.debug('Native replace failed (' + (thrown && thrown.message ? thrown.message : thrown) + '); switching to editContents for this file.');
                precise();
                return 'editContents';
            }
        }

        try {
            /* ---------------------------------------------------------- validate */
            BM.ps.assertHost();

            var mockupFile = BM.fs.toFile(config.mockupPath);
            if (!config.mockupPath || !mockupFile.exists) {
                bmFail(BM.ERROR_CODES.MOCKUP_MISSING, config.mockupPath || 'not set');
            }
            if (!BM.fs.isSupportedMockup(mockupFile)) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'The mockup must be a .psd or .psb file, got “' + mockupFile.name + '”.');
            }

            var designsFolder = BM.fs.requireFolder(config.designsFolder, false);
            outputFolder = BM.fs.requireFolder(config.outputFolder, true);
            BM.fs.assertWritable(outputFolder);
            summary.outputFolder = BM.fs.fsName(outputFolder);

            var listing = BM.fs.listDesigns(designsFolder, config);
            if (listing.matched === 0) {
                bmFail(BM.ERROR_CODES.NO_DESIGNS, BM.fs.fsName(designsFolder));
            }
            if (listing.files.length === 0) {
                bmFail(BM.ERROR_CODES.NO_DESIGNS, 'The range or filter excluded every matched image.');
            }

            /* ------------------------------------------------------------ logging */
            var stamp = BM.util.dateStamp() + '_' + BM.util.timeStamp();
            var logPath = config.writeLogFile ? (outputFolder.fsName + '/bulkmockup_' + stamp + '.log') : '';
            BM.log.start({ level: config.logLevel, file: logPath });
            summary.logFile = logPath;

            BM.log.info(BM.APP.NAME + ' v' + BM.APP.VERSION + ' — run started');
            BM.log.info('Mockup: ' + BM.fs.fsName(mockupFile));
            BM.log.info('Designs: ' + listing.files.length + ' image(s) from ' + BM.fs.fsName(designsFolder));
            BM.log.info('Output: ' + BM.fs.fsName(outputFolder) + '  ·  ' + config.format.toUpperCase() + (config.format === 'jpg' ? ' quality ' + config.quality + '%' : ''));
            BM.log.info('Target layer: “' + config.smartObjectLayer + '”  ·  strategy: ' + config.strategy + '  ·  fit: ' + config.fitMode);
            if (listing.skipped.length) {
                BM.log.warn('Skipped ' + listing.skipped.length + ' unsupported file(s): ' + listing.skipped.slice(0, 8).join(', ') + (listing.skipped.length > 8 ? '…' : ''));
            }
            if (config.backgroundFill) {
                BM.log.debug('Background fill: ' + config.backgroundFill);
            }

            /* --------------------------------------------------------------- setup */
            BM.fs.clearCancelFlag();
            previousDialogs = BM.ps.pushQuiet();

            var total = listing.files.length;
            summary.total = total;
            reporter = makeReporter(total, startedAt);

            var opened = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE);
            mockupDoc = opened.doc;
            mockupWasOpenedByUs = !opened.wasAlreadyOpen;

            if (opened.wasAlreadyOpen) {
                BM.log.warn('The mockup was already open in Photoshop. It will be left open, and never saved over.');
            }

            var mockupInfo = BM.ps.size(mockupDoc);
            summary.mockup = {
                name: mockupDoc.name,
                width: Math.round(mockupInfo.width),
                height: Math.round(mockupInfo.height),
                resolution: Math.round(mockupInfo.resolution)
            };
            BM.log.info('Mockup canvas: ' + summary.mockup.width + '×' + summary.mockup.height + ' px @ ' + summary.mockup.resolution + ' ppi');

            if (!config.reopenMockupPerDesign) {
                targetLayer = resolveLayer(mockupDoc);
            }

            BM.cep.emit(BM.EVENT.PROGRESS, {
                type: BM.EVENT.PROGRESS,
                index: 0, total: total, done: 0, succeeded: 0, failed: 0, remaining: total,
                percent: 0, file: '', elapsedMs: 0, etaMs: -1, phase: 'starting'
            });

            /* ----------------------------------------------------------- the loop */
            for (i = 0; i < listing.files.length; i++) {
                var designFile = listing.files[i];
                var position = i + 1;

                if (BM.fs.isCancelRequested()) {
                    cancelled = true;
                    BM.log.warn('Cancellation requested — stopping after ' + reporter.state.done + ' of ' + total + '.');
                    break;
                }

                var itemStartedAt = BM.util.now();
                var result = {
                    index: position,
                    design: designFile.name,
                    status: 'ok',
                    output: '',
                    message: '',
                    durationMs: 0
                };

                try {
                    if (config.reopenMockupPerDesign) {
                        mockupDoc = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE).doc;
                        targetLayer = resolveLayer(mockupDoc);
                    }

                    var strategyUsed = applyDesign(mockupDoc, targetLayer, designFile);

                    var output = BM.exporter.buildOutputFile(outputFolder, designFile, position, config);
                    var written = BM.exporter.save(mockupDoc, output.file, config);

                    result.output = written.path;
                    result.bytes = written.bytes;
                    result.strategy = strategyUsed;
                    if (output.deduplicated) { result.message = 'saved as “' + output.file.name + '” to avoid overwriting'; }
                    if (written.notes && written.notes.length) {
                        result.message = BM.util.trim((result.message ? result.message + ' · ' : '') + written.notes.join(' · '));
                    }

                    reporter.state.succeeded += 1;
                    BM.log.success('[' + position + '/' + total + '] ' + designFile.name + ' → ' + output.file.name +
                        (result.message ? '  (' + result.message + ')' : ''));

                    if (config.reopenMockupPerDesign) {
                        BM.ps.closeDocument(mockupDoc, false);
                        mockupDoc = null;
                    }
                } catch (thrown) {
                    var info = BM.describeError(thrown);
                    result.status = 'failed';
                    result.message = info.message + (info.detail ? ' (' + info.detail + ')' : '');
                    reporter.state.failed += 1;
                    recordError(designFile.name, info);
                    BM.log.error('[' + position + '/' + total + '] ' + designFile.name + ' failed — ' + result.message);
                    if (info.hint) { BM.log.debug('   hint: ' + info.hint); }

                    // A broken Smart Object leaves the mockup in an unknown
                    // state; re-open it so the rest of the batch still has a
                    // chance of succeeding.
                    if (!config.reopenMockupPerDesign) {
                        try {
                            BM.ps.closeDocument(mockupDoc, false);
                        } catch (e) { /* ignored */ }
                        try {
                            mockupDoc = BM.ps.openDocument(mockupFile, BM.ERROR_CODES.MOCKUP_UNREADABLE).doc;
                            targetLayer = resolveLayer(mockupDoc);
                        } catch (e) {
                            BM.log.error('Could not re-open the mockup; aborting the run.');
                            recordError('(mockup)', BM.describeError(e));
                            break;
                        }
                    }
                }

                result.durationMs = BM.util.now() - itemStartedAt;
                results.push(result);
                reporter.state.done += 1;
                reporter.progress(position, designFile.name);

                BM.cep.emit(BM.EVENT.ITEM, {
                    type: BM.EVENT.ITEM,
                    index: position,
                    total: total,
                    design: designFile.name,
                    status: result.status,
                    output: result.output,
                    message: result.message,
                    durationMs: result.durationMs
                });

                BM.cep.breathe(config.delayMs);
            }

            /* ------------------------------------------------------------- finish */
            summary.results = results;
            summary.errors = errors.slice(0, MAX_REPORTED_ERRORS);
            summary.processed = reporter.state.done;
            summary.succeeded = reporter.state.succeeded;
            summary.failed = reporter.state.failed;
            summary.cancelled = cancelled;
            summary.durationMs = BM.util.now() - startedAt;
            summary.ok = !cancelled && reporter.state.failed === 0;

            if (config.writeCsvReport) {
                var csvPath = outputFolder.fsName + '/bulkmockup_' + stamp + '.csv';
                var rows = [];
                for (i = 0; i < results.length; i++) {
                    rows.push({
                        design: results[i].design,
                        status: results[i].status,
                        output: results[i].output,
                        message: results[i].message
                    });
                }
                if (BM.exporter.writeCsvReport(csvPath, rows)) {
                    summary.csvFile = csvPath;
                    BM.log.info('Report written to ' + csvPath);
                }
            }

            BM.log.info('Finished: ' + summary.succeeded + ' exported, ' + summary.failed + ' failed, ' +
                'in ' + BM.util.formatDuration(summary.durationMs));

        } catch (thrown) {
            var failure = BM.describeError(thrown);
            summary.ok = false;
            summary.error = failure;
            BM.log.error(failure.message + (failure.detail ? ' — ' + failure.detail : ''));
            if (failure.hint) { BM.log.debug('   hint: ' + failure.hint); }
        } finally {
            /* ------------------------------------------------------------- cleanup */
            try { BM.ps.popQuiet(previousDialogs); } catch (e) { /* ignored */ }

            if (mockupDoc) {
                if (mockupWasOpenedByUs) {
                    BM.ps.closeDocument(mockupDoc, false);
                    BM.log.debug('Closed the mockup without saving.');
                } else {
                    BM.log.debug('Left the user’s own mockup document open and unsaved.');
                }
                mockupDoc = null;
            }

            try { BM.fs.clearCancelFlag(); } catch (e) { /* ignored */ }

            if (reporter && !summary.durationMs) {
                summary.durationMs = BM.util.now() - startedAt;
                summary.processed = reporter.state.done;
                summary.succeeded = reporter.state.succeeded;
                summary.failed = reporter.state.failed;
            }

            var logLines = 0;
            try { logLines = BM.log.finish(); } catch (e) { /* ignored */ }
            summary.logLines = logLines;

            BM.cep.emit(BM.EVENT.DONE, { type: BM.EVENT.DONE, summary: summary });
        }

        return summary;
    };

    return api;
}());


/* ===== jsx/api.jsx =================================================== */
/**
 * Public API surface.
 *
 * This is the only object the panel ever talks to. Every entry point returns a
 * JSON *string* rather than a raw value, because `CSInterface.evalScript` can
 * only hand a string back across the bridge, and because a JSON envelope means
 * a thrown error can never surface as the dreaded opaque
 * "EvalScript error.".
 *
 * Envelope shape, always:
 *     { "ok": true,  "data":  { … } }
 *     { "ok": false, "error": { code, message, detail, hint } }
 */

var BulkMockup = (function () {

    function respond(envelope) {
        return BM.json.stringify(envelope);
    }

    /** Run `fn` defensively and serialise whatever comes back. */
    function invoke(fn) {
        var envelope = BM.attempt(fn);
        if (!envelope.ok && envelope.error) {
            try { BM.log.error(envelope.error.message); } catch (e) { /* logger may not be running */ }
        }
        return respond(envelope);
    }

    var api = {};

    /* ------------------------------------------------------------- diagnostics */

    /** Cheap liveness probe; the panel calls this on load. */
    api.ping = function () {
        return invoke(function () {
            BM.ps.assertHost();
            return {
                version: BM.APP.VERSION,
                name: BM.APP.NAME,
                host: BM.ps.info(),
                events: BM.cep.available,
                cancelFile: BM.fs.cancelFilePath(),
                tempFolder: Folder.temp.fsName,
                platform: $.os,
                defaults: BM.DEFAULTS,
                supportedImages: BM.SUPPORTED_IMAGE_EXTENSIONS
            };
        });
    };

    /** Current log file path, so the panel can offer "reveal log". */
    api.logInfo = function () {
        return invoke(function () {
            return { path: BM.log.filePath(), lines: BM.log.writtenCount(), events: BM.cep.count() };
        });
    };

    /* ---------------------------------------------------------------- discovery */

    /**
     * List the layers in a mockup, flagging the Smart Objects.
     *
     * Opens the document read-only, then closes it again — and only closes it
     * when this call was the one that opened it.
     *
     * @param {string} mockupPath
     */
    api.listSmartObjectLayers = function (mockupPath) {
        return invoke(function () {
            BM.ps.assertHost();

            var path = BM.fs.normalizePath(mockupPath);
            var file = BM.fs.toFile(path);
            if (!file || !file.exists) {
                bmFail(BM.ERROR_CODES.MOCKUP_MISSING, path || 'not set');
            }
            if (!BM.fs.isSupportedMockup(file)) {
                bmFail(BM.ERROR_CODES.BAD_CONFIG, 'Expected a .psd or .psb file.');
            }

            var previousDialogs = BM.ps.pushQuiet();
            var opened = null;
            try {
                opened = BM.ps.openDocument(file, BM.ERROR_CODES.MOCKUP_UNREADABLE);
                var records = BM.ps.flattenLayers(opened.doc);
                var layers = [];
                var i;
                for (i = 0; i < records.length; i++) {
                    layers.push({
                        name: records[i].name,
                        path: records[i].path,
                        depth: records[i].depth,
                        isGroup: records[i].isGroup,
                        isSmartObject: records[i].isSmartObject,
                        visible: records[i].visible
                    });
                }

                var size = BM.ps.size(opened.doc);
                return {
                    file: file.name,
                    document: {
                        name: opened.doc.name,
                        width: Math.round(size.width),
                        height: Math.round(size.height),
                        resolution: Math.round(size.resolution)
                    },
                    layers: layers,
                    smartObjects: (function () {
                        var out = [];
                        for (var j = 0; j < records.length; j++) {
                            if (records[j].isSmartObject) { out.push(records[j].path); }
                        }
                        return out;
                    }())
                };
            } finally {
                if (opened && !opened.wasAlreadyOpen) {
                    BM.ps.closeDocument(opened.doc, false);
                }
                BM.ps.popQuiet(previousDialogs);
            }
        });
    };

    /* -------------------------------------------------------------- validation */

    /** Pre-flight report. Never modifies anything. */
    api.inspect = function (config) {
        return invoke(function () {
            return BM.batch.inspect(BM.batch.coerceConfig(config));
        });
    };

    /* -------------------------------------------------------------------- run */

    /**
     * Run the batch. Blocks the ExtendScript engine until it finishes; progress
     * arrives in the panel as CEP events on BM.EVENT.CHANNEL.
     */
    api.start = function (config) {
        return invoke(function () {
            return BM.batch.run(BM.batch.coerceConfig(config));
        });
    };

    /* ------------------------------------------------------------ panel helpers */

    /** Path the panel writes to request cancellation. */
    api.cancelPath = function () {
        return invoke(function () {
            return { path: BM.fs.cancelFilePath() };
        });
    };

    /** Clear a stale cancellation flag (panel calls this before every run). */
    api.clearCancel = function () {
        return invoke(function () {
            BM.fs.clearCancelFlag();
            return { cleared: true };
        });
    };

    /** Open a folder in Explorer / Finder. */
    api.revealFolder = function (path) {
        return invoke(function () {
            var folder = BM.fs.toFolder(path);
            if (!folder || !folder.exists) {
                bmFail(BM.ERROR_CODES.OUTPUT_UNWRITABLE, path || 'not set');
            }
            folder.execute();
            return { path: folder.fsName };
        });
    };

    /** Open a file's containing folder and select nothing more than that. */
    api.revealFile = function (path) {
        return invoke(function () {
            var file = BM.fs.toFile(path);
            if (!file || !file.exists) {
                bmFail(BM.ERROR_CODES.OUTPUT_UNWRITABLE, path || 'not set');
            }
            file.parent.execute();
            return { path: BM.fs.fsName(file) };
        });
    };

    /**
     * Persist the panel's own console, for bug reports.
     *
     * @param {Object} options `{ folder, text }`
     */
    api.savePanelLog = function (options) {
        return invoke(function () {
            // The panel passes a JSON string here, not an object.
            options = BM.batch.coerceConfig(options);
            var folder = BM.fs.toFolder(options.folder);
            if (!folder || !folder.exists) {
                folder = Folder.temp;
            }
            var file = new File(folder.fsName + '/bulkmockup_panel_' + BM.util.dateStamp() + '_' + BM.util.timeStamp() + '.log');
            if (!BM.fs.writeText(BM.fs.fsName(file), String(options.text || ''))) {
                bmFail(BM.ERROR_CODES.OUTPUT_NOT_WRITABLE, BM.fs.fsName(file));
            }
            return { path: BM.fs.fsName(file) };
        });
    };

    /** Environment summary for the About dialog. */
    api.about = function () {
        return invoke(function () {
            BM.ps.assertHost();
            var info = BM.ps.info();
            return {
                name: BM.APP.NAME,
                version: BM.APP.VERSION,
                tagline: BM.APP.TAGLINE,
                host: info.name + ' ' + info.version + ' (build ' + info.build + ')',
                events: BM.cep.available,
                defaults: BM.DEFAULTS
            };
        });
    };

    /* ------------------------------------------------------- panel-free running */

    /**
     * Interactive run for people who are not using the panel.
     *
     * This is what `jsx/standalone/BulkMockupStandalone.jsx` calls: it asks for
     * the three paths and the layer name with the native ExtendScript dialogs,
     * then runs the exact same engine the panel uses. It is the closest thing
     * to the original `bulkMockup.jsx`, minus the sharp edges.
     */
    api.runInteractive = function () {
        BM.ps.assertHost();
        BM.fs.clearCancelFlag();

        var mockupFile = File.openDialog('Choose the mockup PSD (contains the Smart Object)');
        if (!mockupFile) { return; }
        if (!BM.fs.isSupportedMockup(mockupFile)) {
            alert('That is not a .psd or .psb file.\n\n' + mockupFile.fsName);
            return;
        }

        var designsFolder = Folder.selectDialog('Choose the folder containing your designs');
        if (!designsFolder) { return; }

        var outputFolder = Folder.selectDialog('Choose where to write the finished mockups');
        if (!outputFolder) { return; }

        var layerName = prompt('Name of the Smart Object layer to replace:', BM.DEFAULTS.smartObjectLayer);
        if (layerName === null) { return; }

        var summary = BM.batch.run({
            mockupPath: mockupFile.fsName,
            designsFolder: designsFolder.fsName,
            outputFolder: outputFolder.fsName,
            smartObjectLayer: layerName,
            writeLogFile: true,
            writeCsvReport: true
        });

        var message = summary.error
            ? ('Could not run:\n\n' + summary.error.message + (summary.error.detail ? '\n\n' + summary.error.detail : ''))
            : (summary.succeeded + ' of ' + summary.total + ' exported in ' + BM.util.formatDuration(summary.durationMs) +
                (summary.failed ? ('\n' + summary.failed + ' failed — see the CSV report.') : '') +
                '\n\nOutput: ' + summary.outputFolder +
                (summary.cancelled ? '\n\n(cancelled)' : ''));

        alert(message);
        return summary;
    };

    return api;
}());


