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

#include "lib/json2.jsx"

#include "core/constants.jsx"
#include "core/errors.jsx"
#include "core/utils.jsx"
#include "core/cep.jsx"
#include "core/logger.jsx"

#include "modules/fileSystem.jsx"
#include "modules/photoshop.jsx"
#include "modules/smartObject.jsx"
#include "modules/placement.jsx"
#include "modules/exporter.jsx"

#include "services/batchRunner.jsx"

#include "api.jsx"
