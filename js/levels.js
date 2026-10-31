// Level data for SUMP CITY. Rooms are authored on a 32px tile grid.
export const TILE = 32;
export const VIEW_W = 960;
export const VIEW_H = 540;

// tile materials
export const MAT = { BRICK: 1, METAL: 2, CONCRETE: 3, PIPE: 4, GRATE: 5 };

class Room {
  constructor(id, name, sub, w, h, theme, opts = {}) {
    this.id = id;
    this.name = name;
    this.sub = sub;
    this.w = w;
    this.h = h;
    this.theme = theme;
    this.tiles = new Uint8Array(w * h);
    this.props = [];
    this.hazards = [];
    this.enemies = [];
    this.items = [];
    this.notes = [];
    this.breakables = [];
    this.interacts = [];
    this.zones = [];
    this.exits = {};
    this.entries = {};
    this.spawn = null;
    this.light = opts.light ?? 0.42;
    this.water = opts.water ?? null;
    this.boss = opts.boss ?? null;
    this.music = opts.music ?? null;
    this.bg = opts.bg ?? {};
  }

  idx(x, y) { return y * this.w + x; }
  set(x, y, mat = MAT.BRICK) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[this.idx(x, y)] = mat;
  }
  clear(x, y, w = 1, h = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, 0);
  }
  fill(x, y, w, h, mat = MAT.BRICK) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, mat);
  }
  solid(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.tiles[this.idx(x, y)] > 0;
  }
  prop(type, x, y, opts = {}) { this.props.push({ type, x, y, ...opts }); }
  hazard(x, y, w, h, type, dmg = 1, slow = 0) { this.hazards.push({ x, y, w, h, type, dmg, slow }); }
  enemy(type, x, y, opts = {}) { this.enemies.push({ type, x, y, ...opts }); }
  item(type, id, x, y, opts = {}) { this.items.push({ type, id, x, y, ...opts }); }
  note(id, x, y, title, text, tag = 'FIELD NOTE') { this.notes.push({ id, x, y, title, text, tag }); }
  breakable(id, x, y, w, h) { this.breakables.push({ id, x, y, w, h, hp: 3 }); }
  interact(type, id, x, y, opts = {}) { this.interacts.push({ type, id, x, y, ...opts }); }
  zone(type, x, y, w, h, opts = {}) { this.zones.push({ type, x, y, w, h, ...opts }); }
  exit(side, to, entry) { this.exits[side] = { to, entry }; }
  entry(name, x, y, opts = {}) { this.entries[name] = { x, y, ...opts }; }
  barrier(id, x, y, w, h) { this.interacts.push({ type: 'barrier', id, x, y, w, h, bar: true }); }
}

function commonBorder(r, floor, opts = {}) {
  const { ceiling = 3, left = true, right = true, leftGap = null, rightGap = null } = opts;
  r.fill(0, 0, r.w, ceiling, MAT.CONCRETE);
  r.fill(0, floor, r.w, r.h - floor, MAT.BRICK);
  if (left) {
    r.fill(0, ceiling, 2, floor - ceiling, MAT.BRICK);
    if (leftGap) r.clear(0, leftGap[0], 2, leftGap[1]);
  }
  if (right) {
    r.fill(r.w - 2, ceiling, 2, floor - ceiling, MAT.BRICK);
    if (rightGap) r.clear(r.w - 2, rightGap[0], 2, rightGap[1]);
  }
}

export function buildRooms() {
  const rooms = {};

  /* =========================================================
     FLOODGATE JUNCTION — hub
     ========================================================= */
  {
    const r = new Room('hub', 'FLOODGATE JUNCTION', 'SEWER ACCESS · LEVEL 2', 56, 30, 'hub', { light: 0.28, water: 0.35 });
    commonBorder(r, 27, { ceiling: 3, leftGap: [23, 4], rightGap: [23, 4] });

    // central wall-jump shaft
    r.fill(36, 2, 1, 21, MAT.BRICK);   // left wall, gap at bottom (y23-27)
    r.fill(41, 2, 1, 21, MAT.BRICK);   // right wall, matching bottom gap
    r.clear(37, 0, 4, 3, MAT.CONCRETE); // opening through the ceiling
    r.fill(37, 24, 4, 1, MAT.GRATE);    // catwalk grate over the walk-through

    // catwalk + steps
    r.fill(10, 24, 5, 1, MAT.METAL);
    r.fill(15, 22, 8, 1, MAT.METAL);
    r.fill(47, 24, 5, 1, MAT.METAL);

    // hatch to the sump (solid floor, interact to descend)
    r.interact('hatch', 'hubSump', 24, 27, { w: 4, to: 'sump', entry: 'top', label: 'SUMP HATCH' });

    // bench
    r.interact('bench', 'benchHub', 6, 27, { label: 'SAVE BENCH' });
    r.prop('bench', 6.5, 27);

    // token on the high catwalk
    r.item('token', 'hub-token', 19.2, 20.9);

    // scenery
    r.prop('lamp', 5.5, 8, { color: '#ffc06a', radius: 220 });
    r.prop('lamp', 28.5, 12, { color: '#9dffb0', radius: 200 });
    r.prop('lamp', 50.5, 9, { color: '#ffc06a', radius: 210 });
    r.prop('sign', 7.5, 13.4, { text: 'FLOODGATE 7', color: '#ffb35c', sub: 'ACCESS TO SUMP / AUTHORIZED ONLY' });
    r.prop('sign', 45, 15, { text: 'NO WAKE', color: '#b9f23c' });
    r.prop('fan', 45.5, 19, { radius: 44 });
    r.prop('pipes', 2, 5, { w: 13 });
    r.prop('pipes', 42, 4.4, { w: 12 });
    r.prop('chains', 30, 3, { n: 3 });
    r.prop('graffiti', 12.5, 20.5, { text: 'GATOR BAIT', color: '#6fffe9', rot: -0.04 });
    r.prop('trash', 33.5, 26.4);
    r.prop('trash', 43.5, 26.4);
    r.prop('crate', 8.5, 26.1);
    r.prop('crate', 9.4, 26.1);
    r.prop('mushroom', 30.5, 26.6);
    r.prop('grate', 24, 26.9, { w: 4 });
    r.prop('puddle', 20, 26.8, { w: 7 });
    r.prop('puddle', 48, 26.8, { w: 5 });
    r.prop('drip', 13, 3, { rate: 0.7 });
    r.prop('drip', 33, 3, { rate: 0.4 });
    r.prop('drip', 47, 3, { rate: 0.9 });

    r.enemy('rat', 31, 27, { patrol: 4 });
    r.enemy('rat', 48, 23);
    r.enemy('roach', 42, 12, { fly: true });

    r.spawn = { x: 8, y: 27 };
    r.entry('start', 8, 27);
    r.entry('left', 4, 27);
    r.entry('right', 52, 27);
    r.entry('top', 39, 4);
    r.entry('bottom', 26, 27);
    r.entry('bench', 8, 27);

    r.exit('left', 'steam', 'right');
    r.exit('right', 'rats', 'left');
    r.exit('top', 'overflow', 'bottom');
    rooms[r.id] = r;
  }

  /* =========================================================
     RAT WARRENS
     ========================================================= */
  {
    const r = new Room('rats', 'RAT WARRENS', 'ABANDONED TRANSIT LINE', 60, 28, 'rats', { light: 0.34, water: 0.25 });
    commonBorder(r, 25, { ceiling: 3, leftGap: [21, 4], rightGap: [21, 4] });

    r.fill(9, 21, 6, 1, MAT.METAL);
    r.fill(18, 19, 7, 1, MAT.CONCRETE);
    r.fill(29, 22, 5, 1, MAT.METAL);
    r.fill(38, 19, 8, 1, MAT.METAL);
    r.fill(49, 23, 4, 1, MAT.CONCRETE);
    r.fill(21, 0, 12, 13, MAT.CONCRETE); // low ceiling section
    r.fill(33, 0, 1, 10, MAT.BRICK);

    // cracked service wall concealing a token
    r.fill(33, 22, 1, 3, MAT.CONCRETE);
    r.breakable('rats-wall', 33, 22, 1, 3);
    r.item('token', 'rats-token', 34.6, 23.8);
    r.prop('sign', 34.8, 20.6, { text: 'KEEP OUT', color: '#ff8f6a', small: true });

    r.prop('lamp', 6, 14, { color: '#ffb35c', radius: 230 });
    r.prop('lamp', 27, 9, { color: '#ffb35c', radius: 180 });
    r.prop('lamp', 45, 12, { color: '#9dffb0', radius: 200 });
    r.prop('graffiti', 12, 17.5, { text: 'RAT KING', color: '#b9f23c', rot: 0.03 });
    r.prop('graffiti', 51, 16, { text: 'BOROUGH LINE', color: '#ffb35c' });
    r.prop('pipes', 3, 4, { w: 18 });
    r.prop('trash', 15.5, 24.5);
    r.prop('trash', 24.5, 24.5);
    r.prop('trash', 43.5, 24.5);
    r.prop('crate', 12.5, 20.3);
    r.prop('chains', 22, 3, { n: 4 });
    r.prop('chains', 44, 3, { n: 2 });
    r.prop('puddle', 7, 24.7, { w: 5 });
    r.prop('puddle', 27, 24.7, { w: 6 });
    r.prop('drip', 19, 3, { rate: 0.6 });
    r.prop('drip', 40, 3, { rate: 0.5 });

    r.note('rats-note', 6, 24.8, 'LOG 0412 — GRATE 12', 'The rats stopped chewing the cables on Tuesday. Now they sit in the dark and face the water. Something downstream is singing.\n\n— M. Okafor, Maintenance', 'MAINTENANCE LOG');
    r.interact('note', 'rats-note', 6, 25);

    r.enemy('rat', 13, 25, { patrol: 5 });
    r.enemy('rat', 26, 25, { patrol: 4 });
    r.enemy('rat', 46, 25, { patrol: 6 });
    r.enemy('rat', 52, 25, { patrol: 3 });
    r.enemy('roach', 21, 16, { fly: false });
    r.enemy('roach', 41, 15, { fly: false });
    r.enemy('blast', 56, 13, { dir: -1 }); // vent turret in the wall

    r.entry('left', 3, 25);
    r.entry('right', 56, 25);
    r.exit('left', 'hub', 'right');
    r.exit('right', 'tunnel7', 'left');
    rooms[r.id] = r;
  }

  /* =========================================================
     TUNNEL 7
     ========================================================= */
  {
    const r = new Room('tunnel7', 'TUNNEL 7', 'DEAD LINE · NO THROUGH SERVICE', 64, 28, 'tunnel', { light: 0.22, water: 0.3 });
    commonBorder(r, 25, { ceiling: 3, leftGap: [21, 4], rightGap: null });
    r.fill(0, 0, 64, 3, MAT.CONCRETE);

    // low ceiling / tunnel squeeze
    r.fill(22, 0, 9, 13, MAT.CONCRETE);
    r.fill(44, 0, 5, 16, MAT.CONCRETE);

    // route
    r.fill(8, 21, 5, 1, MAT.METAL);
    r.fill(14, 18, 6, 1, MAT.METAL);
    r.fill(27, 22, 6, 1, MAT.CONCRETE);
    r.fill(37, 20, 4, 1, MAT.METAL);
    r.fill(41, 16, 1, 7, MAT.BRICK);
    r.fill(33, 14, 8, 1, MAT.METAL);
    r.fill(50, 21, 4, 1, MAT.CONCRETE);
    r.fill(56, 24, 6, 1, MAT.CONCRETE);

    // grip relic dais at the end of the line
    r.item('relic', 'grip', 59.5, 23.7, { ability: 'grip' });
    r.prop('pedestal', 59.5, 24);

    // wall-jump treasure shaft, carved through the low ceiling
    r.clear(46, 8, 3, 8);
    r.fill(45, 8, 1, 8, MAT.BRICK);
    r.fill(49, 8, 1, 8, MAT.BRICK);
    r.item('token', 'tunnel-token', 47.4, 8.6);

    // spikes
    r.hazard(28, 24.25, 3, 0.75, 'spikes', 1);
    r.prop('spikes', 28, 25, { w: 3 });
    r.hazard(51, 24.25, 2, 0.75, 'spikes', 1);
    r.prop('spikes', 51, 25, { w: 2 });

    r.prop('lamp', 5, 8, { color: '#6fffe9', radius: 190 });
    r.prop('lamp', 24.5, 12, { color: '#6fffe9', radius: 150 });
    r.prop('lamp', 40, 9, { color: '#ffb35c', radius: 170 });
    r.prop('lamp', 58, 16, { color: '#b9f23c', radius: 220 });
    r.prop('sign', 10.5, 14, { text: 'TUNNEL 7', color: '#6fffe9', sub: 'MIND THE THIRD RAIL' });
    r.prop('sign', 59.5, 18.8, { text: 'BOROUGH LINE', color: '#ff8f6a', sub: 'SEALED 1979', small: true });
    r.prop('pipes', 2, 5, { w: 20 });
    r.prop('pipes', 30, 6, { w: 14 });
    r.prop('chains', 17, 3, { n: 5 });
    r.prop('chains', 42, 3, { n: 3 });
    r.prop('puddle', 18, 24.7, { w: 5 });
    r.prop('puddle', 38, 24.7, { w: 4 });
    r.prop('drip', 12, 3, { rate: 1.1 });
    r.prop('drip', 38, 3, { rate: 0.7 });
    r.prop('bones', 46.5, 24.6);
    r.prop('graffiti', 30, 17, { text: 'DON\'T FEED IT', color: '#b9f23c' });
    r.prop('grate', 54, 19.9, { w: 8 });

    r.note('tunnel-note', 5, 24.8, 'MEMO — THIRD RAIL', 'If you can read this, the east line is still dry. Take the grip gauntlets from the old signal room. You will need them to climb the junction.\n\nDo not touch the third rail. Do not answer the singing.', 'DEPARTMENT MEMO');
    r.interact('note', 'tunnel-note', 5, 25);

    r.enemy('rat', 11, 25, { patrol: 4 });
    r.enemy('rat', 24, 25, { patrol: 5 });
    r.enemy('roach', 36, 16);
    r.enemy('roach', 46, 20, { fly: true });
    r.enemy('blast', 44, 13, { dir: 1 });
    r.enemy('blast', 53, 12, { dir: -1 });
    r.enemy('sludge', 32, 25);

    r.entry('left', 3, 25);
    r.exit('left', 'rats', 'right');
    rooms[r.id] = r;
  }

  /* =========================================================
     STEAMWORKS
     ========================================================= */
  {
    const r = new Room('steam', 'STEAMWORKS', 'BOILER 3 · PRESSURE UNSTABLE', 44, 36, 'steam', { light: 0.3, water: 0.15 });
    commonBorder(r, 33, { ceiling: 3, leftGap: null, rightGap: [29, 4] });
    r.fill(0, 0, 44, 3, MAT.METAL);

    // wall-jump shaft
    r.fill(15, 4, 1, 22, MAT.BRICK);
    r.fill(20, 4, 1, 18, MAT.BRICK);
    r.fill(15, 26, 6, 1, MAT.METAL);
    r.clear(20, 22, 1, 4);

    // top platforms & relic
    r.fill(2, 4, 13, 1, MAT.METAL);
    r.fill(21, 4, 8, 1, MAT.METAL);
    r.item('relic', 'dash', 8.5, 3.5, { ability: 'dash' });
    r.prop('pedestal', 8.5, 4);
    r.item('token', 'steam-token', 26.5, 3.2);

    // boiler mass
    r.fill(22, 10, 6, 11, MAT.METAL);
    r.prop('valve', 25, 15, { radius: 30 });

    // route from entry up to shaft
    r.fill(34, 30, 6, 1, MAT.METAL);
    r.fill(28, 27, 6, 1, MAT.METAL);
    r.fill(21, 26, 7, 1, MAT.METAL);
    r.fill(8, 29, 6, 1, MAT.CONCRETE);
    r.fill(3, 25, 5, 1, MAT.METAL);

    // hazards
    r.hazard(4, 32.3, 3, 0.7, 'steam', 1);
    r.prop('vent', 5.5, 33);
    r.hazard(36, 29.3, 2, 0.7, 'steam', 1);
    r.prop('vent', 37, 30);
    r.hazard(10, 28.3, 2, 0.7, 'steam', 1);
    r.prop('vent', 11, 29);

    r.prop('lamp', 6, 10, { color: '#ff9b4a', radius: 210 });
    r.prop('lamp', 31, 13, { color: '#ff9b4a', radius: 230 });
    r.prop('lamp', 40, 24, { color: '#ffd08a', radius: 150 });
    r.prop('sign', 33, 21, { text: 'BOILER 3', color: '#ffb35c', sub: 'DO NOT VENT' });
    r.prop('pipes', 2, 8, { w: 12 });
    r.prop('pipes', 30, 6, { w: 12 });
    r.prop('pipes', 2, 33, { w: 8 });
    r.prop('chains', 29, 3, { n: 4 });
    r.prop('steam', 9, 29, { rate: 0.5 });
    r.prop('steam', 35, 25, { rate: 0.7 });
    r.prop('drip', 18, 3, { rate: 0.5 });
    r.prop('crate', 32.5, 29.3);
    r.prop('crate', 33.4, 29.3);
    r.prop('barrel', 39.5, 32.6);
    r.prop('barrel', 16, 25.1);

    r.note('steam-note', 4, 32.8, 'BOILER 3 — PRESSURE', 'The old pressure boots are in the top locker. Valve wheel sticks. If the needle passes the red line, do not stand in the orange steam.\n\nP.S. The crocodile has been seen again. It is bigger.', 'BOILER CARD');
    r.interact('note', 'steam-note', 4, 33);

    r.enemy('rat', 31, 33, { patrol: 5 });
    r.enemy('roach', 30, 24);
    r.enemy('roach', 10, 22, { fly: true });
    r.enemy('blast', 21, 15, { dir: 1 });

    r.entry('right', 40, 33);
    r.exit('right', 'hub', 'left');
    rooms[r.id] = r;
  }

  /* =========================================================
     THE SUMP — mini-boss
     ========================================================= */
  {
    const r = new Room('sump', 'THE SUMP', 'FLOOD CONTROL · B1', 56, 24, 'sump', { light: 0.3, water: 0.55, boss: 'warden' });
    r.fill(0, 0, 56, 3, MAT.CONCRETE);
    r.fill(0, 21, 56, 3, MAT.BRICK);
    r.fill(0, 3, 2, 18, MAT.BRICK);
    r.fill(54, 3, 2, 18, MAT.BRICK);

    // updraft shaft
    r.fill(23, 2, 1, 11, MAT.METAL);
    r.fill(28, 2, 1, 11, MAT.METAL);
    r.clear(24, 0, 4, 3);
    r.zone('updraft', 24, 2, 4, 18, { power: 3400, id: 'sumpLift' });

    // arena platforms
    r.fill(4, 17, 7, 1, MAT.CONCRETE);
    r.fill(45, 17, 7, 1, MAT.CONCRETE);
    r.fill(16, 13, 6, 1, MAT.METAL);
    r.fill(34, 10, 6, 1, MAT.METAL);
    r.fill(7, 9, 6, 1, MAT.CONCRETE);
    r.fill(43, 7, 6, 1, MAT.CONCRETE);
    r.fill(33, 6, 5, 1, MAT.METAL);

    // sludge
    r.hazard(12, 20.25, 32, 0.75, 'sludge', 1, 0.55);
    r.prop('sludge', 12, 20.4, { w: 32 });
    r.prop('bubbles', 18, 20.6, { w: 20 });
    r.prop('bones', 14.5, 20.4);
    r.prop('bones', 40.5, 20.4);

    // lift visuals
    r.prop('lift', 26, 19, { h: 14 });

    r.prop('lamp', 8, 5, { color: '#b9f23c', radius: 240 });
    r.prop('lamp', 47, 5, { color: '#8dffb2', radius: 230 });
    r.prop('sign', 20, 17.5, { text: 'THE SUMP', color: '#b9f23c', sub: 'AUTHORIZED PERSONNEL ONLY' });
    r.prop('pipes', 3, 4, { w: 12 });
    r.prop('pipes', 42, 4, { w: 10 });
    r.prop('chains', 12, 3, { n: 4 });
    r.prop('chains', 36, 3, { n: 3 });
    r.prop('drip', 14, 3, { rate: 0.9 });
    r.prop('drip', 39, 3, { rate: 0.7 });
    r.prop('crate', 49.5, 20.5);
    r.prop('graffiti', 40, 13.5, { text: 'FEED ME', color: '#ff8f6a' });

    // hidden token
    r.fill(51, 18, 1, 3, MAT.CONCRETE);
    r.breakable('sump-wall', 51, 18, 1, 3);
    r.item('cell', 'cell-sump', 52.5, 19.9);
    r.prop('sign', 52.5, 17.4, { text: '?', color: '#b9f23c', small: true });

    r.note('sump-note', 3, 20.8, 'SUMP LOG — 06:12', 'The pumps ran dry at dawn. The water went somewhere else. I heard something down here counting the rats.\n\nIf the warden wakes, hit it when it lands. Take the boots from the silt. Do not let it pin you in the middle.', 'SUMP LOG');
    r.interact('note', 'sump-note', 3, 21);

    // boss & reward
    r.enemy('warden', 36, 21);
    r.barrier('sumpGate', 24, 13, 4, 2);
    r.item('relic', 'boots', 8.5, 20.2, { ability: 'boots', bossDrop: 'warden' });
    r.prop('pedestal', 8.5, 21);
    r.entry('top', 26, 6, { vy: 40 });
    r.exit('top', 'hub', 'bottom');
    rooms[r.id] = r;
  }

  /* =========================================================
     THE OVERFLOW — vertical
     ========================================================= */
  {
    const r = new Room('overflow', 'THE OVERFLOW', 'STORM SHAFT · 180 FT', 36, 48, 'overflow', { light: 0.26, water: 0.3 });
    commonBorder(r, 45, { ceiling: 3, leftGap: [3, 4], rightGap: [3, 4] });
    r.fill(0, 0, 36, 3, MAT.CONCRETE);

    // bottom return hole to the junction
    r.clear(16, 45, 4, 3);
    r.prop('grate', 16, 44.9, { w: 4 });

    // climb
    r.fill(23, 42, 8, 1, MAT.METAL);
    r.fill(12, 39, 7, 1, MAT.CONCRETE);
    r.fill(22, 36, 7, 1, MAT.METAL);
    r.fill(9, 33, 7, 1, MAT.CONCRETE);
    r.fill(19, 30, 7, 1, MAT.METAL);
    r.fill(28, 27, 6, 1, MAT.CONCRETE);
    r.fill(14, 24, 7, 1, MAT.METAL);
    r.fill(5, 21, 8, 1, MAT.CONCRETE);
    r.fill(17, 18, 7, 1, MAT.METAL);
    r.fill(26, 15, 8, 1, MAT.CONCRETE);
    r.fill(13, 12, 7, 1, MAT.METAL);
    r.fill(2, 7, 9, 1, MAT.CONCRETE);
    r.fill(26, 7, 8, 1, MAT.METAL);
    r.fill(17, 10, 8, 1, MAT.METAL);
    r.fill(9, 9, 1, 3, MAT.BRICK); // little lip for wall jumps

    // bench on the mid landing
    r.interact('bench', 'benchOverflow', 7, 21, { label: 'SAVE BENCH' });
    r.prop('bench', 7.5, 21);

    // waterfall
    r.prop('waterfall', 20, 3, { w: 5, h: 42 });
    r.prop('waterfall', 30, 3, { w: 2, h: 38, thin: true });

    r.prop('lamp', 6, 12, { color: '#9ad8ff', radius: 200 });
    r.prop('lamp', 30, 22, { color: '#6fffe9', radius: 230 });
    r.prop('lamp', 5, 33, { color: '#6fffe9', radius: 180 });
    r.prop('sign', 3.5, 37, { text: 'OVERFLOW', color: '#6fffe9', sub: '180 FT TO RIVER' });
    r.prop('pipes', 2, 4, { w: 9 });
    r.prop('chains', 27, 3, { n: 5 });
    r.prop('chains', 11, 3, { n: 3 });
    r.prop('puddle', 3, 6.8, { w: 4 });
    r.prop('puddle', 27, 6.8, { w: 4 });
    r.prop('mushroom', 24.5, 41.8);
    r.prop('mushroom', 18, 23.8);
    r.prop('drip', 9, 3, { rate: 0.8 });
    r.prop('drip', 32, 3, { rate: 1.2 });
    r.prop('algae', 5, 20.8, { w: 7 });
    r.prop('algae', 26, 14.8, { w: 7 });

    r.item('token', 'overflow-token', 30.5, 14.2);

    r.note('overflow-note', 3, 20.8, 'STORM SHAFT — 180 FT', 'The overflow is the only way up to the old reservoir. If you fall, the junction catches you. If the water catches you, well. It has been dry for forty years. Mostly.\n\n— Please do not remove the chain.', 'SHAFT NOTICE');
    r.interact('note', 'overflow-note', 3, 21);

    r.enemy('roach', 15, 31);
    r.enemy('roach', 25, 22);
    r.enemy('roach', 8, 10, { fly: true });
    r.enemy('blast', 33, 26, { dir: -1 });
    r.enemy('rat', 30, 27);

    r.entry('bottom', 21, 45);
    r.entry('bench', 9, 21);
    r.entry('left', 4, 7);
    r.entry('right', 32, 7);
    r.exit('bottom', 'hub', 'top');
    r.exit('left', 'secret', 'right');
    r.exit('right', 'croclair', 'left');
    rooms[r.id] = r;
  }

  /* =========================================================
     MAINTENANCE CLOSET — secret
     ========================================================= */
  {
    const r = new Room('secret', 'MAINTENANCE CLOSET', 'NOT ON THE SURVEY', 28, 16, 'secret', { light: 0.24, water: 0.05 });
    commonBorder(r, 13, { ceiling: 2, leftGap: null, rightGap: [9, 4] });
    r.fill(0, 0, 28, 2, MAT.CONCRETE);

    r.prop('lamp', 9, 3, { color: '#ffd08a', radius: 280 });
    r.prop('lockers', 3, 13);
    r.prop('shelf', 17, 6.5);
    r.prop('mop', 14, 13);
    r.prop('pipes', 19, 2.4, { w: 8 });
    r.prop('crate', 22.5, 12.6);
    r.prop('trash', 24.5, 12.6);

    r.item('cell', 'cell-secret', 7.5, 12.2);
    r.item('token', 'secret-token', 21, 12.2);
    r.prop('pedestal', 7.5, 13);

    r.note('secret-note', 12, 12.8, 'TO WHOEVER FINDS THIS', 'I have been down here for eleven years. The city above thinks the sewers are a place you flush through. It is a place you live.\n\nThe crocodile was here before the tunnels. It will be here after. Do not mistake it for a monster. It is a landlord.\n\n— R. Velez, night shift', 'PERSONAL NOTE');
    r.interact('note', 'secret-note', 12, 13);

    r.entry('right', 25, 13);
    r.exit('right', 'overflow', 'left');
    rooms[r.id] = r;
  }

  /* =========================================================
     THE CROCODILE KING — final boss
     ========================================================= */
  {
    const r = new Room('croclair', "THE CROCODILE KING", 'RESERVOIR · NO RETURN', 56, 28, 'croc', { light: 0.24, water: 0.5, boss: 'croc' });
    r.fill(0, 0, 56, 3, MAT.CONCRETE);
    r.fill(0, 24, 56, 4, MAT.BRICK);
    r.fill(0, 3, 2, 21, MAT.BRICK);
    r.fill(54, 3, 2, 21, MAT.BRICK);
    r.clear(0, 3, 2, 4);
    r.fill(0, 7, 10, 1, MAT.CONCRETE);

    // acid
    r.hazard(10, 23.3, 38, 0.7, 'sludge', 1, 0.5);
    r.prop('sludge', 10, 23.4, { w: 38, acid: true });
    r.prop('bubbles', 14, 23.6, { w: 30 });

    // platforms
    r.fill(7, 19, 7, 1, MAT.METAL);
    r.fill(20, 20, 8, 1, MAT.CONCRETE);
    r.fill(35, 19, 7, 1, MAT.METAL);
    r.fill(43, 15, 7, 1, MAT.CONCRETE);
    r.fill(26, 14, 8, 1, MAT.METAL);
    r.fill(12, 12, 8, 1, MAT.CONCRETE);
    r.fill(36, 9, 8, 1, MAT.METAL);
    r.fill(23, 8, 7, 1, MAT.METAL);
    r.fill(19, 22, 1, 2, MAT.BRICK);

    // boss & gate
    r.enemy('croc', 40, 24);
    r.barrier('crocGate', 0, 3, 2, 4);

    r.prop('lamp', 6, 5, { color: '#ff8f6a', radius: 230 });
    r.prop('lamp', 48, 5, { color: '#b9f23c', radius: 250 });
    r.prop('lamp', 27, 18, { color: '#ffb35c', radius: 180 });
    r.prop('sign', 41, 6, { text: 'CROCODILE KING', color: '#ff8f6a', sub: 'NO RETURN / NO RESCUE' });
    r.prop('bones', 18, 23.1);
    r.prop('bones', 31, 23.1);
    r.prop('bones', 47, 23.1);
    r.prop('skull', 24.5, 19.4);
    r.prop('chains', 15, 3, { n: 5 });
    r.prop('chains', 34, 3, { n: 4 });
    r.prop('drip', 12, 3, { rate: 1 });
    r.prop('drip', 45, 3, { rate: 0.6 });
    r.prop('graffiti', 12, 8, { text: 'BELLY OF THE BEAST', color: '#ff8f6a', rot: 0.02 });
    r.prop('pipes', 44, 4, { w: 9 });
    r.prop('trash', 50, 23.2);

    r.note('croc-note', 4.2, 6.8, 'FINAL INSPECTION', 'The reservoir is dry. The crocodile is not.\n\nIt has been eating the night crew for six years. The Bureau calls it a drainage anomaly. I call it what it is: the thing at the bottom of the city.\n\nIf you are reading this, you are already deeper than help can reach. Good luck. Bring the wrench.', 'INSPECTION CARD');
    r.interact('note', 'croc-note', 4, 7);

    r.entry('left', 4, 7);
    r.exit('left', 'overflow', 'right');
    rooms[r.id] = r;
  }

  return rooms;
}

export const NOTE_TEXT = {};
export function collectNotes(rooms) {
  for (const room of Object.values(rooms)) {
    for (const n of room.notes) NOTE_TEXT[n.id] = n;
  }
}

export const ROOM_ORDER = ['hub', 'rats', 'tunnel7', 'steam', 'sump', 'overflow', 'secret', 'croclair'];

export const MAP_LAYOUT = {
  hub: { col: 1, row: 1, w: 2, h: 1.5 },
  rats: { col: 3, row: 1, w: 2, h: 1.5 },
  tunnel7: { col: 5, row: 1, w: 2, h: 1.5 },
  steam: { col: 0, row: 0.4, w: 1.6, h: 2.7 },
  sump: { col: 1.2, row: 2.8, w: 2.2, h: 1.4 },
  overflow: { col: 1, row: -3.4, w: 2, h: 3.4 },
  secret: { col: -1.3, row: -3.1, w: 1.6, h: 1.2 },
  croclair: { col: 3, row: -3.4, w: 2.3, h: 1.5 },
};
