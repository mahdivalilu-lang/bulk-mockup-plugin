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
