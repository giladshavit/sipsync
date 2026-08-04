// Post-export step: inject social/link-preview tags into dist/index.html.
//
// These tags must be present in the raw exported HTML — link-preview
// scrapers (WhatsApp, iMessage, Slack, etc.) never execute JavaScript, so
// runtime injection (the AdSenseScript.tsx approach) can't work for them.
// app/+html.tsx can't do it either: this app exports in SPA ("single")
// mode, where Expo ignores that file entirely. So the build script runs
// this after `expo export`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITE = 'https://www.quicklegame.com';
const TITLE = 'Quickle — The Party Drinking Game';
const DESCRIPTION =
  'Join a room from your phone and battle your friends in fast mini-games. Loser drinks.';

const TAGS = [
  `<meta name="description" content="${DESCRIPTION}" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="Quickle" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${DESCRIPTION}" />`,
  `<meta property="og:url" content="${SITE}/" />`,
  `<meta property="og:image" content="${SITE}/og-image.png" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="${TITLE}" />`,
  `<meta name="twitter:description" content="${DESCRIPTION}" />`,
  `<meta name="twitter:image" content="${SITE}/og-image.png" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />`,
].join('\n    ');

const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
const html = readFileSync(indexPath, 'utf8');

if (!html.includes('</head>')) {
  console.error('inject-head-tags: no </head> found in dist/index.html — aborting');
  process.exit(1);
}
if (html.includes('og:image')) {
  console.log('inject-head-tags: tags already present, skipping');
  process.exit(0);
}

writeFileSync(indexPath, html.replace('</head>', `    ${TAGS}\n  </head>`));
console.log('inject-head-tags: injected social meta + apple-touch-icon into dist/index.html');
