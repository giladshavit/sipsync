#!/usr/bin/env node
// Web smoke: serve dist/ (or hit --url=<base>) and assert three static
// screens render with no runtime errors. Used as the pass/fail gate for
// every SDK upgrade hop and for the Vercel preview before merge.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
};

// Each check: path, and a text the screen must show once it has rendered.
const CHECKS = [
  { path: '/', expect: 'Quickle' },             // home page
  { path: '/games', expect: 'Games' },          // catalog index
  { path: '/privacy', expect: 'Privacy Policy' },
];

const urlArg = process.argv.find((a) => a.startsWith('--url='));
let base = urlArg ? urlArg.slice('--url='.length).replace(/\/$/, '') : null;
let server = null;

if (!base) {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.startsWith('/_vercel/')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('');
    }
    let file = join(DIST, path);
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      if (extname(path)) { res.writeHead(404); return res.end(); }
      file = join(DIST, 'index.html'); // SPA fallback for routes, same as vercel.json rewrite
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

const browser = await chromium.launch();
let failures = 0;
for (const check of CHECKS) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  try {
    await page.goto(`${base}${check.path}`, { waitUntil: 'networkidle' });
    await page.getByText(check.expect, { exact: false }).first().waitFor({ timeout: 15000 });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`PASS ${check.path}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${check.path}\n  ${String(e).split('\n').join('\n  ')}`);
  }
  await context.close();
}
await browser.close();
server?.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
