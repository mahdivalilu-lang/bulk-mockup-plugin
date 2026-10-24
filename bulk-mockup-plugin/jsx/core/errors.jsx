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
