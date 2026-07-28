#!/usr/bin/env node
import { chromium } from 'playwright';

function parseArgs(argv) {
  const [url, outputPath, ...rest] = argv;
  const opts = { width: 420, height: 900, wait: 'networkidle', fullPage: false };
  for (const arg of rest) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'width' || key === 'height') opts[key] = parseInt(value, 10);
    else if (key === 'wait') opts.wait = value;
    else if (key === 'fullPage') opts.fullPage = value !== 'false';
  }
  return { url, outputPath, opts };
}

const { url, outputPath, opts } = parseArgs(process.argv.slice(2));

if (!url || !outputPath) {
  console.error('Usage: node scripts/screenshot.mjs <url> <output.png> [--width=420] [--height=900] [--wait=networkidle|load|domcontentloaded] [--fullPage=true]');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});

await page.goto(url, { waitUntil: opts.wait });
await page.screenshot({ path: outputPath, fullPage: opts.fullPage });
await browser.close();

console.log(`Saved screenshot to ${outputPath}`);
