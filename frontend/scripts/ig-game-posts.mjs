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
  if (b.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file} is not a real PNG (a renamed JPEG?) - convert it first: uv run --with pillow python -c "from PIL import Image; Image.open('<f>').convert('RGB').save('<f>','PNG')"`);
  }
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
  'twenty-one': {
    title: '21',
    icon: 'circle-slash',
    accent: '#D946EF',
    screenBg: 'rgb(31,13,34)',
    subtitle: "Don't be the one to hit 21",
    steps: [
      {
        caption: 'A shared counter starts at 0.',
        shot: '01-zero.png',
        bg: 'rgb(31,13,34)',
        window: { x: 0, y: 240, w: 1179, h: 1540 },
        overlays: [
          { type: 'mirror', x: 20, y: 201, w: 210, h: 210 },
          { type: 'cover', x: 350, y: 616, w: 250, h: 52, color: 'rgb(38, 16, 42)', color2: 'rgb(41, 16, 44)' },
          { type: 'text', x: 350, y: 622, w: 250, text: 'DAVID', size: 30, weight: 700, color: C.chalk, tracking: 0.14 },
          { type: 'cover', x: 352, y: 1705, w: 470, h: 47, color: 'rgb(33,13,37)' },
          { type: 'text', x: 352, y: 1707, w: 470, text: "DAVID'S TURN", size: 38, weight: 700, color: C.chalk, tracking: 0.14 },
        ],
      },
      {
        caption: 'On your turn: +1, +2 or +3',
        shot: '02-your-turn.png',
        bg: 'rgb(44,22,32)',
        window: { x: 0, y: 900, w: 1179, h: 1480 },
      },
      {
        caption: `Hit ${red('21')}? You drink.`,
        shot: '03-hit-21.png',
        bg: 'rgb(22,12,20)',
        window: { x: 0, y: 640, w: 1179, h: 1200 },
        overlays: [
          { type: 'cover', x: 280, y: 1268, w: 620, h: 102, color: 'rgb(220,38,38)' },
          { type: 'text', x: 300, y: 1280, w: 620, text: 'ROB', size: 75, weight: 900, color: C.chalk, tracking: 0.04 },
        ],
      },
    ],
    whoDrinks: [
      { label: 'Hit 21', chasers: 2, description: 'Landed on exactly 21' },
    ],
    hashtags: '#partygame #gamenight #minigames #21',
  },
  'closest-average': {
    title: 'Closest Average',
    icon: 'target',
    accent: '#0EA5E9',
    screenBg: 'rgb(10, 10, 15)',
    subtitle: 'Land closest to the average',
    steps: [
      {
        caption: 'Everyone secretly picks a number - 0 to 99.',
        shot: '01-pick.png',
        bg: 'rgb(10, 10, 15)',
        window: { x: 0, y: 860, w: 1179, h: 1073 },
      },
      {
        caption: `All picks in? The room's ${yellow('average')} is revealed.`,
        shot: '02-average.png',
        bg: 'rgb(10, 10, 15)',
        window: { x: 0, y: 700, w: 1179, h: 1073 },
      },
      {
        caption: `${red('Farthest')} from the average? You drink.`,
        shot: '03-farthest.png',
        bg: 'rgb(10, 10, 15)',
        window: { x: 0, y: 700, w: 1179, h: 1073 },
      },
    ],
    whoDrinks: [
      { label: 'Farthest off', chasers: 1, description: 'Farthest from the room average' },
    ],
    hashtags: '#partygame #gamenight #minigames #guessinggame',
  },
  'green-light': {
    title: 'Green Light',
    icon: 'zap',
    accent: '#16A34A',
    screenBg: 'rgb(220, 38, 38)',
    subtitle: 'Tap the instant it flips green',
    steps: [
      {
        caption: `The light starts ${red('red')}. Wait for it.`,
        shot: '01-red.png',
        bg: 'rgb(220, 38, 38)',
        window: { x: 0, y: 740, w: 1179, h: 1073 },
      },
      {
        caption: `${green('Green')}? Tap as fast as you can!`,
        shot: '02-green.png',
        bg: 'rgb(22, 163, 74)',
        window: { x: 0, y: 740, w: 1179, h: 1073 },
      },
      {
        caption: 'Slowest tap? You drink.',
        shot: '03-result.png',
        bg: 'rgb(37, 99, 235)',
        window: { x: 0, y: 740, w: 1179, h: 1073 },
      },
    ],
    whoDrinks: [
      { label: 'Slowest', chasers: 1, description: 'Slowest valid tap' },
      { label: 'Too early', chasers: 1, description: 'Tapped during the red light' },
      { label: "Didn't tap", chasers: 1, description: "Didn't tap at all" },
    ],
    hashtags: '#partygame #gamenight #minigames #greenlight',
  },
  'tap-race': {
    title: 'Tap Race',
    icon: 'hand',
    accent: '#2563EB',
    screenBg: 'rgb(245, 158, 11)',
    subtitle: 'Most taps in 10 seconds wins',
    steps: [
      {
        caption: `A ${yellow('10-second')} window opens.`,
        shot: '01-start.png',
        bg: 'rgb(245, 158, 11)',
        topStrip: {
          x: 0, y: 176, w: 1179, h: 150,
          overlays: [
            { type: 'patch', from: { x: 700, y: 192 }, to: { x: 1012, y: 192 }, w: 106, h: 24 },  // fill the bar to the end
          ],
        },
        window: { x: 0, y: 1100, w: 1179, h: 680 },
      },
      {
        caption: `${green('Tap')}! As many times as you can!`,
        shot: '02-tapping.png',
        bg: 'rgb(240, 144, 20)',
        topStrip: {
          x: 0, y: 176, w: 1179, h: 150,
        },
        window: { x: 0, y: 1100, w: 1179, h: 680 },
      },
      {
        // pre-cropped capture (1178x753): just the you-DRINK block; the frame's
        // matching red fills it out to the slide
        caption: `${red('Fewest')} taps? You drink.`,
        shot: '03-result.png',
        bg: 'rgb(201, 59, 49)',
        window: { x: 0, y: 0, w: 1178, h: 753 },
      },
    ],
    whoDrinks: [
      { label: 'Fewest taps', chasers: 1, description: 'Tapped the least in the room' },
    ],
    hashtags: '#partygame #gamenight #minigames #taprace',
  },
  'human-timer': {
    title: 'Human Timer',
    icon: 'timer',
    accent: '#F59E0B',
    screenBg: 'rgb(16, 14, 15)',
    subtitle: 'Count the seconds in your head',
    steps: [
      {
        caption: `A target appears: ${yellow('22 seconds')}.`,
        shot: '01-target.png',
        bg: 'rgb(16, 14, 15)',
        window: { x: 0, y: 692, w: 1179, h: 1073 },
      },
      {
        caption: `Count in your head. ${green('Tap')} when time's up.`,
        shot: '02-counting.png',
        bg: 'rgb(21, 17, 15)',
        topStrip: {
          x: 0, y: 168, w: 1179, h: 70,
          overlays: [{ type: 'patch', from: { x: 34, y: 385 }, to: { x: 34, y: 212 }, w: 176, h: 28 }],
        },
        window: { x: 0, y: 758, w: 1179, h: 1013 },
      },
      {
        caption: `${red('Farthest')} from the target? You drink.`,
        shot: '03-result.png',
        bg: 'rgb(37, 99, 235)',
        window: { x: 0, y: 744, w: 1179, h: 1073 },
      },
    ],
    whoDrinks: [
      { label: 'Farthest off', chasers: 1, description: 'Farthest from the target time' },
      { label: 'Never tapped', chasers: 1, description: "Didn't tap at all" },
    ],
    hashtags: '#partygame #gamenight #minigames #humantimer',
  },
  'go-with-the-flow': {
    title: 'Go with the Flow',
    icon: 'users',
    accent: '#059669',
    screenBg: 'rgb(255,248,225)',
    subtitle: 'Land with the crowd and win',
    steps: [
      {
        caption: 'A question. Two answers.',
        shot: '01-question.png',
        window: { x: 0, y: 990, w: 1179, h: 800 },
      },
      {
        caption: `Pick a side. Land with the ${green('majority')}.`,
        shot: '02-reveal.png',
        window: { x: 0, y: 590, w: 1179, h: 1490 },
        overlays: [
          { type: 'cover', x: 175, y: 1445, w: 270, h: 370, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 1442, w: 270, text: 'You', size: 52, weight: 900, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1516, w: 270, text: 'David', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1575, w: 270, text: 'Emma', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1634, w: 270, text: 'Jake', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1693, w: 270, text: 'Noah', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1752, w: 270, text: 'Mia', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 1445, w: 260, h: 115, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 1452, w: 260, text: 'Rob', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1511, w: 260, text: 'Sophie', size: 40, weight: 500, color: '#0A0A0F' },
        ],
      },
      {
        // the same reveal screen, re-simulated: You switched to No, so 5-3,
        // the bars re-drawn to scale, and the YOU DRINK button carried over
        // from the other capture
        caption: `With the ${red('minority')}? You drink.`,
        shot: '02-reveal.png',
        window: { x: 0, y: 590, w: 1179, h: 1490 },
        overlays: [
          { type: 'cover', x: 236, y: 784, w: 46, h: 42, color: 'rgb(255,248,225)' },
          { type: 'text', x: 236, y: 786, w: 46, text: '5', size: 36, weight: 800, color: 'rgb(22,163,74)' },
          { type: 'cover', x: 796, y: 784, w: 44, h: 42, color: 'rgb(255,248,225)' },
          { type: 'text', x: 796, y: 786, w: 44, text: '3', size: 36, weight: 800, color: 'rgb(220,38,38)' },
          { type: 'cover', x: 210, y: 998, w: 200, h: 400, color: 'rgb(255,248,225)' },
          { type: 'box', x: 218, y: 1066, w: 186, h: 326, color: 'rgb(22,163,74)' },
          { type: 'cover', x: 766, y: 1260, w: 200, h: 138, color: 'rgb(255,248,225)' },
          { type: 'box', x: 774, y: 1193, w: 186, h: 199, color: 'rgb(220,38,38)' },
          { type: 'cover', x: 175, y: 1445, w: 270, h: 310, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 1452, w: 270, text: 'David', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1511, w: 270, text: 'Emma', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1570, w: 270, text: 'Jake', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1629, w: 270, text: 'Noah', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1688, w: 270, text: 'Mia', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 1445, w: 260, h: 200, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 1442, w: 260, text: 'You', size: 52, weight: 900, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1516, w: 260, text: 'Rob', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1575, w: 260, text: 'Sophie', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'patch', shot: '03-result.png', from: { x: 350, y: 1822 }, to: { x: 350, y: 1822 }, w: 480, h: 220 },
        ],
      },
    ],
    whoDrinks: [
      { label: 'Minority', chasers: 1, description: 'Picked the minority' },
      { label: 'Lost the tie', chasers: 1, description: 'Tie, and the coin landed on your answer' },
    ],
    hashtags: '#partygame #gamenight #minigames #gowiththeflow',
  },
  'against-the-flow': {
    title: 'Against the Flow',
    icon: 'user-minus',
    accent: '#EA580C',
    screenBg: 'rgb(255,248,225)',
    subtitle: 'Guess what the minority wants',
    steps: [
      {
        caption: 'A question. Two answers. Opposite goal.',
        shot: '01-question.png',
        window: { x: 0, y: 990, w: 1179, h: 800 },
      },
      {
        // simulated from the reveal capture: the majority is red now, the
        // minority holds the trophy - and You called it
        caption: `Pick a side. Land with the ${green('minority')}.`,
        shot: '02-reveal.png',
        window: { x: 0, y: 590, w: 1179, h: 1490 },
        overlays: [
          { type: 'cover', x: 345, y: 600, w: 490, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 345, y: 606, w: 490, text: 'Guess against the majority', size: 36, weight: 700, color: 'rgb(168,151,122)' },
          { type: 'cover', x: 175, y: 714, w: 270, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 716, w: 270, text: 'Stand-up', size: 50, weight: 800, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 714, w: 260, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 716, w: 260, text: 'Concert', size: 50, weight: 800, color: '#0A0A0F' },
          { type: 'cover', x: 180, y: 778, w: 260, h: 52, color: 'rgb(255,248,225)' },
          { type: 'icon', name: 'glass-water', x: 194, y: 782, size: 40, color: 'rgb(220,38,38)' },
          { type: 'text', x: 240, y: 788, w: 196, text: '5 VOTES', size: 34, weight: 800, color: 'rgb(220,38,38)', tracking: 0.12 },
          { type: 'cover', x: 748, y: 778, w: 250, h: 52, color: 'rgb(255,248,225)' },
          { type: 'icon', name: 'trophy', x: 754, y: 782, size: 40, color: 'rgb(22,163,74)' },
          { type: 'text', x: 800, y: 788, w: 190, text: '3 VOTES', size: 34, weight: 800, color: 'rgb(22,163,74)', tracking: 0.12 },
          { type: 'cover', x: 210, y: 995, w: 205, h: 405, color: 'rgb(255,248,225)' },
          { type: 'box', x: 218, y: 1074, w: 186, h: 318, color: 'rgb(220,38,38)' },
          { type: 'cover', x: 766, y: 1258, w: 205, h: 140, color: 'rgb(255,248,225)' },
          { type: 'box', x: 774, y: 1201, w: 186, h: 191, color: 'rgb(22,163,74)' },
          { type: 'cover', x: 175, y: 1445, w: 270, h: 370, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 1452, w: 270, text: 'David', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1511, w: 270, text: 'Sophie', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1570, w: 270, text: 'Jake', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1629, w: 270, text: 'Noah', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1688, w: 270, text: 'Mia', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 1438, w: 260, h: 210, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 1442, w: 260, text: 'You', size: 52, weight: 900, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1516, w: 260, text: 'Emma', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1575, w: 260, text: 'Rob', size: 40, weight: 500, color: '#0A0A0F' },
        ],
      },
      {
        caption: `With the ${red('majority')}? You drink.`,
        shot: '02-reveal.png',
        window: { x: 0, y: 590, w: 1179, h: 1490 },
        overlays: [
          { type: 'cover', x: 345, y: 600, w: 490, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 345, y: 606, w: 490, text: 'Guess against the majority', size: 36, weight: 700, color: 'rgb(168,151,122)' },
          { type: 'cover', x: 175, y: 714, w: 270, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 716, w: 270, text: 'Stand-up', size: 50, weight: 800, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 714, w: 260, h: 54, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 716, w: 260, text: 'Concert', size: 50, weight: 800, color: '#0A0A0F' },
          { type: 'cover', x: 180, y: 778, w: 260, h: 52, color: 'rgb(255,248,225)' },
          { type: 'icon', name: 'glass-water', x: 194, y: 782, size: 40, color: 'rgb(220,38,38)' },
          { type: 'text', x: 240, y: 788, w: 196, text: '6 VOTES', size: 34, weight: 800, color: 'rgb(220,38,38)', tracking: 0.12 },
          { type: 'cover', x: 748, y: 778, w: 250, h: 52, color: 'rgb(255,248,225)' },
          { type: 'icon', name: 'trophy', x: 754, y: 782, size: 40, color: 'rgb(22,163,74)' },
          { type: 'text', x: 800, y: 788, w: 190, text: '2 VOTES', size: 34, weight: 800, color: 'rgb(22,163,74)', tracking: 0.12 },
          { type: 'cover', x: 210, y: 995, w: 205, h: 405, color: 'rgb(255,248,225)' },
          { type: 'box', x: 218, y: 1002, w: 186, h: 390, color: 'rgb(220,38,38)' },
          { type: 'cover', x: 766, y: 1258, w: 205, h: 140, color: 'rgb(255,248,225)' },
          { type: 'box', x: 774, y: 1266, w: 186, h: 126, color: 'rgb(22,163,74)' },
          { type: 'cover', x: 175, y: 1445, w: 270, h: 370, color: 'rgb(255,248,225)' },
          { type: 'text', x: 175, y: 1440, w: 270, text: 'You', size: 52, weight: 900, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1514, w: 270, text: 'David', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1573, w: 270, text: 'Sophie', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1632, w: 270, text: 'Jake', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1691, w: 270, text: 'Noah', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 175, y: 1750, w: 270, text: 'Mia', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'cover', x: 735, y: 1445, w: 260, h: 140, color: 'rgb(255,248,225)' },
          { type: 'text', x: 735, y: 1452, w: 260, text: 'Emma', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'text', x: 735, y: 1511, w: 260, text: 'Rob', size: 40, weight: 500, color: '#0A0A0F' },
          { type: 'patch', shot: '03-result.png', from: { x: 350, y: 1822 }, to: { x: 350, y: 1822 }, w: 480, h: 220 },
        ],
      },
    ],
    whoDrinks: [
      { label: 'Majority', chasers: 1, description: 'Picked the majority' },
      { label: 'Lost the tie', chasers: 1, description: 'Tie, and the coin landed on your answer' },
    ],
    hashtags: '#partygame #gamenight #minigames #againsttheflow',
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

  /* cover: the game's own colour, full bleed - the profile grid becomes the games grid */
  .cover { justify-content: center; gap: 0; color: ${C.chalk}; }
  .cover .icon { margin-bottom: 56px; }
  .cover .name { font-size: 104px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.05; text-align: center; padding: 0 60px; }
  .cover .subtitle { margin-top: 36px; font-size: 52px; font-weight: 500; opacity: 0.92; }

  /* step: centered caption, a closed frame around the whole game area */
  .step { padding-top: 104px; }
  .step-no { width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; border: 4px solid ${C.ink}; font-size: 34px; font-weight: 900; color: ${C.chalk}; }
  .caption { margin-top: 44px; padding: 0 96px; text-align: center; font-size: 56px; font-weight: 700; line-height: 1.18; letter-spacing: -0.01em; text-wrap: balance; }
  .frame { position: absolute; left: ${FRAME.left}px; top: ${FRAME.top}px; width: ${FRAME.w}px; height: ${FRAME.h}px; border: 4px solid ${C.ink}; overflow: hidden; }
  .raw { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .bar { position: absolute; top: 0; background-repeat: repeat-x; }
  .strip { position: absolute; left: 0; top: 0; overflow: hidden; }
  .clip { position: absolute; overflow: hidden; }
  .raw img { display: block; height: auto; }
  .ov { position: absolute; }
  .ov-patch { background-repeat: no-repeat; }
  .ov-text { display: flex; align-items: center; justify-content: center; white-space: nowrap; }
  .ov-card { background: ${C.surface}; border: 4px solid rgb(21,179,80); border-radius: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; }
  .ov-card .pts { font-size: 96px; font-weight: 900; color: rgb(255,218,79); line-height: 1; margin-top: 26px; }
  .ov-card .name { font-size: 40px; font-weight: 700; color: #FFFFFF; margin-top: 30px; }
  .ov-skip { border: 4px solid rgb(150,150,160); border-radius: 30px; display: flex; align-items: center; justify-content: center; gap: 22px; color: ${C.chalk}; font-size: 44px; font-weight: 900; letter-spacing: 0.12em; }

  /* who drinks: the tutorial's chips, on cream */
  .who { justify-content: center; }
  .who h1 { font-size: 92px; font-weight: 800; letter-spacing: -0.02em; }
  .chips { display: flex; gap: 36px; margin-top: 72px; padding: 0 64px; justify-content: center; align-self: stretch; }

  /* close: the duck and the link */
  .close { justify-content: center; }
  .duck { width: 600px; height: 600px; }
  .close .line { margin-top: 16px; font-size: 76px; font-weight: 700; line-height: 1.12; letter-spacing: -0.01em; text-align: center; }
  .url { margin-top: 48px; width: 760px; height: 132px; display: flex; align-items: center; justify-content: center; background: ${C.amber}; border: 6px solid ${C.ink}; border-radius: 24px; box-shadow: 14px 14px 0 0 ${C.ink}; font-size: 60px; font-weight: 800; }
  .chip { flex: 1 1 0; max-width: 340px; min-width: 0; padding: 44px 24px 38px; display: flex; flex-direction: column; align-items: center; gap: 22px; border: 4px solid ${C.ink}; background: ${C.paper}; box-shadow: 10px 10px 0 0 ${C.ink}; }
  .glasses { display: flex; gap: 8px; }
  .chip-label { font-size: 34px; font-weight: 800; }
  .chip-desc { font-size: 26px; color: ${C.chipDesc}; text-align: center; line-height: 1.3; }
`;

const page_ = (body) => `<!doctype html><html><head><meta charset="utf-8">${FONT_FACE}<style>${css}</style></head><body>${body}</body></html>`;

function coverHtml(g) {
  return page_(`
    <div class="slide cover" style="background:${g.accent}">
      <div class="icon">${lucide(g.icon, { size: 320, color: C.chalk, strokeWidth: 1.5 })}</div>
      <div class="name" style="font-size:${g.title.length <= 3 ? 180 : 104}px">${g.title}</div>
      <div class="subtitle">${g.subtitle}</div>
    </div>`);
}

function overlayHtml(o, img) {
  const box = `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px`;
  switch (o.type) {
    case 'mirror': {
      const rawW = o.rawW;
      return `<div class="ov" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;background-image:url(file://${img});background-size:${rawW}px auto;background-position:-${rawW - o.x - o.w}px -${o.y}px;transform:scaleX(-1)"></div>`;
    }
    case 'patch': {
      const src = o.shot ? path.join(path.dirname(img), o.shot) : img;
      const srcW = o.shot ? pngSize(src).w : o.rawW;
      return `<div class="ov ov-patch" style="left:${o.to.x}px;top:${o.to.y}px;width:${o.w}px;height:${o.h}px;background-image:url(file://${src});background-size:${srcW}px auto;background-position:-${o.from.x}px -${o.from.y}px"></div>`;
    }
    case 'icon':
      return `<div class="ov" style="left:${o.x}px;top:${o.y}px">${lucide(o.name, { size: o.size, color: o.color, strokeWidth: o.strokeWidth ?? 2.5 })}</div>`;
    case 'box':
      return `<div class="ov" style="${box};background:${o.color};border:4px solid #0A0A0F"></div>`;
    case 'cover':
      return `<div class="ov" style="${box};background:${o.color2 ? `linear-gradient(90deg, ${o.color}, ${o.color2})` : o.color}"></div>`;
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
  const { w: rawW, h: rawH } = pngSize(img);
  const inner = { w: FRAME.w - 8, h: FRAME.h - 8 };
  const strip = s.topStrip;
  const stripScale = strip ? inner.w / strip.w : 0;
  const stripH = strip ? Math.round(strip.h * stripScale) : 0;
  const stripHtml = strip
    ? `<div class="strip" style="width:${inner.w}px;height:${stripH}px"><div class="raw" style="transform: translate(${-strip.x * stripScale}px, ${-strip.y * stripScale}px) scale(${stripScale})"><img src="file://${img}" style="width:${rawW}px">${(strip.overlays ?? []).map((o) => overlayHtml({ bg: s.bg ?? g.screenBg, rawW, ...o }, img)).join('')}</div></div>`
    : '';
  const availH = inner.h - stripH;
  const scale = Math.min(inner.w / s.window.w, availH / s.window.h);
  // the window is clipped to its own box, so off-window rows of the capture
  // can never bleed over the strip or the fill bars
  const clip = {
    left: Math.round((inner.w - s.window.w * scale) / 2),
    top: Math.round(stripH + (availH - s.window.h * scale) / 2),
    w: Math.round(s.window.w * scale),
    h: Math.round(s.window.h * scale),
  };
  // side bars: the capture's outermost columns stretched horizontally, so the
  // background continues seamlessly (vertical gradients survive, no visible join)
  const barW = Math.ceil((inner.w - s.window.w * scale) / 2);
  const barTop = stripH;
  const stretch = 4000; // one source column spread across the whole bar
  const sizeCss = `background-size:${Math.round(s.window.w * scale * stretch)}px ${Math.round(rawH * scale)}px`;
  const posY = -Math.round(s.window.y * scale);
  const leftBar = barW > 0 ? `<div class="bar" style="left:0;top:${barTop}px;width:${barW + 1}px;height:${availH}px;background-image:url(file://${img});${sizeCss};background-position:${-Math.round((s.window.x + 2) * scale * stretch)}px ${posY}px"></div>` : '';
  const rightBar = barW > 0 ? `<div class="bar" style="right:0;top:${barTop}px;width:${barW + 1}px;height:${availH}px;background-image:url(file://${img});${sizeCss};background-position:${-Math.round((s.window.x + s.window.w - 3) * scale * stretch)}px ${posY}px"></div>` : '';
  // and the same trick vertically when the window is wider than tall
  const vBarH = Math.ceil((availH - s.window.h * scale) / 2);
  const vSizeCss = `background-size:${Math.round(rawW * scale)}px ${Math.round(s.window.h * scale * stretch)}px`;
  const posX = Math.round(clip.left - s.window.x * scale);
  const topBar = vBarH > 0 ? `<div class="bar" style="left:0;top:${barTop}px;width:${inner.w}px;height:${vBarH + 1}px;background-image:url(file://${img});${vSizeCss};background-position:${posX}px ${-Math.round((s.window.y + 2) * scale * stretch)}px"></div>` : '';
  const bottomBar = vBarH > 0 ? `<div class="bar" style="left:0;top:${barTop + availH - vBarH - 1}px;width:${inner.w}px;height:${vBarH + 1}px;background-image:url(file://${img});${vSizeCss};background-position:${posX}px ${-Math.round((s.window.y + s.window.h - 3) * scale * stretch)}px"></div>` : '';
  const overlays = (s.overlays ?? []).map((o) => overlayHtml({ bg: s.bg ?? g.screenBg, rawW, ...o }, img)).join('');
  return page_(`
    <div class="slide step">
      <div class="step-no" style="background:${g.accent}">${i}</div>
      <div class="caption">${s.caption}</div>
      <div class="frame" style="background:${s.bg ?? g.screenBg}">
        ${leftBar}${rightBar}${topBar}${bottomBar}${stripHtml}
        <div class="clip" style="left:${clip.left}px;top:${clip.top}px;width:${clip.w}px;height:${clip.h}px">
          <div class="raw" style="transform: translate(${-s.window.x * scale}px, ${-s.window.y * scale}px) scale(${scale})">
            <img src="file://${img}" style="width:${rawW}px">${overlays}
          </div>
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
  return `${g.title}: ${g.subtitle.toLowerCase()}.\n\n${steps}\n\nFast & Fun mini-games for a night with friends. Everyone plays on their own phone, no download, no account, nothing to set up. Play free at quicklegame.com (link in bio).\n\n${g.hashtags} #quickle\n`;
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
