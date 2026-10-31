import { buildRooms } from './levels.js';
import {
  TILE as T, VIEW_W, VIEW_H, clamp, lerp, sign, rand, dist, aabb, hash, mulberry,
  PHYS, RELICS, TOKEN_TOTAL, ROOM_TOTAL, THEMES,
} from './common.js';
import { Renderer } from './render.js';
import { SumpAudio } from './audio.js';

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('game');
const mapCanvas = document.getElementById('mapCanvas');
const renderer = new Renderer(canvas, mapCanvas);
const audio = new SumpAudio();
const $ = id => document.getElementById(id);

const SAVE_KEY = 'sumpcity.save.v2';

const game = {
  state: 'title',
  time: 0,
  titleTime: 0,
  rooms: null,
  room: null,
  player: null,
  cam: { x: 0, y: 0 },
  particles: [],
  projectiles: [],
  enemies: [],
  items: [],
  notes: [],
  boss: null,
  bossActive: null,
  activeBarriers: new Set(),
  updraftActive: false,
  abilities: { grip: false, boots: false, dash: false },
  maxHp: 4,
  tokens: new Set(),
  taken: new Set(),
  collected: new Set(),
  bosses: { warden: false, croc: false },
  visited: new Set(['hub']),
  destroyed: new Set(),
  checkpoint: { room: 'hub', entry: 'start' },
  deaths: 0,
  playTime: 0,
  shake: 0,
  hitstop: 0,
  banner: null,
  bigBanner: null,
  toast: null,
  showHint: null,
  prompt: null,
  nearest: null,
  transition: null,
  endingTimer: 0,
  deathTimer: 0,
  exitCooldown: 0,
  mapDirty: true,
  staticVersion: 0,
};

const held = {
  left: false, right: false, up: false, down: false,
  jump: false, attack: false, dash: false,
};
let edges = new Set();

/* ------------------------------------------------------------------ */
/* save / load                                                         */
/* ------------------------------------------------------------------ */
function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

function readSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

function saveGame() {
  if (!game.player) return;
  const data = {
    version: 2,
    maxHp: game.maxHp,
    hp: game.player.hp,
    abilities: { ...game.abilities },
    tokens: [...game.tokens],
    taken: [...game.taken],
    collected: [...game.collected],
    bosses: { ...game.bosses },
    visited: [...game.visited],
    destroyed: [...game.destroyed],
    checkpoint: { ...game.checkpoint },
    deaths: game.deaths,
    playTime: game.playTime,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
  refreshTitleButtons();
}

function applySave(s) {
  if (!s || s.version !== 2) return false;
  game.maxHp = clamp(s.maxHp || 4, 4, 8);
  game.abilities = { grip: false, boots: false, dash: false, ...(s.abilities || {}) };
  game.tokens = new Set(s.tokens || []);
  game.taken = new Set(s.taken || []);
  game.collected = new Set(s.collected || []);
  game.bosses = { warden: false, croc: false, ...(s.bosses || {}) };
  game.visited = new Set(s.visited || ['hub']);
  game.destroyed = new Set(s.destroyed || []);
  game.checkpoint = s.checkpoint || { room: 'hub', entry: 'start' };
  game.deaths = s.deaths || 0;
  game.playTime = s.playTime || 0;

  // restore broken walls
  for (const room of Object.values(game.rooms)) {
    for (const b of room.breakables) {
      if (game.destroyed.has(b.id)) {
        b.hp = 0;
        room.clear(b.x, b.y, b.w, b.h);
      }
    }
  }
  return true;
}

function refreshTitleButtons() {
  const cont = $('continueBtn');
  if (hasSave()) {
    cont.classList.remove('hidden');
    const s = readSave();
    const where = s?.checkpoint?.room;
    const label = where && game.rooms?.[where] ? game.rooms[where].name : 'LAST BENCH';
    $('titleMeta').textContent = `Continue at ${label.toLowerCase()} · ${s?.tokens?.length || 0}/6 tokens`;
  } else {
    cont.classList.add('hidden');
    $('titleMeta').textContent = 'Six tokens. Three relics. One very large reptile.';
  }
}

/* ------------------------------------------------------------------ */
/* rooms & entities                                                    */
/* ------------------------------------------------------------------ */
const ENEMY_STATS = {
  rat: { w: 30, h: 18, hp: 2, contact: 1 },
  roach: { w: 26, h: 20, hp: 2, contact: 1 },
  sludge: { w: 38, h: 28, hp: 4, contact: 1 },
  blast: { w: 32, h: 26, hp: 3, contact: 1 },
};

function makePlayer() {
  return {
    x: 0, y: 0, w: 22, h: 34, vx: 0, vy: 0, facing: 1,
    hp: game.maxHp, maxHp: game.maxHp,
    onGround: false, coyote: 0, jumpBuffer: 0, usedDouble: false,
    wallLock: 0, wallSide: 0, dashTimer: 0, dashCd: 0, dashDir: 1,
    attackTimer: 0, attackCd: 0, swung: new Set(),
    invuln: 0, hurtLock: 0, runPhase: 0, airTime: 0, stepT: 0,
  };
}

function makeEnemy(spawn) {
  const st = ENEMY_STATS[spawn.type];
  const w = st.w, h = st.h;
  const x = spawn.x * T + T / 2 - w / 2;
  const e = {
    kind: spawn.type, x, y: spawn.y * T - h, w, h, vx: 0, vy: 0,
    hp: st.hp, maxHp: st.hp, contact: st.contact,
    homeX: x, patrolTiles: spawn.patrol || 3.5,
    facing: Math.random() < 0.5 ? -1 : 1,
    onGround: false, timer: rand(0.4, 1.4), state: 'idle',
    hurtFlash: 0, seed: Math.random() * 10, dead: false,
    fly: spawn.type === 'roach' ? !!(spawn.fly || (spawn.y < 22 && hash(spawn.x, spawn.y, 4) > 0.45)) : false,
    dir: spawn.dir || 1, shootT: rand(0.6, 1.6),
  };
  if (e.kind === 'blast') {
    e.static = true;
    e.y = spawn.y * T - h / 2;
    e.x = spawn.x * T - w / 2;
  }
  return e;
}

function makeBoss(kind) {
  const room = game.room;
  const spawn = room.enemies.find(e => e.type === kind);
  const sx = spawn ? spawn.x : 30, sy = spawn ? spawn.y : 20;
  if (kind === 'warden') {
    const w = 120, h = 90;
    return {
      kind, name: 'THE SUMP WARDEN',
      x: sx * T + T / 2 - w / 2, y: sy * T - h, w, h, vx: 0, vy: 0,
      hp: 18, maxHp: 18, facing: -1, onGround: false, state: 'idle', timer: 1.4,
      hurtFlash: 0, enraged: false, summons: false, dead: false, slam: false,
    };
  }
  const w = 180, h = 110;
  return {
    kind, name: 'THE CROCODILE KING',
    x: sx * T + T / 2 - w / 2, y: sy * T - h, w, h, vx: 0, vy: 0,
    hp: 32, maxHp: 32, facing: -1, onGround: false, state: 'idle', timer: 2.2,
    hurtFlash: 0, phase: 1, summons: false, dead: false, chargeT: 0, deadTimer: 0,
    homeX: sx * T + T / 2 - w / 2,
  };
}

function enterRoom(id, entry = 'start', keepHp = true) {
  const def = game.rooms[id];
  if (!def) return;
  game.room = def;
  game.enemies = def.enemies.filter(e => e.type !== 'warden' && e.type !== 'croc').map(makeEnemy);
  game.boss = def.boss && !game.bosses[def.boss] ? makeBoss(def.boss) : null;
  game.bossActive = null;
  game.activeBarriers.clear();
  game.items = def.items
    .filter(it => !game.taken.has(it.id))
    .map(it => ({ ...it, taken: false }));
  game.notes = def.notes.map(n => ({ ...n }));
  game.projectiles = [];
  game.particles = [];
  game.updraftActive = !!game.bosses.warden;
  game.endingTimer = 0;
  game.deathTimer = 0;
  game.exitCooldown = 0.55;

  // re-apply destroyed secret walls
  for (const b of def.breakables) {
    if (game.destroyed.has(b.id) || b.hp <= 0) {
      b.hp = 0;
      def.clear(b.x, b.y, b.w, b.h);
    }
  }

  const e = def.entries[entry] || def.spawn || { x: 3, y: 3 };
  const p = game.player;
  p.x = e.x * T + (T - p.w) / 2;
  p.y = e.y * T - p.h;
  p.vx = 0;
  p.vy = e.vy || 0;
  p.onGround = false;
  p.dashTimer = 0;
  p.attackTimer = 0;
  p.invuln = Math.max(p.invuln, 0.6);
  if (!keepHp) p.hp = game.maxHp;
  p.maxHp = game.maxHp;

  game.visited.add(id);
  game.banner = { name: def.name, sub: def.sub, t: 4.4 };
  game.prompt = null;
  game.nearest = null;
  game.shake = 0;

  updateCamera(0, true);
  saveGame();
  if (def.boss && !game.bosses[def.boss]) {
    // boss arena ambience starts when actually triggered
    game.showHint = { text: def.boss === 'croc' ? 'Something enormous is breathing in the dark.' : 'The water is moving against the current.', t: 5 };
  } else if (def.id === 'hub' && !game.abilities.grip) {
    game.showHint = { text: 'The eastern tunnels are open. Find what the rats are guarding.', t: 6 };
  } else {
    game.showHint = null;
  }
}

/* ------------------------------------------------------------------ */
/* collision                                                           */
/* ------------------------------------------------------------------ */
function barrierRects() {
  const out = [];
  for (const it of game.room.interacts || []) {
    if (it.type === 'barrier' && game.activeBarriers.has(it.id)) {
      out.push({ x: it.x * T, y: it.y * T, w: it.w * T, h: it.h * T });
    }
  }
  return out;
}

function rectHits(room, x, y, w, h) {
  const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.001) / T);
  const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.001) / T);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (room.solid(xx, yy)) return true;
    }
  }
  const box = { x, y, w, h };
  for (const b of barrierRects()) if (aabb(box, b)) return true;
  return false;
}

function moveEntity(e, dx, dy, room) {
  e.hitWall = false;
  e.hitCeiling = false;
  e.onGround = false;
  if (dx !== 0) {
    const steps = Math.max(1, Math.ceil(Math.abs(dx) / 7));
    const step = dx / steps;
    for (let i = 0; i < steps; i++) {
      e.x += step;
      if (rectHits(room, e.x, e.y, e.w, e.h)) {
        e.x -= step;
        e.vx = 0;
        e.hitWall = true;
        break;
      }
    }
  }
  if (dy !== 0) {
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 7));
    const step = dy / steps;
    for (let i = 0; i < steps; i++) {
      e.y += step;
      if (rectHits(room, e.x, e.y, e.w, e.h)) {
        e.y -= step;
        if (step > 0) e.onGround = true;
        else e.hitCeiling = true;
        e.vy = 0;
        break;
      }
    }
  }
}

function overlapRect(e, r) {
  return e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y;
}

/* ------------------------------------------------------------------ */
/* camera, particles, effects                                          */
/* ------------------------------------------------------------------ */
function updateCamera(dt, snap = false) {
  const def = game.room;
  const p = game.player;
  const rw = def.w * T, rh = def.h * T;
  let tx = p.x + p.w / 2 - VIEW_W / 2 + p.facing * 34;
  let ty = p.y + p.h / 2 - VIEW_H * 0.57;
  if (rw <= VIEW_W) tx = (rw - VIEW_W) / 2;
  else tx = clamp(tx, 0, rw - VIEW_W);
  if (rh <= VIEW_H) ty = (rh - VIEW_H) / 2;
  else ty = clamp(ty, 0, rh - VIEW_H);
  if (snap) {
    game.cam.x = tx;
    game.cam.y = ty;
  } else {
    game.cam.x = lerp(game.cam.x, tx, clamp(dt * 8, 0, 1));
    game.cam.y = lerp(game.cam.y, ty, clamp(dt * 8, 0, 1));
  }
}

function particle(opts) {
  if (game.particles.length > 420) game.particles.shift();
  game.particles.push({
    x: 0, y: 0, vx: 0, vy: 0, life: 0.6, max: 0.6, size: 3,
    color: '#b9f23c', grav: 0, drag: 0, shape: 'dot', glow: false, fg: false, ...opts,
  });
}

function burst(x, y, color, n = 8, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 260);
    particle({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (opts.up || 0),
      life: rand(0.25, 0.7), max: 0.7,
      size: rand(1.5, 4), color, grav: opts.grav ?? 620,
      drag: 1.5, shape: Math.random() < 0.3 ? 'square' : 'dot',
      glow: opts.glow || false,
    });
  }
}

function dust(x, y, dir = 0, color = 'rgba(190,210,180,.45)', n = 5) {
  for (let i = 0; i < n; i++) {
    particle({
      x: x + rand(-6, 6), y: y + rand(-3, 2),
      vx: dir * rand(10, 70) + rand(-30, 30),
      vy: rand(-70, -15),
      life: rand(0.2, 0.55), max: 0.55,
      size: rand(2, 5), color, grav: 160, drag: 2.4,
    });
  }
}

function toast(text) { game.toast = { text, t: 3 }; }

/* ------------------------------------------------------------------ */
/* UI screens                                                          */
/* ------------------------------------------------------------------ */
const SCREENS = ['titleScreen', 'pauseScreen', 'mapScreen', 'noteScreen', 'deadScreen', 'endScreen'];

function syncTouchUI() {
  document.body.classList.toggle('in-game', game.state === 'play');
}

function hideScreens() {
  for (const id of SCREENS) $(id)?.classList.add('hidden');
  syncTouchUI();
}

function showScreen(id) {
  hideScreens();
  $(id)?.classList.remove('hidden');
  syncTouchUI();
}

function objective() {
  if (!game.abilities.grip) return 'The eastern tunnels run under the old transit line. Find what the rats are guarding.';
  const missing = [];
  if (!game.abilities.boots) missing.push('the sump');
  if (!game.abilities.dash) missing.push('Boiler 3');
  if (missing.length) return `Relics remain in ${missing.length === 2 ? 'the sump and Boiler 3' : missing[0]}. Search west of the junction and below it.`;
  if (!game.bosses.croc) return 'The Overflow climbs to the old reservoir. The Crocodile King is waiting at the top.';
  return 'The reservoir is quiet. The city above will never know.';
}

function updatePausePanel() {
  $('pauseRelics').innerHTML = Object.entries(RELICS).map(([id, r]) => {
    const has = game.abilities[id];
    return `<li class="${has ? '' : 'locked'}"><span class="glyph">${r.glyph}</span><span>${r.name}<small>${has ? r.desc : 'Undiscovered'}</small></span></li>`;
  }).join('');
  $('pauseTokens').textContent = `${game.tokens.size} / ${TOKEN_TOTAL}`;
  $('pauseRooms').textContent = `${game.visited.size} / ${ROOM_TOTAL}`;
  $('pauseObjective').textContent = objective();
}

function openPause() {
  if (game.state !== 'play') return;
  game.state = 'paused';
  updatePausePanel();
  showScreen('pauseScreen');
  audio.sfx('menu');
  for (const k in held) held[k] = false;
}

function closePause() {
  if (game.state !== 'paused') return;
  game.state = 'play';
  hideScreens();
  audio.sfx('menu');
}

function openMap() {
  if (game.state !== 'play' && game.state !== 'paused') return;
  game.state = 'map';
  $('mapObjective').textContent = objective();
  $('mapTokens').textContent = `Tokens ${game.tokens.size}/${TOKEN_TOTAL}`;
  const ab = Object.values(game.abilities).filter(Boolean).length;
  $('mapAbilities').textContent = `Relics ${ab}/3`;
  showScreen('mapScreen');
  renderer.drawMap(game);
  audio.sfx('menu');
  for (const k in held) held[k] = false;
}

function closeMap() {
  if (game.state !== 'map') return;
  game.state = 'play';
  hideScreens();
  audio.sfx('menu');
}

function openNote(id) {
  const n = game.notes.find(x => x.id === id);
  if (!n) return;
  game.state = 'note';
  $('noteTag').textContent = n.tag || 'FIELD NOTE';
  $('noteTitle').textContent = n.title;
  $('noteBody').textContent = n.text;
  showScreen('noteScreen');
  if (!game.collected.has(id)) {
    game.collected.add(id);
    saveGame();
  }
  audio.sfx('note');
  for (const k in held) held[k] = false;
}

function closeNote() {
  if (game.state !== 'note') return;
  game.state = 'play';
  hideScreens();
  audio.sfx('menu');
}

function die() {
  const p = game.player;
  p.hp = 0;
  game.deaths++;
  game.state = 'dead';
  audio.sfx('death');
  audio.setBossMode(false);
  game.shake = 14;
  burst(p.x + p.w / 2, p.y + p.h / 2, '#ff6b5a', 26, { grav: 300, up: 100, glow: true });
  const lines = [
    'The tunnels always give you back.',
    'Somewhere above, a faucet drips.',
    'The Bureau does not issue medals for this.',
    'The rats will not tell anyone.',
    'You are not the first down here.',
  ];
  $('deadLine').textContent = lines[Math.floor(Math.random() * lines.length)];
  showScreen('deadScreen');
  for (const k in held) held[k] = false;
}

function respawn() {
  game.state = 'play';
  hideScreens();
  game.player = makePlayer();
  game.player.hp = game.maxHp;
  game.player.invuln = 1.4;
  const cp = game.checkpoint || { room: 'hub', entry: 'start' };
  enterRoom(game.rooms[cp.room] ? cp.room : 'hub', cp.entry || 'start');
  audio.startMusic();
  audio.setBossMode(false);
  toast('You crawl back to the last bench.');
}

function startNewGame() {
  game.rooms = buildRooms();
  game.abilities = { grip: false, boots: false, dash: false };
  game.maxHp = 4;
  game.tokens = new Set();
  game.taken = new Set();
  game.collected = new Set();
  game.bosses = { warden: false, croc: false };
  game.visited = new Set(['hub']);
  game.destroyed = new Set();
  game.checkpoint = { room: 'hub', entry: 'start' };
  game.deaths = 0;
  game.playTime = 0;
  game.state = 'play';
  game.player = makePlayer();
  game.player.hp = game.maxHp;
  game.particles = [];
  game.projectiles = [];
  game.transition = null;
  game.boss = null;
  game.bossActive = null;
  game.activeBarriers.clear();
  game.updraftActive = false;
  game.endingTimer = 0;
  game.bigBanner = null;
  game.toast = null;
  game.staticVersion++;
  hideScreens();
  enterRoom('hub', 'start', false);
  saveGame();
  audio.startMusic();
  audio.setBossMode(false);
}

function continueGame() {
  const s = readSave();
  if (!s || !applySave(s)) { startNewGame(); return; }
  game.state = 'play';
  game.player = makePlayer();
  game.player.hp = clamp(s.hp ?? game.maxHp, 1, game.maxHp);
  game.particles = [];
  game.projectiles = [];
  game.transition = null;
  hideScreens();
  const cp = game.checkpoint;
  enterRoom(game.rooms[cp.room] ? cp.room : 'hub', cp.entry || 'start', false);
  game.player.hp = clamp(s.hp ?? game.maxHp, 1, game.maxHp);
  audio.startMusic();
  audio.setBossMode(false);
  toast('Welcome back to the underworld.');
}

function showEnding() {
  game.state = 'ending';
  document.body.classList.add('ending');
  hideScreens();
  const mins = Math.floor(game.playTime / 60);
  const secs = Math.floor(game.playTime % 60);
  const ab = Object.values(game.abilities).filter(Boolean).length;
  $('endStats').innerHTML = `
    <div>Time in the tunnels<b>${mins}:${String(secs).padStart(2, '0')}</b></div>
    <div>Tokens recovered<b>${game.tokens.size} / ${TOKEN_TOTAL}</b></div>
    <div>Relics claimed<b>${ab} / 3</b></div>
    <div>Rooms charted<b>${game.visited.size} / ${ROOM_TOTAL}</b></div>
    <div>Times drowned<b>${game.deaths}</b></div>`;
  showScreen('endScreen');
  audio.sfx('relic');
  audio.setBossMode(false);
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

/* ------------------------------------------------------------------ */
/* title / buttons / input                                             */
/* ------------------------------------------------------------------ */
function initUI() {
  $('startBtn').addEventListener('click', () => {
    audio.init(); audio.startMusic();
    startNewGame();
  });
  $('continueBtn').addEventListener('click', () => {
    audio.init(); audio.startMusic();
    continueGame();
  });
  $('resumeBtn').addEventListener('click', closePause);
  $('mapBtn').addEventListener('click', openMap);
  $('quitBtn').addEventListener('click', () => {
    hideScreens();
    game.state = 'title';
    audio.setBossMode(false);
    refreshTitleButtons();
    showScreen('titleScreen');
  });
  $('mapCloseBtn').addEventListener('click', closeMap);
  $('noteCloseBtn').addEventListener('click', closeNote);
  $('respawnBtn').addEventListener('click', respawn);
  $('againBtn').addEventListener('click', () => {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    startNewGame();
  });
  $('touchPause').addEventListener('click', () => {
    game.state === 'paused' ? closePause() : openPause();
  });
  $('touchMap').addEventListener('click', () => {
    game.state === 'map' ? closeMap() : openMap();
  });
  $('soundBtn').addEventListener('click', () => {
    audio.init();
    const m = audio.toggleMute();
    $('soundBtn').classList.toggle('muted', m);
    $('soundBtn').textContent = m ? '×' : '♪';
  });

  // touch buttons
  document.querySelectorAll('.tbtn[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    const down = e => {
      e.preventDefault();
      if (!audio.ctx) { audio.init(); audio.startMusic(); }
      held[key] = true;
      edges.add(key);
      btn.classList.add('active');
    };
    const up = e => {
      e.preventDefault();
      held[key] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });
}

// keyboard
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump',
  KeyJ: 'attack', KeyX: 'attack',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash',
};
const PREVENT = new Set([...Object.keys(KEYMAP), 'KeyM', 'KeyP', 'Escape', 'Enter']);

window.addEventListener('keydown', e => {
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (!audio.ctx && (game.state === 'play' || game.state === 'title')) {
    audio.init(); audio.startMusic();
  }
  const mapped = KEYMAP[e.code];
  if (mapped && game.state === 'play') {
    held[mapped] = true;
    edges.add(mapped);
  }
  if (e.code === 'KeyM') {
    if (game.state === 'map') closeMap();
    else if (game.state === 'play' || game.state === 'paused') openMap();
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.state === 'play') openPause();
    else if (game.state === 'paused') closePause();
    else if (game.state === 'map') closeMap();
    else if (game.state === 'note') closeNote();
  }
  if (e.code === 'Enter') {
    if (game.state === 'title') {
      audio.init(); audio.startMusic();
      hasSave() ? continueGame() : startNewGame();
    }
  }
});

window.addEventListener('keyup', e => {
  const mapped = KEYMAP[e.code];
  if (mapped) held[mapped] = false;
});

window.addEventListener('blur', () => {
  for (const k in held) held[k] = false;
  if (game.state === 'play') openPause();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'play') openPause();
});

// detect touch
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
}
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

/* ------------------------------------------------------------------ */
/* interactions                                                        */
/* ------------------------------------------------------------------ */
function interactPoints() {
  const p = game.player;
  const cx = p.x + p.w / 2;
  const feet = p.y + p.h;
  const out = [];
  for (const it of game.room.interacts) {
    if (it.type === 'barrier') continue;
    const ix = it.x * T + T / 2;
    const iy = it.y * T;
    let label = it.label || 'USE';
    let rangeX = 78, rangeY = 74;
    if (it.type === 'hatch') { rangeX = (it.w || 3) * T / 2 + 26; rangeY = 60; }
    if (it.type === 'note') { rangeX = 62; rangeY = 62; }
    if (Math.abs(cx - ix) < rangeX && Math.abs(feet - iy) < rangeY) {
      if (it.type === 'bench') label = 'SAVE BENCH';
      if (it.type === 'hatch') label = 'OPEN SUMP HATCH';
      if (it.type === 'note') label = 'READ NOTE';
      out.push({ it, label, d: Math.abs(cx - ix) + Math.abs(feet - iy) });
    }
  }
  // notes are also interact points
  for (const n of game.notes) {
    if (game.collected.has(n.id)) continue;
    const ix = n.x * T + T / 2;
    const iy = n.y * T;
    if (Math.abs(cx - ix) < 66 && Math.abs(feet - iy) < 66) {
      out.push({ it: { type: 'note', id: n.id }, label: 'READ NOTE', d: Math.abs(cx - ix) + Math.abs(feet - iy) });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function performInteract(target) {
  if (!target) return;
  const it = target.it;
  if (it.type === 'bench') {
    game.player.hp = game.maxHp;
    game.checkpoint = { room: game.room.id, entry: 'bench' };
    saveGame();
    audio.sfx('save');
    toast('Bench saved. Take a breath.');
    burst(game.player.x + 11, game.player.y + 17, '#a6ff9a', 12, { glow: true, grav: -40 });
    game.banner = { name: 'RESTED', sub: 'PROGRESS SAVED TO THE BENCH', t: 2.2 };
  } else if (it.type === 'hatch') {
    startTransition(it.to, it.entry);
  } else if (it.type === 'note') {
    openNote(it.id);
  }
}

/* ------------------------------------------------------------------ */
/* transitions, abilities, pickups                                     */
/* ------------------------------------------------------------------ */
function startTransition(to, entry) {
  if (game.transition) return;
  game.transition = { time: 0, dur: 0.62, target: to, entry, swapped: false };
  audio.sfx('door');
  for (const k in held) held[k] = false;
}

function grantAbility(id) {
  if (game.abilities[id]) return;
  game.abilities[id] = true;
  const relic = RELICS[id];
  game.bigBanner = {
    kicker: 'RELIC RECOVERED',
    title: relic.name,
    sub: relic.desc.toUpperCase(),
    t: 4.2,
  };
  audio.sfx('relic');
  game.shake = 6;
  burst(game.player.x + 11, game.player.y + 17, '#d9ff7a', 30, { glow: true, grav: -80, up: 60 });
  saveGame();
}

function collectItems() {
  const p = game.player;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  for (const it of game.items) {
    if (it.taken) continue;
    if (it.bossDrop && !game.bosses[it.bossDrop]) continue;
    const ix = it.x * T, iy = it.y * T;
    if (dist(cx, cy, ix, iy) > 46) continue;
    if (it.type === 'token') {
      it.taken = true;
      game.taken.add(it.id);
      game.tokens.add(it.id);
      audio.sfx('token');
      burst(ix, iy, '#ffd86a', 12, { glow: true, grav: -30 });
      toast(`Transit token recovered — ${game.tokens.size}/${TOKEN_TOTAL}`);
      saveGame();
    } else if (it.type === 'cell') {
      it.taken = true;
      game.taken.add(it.id);
      game.maxHp = Math.min(8, game.maxHp + 1);
      p.maxHp = game.maxHp;
      p.hp = Math.min(game.maxHp, p.hp + 2);
      audio.sfx('relic');
      burst(ix, iy, '#ff8873', 18, { glow: true, grav: -40 });
      game.bigBanner = { kicker: 'BIO-CELL FOUND', title: '+1 MAXIMUM HEALTH', sub: 'THE BODY REMEMBERS', t: 3.4 };
      saveGame();
    } else if (it.type === 'relic') {
      it.taken = true;
      game.taken.add(it.id);
      grantAbility(it.ability);
    }
  }
}

/* ------------------------------------------------------------------ */
/* attack / damage                                                     */
/* ------------------------------------------------------------------ */
function playerAttackBox() {
  const p = game.player;
  return p.facing > 0
    ? { x: p.x + p.w - 2, y: p.y + 2, w: 46, h: 30 }
    : { x: p.x - 42, y: p.y + 2, w: 46, h: 30 };
}

function processAttack() {
  const p = game.player;
  if (p.attackTimer <= 0) return;
  if (p.attackTimer > 0.21 || p.attackTimer < 0.04) return;
  const box = playerAttackBox();
  // enemies
  for (const e of game.enemies) {
    if (e.dead || p.swung.has(e)) continue;
    if (aabb(box, e)) {
      p.swung.add(e);
      hitEnemy(e, 1, box);
    }
  }
  if (game.boss && game.bossActive && !game.boss.dead && !p.swung.has(game.boss) && aabb(box, game.boss)) {
    p.swung.add(game.boss);
    hitBoss(game.boss, 1);
  }
  for (const pr of [...game.projectiles]) {
    if (p.swung.has(pr)) continue;
    if (aabb(box, { x: pr.x - 10, y: pr.y - 10, w: 20, h: 20 })) {
      p.swung.add(pr);
      game.projectiles.splice(game.projectiles.indexOf(pr), 1);
      burst(pr.x, pr.y, '#d9ff7a', 6, { glow: true });
      audio.sfx('hit');
    }
  }
  for (const b of game.room.breakables) {
    if (b.hp <= 0 || p.swung.has(b)) continue;
    const r = { x: b.x * T, y: b.y * T, w: b.w * T, h: b.h * T };
    if (aabb(box, r)) {
      p.swung.add(b);
      b.hp--;
      game.shake = 4;
      audio.sfx('hit');
      burst(r.x + r.w / 2, r.y + r.h / 2, '#c9d8b0', 10, { grav: 500 });
      if (b.hp <= 0) {
        game.room.clear(b.x, b.y, b.w, b.h);
        game.destroyed.add(b.id);
        game.staticVersion = (game.staticVersion || 0) + 1;
        game.shake = 8;
        audio.sfx('kill');
        burst(r.x + r.w / 2, r.y + r.h / 2, '#8b7355', 20, { grav: 700 });
        saveGame();
      }
    }
  }
}

function hitEnemy(e, dmg, box) {
  e.hp -= dmg;
  e.hurtFlash = 0.15;
  e.vx += game.player.facing * 160;
  e.vy = -120;
  game.hitstop = Math.max(game.hitstop, 0.035);
  game.shake = Math.max(game.shake, 4);
  audio.sfx('hit');
  burst(e.x + e.w / 2, e.y + e.h / 2, e.kind === 'blast' ? '#ffb35c' : '#9bff9c', 6, { grav: 500 });
  if (e.hp <= 0) {
    e.dead = true;
    game.shake = Math.max(game.shake, 6);
    audio.sfx('kill');
    burst(e.x + e.w / 2, e.y + e.h / 2, '#7fae4d', 18, { grav: 650 });
    if (e.kind === 'sludge') toast('The sludge gives up its shape.');
  }
}

function hitBoss(b, dmg) {
  b.hp -= dmg;
  b.hurtFlash = 0.12;
  game.hitstop = 0.05;
  game.shake = 7;
  audio.sfx('hit');
  burst(b.x + b.w / 2, b.y + b.h / 2, '#d9ff7a', 9, { grav: 400 });
  if (b.kind === 'croc' && b.phase === 1 && b.hp <= b.maxHp * 0.6) {
    b.phase = 2;
    audio.sfx('roar');
    toast('The Crocodile King is enraged.');
  }
  if (b.hp <= 0) defeatBoss(b);
}

function hurtPlayer(amount, sourceX, knock = 280) {
  const p = game.player;
  if (p.invuln > 0 || game.state !== 'play') return;
  p.hp -= amount;
  p.invuln = 1.2;
  p.hurtLock = 0.16;
  p.vx = sign(p.x + p.w / 2 - sourceX) * knock;
  p.vy = -330;
  p.onGround = false;
  game.shake = 10;
  game.hitstop = 0.06;
  audio.sfx('hurt');
  burst(p.x + p.w / 2, p.y + p.h / 2, '#ff6b5a', 12, { grav: 500, glow: true });
  if (p.hp <= 0) {
    p.hp = 0;
    die();
  }
}

/* ------------------------------------------------------------------ */
/* bosses                                                              */
/* ------------------------------------------------------------------ */
function startBoss(kind) {
  if (game.bossActive) return;
  game.bossActive = kind;
  game.activeBarriers.add(kind === 'warden' ? 'sumpGate' : 'crocGate');
  game.boss.state = 'idle';
  game.boss.timer = 1.1;
  game.shake = 8;
  audio.sfx(kind === 'croc' ? 'roar' : 'boss');
  audio.setBossMode(true);
  if (kind === 'croc') toast('THE CROCODILE KING');
  else toast('THE SUMP WARDEN');
  for (const k in held) held[k] = false;
}

function defeatBoss(b) {
  b.hp = 0;
  b.dead = true;
  b.deadTimer = 2.8;
  game.bosses[b.kind] = true;
  game.bossActive = null;
  game.activeBarriers.clear();
  game.shake = 16;
  game.hitstop = 0.16;
  audio.setBossMode(false);
  audio.sfx('kill');
  burst(b.x + b.w / 2, b.y + b.h / 2, b.kind === 'croc' ? '#ff8f6a' : '#b9f23c', 36, { grav: 400, glow: true });
  saveGame();

  if (b.kind === 'warden') {
    game.updraftActive = true;
    game.player.hp = Math.min(game.maxHp, game.player.hp + 2);
    game.bigBanner = { kicker: 'SUMP WARDEN DOWN', title: 'THE LIFT WAKES', sub: 'SUMP BOOTS RECOVERED — JUMP AGAIN IN MIDAIR', t: 4.4 };
    audio.sfx('relic');
    toast('The updraft is active. Take the boots.');
  } else {
    game.endingTimer = 3.6;
    game.player.invuln = 99;
    audio.sfx('death');
    toast('The reservoir goes quiet.');
  }
}

function spawnWave(x, y, dir) {
  game.projectiles.push({
    type: 'wave', x, y, vx: dir * 300, vy: 0, w: 28, h: 34,
    life: 2.4, max: 2.4, r: 10,
  });
}

function spawnAcid(x, y, vx, vy) {
  game.projectiles.push({
    type: 'acid', x, y, vx, vy, w: 14, h: 14, r: 7,
    life: 4, max: 4,
  });
}

function updateWarden(b, dt) {
  const p = game.player;
  const bx = b.x + b.w / 2;
  const px = p.x + p.w / 2;
  const dx = px - bx;
  const dir = sign(dx) || 1;
  b.timer -= dt;
  b.hurtFlash = Math.max(0, b.hurtFlash - dt);

  if (b.hp < b.maxHp * 0.5 && !b.summons) {
    b.summons = true;
    b.enraged = true;
    toast('The Sump Warden splits the sludge.');
    for (const off of [-1, 1]) {
      const e = makeEnemy({ type: 'sludge', x: b.x / T + 3 + off * 3, y: 21, patrol: 2 });
      e.x = bx + off * 110; e.y = b.y + b.h - e.h;
      e.vy = -260; e.vx = off * 80;
      game.enemies.push(e);
    }
  }

  if (b.state === 'idle') {
    b.vx = lerp(b.vx, Math.sign(dx) * 26, dt * 2);
    b.facing = dir;
    if (b.timer <= 0) {
      b.state = 'telegraph';
      b.timer = 0.62;
      b.vx = 0;
      audio.sfx('boss');
      dust(bx, b.y + b.h, 0, 'rgba(140,220,140,.4)', 8);
    }
  } else if (b.state === 'telegraph') {
    b.facing = dir;
    if (b.timer <= 0) {
      b.vy = -790;
      b.vx = clamp(dx * 1.45, -360, 360);
      b.state = 'leap';
      b.timer = 1.3;
      audio.sfx('jump');
      b.onGround = false;
    }
  } else if (b.state === 'leap') {
    if (b.onGround) {
      b.state = 'recover';
      b.timer = 0.95;
      b.vx = 0;
      game.shake = 12;
      audio.sfx('slam');
      spawnWave(bx - 30, b.y + b.h - 34, -1);
      spawnWave(bx + 30, b.y + b.h - 34, 1);
      burst(bx, b.y + b.h, '#9bff9c', 24, { grav: 700, up: 100 });
      for (let i = 0; i < 8; i++) dust(bx + rand(-70, 70), b.y + b.h, 0, 'rgba(140,200,140,.35)', 1);
    }
  } else if (b.state === 'recover') {
    b.vx = lerp(b.vx, 0, dt * 5);
    if (b.timer <= 0) {
      b.state = 'idle';
      b.timer = b.enraged ? rand(0.7, 1.2) : rand(1.1, 1.9);
    }
  }

  b.vy = Math.min(b.vy + PHYS.gravity * dt, 1200);
  moveEntity(b, b.vx * dt, b.vy * dt, game.room);
  if (b.onGround) b.vy = 0;
  if (b.hitWall) b.vx = 0;
}

function updateCroc(b, dt) {
  const p = game.player;
  const bx = b.x + b.w / 2;
  const px = p.x + p.w / 2;
  const dx = px - bx;
  const distX = Math.abs(dx);
  b.timer -= dt;
  b.hurtFlash = Math.max(0, b.hurtFlash - dt);
  if (b.phase < 3 && b.hp <= b.maxHp * 0.3) {
    b.phase = 3;
    audio.sfx('roar');
    game.shake = 10;
    toast('It is not slowing down.');
  }

  if (b.state === 'idle') {
    b.facing = sign(dx) || b.facing;
    b.vx = lerp(b.vx, b.facing * (b.phase >= 2 ? 70 : 42), dt * 3);
    if (b.timer <= 0) {
      if (distX < 150) { b.state = 'tailTell'; b.timer = 0.45; }
      else if (distX > 220 && Math.random() < 0.68) { b.state = 'chargeTell'; b.timer = 0.72; }
      else { b.state = 'spitTell'; b.timer = 0.5; }
      b.vx = 0;
    }
  } else if (b.state === 'chargeTell') {
    b.facing = sign(dx) || b.facing;
    b.vx = 0;
    if (Math.random() < 0.3) dust(bx + b.facing * 50, b.y + b.h, -b.facing, 'rgba(255,140,90,.35)', 1);
    if (b.timer <= 0) {
      b.state = 'charge';
      b.chargeT = 1.15;
      b.vx = b.facing * (b.phase >= 2 ? 720 : 620);
      audio.sfx('roar');
      game.shake = 8;
    }
  } else if (b.state === 'charge') {
    b.chargeT -= dt;
    if (b.chargeT <= 0 || b.hitWall) {
      b.state = 'recover';
      b.timer = 0.9;
      b.vx = 0;
      if (b.hitWall) {
        game.shake = 13;
        audio.sfx('slam');
        burst(bx + b.facing * b.w / 2, b.y + b.h / 2, '#ff8f6a', 18, { grav: 500 });
      }
    }
  } else if (b.state === 'spitTell') {
    b.vx = 0;
    b.facing = sign(dx) || b.facing;
    if (b.timer <= 0) {
      const mx = b.x + (b.facing > 0 ? b.w + 6 : -6);
      const my = b.y + 38;
      for (let i = -1; i <= 1; i++) {
        const tx = px + i * 80;
        const dx2 = tx - mx;
        const dy2 = (p.y + p.h - 6) - my;
        const t = clamp(Math.abs(dx2) / 300, 0.45, 1.4);
        spawnAcid(mx, my, dx2 / t, dy2 / t - 220);
      }
      audio.sfx('roar');
      b.state = 'recover';
      b.timer = 0.6;
    }
  } else if (b.state === 'tailTell') {
    b.vx = 0;
    if (b.timer <= 0) {
      b.state = 'recover';
      b.timer = 0.6;
      game.shake = 10;
      audio.sfx('slam');
      if (distX < 185 && Math.abs(p.y + p.h - (b.y + b.h)) < 90) {
        hurtPlayer(1, bx, 360);
      }
      spawnWave(bx - 80, b.y + b.h - 34, -1);
      spawnWave(bx + 80, b.y + b.h - 34, 1);
      burst(bx, b.y + b.h - 20, '#ff8f6a', 14, { grav: 500 });
    }
  } else if (b.state === 'recover') {
    b.vx = lerp(b.vx, 0, dt * 6);
    if (b.timer <= 0) {
      b.state = 'idle';
      b.timer = b.phase >= 2 ? rand(1.0, 1.6) : rand(1.5, 2.3);
    }
  }

  if (b.phase >= 2 && b.hp < b.maxHp * 0.5 && !b.summons) {
    b.summons = true;
    toast('The King calls his court.');
    for (const off of [-1, 1]) {
      const e = makeEnemy({ type: 'rat', x: 10, y: 24, patrol: 2 });
      e.x = bx + off * 160; e.y = 24 * T - e.h;
      e.vx = off * 120;
      game.enemies.push(e);
    }
  }

  b.vy = Math.min(b.vy + PHYS.gravity * dt, 1400);
  moveEntity(b, b.vx * dt, b.vy * dt, game.room);
  if (b.onGround) b.vy = 0;
  if (b.hitWall && b.state === 'charge') b.chargeT = 0;
}

function updateBoss(dt) {
  const b = game.boss;
  if (!b || b.dead) return;
  const p = game.player;
  if (!game.bossActive) {
    if (!game.bosses[b.kind]) {
      if (b.kind === 'warden' && p.y > 4 * T) startBoss('warden');
      if (b.kind === 'croc' && p.y > 10 * T) startBoss('croc');
    }
    return;
  }
  if (b.kind === 'warden') updateWarden(b, dt);
  else updateCroc(b, dt);

  // contact damage
  if (aabb(p, b)) hurtPlayer(1, b.x + b.w / 2, 340);
}

/* ------------------------------------------------------------------ */
/* enemies & projectiles                                               */
/* ------------------------------------------------------------------ */
function groundAhead(room, e, dir) {
  const x = dir > 0 ? e.x + e.w + 3 : e.x - 3;
  return room.solid(Math.floor(x / T), Math.floor((e.y + e.h + 5) / T));
}

function updateEnemies(dt) {
  const p = game.player;
  const room = game.room;
  const px = p.x + p.w / 2, py = p.y + p.h / 2;

  for (const e of game.enemies) {
    if (e.dead) continue;
    e.hurtFlash = Math.max(0, e.hurtFlash - dt);
    const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    const dx = px - ex, dy = py - ey;
    const pd = Math.hypot(dx, dy);

    if (e.kind === 'rat') {
      e.timer -= dt;
      if (pd < 230 && Math.abs(dy) < 80) {
        e.facing = sign(dx) || e.facing;
        e.vx = lerp(e.vx, e.facing * 132, dt * 7);
      } else {
        if (Math.abs(e.x - e.homeX) > e.patrolTiles * T) e.facing = sign(e.homeX - e.x) || e.facing;
        if (!groundAhead(room, e, e.facing)) e.facing *= -1;
        e.vx = lerp(e.vx, e.facing * 58, dt * 5);
      }
      e.vy = Math.min(e.vy + PHYS.gravity * dt, 900);
      moveEntity(e, e.vx * dt, e.vy * dt, room);
      if (e.hitWall) { e.facing *= -1; e.vx = 0; }
      if (e.hitCeiling) e.vy = 0;
    } else if (e.kind === 'roach') {
      if (e.fly) {
        const aggro = pd < 300;
        const tx = e.facing * 90, ty = Math.sin(game.time * 2 + e.seed) * 40;
        const seekX = aggro ? clamp(dx, -150, 150) : clamp(e.homeX - ex, -60, 60);
        const seekY = aggro ? clamp(dy, -120, 120) : Math.sin(game.time * 0.8 + e.seed) * 60;
        e.vx = lerp(e.vx, seekX + tx, dt * 1.6);
        e.vy = lerp(e.vy, seekY + ty, dt * 1.6);
        if (aggro && Math.abs(dx) > 8) e.facing = sign(dx) || e.facing;
        if (e.hitWall) { e.vx *= -0.7; e.x += e.facing * 2; }
        moveEntity(e, e.vx * dt, e.vy * dt, room);
      } else {
        if (pd < 300) {
          e.facing = sign(dx) || e.facing;
          e.vx = lerp(e.vx, e.facing * 150, dt * 8);
          if (e.onGround && Math.random() < 0.008) e.vy = -430;
        } else {
          e.vx = lerp(e.vx, e.facing * 40, dt * 4);
        }
        e.vy = Math.min(e.vy + PHYS.gravity * dt, 900);
        moveEntity(e, e.vx * dt, e.vy * dt, room);
        if (e.hitWall) e.facing *= -1;
      }
    } else if (e.kind === 'sludge') {
      e.timer -= dt;
      if (e.onGround && e.timer <= 0 && pd < 340) {
        e.vy = -460;
        e.vx = sign(dx) * 165;
        e.facing = sign(dx) || e.facing;
        e.timer = rand(1.5, 2.5);
        dust(e.x + e.w / 2, e.y + e.h, 0, 'rgba(120,200,120,.35)', 5);
      }
      e.vy = Math.min(e.vy + PHYS.gravity * dt, 950);
      moveEntity(e, e.vx * dt, e.vy * dt, room);
      if (e.onGround) e.vx = lerp(e.vx, 0, dt * 5);
      if (e.hitWall) e.vx = 0;
    } else if (e.kind === 'blast') {
      e.shootT -= dt;
      if (Math.abs(dx) > 4) e.facing = sign(dx) || 1;
      if (e.shootT <= 0 && pd < 470 && Math.abs(dy) < 150) {
        e.shootT = 1.85;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        game.projectiles.push({
          type: 'bolt', x: ex + e.facing * 14, y: ey, vx: (dx / len) * 260, vy: (dy / len) * 260,
          w: 12, h: 12, r: 5, life: 3, max: 3,
        });
        audio.sfx('hit');
        burst(ex + e.facing * 14, ey, '#ffb35c', 4, { glow: true, grav: 0 });
      }
    }

    if (aabb(p, e)) hurtPlayer(e.contact, ex, 280);
  }

  // remove dead
  game.enemies = game.enemies.filter(e => !e.dead || (e.deadTimer = (e.deadTimer || 0) + dt) < 0.3);
}

function updateProjectiles(dt) {
  const p = game.player;
  const room = game.room;
  const keep = [];
  for (const pr of game.projectiles) {
    pr.life -= dt;
    if (pr.life <= 0) continue;
    if (pr.type === 'acid') {
      pr.vy += 880 * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (Math.random() < 0.5) particle({
        x: pr.x, y: pr.y, vx: rand(-20, 20), vy: rand(-20, 20),
        life: 0.25, max: 0.25, size: 2.5, color: '#b9f23c', grav: 0, drag: 2, glow: true,
      });
      if (rectHits(room, pr.x - 4, pr.y - 4, 8, 8)) {
        burst(pr.x, pr.y, '#b9f23c', 7, { grav: 300, glow: true });
        continue;
      }
    } else if (pr.type === 'wave') {
      pr.x += pr.vx * dt;
      if (rectHits(room, pr.x - 14, pr.y + 4, 28, 28)) continue;
      if (Math.random() < 0.4) particle({
        x: pr.x + rand(-10, 10), y: pr.y + 30, vx: rand(-20, 20), vy: rand(-80, -20),
        life: 0.35, max: 0.35, size: 3, color: '#b9f23c', grav: 200, drag: 1, glow: true,
      });
    } else {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (rectHits(room, pr.x - 4, pr.y - 4, 8, 8)) {
        burst(pr.x, pr.y, '#ffb35c', 5, { grav: 200 });
        continue;
      }
    }
    if (aabb(p, { x: pr.x - pr.w / 2, y: pr.y - pr.h / 2, w: pr.w, h: pr.h })) {
      hurtPlayer(1, pr.x, 240);
      continue;
    }
    keep.push(pr);
  }
  game.projectiles = keep;
}

function updateParticles(dt) {
  for (const pt of game.particles) {
    pt.life -= dt;
    pt.vy += (pt.grav || 0) * dt;
    if (pt.drag) {
      pt.vx -= pt.vx * pt.drag * dt;
      pt.vy -= pt.vy * pt.drag * dt * 0.3;
    }
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
  game.particles = game.particles.filter(p => p.life > 0);
}

/* ------------------------------------------------------------------ */
/* ambient emitters                                                    */
/* ------------------------------------------------------------------ */
function updateProps(dt) {
  const room = game.room;
  for (const prop of room.props) {
    if (prop.type === 'drip') {
      prop._t = (prop._t ?? rand(0, 1)) - dt;
      if (prop._t <= 0) {
        prop._t = rand(0.5, 1.4) / (prop.rate || 1);
        particle({
          x: prop.x * T + rand(-2, 2), y: prop.y * T,
          vx: 0, vy: 90, life: 1.4, max: 1.4, size: 2,
          color: 'rgba(160,220,255,.65)', grav: 500, drag: 0, fg: true,
        });
      }
    } else if (prop.type === 'steam') {
      prop._t = (prop._t ?? 0) - dt;
      if (prop._t <= 0) {
        prop._t = 0.09 / (prop.rate || 1);
        particle({
          x: prop.x * T + rand(-10, 10), y: prop.y * T,
          vx: rand(-12, 12), vy: rand(-70, -30),
          life: rand(0.8, 1.6), max: 1.6, size: rand(5, 12),
          color: 'rgba(220,230,220,.13)', grav: -16, drag: 0.6, shape: 'dot',
        });
      }
    } else if (prop.type === 'bubbles') {
      prop._t = (prop._t ?? 0) - dt;
      if (prop._t <= 0) {
        prop._t = 0.22;
        particle({
          x: prop.x * T + rand(0, (prop.w || 4) * T), y: prop.y * T + rand(0, 14),
          vx: rand(-4, 4), vy: rand(-30, -12),
          life: rand(0.5, 1.1), max: 1.1, size: rand(1.5, 3.5),
          color: 'rgba(200,255,180,.35)', grav: -20, drag: 0, glow: false,
        });
      }
    } else if (prop.type === 'waterfall') {
      prop._t = (prop._t ?? 0) - dt;
      if (prop._t <= 0) {
        prop._t = 0.09;
        particle({
          x: prop.x * T + rand(0, (prop.w || 4) * T),
          y: prop.y * T + rand(0, (prop.h || 20) * T),
          vx: rand(-8, 8), vy: rand(40, 130),
          life: 0.5, max: 0.5, size: rand(1, 3),
          color: 'rgba(180,230,255,.28)', grav: 350, drag: 0, fg: true,
        });
      }
    }
  }

  // ambient dust
  game.ambientT = (game.ambientT || 0) - dt;
  if (game.ambientT <= 0) {
    game.ambientT = 0.22;
    const th = THEMES[room.theme] || THEMES.hub;
    particle({
      x: game.cam.x + rand(0, VIEW_W), y: game.cam.y + rand(0, VIEW_H),
      vx: rand(-6, 6), vy: rand(-16, -4),
      life: rand(1.2, 2.6), max: 2.6, size: rand(0.8, 2.2),
      color: th.accent, grav: 0, drag: 0.2, glow: true, alpha: 0.45,
    });
  }
}

/* ------------------------------------------------------------------ */
/* player update                                                       */
/* ------------------------------------------------------------------ */
function updatePlayer(dt) {
  const p = game.player;
  const room = game.room;
  p.maxHp = game.maxHp;

  p.invuln = Math.max(0, p.invuln - dt);
  p.attackCd = Math.max(0, p.attackCd - dt);
  p.attackTimer = Math.max(0, p.attackTimer - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.hurtLock > 0) p.hurtLock = Math.max(0, p.hurtLock - dt);
  if (p.wallLock > 0) p.wallLock = Math.max(0, p.wallLock - dt);

  if (edges.has('jump')) p.jumpBuffer = PHYS.buffer;
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  if (p.onGround) p.coyote = PHYS.coyote;
  else p.coyote = Math.max(0, p.coyote - dt);

  // wall contact probes
  const wallL = rectHits(room, p.x - 2, p.y + 3, 2, p.h - 8);
  const wallR = rectHits(room, p.x + p.w, p.y + 3, 2, p.h - 8);
  p.wallSide = wallL ? -1 : wallR ? 1 : 0;

  // dash
  if (edges.has('dash') && game.abilities.dash && p.dashCd <= 0 && p.dashTimer <= 0) {
    p.dashTimer = PHYS.dashTime;
    p.dashCd = PHYS.dashCd;
    p.dashDir = p.facing;
    p.vy = 0;
    audio.sfx('dash');
    game.shake = Math.max(game.shake, 2.5);
    for (let i = 0; i < 8; i++) {
      particle({
        x: p.x + p.w / 2 - p.facing * 8, y: p.y + rand(4, p.h - 4),
        vx: -p.facing * rand(60, 200), vy: rand(-40, 40),
        life: rand(0.15, 0.4), max: 0.4, size: rand(1.5, 4),
        color: '#9ad8ff', grav: 0, drag: 3, shape: 'square', glow: true,
      });
    }
  }

  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.vx = p.dashDir * PHYS.dashSpeed;
    p.vy = 0;
    if (Math.random() < 0.8) {
      particle({
        x: p.x + p.w / 2 - p.dashDir * rand(0, 14), y: p.y + rand(0, p.h),
        vx: -p.dashDir * rand(40, 120), vy: rand(-20, 20),
        life: 0.25, max: 0.25, size: rand(2, 5),
        color: '#9ad8ff', grav: 0, drag: 2, shape: 'streak', glow: true,
      });
    }
  } else if (p.hurtLock <= 0 && p.wallLock <= 0) {
    const dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if (dir) {
      const accel = p.onGround ? PHYS.accel : PHYS.airAccel;
      p.vx += dir * accel * dt;
      p.vx = clamp(p.vx, -PHYS.speed, PHYS.speed);
      p.facing = dir;
    } else {
      const fr = p.onGround ? PHYS.friction : PHYS.airDrag;
      if (Math.abs(p.vx) <= fr * dt) p.vx = 0;
      else p.vx -= sign(p.vx) * fr * dt;
    }
  }

  // jump / wall jump / double jump
  if (p.jumpBuffer > 0 && p.dashTimer <= 0) {
    if (p.onGround || p.coyote > 0) {
      p.vy = -PHYS.jump;
      p.jumpBuffer = 0;
      p.coyote = 0;
      p.onGround = false;
      p.usedDouble = false;
      audio.sfx('jump');
      dust(p.x + p.w / 2, p.y + p.h, 0, 'rgba(190,210,180,.35)', 5);
    } else if (game.abilities.grip && p.wallSide !== 0) {
      p.vy = -PHYS.wallJumpY;
      p.vx = -p.wallSide * PHYS.wallJumpX;
      p.facing = -p.wallSide;
      p.wallLock = 0.16;
      p.jumpBuffer = 0;
      p.usedDouble = false;
      audio.sfx('doublejump');
      dust(p.x + p.w / 2 + p.wallSide * 8, p.y + p.h * 0.55, -p.wallSide, 'rgba(185,242,60,.35)', 6);
    } else if (game.abilities.boots && !p.usedDouble) {
      p.vy = -PHYS.doubleJump;
      p.usedDouble = true;
      p.jumpBuffer = 0;
      audio.sfx('doublejump');
      burst(p.x + p.w / 2, p.y + p.h, '#9ad8ff', 8, { grav: 220, glow: true });
    }
  }

  // wall slide
  if (game.abilities.grip && !p.onGround && p.wallSide !== 0 && p.vy > 0 && p.dashTimer <= 0 && p.wallLock <= 0) {
    p.vy = Math.min(p.vy, PHYS.wallSlide);
    if (Math.random() < 0.25) {
      particle({
        x: p.x + (p.wallSide > 0 ? p.w + 2 : -2), y: p.y + rand(8, p.h),
        vx: -p.wallSide * rand(4, 20), vy: rand(-10, 10),
        life: 0.3, max: 0.3, size: 2, color: 'rgba(185,242,60,.4)', grav: 0, drag: 1,
      });
    }
  }

  // gravity / updraft
  const inLift = game.updraftActive && room.zones.some(z =>
    z.type === 'updraft' && overlapRect(p, { x: z.x * T, y: z.y * T, w: z.w * T, h: z.h * T }));
  if (p.dashTimer <= 0) {
    if (inLift) {
      p.vy = Math.max(p.vy - 5600 * dt, -760);
      if (Math.random() < 0.6) {
        particle({
          x: p.x + p.w / 2 + rand(-16, 16), y: p.y + p.h + rand(-6, 10),
          vx: rand(-20, 20), vy: rand(80, 240), life: 0.5, max: 0.5,
          size: rand(1.5, 3.5), color: '#b9f23c', grav: -100, drag: 0, glow: true,
        });
      }
    } else {
      let g = PHYS.gravity;
      if (p.vy < 0 && !held.jump) g *= 1.55;
      p.vy = Math.min(p.vy + g * dt, PHYS.maxFall);
    }
  }

  const wasGround = p.onGround;
  moveEntity(p, p.vx * dt, p.vy * dt, room);
  if (p.onGround) {
    p.usedDouble = false;
    if (!wasGround) {
      if (p.vy > 500) {
        audio.sfx('land');
        dust(p.x + p.w / 2, p.y + p.h, 0, 'rgba(190,210,180,.35)', 6);
      }
    }
    if (p.dashTimer > 0 && p.dashDir !== 0) {
      game.shake = Math.max(game.shake, 3);
    }
  } else {
    p.airTime = (p.airTime || 0) + dt;
  }
  if (p.hitWall && p.dashTimer > 0) {
    p.dashTimer = 0;
    p.vx = 0;
    game.shake = Math.max(game.shake, 6);
    burst(p.x + p.w / 2, p.y + p.h / 2, '#9ad8ff', 6, { grav: 200 });
  }
  if (p.hitCeiling && p.vy < 0) p.vy = 0;

  // run animation
  if (p.onGround && Math.abs(p.vx) > 20) p.runPhase += dt * (6 + Math.abs(p.vx) * 0.04);
  else p.runPhase += dt * 2;

  // attack
  if (edges.has('attack') && p.attackCd <= 0) {
    p.attackTimer = 0.26;
    p.attackCd = 0.33;
    p.swung = new Set();
    audio.sfx('swing');
  }
  processAttack();

  // interaction
  const candidates = interactPoints();
  game.nearest = candidates[0] || null;
  game.prompt = game.nearest ? game.nearest.label : null;
  if (edges.has('up') && game.nearest) performInteract(game.nearest);

  // pickups
  collectItems();

  // hazards
  for (const h of room.hazards) {
    const r = { x: h.x * T, y: h.y * T, w: h.w * T, h: Math.max(10, h.h * T) };
    if (!overlapRect(p, r)) continue;
    if (h.type === 'sludge') {
      p.vx *= 0.86;
      if (Math.random() < 0.04) particle({
        x: p.x + rand(0, p.w), y: p.y + p.h, vx: rand(-10, 10), vy: -30,
        life: 0.4, max: 0.4, size: 2, color: '#b9f23c', grav: 100,
      });
    }
    if (p.invuln <= 0) {
      hurtPlayer(h.dmg || 1, p.x + p.w / 2 - 30, h.type === 'spikes' ? 260 : 190);
      if (h.type === 'spikes') p.vy = -520;
      else p.vy = -360;
    }
  }

  updateCamera(dt);
}

/* ------------------------------------------------------------------ */
/* transition / exits / tick                                           */
/* ------------------------------------------------------------------ */
function checkExits() {
  if (game.exitCooldown > 0 || game.transition) return;
  const def = game.room;
  const p = game.player;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  if (cx < 0 && def.exits.left) { startTransition(def.exits.left.to, def.exits.left.entry); return; }
  if (cx > def.w * T && def.exits.right) { startTransition(def.exits.right.to, def.exits.right.entry); return; }
  if (cy > def.h * T + 10 && def.exits.bottom) { startTransition(def.exits.bottom.to, def.exits.bottom.entry); return; }
  if (cy < -10 && def.exits.top) { startTransition(def.exits.top.to, def.exits.top.entry); return; }
}

function updateTransition(dt) {
  const tr = game.transition;
  if (!tr) return false;
  tr.time += dt;
  if (!tr.swapped && tr.time >= tr.dur / 2) {
    tr.swapped = true;
    enterRoom(tr.target, tr.entry);
    game.transition = tr;
  }
  if (tr.time >= tr.dur) game.transition = null;
  return true;
}

function update(dt) {
  game.playTime += dt;
  game.shake = Math.max(0, game.shake - dt * 26);
  game.exitCooldown = Math.max(0, game.exitCooldown - dt);

  // timers
  if (game.toast) { game.toast.t -= dt; if (game.toast.t <= 0) game.toast = null; }
  if (game.banner) { game.banner.t -= dt; if (game.banner.t <= 0) game.banner = null; }
  if (game.bigBanner) { game.bigBanner.t -= dt; if (game.bigBanner.t <= 0) game.bigBanner = null; }
  if (game.showHint) { game.showHint.t -= dt; if (game.showHint.t <= 0) game.showHint = null; }

  if (updateTransition(dt)) return;

  if (game.hitstop > 0) { game.hitstop = Math.max(0, game.hitstop - dt); return; }

  updatePlayer(dt);
  if (game.state !== 'play') return;

  updateProps(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  checkExits();

  if (game.endingTimer > 0) {
    game.endingTimer -= dt;
    if (game.boss) {
      const b = game.boss;
      if (Math.random() < 0.4) {
        burst(b.x + rand(0, b.w), b.y + rand(0, b.h), Math.random() < 0.5 ? '#ff8f6a' : '#b9f23c', 3, { grav: 200, glow: true });
      }
      game.shake = Math.max(game.shake, 2);
    }
    if (game.endingTimer <= 0) showEnding();
  }
}

/* ------------------------------------------------------------------ */
/* main loop                                                           */
/* ------------------------------------------------------------------ */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  game.time += dt;
  if (game.state === 'title') {
    game.titleTime += dt;
  } else if (game.state === 'play' && !game.testFreeze) {
    update(dt);
  } else if (game.state === 'map') {
    renderer.drawMap(game);
  }
  renderer.render(game);
  edges.clear();
  requestAnimationFrame(loop);
}

function boot() {
  game.rooms = buildRooms();
  initUI();
  refreshTitleButtons();
  showScreen('titleScreen');
  game.titleTime = 0;
  requestAnimationFrame(loop);

  // small debug/verification surface (harmless in production)
  window.SUMP = {
    game,
    renderer,
    enterRoom,
    grantAbility,
    startBoss,
    defeatBoss,
    teleport(room, x, y) {
      game.state = 'play';
      game.room = game.rooms[room];
      game.player = game.player || makePlayer();
      game.player.x = x;
      game.player.y = y;
      game.enemies = game.room.enemies.map(makeEnemy);
    },
    unlockAll() {
      game.abilities = { grip: true, boots: true, dash: true };
    },
  };

  // deterministic input/step hooks used by the browser regression pass
  Object.assign(window.SUMP, {
    test: {
      freeze(v = true) { game.testFreeze = !!v; },
      setKeys(keys) {
        for (const k in held) held[k] = false;
        for (const k in keys) if (keys[k]) { held[k] = true; edges.add(k); }
      },
      step(n = 1, dt = 1 / 60) {
        for (let i = 0; i < n; i++) {
          update(dt);
          edges.clear();
        }
      },
      keys: held,
    },
  });
}

boot();

