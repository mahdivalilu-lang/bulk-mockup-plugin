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
