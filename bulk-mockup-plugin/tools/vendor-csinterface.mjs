/**
 * Refreshes the vendored copy of Adobe's CSInterface.js.
 *
 * CSInterface is shipped, unmodified, rather than pulled in at build time:
 * a CEP extension has no bundler and no node_modules at runtime, so the file
 * has to be present in the repository. This script exists so that "present"
 * also means "reproducible".
 *
 * Run with:  npm run vendor:csinterface
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'client', 'lib', 'CSInterface.js');

const HEADER = `/*
 * CSInterface.js
 *
 * Vendored, unmodified, from Adobe's CEP Resources repository:
 *   ${SOURCE}
 *
 * Regenerate with:  npm run vendor:csinterface
 * Only imported as-is; treat any local edit as a bug.
 */

`;

const response = await fetch(SOURCE);
if (!response.ok) {
    throw new Error(`could not download CSInterface.js — HTTP ${response.status}`);
}

const body = await response.text();
if (!/CSInterface/.test(body) || body.length < 10_000) {
    throw new Error(`downloaded file does not look like CSInterface.js (${body.length} bytes)`);
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, HEADER + body, 'utf8');

console.log(`vendored CSInterface.js (${(body.length / 1024).toFixed(1)} KB) -> client/lib/CSInterface.js`);
