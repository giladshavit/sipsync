#!/usr/bin/env node
// Web smoke: serve dist/ (or hit --url=<base>) and assert static screens
// render with no runtime errors. Used as the pass/fail gate for every SDK
// upgrade hop and for the Vercel preview before merge.
// The local server mimics Vercel's cleanUrls + vercel.json rewrites — see
// lib/static-server.mjs.
import { chromium } from 'playwright';
import { serveDist } from './lib/static-server.mjs';

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
  server = await serveDist();
  base = server.base;
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
