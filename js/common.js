import { TILE, VIEW_W, VIEW_H } from './levels.js';

export { TILE, VIEW_W, VIEW_H };

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = v => v < 0 ? -1 : v > 0 ? 1 : 0;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export const aabb = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function hash(x, y, s = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 2654435761;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const PHYS = {
  speed: 238, accel: 2600, airAccel: 2000, friction: 3200, airDrag: 720,
  gravity: 2150, maxFall: 1050, jump: 780, doubleJump: 700,
  wallJumpX: 345, wallJumpY: 705, wallSlide: 145,
  dashSpeed: 650, dashTime: 0.165, dashCd: 0.62,
  coyote: 0.1, buffer: 0.13,
};

export const THEMES = {
  hub: {
    bg1: '#0e2b21', bg2: '#020706', far: '#123528', far2: '#194634',
    tileA: '#355543', tileB: '#2d493a', tileC: '#243a2f', edge: '#639173',
    mortar: '#12231b', moss: '#639c5a', accent: '#b9f23c', fog: '#154634',
    metal: '#3a5954', metalEdge: '#6f948a', lamp: '#ffc06a',
  },
  rats: {
    bg1: '#2a1f13', bg2: '#070503', far: '#352718', far2: '#453323',
    tileA: '#574633', tileB: '#493a2a', tileC: '#392e21', edge: '#967b59',
    mortar: '#241c14', moss: '#7f8d44', accent: '#d6c26a', fog: '#35291b',
    metal: '#5b5748', metalEdge: '#948a73', lamp: '#ffb35c',
  },
  tunnel: {
    bg1: '#082025', bg2: '#020708', far: '#0d2b33', far2: '#123c46',
    tileA: '#31525c', tileB: '#2a4650', tileC: '#213741', edge: '#6193a0',
    mortar: '#10232a', moss: '#4c8071', accent: '#6fffe9', fog: '#113d45',
    metal: '#365e66', metalEdge: '#72a1ad', lamp: '#6fffe9',
  },
  steam: {
    bg1: '#2a160a', bg2: '#080302', far: '#3d2110', far2: '#512c16',
    tileA: '#6b4830', tileB: '#5a3d29', tileC: '#473020', edge: '#ad7950',
    mortar: '#2c1c11', moss: '#7b7b35', accent: '#ffb35c', fog: '#4a2b14',
    metal: '#6e543f', metalEdge: '#ad8664', lamp: '#ff9b4a',
  },
  sump: {
    bg1: '#0e2a1e', bg2: '#020705', far: '#17452e', far2: '#1f5739',
    tileA: '#3a5946', tileB: '#314c3c', tileC: '#263b2e', edge: '#6e9874',
    mortar: '#13271b', moss: '#8dc35b', accent: '#b9f23c', fog: '#1b5237',
    metal: '#48604f', metalEdge: '#84a087', lamp: '#b9f23c',
  },
  overflow: {
    bg1: '#0c2234', bg2: '#02060a', far: '#123249', far2: '#194360',
    tileA: '#344f60', tileB: '#2b4352', tileC: '#22343f', edge: '#6593aa',
    mortar: '#10202a', moss: '#4d8d7c', accent: '#9ad8ff', fog: '#14405a',
    metal: '#3d5f70', metalEdge: '#79a5bb', lamp: '#9ad8ff',
  },
  secret: {
    bg1: '#322111', bg2: '#080502', far: '#3f2b16', far2: '#52391f',
    tileA: '#685035', tileB: '#59442c', tileC: '#453421', edge: '#b08c5e',
    mortar: '#2b1f12', moss: '#90904a', accent: '#ffd08a', fog: '#4c351b',
    metal: '#665443', metalEdge: '#b0926d', lamp: '#ffd08a',
  },
  croc: {
    bg1: '#24100d', bg2: '#050202', far: '#351714', far2: '#471c17',
    tileA: '#5a4036', tileB: '#4c352d', tileC: '#3a2822', edge: '#a1755e',
    mortar: '#261812', moss: '#8bae4d', accent: '#ff8f6a', fog: '#461e18',
    metal: '#5a4940', metalEdge: '#a0806e', lamp: '#ff8f6a',
  },
};

export const RELICS = {
  grip: { glyph: '✋', name: 'RUST GRIP', desc: 'Wall-jump off slick surfaces.', short: 'Wall-jump' },
  boots: { glyph: '▲▲', name: 'SUMP BOOTS', desc: 'Jump again in mid-air.', short: 'Double jump' },
  dash: { glyph: '»', name: 'PRESSURE VALVE', desc: 'Burst forward through the water.', short: 'Dash' },
};

export const TOKEN_TOTAL = 6;
export const ROOM_TOTAL = 8;

export function roundRect(ctx, x, y, w, h, r = 6) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y + s);
  ctx.bezierCurveTo(x - s * 0.15, y + s * 0.55, x + s * 0.05, y - s * 0.1, x + s * 0.5, y + s * 0.25);
  ctx.bezierCurveTo(x + s * 0.95, y - s * 0.1, x + s * 1.15, y + s * 0.55, x + s * 0.5, y + s);
  ctx.closePath();
}

export function tokenPath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}
