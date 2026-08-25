#!/usr/bin/env node
// Tutorial fit gate: every game's tutorial must show its cue line, its phone
// mockup AND its who-drinks chips without scrolling, at every screen size we
// support.
//
// This is not a style preference. The in-round tutorial
// (app/room/[code]/tutorial.tsx) auto-advances after a fixed 6-11s, so content
// below the fold is content the player never sees — the chips explaining when
// they drink a chaser were landing up to 105px below the bottom of the window
// on a 375x667 screen (issue #131).
//
// Measures BOTH hosts rather than modelling one from the other. They differ by
// more than they look: the in-round screen spends ~31px on its countdown bar
// but saves ~66px by having no back/replay button row, so it actually gets a
// *taller* stage than the preview (520px vs 477px at 375x667), not a shorter
// one. Its route renders fine headlessly — the socket fails to connect and the
// layout doesn't care, since the game is read from the tutorialAsset param.
//
//   npm run check:tutorials
//   node scripts/tutorial-fit.mjs --url=https://...     (against a deployment)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serveDist, ROOT } from './lib/static-server.mjs';

// Content must end at least this far above the bottom of its scroll box. Zero
// would mean "not technically clipped" while sitting flush against the edge;
// this is the smallest gap that still reads as deliberate.
const MIN_SLACK_PX = 8;

// Real logical sizes, smallest first. The 1280x600 entry is not a phone: it is
// a laptop browser window with devtools or a shallow window open, which is how
// the web build actually gets used and the harshest case in the set.
const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 13 mini', width: 375, height: 812 },
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { name: 'short laptop window', width: 1280, height: 600 },
];

// Both screens that render a tutorial. `path` takes the game id.
const HOSTS = [
  { name: 'preview', path: (id) => `/games/${id}/tutorial` },
  {
    name: 'in-round',
    path: (id) =>
      `/room/SMOKE1/tutorial?tutorialType=animation&tutorialAsset=tutorial.${id}`,
  },
];

async function gameIds() {
  const src = await readFile(join(ROOT, 'constants/games.ts'), 'utf8');
  return [...new Set([...src.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
}

const urlArg = process.argv.find((a) => a.startsWith('--url='));
let base = urlArg ? urlArg.slice('--url='.length).replace(/\/$/, '') : null;
let server = null;
if (!base) {
  server = await serveDist();
  base = server.base;
}

const ids = await gameIds();
const browser = await chromium.launch();
const failures = [];

for (const vp of VIEWPORTS) {
  for (const host of HOSTS) {
  const results = [];
  for (const id of ids) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${host.path(id)}`, { waitUntil: 'networkidle' });
      // Tutorial stories animate for several seconds and freeze on their final
      // frame — measure the frame the player is left looking at, and the one
      // whose layout is tallest.
      await page.waitForTimeout(2500);
      const m = await page.evaluate(() => {
        // The stage's contentContainer has flexGrow: 1, so scrollHeight is
        // pinned to clientHeight whenever the content fits and tells you
        // nothing. Measure where the content actually ends instead: the
        // lowest rendered text inside the scroll box is the last chip label.
        const scroller = [...document.querySelectorAll('div')].find(
          (el) =>
            ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
            el.clientHeight > 0,
        );
        if (!scroller) return null;
        const box = scroller.getBoundingClientRect();
        let lowest = -Infinity;
        let label = null;
        for (const el of scroller.querySelectorAll('div, span')) {
          if (el.children.length || !el.textContent.trim()) continue;
          const r = el.getBoundingClientRect();
          if (r.height && r.bottom > lowest) {
            lowest = r.bottom;
            label = el.textContent.trim().slice(0, 20);
          }
        }
        if (lowest === -Infinity) return null;
        return {
          // Positive = content ends this far above the bottom of the box.
          slack: Math.round(box.bottom - lowest),
          label,
        };
      });
      if (!m) throw new Error('no scroll container / no content found — page did not render');
      results.push({ id, ...m });
      if (m.slack < MIN_SLACK_PX) {
        failures.push({ vp: vp.name, host: host.name, id, slack: m.slack, label: m.label });
      }
    } catch (e) {
      results.push({ id, error: String(e).split('\n')[0].slice(0, 90) });
      failures.push({ vp: vp.name, host: host.name, id, error: true });
    }
    await ctx.close();
  }

  const bad = results.filter((r) => r.error || r.slack < MIN_SLACK_PX);
  console.log(
    `${bad.length ? 'FAIL' : 'PASS'}  ${vp.name.padEnd(20)} ${String(vp.width + 'x' + vp.height).padEnd(9)} ${host.name.padEnd(8)}` +
      (bad.length ? ` — ${bad.map((b) => b.id).join(', ')}` : ''),
  );
  for (const b of bad) {
    console.log(
      b.error
        ? `        ${b.id}: ${b.error}`
        : `        ${b.id}: last content ("${b.label}") ends ${b.slack}px above the box bottom, needs ${MIN_SLACK_PX}px`,
    );
  }
  }
}

await browser.close();
server?.close();

console.log(
  failures.length
    ? `\n${failures.length} tutorial/viewport combination(s) do not fit`
    : `\nAll ${ids.length} tutorials fit on both hosts at all ${VIEWPORTS.length} viewports`,
);
process.exit(failures.length ? 1 : 0);
