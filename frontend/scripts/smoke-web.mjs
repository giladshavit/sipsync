#!/usr/bin/env node
// Web smoke: serve dist/ (or hit --url=<base>) and assert static screens
// render with no runtime errors. Used as the pass/fail gate for every SDK
// upgrade hop and for the Vercel preview before merge.
// Server mimics Vercel's cleanUrls static hosting: /privacy → privacy.html, /games → games/index.html.
// It also mimics vercel.json's `rewrites` (dynamic routes like /games/:id
// that aren't all prerendered) by loading that file's rewrite table and
// resolving a matched destination through the same cleanUrls candidates.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
};

// vercel.json rewrites, e.g. { source: '/games/:id', destination: '/games/_id_' }
// — turn each :param source segment into a [^/]+ regex group. Destinations
// here are already literal (post-export renames [id] -> _id_), so no
// substitution back into the destination is needed, just a match test.
const { rewrites = [] } = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const REWRITES = rewrites.map((r) => ({
  pattern: new RegExp(`^${r.source.replace(/:[^/]+/g, '[^/]+')}$`),
  destination: r.destination,
}));

// Each check: path, and a text the screen must show once it has rendered.
const CHECKS = [
  { path: '/', expect: 'Quickle' },             // home page
  { path: '/games', expect: 'Games' },          // catalog index
  { path: '/privacy', expect: 'Privacy Policy' },
  { path: '/games/reflex', expect: 'tap as fast as you can' }, // dynamic /games/:id rules page
  { path: '/games/reflex/tutorial', expect: 'Green Light' },   // dynamic /games/:id/tutorial page
];

const urlArg = process.argv.find((a) => a.startsWith('--url='));
let base = urlArg ? urlArg.slice('--url='.length).replace(/\/$/, '') : null;
let server = null;

if (!base) {
  async function exists(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.startsWith('/_vercel/')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('');
    }

    let file = null;
    if (extname(path)) {
      if (await exists(join(DIST, path))) file = join(DIST, path);
      else { res.writeHead(404); return res.end(); } // Missing asset: plain 404
    } else {
      // Vercel cleanUrls: /privacy → privacy.html, /games → games/index.html, / → index.html
      for (const candidate of [join(DIST, `${path}.html`), join(DIST, path, 'index.html')]) {
        if (await exists(candidate)) { file = candidate; break; }
      }
      if (!file) {
        // Not a static file — try vercel.json's rewrites (dynamic routes,
        // e.g. an un-prerendered /games/:id), resolving the destination
        // through the same cleanUrls candidates as above.
        const rewrite = REWRITES.find((r) => r.pattern.test(path));
        if (rewrite) {
          for (const candidate of [join(DIST, `${rewrite.destination}.html`), join(DIST, rewrite.destination, 'index.html')]) {
            if (await exists(candidate)) { file = candidate; break; }
          }
        }
      }
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(await readFile(join(DIST, '404.html')).catch(() => ''));
      }
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
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
    // Let the page settle briefly after its expected text appears — some
    // runtime errors (e.g. a delayed hydration mismatch) surface just after
    // the initial render, not at it.
    await page.waitForTimeout(1500);
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
