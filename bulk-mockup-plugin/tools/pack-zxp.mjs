/**
 * Packages the extension as a signed .zxp for distribution.
 *
 * A .zxp is a ZIP with an Adobe signature in it, so this defers to Adobe's own
 * ZXPSignCmd rather than reimplementing zip+signing with a dependency. If the
 * tool is not on PATH we say exactly how to get it instead of producing a file
 * that silently fails to install.
 *
 * Run with:  npm run pack
 *
 * Environment:
 *   ZXPSIGNCMD   full path to ZXPSignCmd(.exe)
 *   CERT_P12     path to your .p12 signing certificate
 *   CERT_PASS    its password
 *   CERT_TSA     RFC-3161 timestamp server (defaults to DigiCert's)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE_ID = 'com.bulkmockup.panel';

/** Everything the installed extension actually needs. */
const INCLUDE = ['CSXS', 'client', 'jsx', 'assets', 'README.md', 'LICENSE'];

function findSignTool() {
    if (process.env.ZXPSIGNCMD && fs.existsSync(process.env.ZXPSIGNCMD)) {
        return process.env.ZXPSIGNCMD;
    }
    const executable = process.platform === 'win32' ? 'ZXPSignCmd.exe' : 'ZXPSignCmd';
    try {
        execFileSync(executable, ['-help'], { stdio: 'ignore' });
        return executable;
    } catch {
        return null;
    }
}

function stage() {
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });

    const staging = path.join(DIST, `${BUNDLE_ID}.stage`);
    fs.mkdirSync(staging, { recursive: true });

    for (const entry of INCLUDE) {
        const from = path.join(ROOT, entry);
        if (!fs.existsSync(from)) {
            throw new Error(`missing required file: ${entry}`);
        }
        fs.cpSync(from, path.join(staging, entry), { recursive: true });
    }
    return staging;
}

const staging = stage();
console.log(`staged ${INCLUDE.length} entries in dist/${BUNDLE_ID}.stage`);

const signTool = findSignTool();
if (!signTool) {
    console.log(`
ZXPSignCmd was not found, so no .zxp was produced.

Install it, then re-run \`npm run pack\`:

  Windows  https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/win64/ZXPSignCmd.exe
  macOS    https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/mac64/ZXPSignCmd

Or point at it explicitly:

  $ZXPSIGNCMD=/path/to/ZXPSignCmd npm run pack

The staged folder above is already a valid unsigned extension — see
docs/INSTALL.md for the manual install path, which needs no certificate.
`);
    process.exit(0);
}

const certificate = process.env.CERT_P12;
const password = process.env.CERT_PASS;
const tsa = process.env.CERT_TSA || 'http://timestamp.digicert.com';
const output = path.join(DIST, `${BUNDLE_ID}.zxp`);

if (!certificate || !password) {
    // -selfSignedCert <country> <province> <org> <name> <password> <output.p12>
    const selfSigned = path.join(DIST, 'self-signed.p12');
    console.log('CERT_P12/CERT_PASS not set — generating a self-signed certificate for local testing.');
    execFileSync(signTool, [
        '-selfSignedCert', 'US', 'CA', 'Bulk Mockup', 'Bulk Mockup Dev', 'bulkmockup', selfSigned
    ], { stdio: 'inherit' });

    execFileSync(signTool, ['-sign', staging, output, selfSigned, 'bulkmockup', '-tsa', tsa], { stdio: 'inherit' });
} else {
    execFileSync(signTool, ['-sign', staging, output, certificate, password, '-tsa', tsa], { stdio: 'inherit' });
}

// Verify what we just produced; a broken ZXP is worse than no ZXP.
execFileSync(signTool, ['-verify', output, '-certInfo'], { stdio: 'inherit' });

const size = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
console.log(`\nsigned ${path.relative(ROOT, output)} (${size} MB)${os.EOL}`);
