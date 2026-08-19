// Post-export step for the static web build (web.output: "static").
// 1. Renames bracket route segments ([code] -> _code_) so vercel.json
//    rewrites never depend on how Vercel parses literal brackets.
// 2. Copies +not-found.html to 404.html (Vercel serves 404.html natively).
// 3. Content tripwire: static rendering is the whole point of this build —
//    if a route ships an empty shell again (e.g. someone reverts web.output
//    or a render-time browser-global sneaks in), fail the build loudly.
import { readFileSync, readdirSync, renameSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Naming note: a route with child routes exports as <name>/index.html
// (games/, games/reflex/), a leaf route exports flat (privacy.html).
const CHECKS = [
  // Needles must be single static JSX text nodes — SSR splits interpolated
  // text with <!-- --> comments, so "See all 15 games" never appears joined.
  { file: 'index.html', mustContain: ['How it works', 'Create a room', 'Loser drinks', 'drink responsibly'] },
  { file: 'games/index.html', mustContain: ['Speed', 'Luck', 'Strategy'] },
  { file: 'games/reflex/index.html', mustContain: ['tap as fast as you can'] },
  { file: 'privacy.html', mustContain: ['Privacy Policy', 'No account, email, phone number'] },
];

function renameBracketSegments(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) renameBracketSegments(from);
    const safe = entry.name.replace(/\[(.+)\]/, '_$1_');
    if (safe !== entry.name) renameSync(from, join(dir, safe));
  }
}
renameBracketSegments(DIST);

const notFound = join(DIST, '+not-found.html');
if (existsSync(notFound)) copyFileSync(notFound, join(DIST, '404.html'));

// Expo Router's built-in route-listing page — a dev tool, not a page the
// live site should serve.
rmSync(join(DIST, '_sitemap.html'), { force: true });

const failures = [];
for (const { file, mustContain } of CHECKS) {
  const path = join(DIST, file);
  if (!existsSync(path)) {
    failures.push(`${file}: missing from dist/`);
    continue;
  }
  const html = readFileSync(path, 'utf8');
  for (const needle of mustContain) {
    if (!html.includes(needle)) failures.push(`${file}: expected text not in exported HTML: "${needle}"`);
  }
}
if (failures.length) {
  console.error('post-export tripwire failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('post-export: bracket segments renamed, 404.html placed, content tripwire passed');
