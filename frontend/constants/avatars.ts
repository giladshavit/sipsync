import type { ImageSourcePropType } from 'react-native';

// Mirrors backend/app/engine/avatar_pool.py — the backend owns assignment
// and uniqueness, this is just the same id list plus the actual image
// mapping. Metro needs static `require()` calls, so this can't be built
// from a loop over AVATAR_POOL — every entry must be written out.
export const AVATAR_POOL: string[] = [
  'avocado', 'balloon', 'bear', 'bee', 'book', 'camera', 'cat', 'chick',
  'cookie', 'cucumber', 'deer', 'donut', 'duck', 'fox', 'frog', 'gift_box',
  'hamster', 'hedgehog', 'ice_cream_cone', 'koala', 'lemon', 'lion',
  'mitten', 'monkey', 'moon', 'mushroom', 'octopus', 'owl', 'panda',
  'penguin', 'pig', 'rabbit', 'rainbow', 'raindrop', 'sloth', 'sock',
  'strawberry', 'sun', 'tiger', 'turtle', 'unicorn', 'whale',
];

// Each avatar's own accent color — computed from the median color of its
// actual (non-white/black) artwork pixels, so the border always matches
// that specific character rather than an arbitrary per-player color.
export const AVATAR_COLORS: Record<string, string> = {
  avocado: '#DDE092',
  balloon: '#F4BFC6',
  bear: '#B9835F',
  bee: '#FADD73',
  book: '#A6D1C0',
  camera: '#B69476',
  cat: '#F8E6CD',
  chick: '#F8E175',
  cookie: '#EBB378',
  cucumber: '#94BE77',
  deer: '#E6BA92',
  donut: '#A76956',
  duck: '#F8E073',
  fox: '#F29558',
  frog: '#99C372',
  gift_box: '#BD9DC6',
  hamster: '#FAE3BA',
  hedgehog: '#F1CAAA',
  ice_cream_cone: '#F3BEAD',
  koala: '#7E5445',
  lemon: '#FAE276',
  lion: '#EBB668',
  mitten: '#AFC4DD',
  monkey: '#EDBC97',
  moon: '#FDEDB0',
  mushroom: '#C68C6B',
  octopus: '#F6A783',
  owl: '#C08966',
  panda: '#DF9C96',
  penguin: '#EFA27A',
  pig: '#F8C4C4',
  rabbit: '#E8A6A4',
  rainbow: '#F5BD99',
  raindrop: '#B5D9EB',
  sloth: '#C7A47F',
  sock: '#F3C2BC',
  strawberry: '#E46B69',
  sun: '#F9E6A1',
  tiger: '#F4A65F',
  turtle: '#B4CA83',
  unicorn: '#F4BAAD',
  whale: '#9FB2D2',
};

// Used only as a background/border for players without an avatar image yet
// (vibe icon or initial-letter fallback) — the avatar image case uses each
// avatar's own AVATAR_COLORS accent instead.
const AVATAR_COLORS_FALLBACK = [
  '#C4852A', '#8A4A2A', '#7A6A3A', '#A05C2A', '#6A4A1A',
  '#4A8A6F', '#3D6A5A', '#5A8888', '#3D7A6A', '#5A7A4A',
  '#3D7FA5', '#2D5A8A', '#4A6A9A', '#3D5A7A', '#5A7A9A',
  '#C4577A', '#A04A6A', '#8A3A5A', '#C46A5A', '#A05A5A',
  '#7A5A9A', '#6A4A8A', '#8A6A9A', '#5A7A5A', '#7A5A3A',
  '#6A7A9A', '#9A6A4A', '#5A6A7A',
];

// Stable per-player color for the avatar-less fallback (vibe icon or initial
// letter) — hashed from the player id so it stays consistent across renders.
export function avatarFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS_FALLBACK[Math.abs(hash) % AVATAR_COLORS_FALLBACK.length];
}

export const AVATAR_IMAGES: Record<string, ImageSourcePropType> = {
  avocado: require('@/assets/avatars/avocado.png'),
  balloon: require('@/assets/avatars/balloon.png'),
  bear: require('@/assets/avatars/bear.png'),
  bee: require('@/assets/avatars/bee.png'),
  book: require('@/assets/avatars/book.png'),
  camera: require('@/assets/avatars/camera.png'),
  cat: require('@/assets/avatars/cat.png'),
  chick: require('@/assets/avatars/chick.png'),
  cookie: require('@/assets/avatars/cookie.png'),
  cucumber: require('@/assets/avatars/cucumber.png'),
  deer: require('@/assets/avatars/deer.png'),
  donut: require('@/assets/avatars/donut.png'),
  duck: require('@/assets/avatars/duck.png'),
  fox: require('@/assets/avatars/fox.png'),
  frog: require('@/assets/avatars/frog.png'),
  gift_box: require('@/assets/avatars/gift_box.png'),
  hamster: require('@/assets/avatars/hamster.png'),
  hedgehog: require('@/assets/avatars/hedgehog.png'),
  ice_cream_cone: require('@/assets/avatars/ice_cream_cone.png'),
  koala: require('@/assets/avatars/koala.png'),
  lemon: require('@/assets/avatars/lemon.png'),
  lion: require('@/assets/avatars/lion.png'),
  mitten: require('@/assets/avatars/mitten.png'),
  monkey: require('@/assets/avatars/monkey.png'),
  moon: require('@/assets/avatars/moon.png'),
  mushroom: require('@/assets/avatars/mushroom.png'),
  octopus: require('@/assets/avatars/octopus.png'),
  owl: require('@/assets/avatars/owl.png'),
  panda: require('@/assets/avatars/panda.png'),
  penguin: require('@/assets/avatars/penguin.png'),
  pig: require('@/assets/avatars/pig.png'),
  rabbit: require('@/assets/avatars/rabbit.png'),
  rainbow: require('@/assets/avatars/rainbow.png'),
  raindrop: require('@/assets/avatars/raindrop.png'),
  sloth: require('@/assets/avatars/sloth.png'),
  sock: require('@/assets/avatars/sock.png'),
  strawberry: require('@/assets/avatars/strawberry.png'),
  sun: require('@/assets/avatars/sun.png'),
  tiger: require('@/assets/avatars/tiger.png'),
  turtle: require('@/assets/avatars/turtle.png'),
  unicorn: require('@/assets/avatars/unicorn.png'),
  whale: require('@/assets/avatars/whale.png'),
};
