/**
 * Generates a standalone, top-level copy of the panel for screenshots.
 *
 * `panel-preview.html` uses an iframe, which is the right shape for interactive
 * development but awkward to capture and to script. This produces a flat page
 * with the same substitutions so the panel can be opened directly, driven with
 * `__populate()` / `__stream()`, and captured with a plain page screenshot.
 *
 * Output: tools/preview/panel-shot.html  (generated, git-ignored)
 *
 * Run with:  npm run preview:shot
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'client', 'index.html');
const TARGET = path.join(ROOT, 'tools', 'preview', 'panel-shot.html');

const html = fs.readFileSync(SOURCE, 'utf8');

const patched = html
    .replace('<head>', '<head>\n<base href="/" />')
    .replace('src="lib/CSInterface.js"', 'src="tools/preview/mock-cep.js"')
    .replace(/(src|href)="css\//g, '$1="client/css/')
    .replace(/(src|href)="js\//g, '$1="client/js/')
    .replace(/src="\.\.\/assets\//g, 'src="assets/')
    .replace('</head>',
        '<style>html,body{width:400px;height:780px;overflow:hidden;}' +
        'main{overflow-y:auto;}body{align-items:stretch;}</style></head>');

fs.writeFileSync(TARGET, patched, 'utf8');
console.log(`wrote ${path.relative(ROOT, TARGET).replace(/\\/g, '/')} (${(patched.length / 1024).toFixed(1)} KB)`);
