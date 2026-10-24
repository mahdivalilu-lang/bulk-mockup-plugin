/**
 * Builds the single-file ExtendScript bundle.
 *
 * `jsx/index.jsx` uses `#include`, which Photoshop resolves happily but most
 * other ExtendScript hosts (ExtendScript Toolkit, `app.doScript`, `.jsxbin`
 * tooling, other Adobe apps) handle inconsistently. This flattens the tree into
 * one file that runs anywhere — including as a straight replacement for the
 * original `bulkMockup.jsx`.
 *
 * Outputs:
 *   jsx/engine.jsx                        — CEP `ScriptPath` (no entry call)
 *   jsx/standalone/BulkMockupStandalone.jsx — File > Scripts (runs interactively)
 *
 * CEP evaluates `ScriptPath` as a *string*, not with `$.evalFile`, so
 * `#include` cannot resolve relative to the file there. The CEP entry must
 * therefore be fully flattened — which is exactly what `jsx/engine.jsx` is.
 *
 * Run with:  npm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'jsx', 'index.jsx');
const OUTPUT = path.join(ROOT, 'jsx', 'standalone', 'BulkMockupStandalone.jsx');
const ENGINE_OUTPUT = path.join(ROOT, 'jsx', 'engine.jsx');

/** Resolve `#include "x.jsx"` relative to the file that contains it. */
function expand(filePath, seen = new Set()) {
    if (seen.has(filePath)) {
        throw new Error(`circular #include: ${path.relative(ROOT, filePath)}`);
    }
    seen.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const chunks = [`/* ===== ${relative} ${'='.repeat(Math.max(1, 62 - relative.length))} */`];

    for (const line of source.split(/\r?\n/)) {
        const match = /^\s*#include\s+"([^"]+)"\s*$/.exec(line);
        if (match) {
            const resolved = path.resolve(path.dirname(filePath), match[1]);
            if (!fs.existsSync(resolved)) {
                throw new Error(`#include not found: ${match[1]} (from ${relative})`);
            }
            chunks.push(expand(resolved, seen));
            continue;
        }
        chunks.push(line);
    }

    seen.delete(filePath);
    return chunks.join('\n');
}

const body = expand(ENTRY);

const banner = `/*
 * Bulk Mockup v1.0.0 — single-file ExtendScript build.
 *
 * GENERATED FILE. Do not edit by hand: edit the modules under jsx/ and run
 * \`npm run build\`. Source of truth lives in jsx/core, jsx/modules,
 * jsx/services and jsx/api.jsx.
 *
 * How to use this file
 * --------------------
 *   Photoshop > File > Scripts > Browse…  and pick this file. You will be
 *   asked for the mockup PSD, the designs folder, the output folder and the
 *   Smart Object layer name, then the batch runs with the same engine the
 *   panel uses (including the log file and the per-run CSV report).
 *
 *   The final line of this file is the entry call. Delete it if you would
 *   rather drive \`BulkMockup.*\` yourself from another script.
 *
 *   For the CEP panel, use jsx/engine.jsx instead — it is the same code
 *   without the entry call, because CEP loads it as the panel's ScriptPath.
 */

`;

const footer = `
/* ===== entry point ${'='.repeat(48)} */
BulkMockup.runInteractive();
`;

const engineBanner = `/*
 * Bulk Mockup v1.0.0 — CEP engine (generated).
 *
 * GENERATED FILE. Do not edit by hand: edit the modules under jsx/ and run
 * \`npm run build\`.
 *
 * This is the manifest's \`ScriptPath\`. CEP reads this file and evaluates its
 * *contents* as a script string, so it must be self-contained: a relative
 * \`#include\` would be resolved against Photoshop's working directory and fail.
 * That is why the includes are flattened here, and why there is no entry call
 * at the bottom — the panel drives the API with \`evalScript\` calls.
 */

`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, banner + body + '\n' + footer, 'utf8');
fs.writeFileSync(ENGINE_OUTPUT, engineBanner + body + '\n', 'utf8');

const sizeKb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
const engineKb = (fs.statSync(ENGINE_OUTPUT).size / 1024).toFixed(1);
console.log(`built ${path.relative(ROOT, OUTPUT).replace(/\\/g, '/')} (${sizeKb} KB)`);
console.log(`built ${path.relative(ROOT, ENGINE_OUTPUT).replace(/\\/g, '/')} (${engineKb} KB)`);
