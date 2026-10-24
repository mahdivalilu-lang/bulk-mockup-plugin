/**
 * Static file server for the panel preview.
 *
 * `tools/preview/panel-preview.html` needs to `fetch` the real
 * `client/index.html`, which browsers refuse to do over `file://`. This serves
 * the repository root so the preview behaves exactly as it would inside CEP.
 *
 * Run with:  npm run preview        (opens your default browser)
 *            npm run preview -- --no-open --port 8137
 *
 * Development only — nothing here is part of the extension.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 8137;
const OPEN = !argv.includes('--no-open');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.log': 'text/plain; charset=utf-8'
};

const server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.join(ROOT, requested);

    // Never serve anything outside the repository.
    if (!target.startsWith(ROOT)) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(target, (error, stats) => {
        if (error || !stats.isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + requested);
            return;
        }
        response.writeHead(200, {
            'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(target).pipe(response);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}/tools/preview/panel-preview.html`;
    console.log(`Bulk Mockup preview: ${url}\n(Ctrl+C to stop)`);

    if (OPEN) {
        const command = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        execFile(command, args, () => { /* the user can open it manually if this fails */ });
    }
});
