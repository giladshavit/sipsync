// Instagram carousels that explain one mini-game each — rendered as HTML with
// the app's own visual language and screenshotted by Playwright.
//
//   cd frontend && node scripts/ig-game-posts.mjs [game-slug ...]
//
// Writes docs/marketing/instagram/<game>/01..NN.png (1080x1350) and a
// caption.md. Five slides per game: the cover (the game's catalog tile, big),
// one slide per rule with the matching screenshot in a closed frame, and
// "Who drinks" as the tutorial's chips. Text is the catalog's
// (constants/games.ts); screenshots come from docs/marketing/shots/<game>/
// (raw 1290x2796 iPhone captures). Overlays are drawn in the capture's own
// coordinates with the app's colours, for game states we have no capture of.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(FRONTEND, '..');
const OUT = process.env.OUT_DIR ?? path.join(REPO, 'docs/marketing/instagram');
const SHOTS = path.join(REPO, 'docs/marketing/shots');
const ICONS = path.join(FRONTEND, 'node_modules/lucide-react-native/dist/esm/icons');

const W = 1080;
const H = 1350;
const FRAME = { left: 90, top: 440, w: 900, h: 820 }; // the screenshot frame on a step slide

// constants/design.ts
const C = {
  ink: '#0A0A0F', surface: '#131320', rim: '#252538', chalk: '#F0F0E8', fog: '#64748B',
  amber: '#F59E0B', stop: '#DC2626', go: '#16A34A', cream: '#FFF8E1', sand: '#E4D9BE', dune: '#A8977A',
  paper: '#FFFDF5', amberDeep: '#B45309', yellowDeep: '#D19F07', chipDesc: '#5C5243',
};

// PNG header: width at bytes 16-19, height at 20-23 (big-endian).
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------- Lucide: the icon node data → inline SVG ----------
function lucide(name, { size, color, strokeWidth = 2 }) {
  const src = fs.readFileSync(path.join(ICONS, `${name}.mjs`), 'utf8');
  const literal = src.slice(src.indexOf('", [') + 3, src.lastIndexOf(']);') + 1);
  const nodes = new Function(`return ${literal}`)();
  const body = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const green = (t) => `<span style="color:${C.go}">${t}</span>`;
const amber = (t) => `<span style="color:${C.amberDeep}">${t}</span>`;
const yellow = (t) => `<span style="color:${C.yellowDeep}">${t}</span>`;
const red = (t) => `<span style="color:${C.stop}">${t}</span>`;

// ---------- The games ----------
// steps[].window: the raw region to show, fitted whole inside the frame.
// steps[].overlays: drawn over the capture in raw coordinates —
//   card    a revealed Roulette card (the app's own style) at x,y with points + name
//   cover   a rectangle in a flat colour, e.g. to hide a name before re-drawing it
//   text    a line of text in the capture's type
//   patch   copy one raw region of the same capture over another
//   skip    the Skip button, enabled (the captures only have it greyed out)
const GAMES = {
  roulette: {
    title: 'Russian Roulette',
    icon: 'skull',
    accent: '#DC2626',
    screenBg: 'rgb(34,30,26)',
    subtitle: 'Avoid the poison',
    steps: [
      {
        caption: `6 cards. 1 is ${red('poison')}!`,
        shot: '01-cards.png',
        window: { x: 0, y: 1060, w: 1290, h: 1170 },
        overlays: [{ type: 'patch', from: { x: 459, y: 1083 }, to: { x: 63, y: 1083 }, w: 370, h: 549 }],
      },
      {
        // 1179x2556 capture: your turn, three cards revealed, Skip lit
        caption: `On your turn: ${green('flip')} or ${yellow('skip')}`,
        shot: '02-your-turn.png',
        bg: 'rgb(32,41,30)',
        window: { x: 0, y: 960, w: 1179, h: 1384 },
        overlays: [
          { type: 'cover', x: 500, y: 1322, w: 180, h: 56, color: 'rgb(19,19,32)' },
          { type: 'text', x: 430, y: 1325, w: 320, text: 'Sam', size: 38, weight: 700, color: '#FFFFFF' },
          { type: 'cover', x: 90, y: 1842, w: 270, h: 66, color: 'rgb(19,19,32)' },
          { type: 'text', x: 64, y: 1848, w: 320, text: 'Ava', size: 38, weight: 700, color: '#FFFFFF' },
          { type: 'cover', x: 830, y: 1842, w: 240, h: 66, color: 'rgb(19,19,32)' },
          { type: 'text', x: 790, y: 1848, w: 320, text: 'Kai', size: 38, weight: 700, color: '#FFFFFF' },
        ],
      },
      {
        // 1179x2556 capture: the poison popup
        caption: `Flip the ${red('poison')}? You drink.`,
        shot: '03-poison.png',
        bg: 'rgb(17,16,18)',
        window: { x: 0, y: 880, w: 1179, h: 1160 },
        overlays: [
          { type: 'cover', x: 420, y: 872, w: 340, h: 40, color: 'rgb(17,16,18)' },  // the dimmed POINTS label at the window's edge
          { type: 'cover', x: 934, y: 1322, w: 94, h: 58, color: 'rgb(12,12,20)' },  // the tail of a name behind the popup
          { type: 'cover', x: 340, y: 1212, w: 500, h: 100, color: 'rgb(220,38,38)' },
          { type: 'text', x: 240, y: 1201, w: 700, text: 'AVA', size: 94, weight: 900, color: C.chalk, tracking: 0.04 },
        ],
      },
    ],
    whoDrinks: [
      { label: 'Poison', chasers: 3, description: 'Flipped the poison card' },
      { label: 'Skipped', chasers: 1, description: 'Skipped your turn' },
    ],
    hashtags: '#partygame #gamenight #minigames #russianroulette',
  },
};

// ---------- HTML ----------
// The post's own voice (OFL faces vendored in docs/marketing/fonts) - friendlier than the app's
// system sans. POST_FONT picks one; OUT_DIR redirects the output (both for side-by-side tries).
const FONTS = {
  Rubik: 'Rubik-Variable.ttf',
  Fredoka: 'Fredoka-Variable.ttf',
  'Baloo 2': 'Baloo2-Variable.ttf',
  Outfit: 'Outfit-Variable.ttf',
};
const POST_FONT = process.env.POST_FONT ?? 'Fredoka';
const FONT_FACE = `<style>@font-face { font-family: "${POST_FONT}"; src: url(file://${path.join(REPO, 'docs/marketing/fonts', FONTS[POST_FONT])}) format('truetype'); font-weight: 300 900; }</style>`;
const css = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body { font-family: "${POST_FONT}", -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: ${C.ink}; background: ${C.cream}; -webkit-font-smoothing: antialiased; }
  .raw { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  .slide { position: relative; width: ${W}px; height: ${H}px; display: flex; flex-direction: column; align-items: center; }
  .label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.22em; }

  /* cover: the catalog tile, big */
  .cover { justify-content: center; }
  .tile { width: 620px; border: 4px solid ${C.ink}; background: ${C.cream}; }
  .tile-icon { height: 480px; display: flex; align-items: center; justify-content: center; border-bottom: 4px solid ${C.ink}; }
  .tile-name { padding: 44px 36px; text-align: center; font-size: 56px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.05; }
  .subtitle { margin-top: 72px; font-size: 54px; font-weight: 500; letter-spacing: -0.01em; }

  /* step: centered caption, a closed frame around the whole game area */
  .step { padding-top: 104px; }
  .step-no { width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; border: 4px solid ${C.ink}; font-size: 34px; font-weight: 900; color: ${C.chalk}; }
  .caption { margin-top: 44px; padding: 0 96px; text-align: center; font-size: 56px; font-weight: 700; line-height: 1.18; letter-spacing: -0.01em; text-wrap: balance; }
  .frame { position: absolute; left: ${FRAME.left}px; top: ${FRAME.top}px; width: ${FRAME.w}px; height: ${FRAME.h}px; border: 4px solid ${C.ink}; overflow: hidden; }
  .raw { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .raw img { display: block; height: auto; }
  .ov { position: absolute; }
  .ov-patch { background-repeat: no-repeat; background-size: 1290px auto; }
  .ov-text { display: flex; align-items: center; justify-content: center; white-space: nowrap; }
  .ov-card { background: ${C.surface}; border: 4px solid rgb(21,179,80); border-radius: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; }
  .ov-card .pts { font-size: 96px; font-weight: 900; color: rgb(255,218,79); line-height: 1; margin-top: 26px; }
  .ov-card .name { font-size: 40px; font-weight: 700; color: #FFFFFF; margin-top: 30px; }
  .ov-skip { border: 4px solid rgb(150,150,160); border-radius: 30px; display: flex; align-items: center; justify-content: center; gap: 22px; color: ${C.chalk}; font-size: 44px; font-weight: 900; letter-spacing: 0.12em; }

  /* who drinks: the tutorial's chips, on cream */
  .who { justify-content: center; }
  .who h1 { font-size: 92px; font-weight: 800; letter-spacing: -0.02em; }
  .chips { display: flex; gap: 40px; margin-top: 72px; }

  /* close: the duck and the link */
  .close { justify-content: center; }
  .duck { width: 600px; height: 600px; }
  .close .line { margin-top: 16px; font-size: 76px; font-weight: 700; line-height: 1.12; letter-spacing: -0.01em; text-align: center; }
  .url { margin-top: 48px; width: 760px; height: 132px; display: flex; align-items: center; justify-content: center; background: ${C.amber}; border: 6px solid ${C.ink}; border-radius: 24px; box-shadow: 14px 14px 0 0 ${C.ink}; font-size: 60px; font-weight: 800; }
  .chip { width: 340px; padding: 44px 28px 38px; display: flex; flex-direction: column; align-items: center; gap: 22px; border: 4px solid ${C.ink}; background: ${C.paper}; box-shadow: 10px 10px 0 0 ${C.ink}; }
  .glasses { display: flex; gap: 8px; }
  .chip-label { font-size: 34px; font-weight: 800; }
  .chip-desc { font-size: 26px; color: ${C.chipDesc}; text-align: center; line-height: 1.3; }
`;

const page_ = (body) => `<!doctype html><html><head><meta charset="utf-8">${FONT_FACE}<style>${css}</style></head><body>${body}</body></html>`;

function coverHtml(g) {
  return page_(`
    <div class="slide cover">
      <div class="tile">
        <div class="tile-icon" style="background:${g.accent}">${lucide(g.icon, { size: 280, color: C.chalk, strokeWidth: 1.6 })}</div>
        <div class="tile-name">${g.title}</div>
      </div>
      <div class="subtitle">${g.subtitle}</div>
    </div>`);
}

function overlayHtml(o, img) {
  const box = `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px`;
  switch (o.type) {
    case 'patch':
      return `<div class="ov ov-patch" style="left:${o.to.x}px;top:${o.to.y}px;width:${o.w}px;height:${o.h}px;background-image:url(file://${img});background-position:-${o.from.x}px -${o.from.y}px"></div>`;
    case 'cover':
      return `<div class="ov" style="${box};background:${o.color}"></div>`;
    case 'text':
      return `<div class="ov ov-text" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.size * 1.3}px;font-size:${o.size}px;font-weight:${o.weight};color:${o.color};letter-spacing:${o.tracking ?? 0}em">${o.text}</div>`;
    case 'card':
      return `<div class="ov ov-card" style="${box}">${lucide('check', { size: 72, color: 'rgb(21,179,80)', strokeWidth: 2.5 })}<div class="pts">+${o.points}</div><div class="name">${o.name}</div></div>`;
    case 'skip':
      return `<div class="ov ov-skip" style="${box};background:${o.bg}">${lucide('skip-forward', { size: 52, color: C.chalk, strokeWidth: 2.5 })}<span>SKIP (−5)</span></div>`;
    default:
      throw new Error(`unknown overlay ${o.type}`);
  }
}

function stepHtml(g, i, s) {
  const img = path.join(SHOTS, g.slug, s.shot);
  const rawW = pngSize(img).w;
  const inner = { w: FRAME.w - 8, h: FRAME.h - 8 };
  const scale = Math.min(inner.w / s.window.w, inner.h / s.window.h);
  const dx = (inner.w - s.window.w * scale) / 2 - s.window.x * scale;
  const dy = (inner.h - s.window.h * scale) / 2 - s.window.y * scale;
  const overlays = (s.overlays ?? []).map((o) => overlayHtml({ bg: s.bg ?? g.screenBg, ...o }, img)).join('');
  return page_(`
    <div class="slide step">
      <div class="step-no" style="background:${g.accent}">${i}</div>
      <div class="caption">${s.caption}</div>
      <div class="frame" style="background:${s.bg ?? g.screenBg}">
        <div class="raw" style="transform: translate(${dx}px, ${dy}px) scale(${scale})">
          <img src="file://${img}" style="width:${rawW}px">${overlays}
        </div>
      </div>
    </div>`);
}

function whoHtml(g) {
  const chips = g.whoDrinks
    .map(
      (r) => `
      <div class="chip">
        <div class="glasses">${lucide('glass-water', { size: 56, color: C.stop, strokeWidth: 2 }).repeat(r.chasers)}</div>
        <div class="chip-label">${r.label}</div>
        <div class="chip-desc">${r.description}</div>
      </div>`,
    )
    .join('');
  return page_(`
    <div class="slide who">
      <h1>Who drinks</h1>
      <div class="chips">${chips}</div>
    </div>`);
}

function closeHtml() {
  return page_(`
    <div class="slide close">
      <img class="duck" src="file://${path.join(FRONTEND, 'assets/duck-wave.png')}">
      <div class="line">Fast &amp; Fun<br>Mini-games</div>
      <div class="url">quicklegame.com</div>
    </div>`);
}

const plain = (html) => html.replace(/<[^>]+>/g, '');

function caption(g) {
  const steps = g.steps.map((s, i) => `${i + 1}. ${plain(s.caption)}`).join('\n');
  return `${g.title} — ${g.subtitle.toLowerCase()}.\n\n${steps}\n\nOne of 15 mini-games in Quickle. Everyone plays on their own phone — no download, no account, nothing to set up. Free at quicklegame.com (link in bio).\n\n${g.hashtags} #quickle\n`;
}

// ---------- render ----------
async function main() {
  const wanted = process.argv.slice(2);
  const slugs = wanted.length ? wanted : Object.keys(GAMES);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const slug of slugs) {
    const g = { slug, ...GAMES[slug] };
    const dir = path.join(OUT, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const slides = [coverHtml(g), ...g.steps.map((s, i) => stepHtml(g, i + 1, s)), whoHtml(g), closeHtml()];
    for (const [i, html] of slides.entries()) {
      const tmp = path.join(dir, `.slide-${i + 1}.html`);
      fs.writeFileSync(tmp, html);
      await page.goto(`file://${tmp}`);
      await page.evaluate(() => document.fonts.ready);
      if (!(await page.evaluate((f) => document.fonts.check(`700 40px "${f}"`), POST_FONT))) throw new Error(`${POST_FONT} did not load`);
      await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}.png`) });
      fs.unlinkSync(tmp);
    }
    fs.writeFileSync(path.join(dir, 'caption.md'), caption(g));
    console.log(`${path.relative(REPO, dir)}: ${slides.length} slides`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
