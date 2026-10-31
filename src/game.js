import { ROOMS, MAP, LINKS, THEMES } from './rooms.js';
import { SoundEngine } from './audio.js';
import { Input } from './input.js';

const W = 960, H = 540;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => v < 0 ? -1 : 1;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const rand = (a, b) => a + Math.random() * (b - a);
const rect = (x, y, w, h) => ({ x, y, w, h });

const SAVE_KEY = 'silt-save-v1';
const ZOOM = 1.26;
const ABILITY_INFO = {
  dash: { name: 'STEAM DASH', key: 'C / SHIFT', color: '#ffd36b' },
  wallGrip: { name: 'WALL GRIP', key: 'HOLD WALL + JUMP', color: '#85ffd8' },
  doubleJump: { name: 'PUMP JUMP', key: 'SPACE IN AIR', color: '#7fdcff' },
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = W;
    this.canvas.height = H;
    this.sound = new SoundEngine();
    this.input = new Input();
    this.state = 'title';
    this.room = null;
    this.roomId = null;
    this.player = null;
    this.enemies = [];
    this.pickups = [];
    this.projectiles = [];
    this.particles = [];
    this.toasts = [];
    this.camera = { x: 0, y: 0, shake: 0 };
    this.transition = null;
    this.deadT = 0;
    this.freeze = 0;
    this.flash = 0;
    this.playTime = 0;
    this.roomBanner = 0;
    this.boss = null;
    this.bossBar = 0;
    this.doorMsgCd = 0;
    this.checkpointCd = 0;
    this.visited = new Set(['floodgate']);
    this.endingT = 0;
    this.muted = false;
    this.lastTime = 0;
    this.timeScale = 1;
    this.hitSet = new Set();
    this.touch = false;
    this.save = this.loadSave() || this.defaultSave();
    this.applySave(this.save);
    this.loadRoom('floodgate', [260, 780], true);
    this.bindUI();
    this.bindTouch();
    this.setupTitle();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- save / flow
  defaultSave() {
    return {
      v: 1, abilities: { dash: false, wallGrip: false, doubleJump: false }, maxHp: 5,
      checkpoint: { room: 'floodgate', id: 'cp-flood', x: 200, y: 780 },
      collected: [], visited: ['floodgate'], deaths: 0, time: 0, bossDefeated: false,
    };
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      return Object.assign(this.defaultSave(), s);
    } catch { return null; }
  }

  persist() {
    this.save.abilities = { ...this.abil };
    this.save.maxHp = this.player.maxHp;
    this.save.visited = [...this.visited];
    this.save.time = this.playTime;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch {}
  }

  applySave(s) {
    this.save = s;
    this.abil = { ...s.abilities };
    this.player = {
      x: 200, y: 744, w: 22, h: 36, vx: 0, vy: 0, facing: 1,
      onGround: false, coyote: 0, jumpBuffer: 0, hp: s.maxHp, maxHp: s.maxHp,
      invuln: 0, hurtT: 0, attackT: 0, attackCd: 0, attackId: 0, dashT: 0, dashCd: 0,
      dashDir: 1, airDash: false, airJump: false, wall: 0, wallDir: 0, wallT: 0,
      dead: false, anim: 0, step: 0,
    };
    this.visited = new Set(s.visited || ['floodgate']);
    this.muted = !!this.muted;
    this.sound.setMuted(this.muted);
  }

  setupTitle() {
    this.state = 'title';
    const cont = document.getElementById('btn-continue');
    const has = !!localStorage.getItem(SAVE_KEY);
    cont.classList.toggle('hidden', !has);
    document.getElementById('title').classList.remove('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('ending').classList.add('hidden');
  }

  newRun() {
    this.sound.init();
    this.save = this.defaultSave();
    this.applySave(this.save);
    this.visited = new Set(['floodgate']);
    this.playTime = 0;
    this.persist();
    document.getElementById('title').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('ending').classList.add('hidden');
    this.state = 'play';
    this.loadRoom('floodgate', [260, 780]);
    this.player.hp = this.player.maxHp;
    this.showToast('DESCENT', 'The pumps are dead. The water is rising. Find the source.', 5);
    this.sound.checkpoint();
  }

  continueRun() {
    this.sound.init();
    const s = this.loadSave();
    if (!s) return this.newRun();
    this.applySave(s);
    this.playTime = s.time || 0;
    this.visited = new Set(s.visited || ['floodgate']);
    document.getElementById('title').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('ending').classList.add('hidden');
    this.state = 'play';
    const cp = s.checkpoint;
    this.loadRoom(cp.room || 'floodgate', [cp.x + 72, cp.y]);
    this.player.hp = this.player.maxHp;
    this.player.invuln = 1.6;
    this.showToast('SIGNAL REACQUIRED', 'Resuming from the last maintenance beacon.', 3.5);
  }

  bindUI() {
    document.getElementById('btn-new').addEventListener('click', () => this.newRun());
    document.getElementById('btn-continue').addEventListener('click', () => this.continueRun());
    document.getElementById('btn-help').addEventListener('click', () => {
      document.getElementById('title-help').classList.toggle('hidden');
    });
    document.getElementById('btn-resume').addEventListener('click', () => this.togglePause(false));
    document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());
    document.getElementById('btn-pause-help').addEventListener('click', () => {
      document.getElementById('pause-help').classList.toggle('hidden');
    });
    document.getElementById('btn-abandon').addEventListener('click', (e) => {
      if (e.currentTarget.dataset.confirm === '1') {
        localStorage.removeItem(SAVE_KEY);
        this.togglePause(false);
        this.save = this.defaultSave();
        this.applySave(this.save);
        this.loadRoom('floodgate', [260, 780], true);
        this.setupTitle();
      } else {
        e.currentTarget.dataset.confirm = '1';
        e.currentTarget.textContent = 'CLICK AGAIN TO ABANDON';
        setTimeout(() => {
          e.currentTarget.dataset.confirm = '0';
          e.currentTarget.textContent = 'ABANDON RUN';
        }, 2600);
      }
    });
    document.getElementById('btn-again').addEventListener('click', () => {
      localStorage.removeItem(SAVE_KEY);
      this.save = this.defaultSave();
      this.applySave(this.save);
      this.playTime = 0;
      this.visited = new Set(['floodgate']);
      document.getElementById('ending').classList.add('hidden');
      this.state = 'play';
      this.loadRoom('floodgate', [260, 780]);
      this.player.hp = this.player.maxHp;
    });
    document.getElementById('touch-pause').addEventListener('click', () => this.togglePause(true));
  }

  bindTouch() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
    this.touch = isTouch || window.innerWidth < 820;
    document.body.classList.toggle('is-touch', this.touch);
    document.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      const down = (e) => {
        e.preventDefault();
        if (this.state !== 'play') return;
        this.input.virtual.add(action);
        this.input.press(action);
        btn.classList.add('pressed');
      };
      const up = (e) => {
        e.preventDefault();
        this.input.virtual.delete(action);
        this.input.release(action);
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', (e) => { if (btn.classList.contains('pressed')) up(e); });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    window.addEventListener('resize', () => {
      const t = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < 820;
      document.body.classList.toggle('is-touch', t);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    this.sound.setMuted(this.muted);
    document.getElementById('btn-mute').textContent = this.muted ? 'SOUND: OFF' : 'SOUND: ON';
  }

  togglePause(on) {
    const pause = document.getElementById('pause');
    if (on === undefined) on = this.state !== 'pause';
    if (on && this.state === 'play') {
      this.state = 'pause';
      pause.classList.remove('hidden');
      this.buildPauseMap();
      document.getElementById('pause-objective').textContent = this.objective();
    } else if (!on && this.state === 'pause') {
      this.state = 'play';
      pause.classList.add('hidden');
    }
  }

  objective() {
    if (this.save.bossDefeated) return 'THE WATER FALLS. THE CITY BREATHES.';
    if (!this.abil.dash) return 'FIND THE SOURCE OF THE FLOOD. HEAD EAST.';
    if (!this.abil.wallGrip) return 'DASH THROUGH THE VENT HATCH ABOVE THE JUNCTION.';
    if (!this.abil.doubleJump) return 'THE CISTERN HATCH IS OPEN. DESCEND TO PUMP CONTROL.';
    return 'THE BLACKWATER DOOR IS OPEN. END WHAT LIVES BELOW.';
  }

  buildPauseMap() {
    const el = document.getElementById('pause-map');
    let html = '<div class="map-board">';
    html += '<svg class="map-links" viewBox="0 0 100 100" preserveAspectRatio="none">';
    for (const [a, b] of LINKS) {
      const seen = this.visited.has(a) && this.visited.has(b);
      html += `<line x1="${MAP[a].x * 24 + 13.5}" y1="${MAP[a].y * 19 + 10.5}" x2="${MAP[b].x * 24 + 13.5}" y2="${MAP[b].y * 19 + 10.5}" class="${seen ? 'seen' : ''}" vector-effect="non-scaling-stroke" />`;
    }
    html += '</svg>';
    for (const [id, pos] of Object.entries(MAP)) {
      const seen = this.visited.has(id);
      const cur = id === this.roomId;
      html += `<div class="map-room ${seen ? 'seen' : ''} ${cur ? 'current' : ''}" style="left:${pos.x * 24 + 4}%;top:${pos.y * 19 + 4}%;">
        <b>${seen ? pos.name : '· · ·'}</b></div>`;
    }
    html += '<div class="map-player" style="left:' + (MAP[this.roomId].x * 24 + 7) + '%;top:' + (MAP[this.roomId].y * 19 + 10) + '%;"></div>';
    html += '<div class="map-legend">' + this.abilityLine() + '</div></div>';
    el.innerHTML = html;
  }

  abilityLine() {
    return `<span class="${this.abil.dash ? 'on' : ''}">DASH</span> · <span class="${this.abil.wallGrip ? 'on' : ''}">GRIP</span> · <span class="${this.abil.doubleJump ? 'on' : ''}">PUMP</span>`;
  }

  // ---------------------------------------------------------------- world
  loadRoom(id, spawn, title = false) {
    const room = ROOMS[id];
    if (!room) return;
    this.roomId = id;
    this.room = room;
    this.visited.add(id);
    this.save.visited = [...this.visited];
    const p = this.player;
    p.x = spawn[0] - p.w / 2;
    p.y = spawn[1] - p.h;
    p.vx = 0; p.vy = 0; p.onGround = false; p.wall = 0;
    p.dashT = 0; p.attackT = 0; p.airDash = false; p.airJump = false; p.dead = false;
    this.enemies = room.enemies.map((e, i) => this.makeEnemy(e, i));
    this.pickups = room.pickups.filter((pk) => !this.save.collected.includes(pk.id));
    this.checkpoints = [];
    this.checkpoints = (room.checkpoints || []).map((c) => ({ ...c, active: this.save.checkpoint.id === c.id }));
    this.projectiles = [];
    this.particles = [];
    this.transition = null;
    this.doorLock = 0;
    this.boss = null;
    this.bossBar = 0;
    this.freeze = 0;
    this.roomBanner = title ? 0 : 2.8;
    this.camera.x = clamp(p.x + p.w / 2 - W / ZOOM / 2, 0, Math.max(0, room.w - W / ZOOM));
    this.camera.y = clamp(p.y + p.h / 2 - H / ZOOM / 2, 0, Math.max(0, room.h - H / ZOOM));
    this.camera.shake = 0;
    if (id === 'blackwater') {
      if (!this.save.bossDefeated) {
        this.boss = this.makeBoss();
        this.bossBar = 0;
      }
    }
    if (!title && id === 'blackwater' && !this.save.bossDefeated) {
      this.showToast('BLACKWATER', 'The chamber breathes. Something enormous is in the water.', 4.5);
    }
    if (!title) this.persist();
  }

  makeEnemy(def, i) {
    const base = { type: def.type, x: def.x, y: def.y, homeX: def.x, homeY: def.y, range: def.range || 140, vx: 0, vy: 0, dir: i % 2 ? 1 : -1, t: hash(i * 9.3) * 6, hp: def.type === 'sludge' ? 3 : def.type === 'turret' ? 3 : 2, flash: 0, dead: false, lastHit: -1, shootCd: 1 + hash(i) * 2 };
    if (def.type === 'drone') { base.w = 34; base.h = 28; base.hp = 2; base.fly = true; base.baseY = def.y; }
    else if (def.type === 'sludge') { base.w = 38; base.h = 30; }
    else if (def.type === 'turret') { base.w = 34; base.h = 34; }
    else { base.w = 40; base.h = 22; }
    base.y = def.y - base.h;
    return base;
  }

  makeBoss() {
    return {
      x: 1660, y: 730, w: 280, h: 110, vx: 0, vy: 0, hp: 30, maxHp: 30,
      state: 'sleep', t: 0, facing: -1, flash: 0, onGround: true, phase: 1,
      dead: false, lastHit: -1, active: false, jaw: 0, hurt: 0, spawnedAdds: false,
    };
  }

  loop(t) {
    requestAnimationFrame((ts) => this.loop(ts));
    if (!this.lastTime) this.lastTime = t;
    let dt = (t - this.lastTime) / 1000;
    this.lastTime = t;
    if (!isFinite(dt)) dt = 0;
    dt = Math.min(dt, 0.033);
    if (this.state === 'pause') {
      if (this.input.justPressed('pause')) this.togglePause(false);
    } else {
      this.update(dt);
    }
    this.render();
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    if (input.justPressed('mute')) this.toggleMute();
    if (input.justPressed('pause')) {
      if (this.state === 'play') this.togglePause(true);
      else if (this.state === 'pause') this.togglePause(false);
    }
    if (this.state === 'pause') return;

    if (input.justPressed('map') && this.state === 'play') {
      this.togglePause(true);
      return;
    }

    if (this.state === 'play') {
      this.playTime += dt;
      this.doorMsgCd -= dt;
      this.checkpointCd -= dt;
      this.flash = Math.max(0, this.flash - dt * 4);
      this.camera.shake = Math.max(0, this.camera.shake - dt * 38);
      this.roomBanner = Math.max(0, this.roomBanner - dt);
      this.updateToasts(dt);
      this.updateParticles(dt);
      if (this.transition) { this.updateTransition(dt); return; }
      if (this.freeze > 0) { this.freeze -= dt; this.updateCamera(dt); return; }
      if (this.player.dead) { this.updateDeath(dt); return; }
      this.updatePlayer(dt);
      if (this.player.dead) { this.updateDeath(dt); return; }
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateCheckpoints(dt);
      this.updateDoors(dt);
      if (this.boss) this.updateBoss(dt);
      this.updateCamera(dt);
      if (this.state === 'ending') return;
      if (this.endingT > 0) {
        this.endingT -= dt;
        if (this.endingT <= 0) this.showEnding();
      }
    } else if (this.state === 'title') {
      this.player.anim += dt;
      this.updateParticles(dt, true);
      this.camera.x = 180 + Math.sin(this.player.anim * 0.12) * 40;
      this.camera.y = 120;
    } else if (this.state === 'dead') {
      this.updateParticles(dt);
    }
  }
  // ---------------------------------------------------------------- player
  solidAt(r) {
    for (const s of this.room.solids) if (!s.oneWay && overlap(r, s)) return s;
    return null;
  }

  attackBox() {
    const p = this.player;
    return rect(p.facing > 0 ? p.x + p.w - 4 : p.x - 50, p.y + 2, 54, 38);
  }

  updatePlayer(dt) {
    const p = this.player, inp = this.input;
    p.anim += dt;
    p.coyote -= dt;
    p.jumpBuffer -= dt;
    p.attackT -= dt;
    p.attackCd -= dt;
    p.dashT -= dt;
    p.dashCd -= dt;
    p.invuln -= dt;
    p.hurtT -= dt;
    this.doorLock = Math.max(0, (this.doorLock || 0) - dt);

    if (inp.justPressed('jump')) p.jumpBuffer = 0.13;

    if (inp.justPressed('attack') && p.attackCd <= 0) {
      p.attackT = 0.16;
      p.attackCd = 0.31;
      p.attackId++;
      this.sound.attack();
      for (let i = 0; i < 3; i++) this.spawnParticle(p.x + p.w / 2 + p.facing * 26, p.y + 16, rand(-35, 35), rand(-45, 5), 0.2, '#cfe7dc', rand(1, 3), 0);
    }

    if (inp.justPressed('dash') && this.abil.dash && p.dashCd <= 0 && p.dashT <= 0) {
      if (p.onGround || !p.airDash) {
        p.dashT = 0.17;
        p.dashCd = 0.6;
        p.dashDir = p.facing;
        p.vy = 0;
        p.invuln = Math.max(p.invuln, 0.18);
        if (!p.onGround) p.airDash = true;
        this.sound.dash();
        this.camera.shake = Math.max(this.camera.shake, 3);
        for (let i = 0; i < 12; i++) {
          this.spawnParticle(p.x + p.w / 2, p.y + p.h / 2, -p.dashDir * rand(80, 320), rand(-80, 80), rand(0.18, 0.4), i % 2 ? '#ffd36b' : '#9fffe0', rand(1, 3), -60);
        }
      }
    }

    const left = inp.isDown('left'), right = inp.isDown('right');
    const leftWall = this.solidAt(rect(p.x - 4, p.y + 5, 4, p.h - 10));
    const rightWall = this.solidAt(rect(p.x + p.w, p.y + 5, 4, p.h - 10));

    if (p.dashT > 0) {
      p.vx = p.dashDir * 780;
      p.vy = 0;
      p.facing = p.dashDir;
      if (Math.random() < 0.7) this.spawnParticle(p.x + p.w / 2 - p.dashDir * 10, p.y + rand(6, p.h - 4), -p.dashDir * rand(20, 80), rand(-30, 30), rand(0.2, 0.4), '#ffd36b', rand(1, 3), 0);
    } else {
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir) p.facing = dir;

      p.wall = 0;
      if (!p.onGround && this.abil.wallGrip && p.vy > -180) {
        if (left && leftWall) { p.wall = -1; p.wallDir = -1; p.vy = Math.min(p.vy, 90); }
        else if (right && rightWall) { p.wall = 1; p.wallDir = 1; p.vy = Math.min(p.vy, 90); }
        if (p.wall) {
          p.airDash = false;
          p.coyote = 0.09;
          if (Math.random() < 0.28) this.spawnParticle(p.x + (p.wall < 0 ? 0 : p.w), p.y + rand(6, p.h - 4), -p.wall * rand(20, 100), rand(-30, 60), rand(0.25, 0.5), '#b6fff0', rand(1, 2), 60);
          if (p.jumpBuffer > 0) {
            p.jumpBuffer = 0;
            p.vy = -750;
            p.vx = -p.wall * 340;
            p.facing = -p.wall;
            p.wall = 0;
            p.airJump = false;
            p.airDash = false;
            this.sound.jump();
            this.camera.shake = 2;
            for (let i = 0; i < 6; i++) this.spawnParticle(p.x + p.w / 2, p.y + p.h - 6, -p.wall * rand(30, 150), rand(-40, 90), rand(0.2, 0.45), '#c9fff2', rand(1, 3), 200);
          }
        }
      }

      if (p.jumpBuffer > 0 && !p.wall) {
        if (p.onGround || p.coyote > 0) {
          p.jumpBuffer = 0;
          p.coyote = 0;
          p.vy = -790;
          p.onGround = false;
          p.airJump = false;
          this.sound.jump();
          for (let i = 0; i < 7; i++) this.spawnParticle(p.x + p.w / 2, p.y + p.h - 2, rand(-80, 80), rand(-20, 60), rand(0.2, 0.4), '#9ccac0', rand(1, 3), 140);
        } else if (this.abil.doubleJump && !p.airJump) {
          p.jumpBuffer = 0;
          p.airJump = true;
          p.vy = -700;
          this.sound.doubleJump();
          for (let i = 0; i < 12; i++) this.spawnParticle(p.x + p.w / 2, p.y + p.h - 4, rand(-150, 150), rand(0, 190), rand(0.2, 0.5), i % 2 ? '#7fdcff' : '#e1fbff', rand(1, 3), 260);
        }
      }
      const accel = p.onGround ? 2300 : 1650;
      if (dir) {
        p.vx += dir * accel * dt;
        p.vx = clamp(p.vx, -255, 255);
      } else {
        const friction = p.onGround ? 2600 : 500;
        if (Math.abs(p.vx) <= friction * dt) p.vx = 0;
        else p.vx -= sign(p.vx) * friction * dt;
      }
      if (!inp.isDown('jump') && p.vy < -140) p.vy += 2300 * 1.1 * dt;
      p.vy += 2300 * dt;
      p.vy = Math.min(p.vy, 1080);
    }

    const wasGround = p.onGround;
    const fallSpeed = p.vy;
    this.moveX(p, p.vx * dt);
    this.moveY(p, p.vy * dt, wasGround);

    if (p.onGround) {
      p.coyote = 0.1;
      p.airJump = false;
      p.airDash = false;
      if (!wasGround && fallSpeed > 340) {
        this.sound.land();
        this.camera.shake = Math.max(this.camera.shake, Math.min(5, fallSpeed / 260));
        for (let i = 0; i < 6; i++) this.spawnParticle(p.x + rand(0, p.w), p.y + p.h, rand(-80, 80), rand(-40, 10), rand(0.2, 0.4), '#8da79f', rand(1, 3), 160);
      }
      if (Math.abs(p.vx) > 4) {
        p.step += dt * Math.abs(p.vx) * 0.06;
        if (Math.random() < 0.12) this.spawnParticle(p.x + rand(0, p.w), p.y + p.h - 2, -p.vx * 0.06, rand(-20, 5), rand(0.2, 0.4), '#9fb5ac', 1, 80);
      }
    }
    if (p.dashT > 0 && Math.abs(p.vx) < 200) p.dashT = 0;

    p.x = clamp(p.x, 0, this.room.w - p.w);
    p.y = clamp(p.y, -40, this.room.h - p.h);

    if (p.attackT > 0) this.attackCheck();
    this.hazardCheck();
  }

  moveX(p, dx) {
    p.x += dx;
    for (const s of this.room.solids) {
      if (s.oneWay) continue;
      if (overlap(p, s)) {
        if (dx > 0) p.x = s.x - p.w;
        else if (dx < 0) p.x = s.x + s.w;
        p.vx = 0;
        if (p.dashT > 0) p.dashT = 0;
      }
    }
  }

  moveY(p, dy, wasGround) {
    p.y += dy;
    p.onGround = false;
    for (const s of this.room.solids) {
      if (!overlap(p, s)) continue;
      if (dy > 0) {
        if (s.oneWay) {
          if (p.y + p.h - dy <= s.y + 6) { p.y = s.y - p.h; p.vy = 0; p.onGround = true; }
        } else { p.y = s.y - p.h; p.vy = 0; p.onGround = true; }
      } else if (dy < 0 && !s.oneWay) {
        p.y = s.y + s.h; p.vy = 0;
      }
    }
  }

  attackCheck() {
    const p = this.player;
    const hb = this.attackBox();
    for (const e of this.enemies) {
      if (e.dead || e.lastHit === p.attackId) continue;
      const box = rect(e.x, e.y, e.w, e.h);
      if (overlap(hb, box)) {
        e.lastHit = p.attackId;
        this.hurtEnemy(e, 1, sign(e.x + e.w / 2 - (p.x + p.w / 2)));
      }
    }
    if (this.boss && !this.boss.dead && this.boss.active && this.boss.lastHit !== p.attackId) {
      const b = this.boss;
      if (overlap(hb, rect(b.x + 20, b.y + 10, b.w - 40, b.h - 10))) {
        b.lastHit = p.attackId;
        this.hurtBoss(b.state === 'stun' ? 2 : 1, sign(b.x + b.w / 2 - (p.x + p.w / 2)));
      }
    }
    for (const pr of this.projectiles) {
      if (!pr.dead && pr.parryable && overlap(hb, rect(pr.x - 8, pr.y - 8, 16, 16))) {
        pr.dead = true;
        this.spawnBurst(pr.x, pr.y, '#b6ff7a', 8);
        this.sound.hit();
      }
    }
  }

  hazardCheck() {
    const p = this.player;
    const box = rect(p.x + 4, p.y + 5, p.w - 8, p.h - 6);
    for (const h of this.room.hazards || []) {
      if (overlap(box, h)) {
        if (p.invuln <= 0) {
          this.damagePlayer(1, h.x + h.w / 2);
          p.vy = -430;
          p.vx = sign(p.x + p.w / 2 - (h.x + h.w / 2)) * 230;
        }
        break;
      }
    }
  }

  damagePlayer(n, sourceX) {
    const p = this.player;
    if (p.invuln > 0 || p.dead) return;
    p.hp -= n;
    p.invuln = 1.15;
    p.hurtT = 0.4;
    p.vx = sign(p.x + p.w / 2 - sourceX) * 300;
    p.vy = -390;
    p.dashT = 0;
    this.camera.shake = 12;
    this.flash = 1;
    this.sound.hurt();
    this.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, '#ff7a5c', 14);
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      this.deadT = 0;
      this.save.deaths = (this.save.deaths || 0) + 1;
      this.persist();
      this.sound.death();
      this.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, '#ff5a4c', 28);
    }
  }

  updateDeath(dt) {
    this.deadT += dt;
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 20);
    if (this.deadT > 1.7) {
      this.player.dead = false;
      this.player.hp = this.player.maxHp;
      this.player.invuln = 1.8;
      const cp = this.save.checkpoint;
      this.loadRoom(cp.room || 'floodgate', [cp.x + 72, cp.y]);
      this.player.hp = this.player.maxHp;
      this.player.invuln = 1.8;
      this.showToast('SIGNAL RESTORED', 'The city spits you back out at the last beacon.', 3);
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const tx = clamp(p.x + p.w / 2 + p.facing * 36 - W / ZOOM / 2, 0, Math.max(0, this.room.w - W / ZOOM));
    const ty = clamp(p.y + p.h / 2 - H / ZOOM / 2 - 24, 0, Math.max(0, this.room.h - H / ZOOM));
    const k = 1 - Math.exp(-7 * dt);
    this.camera.x = lerp(this.camera.x, tx, k);
    this.camera.y = lerp(this.camera.y, ty, k);
  }
  // ---------------------------------------------------------------- enemies
  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt * 5);
      const dx = p.x + p.w / 2 - (e.x + e.w / 2);
      const dy = p.y + p.h / 2 - (e.y + e.h / 2);
      const near = Math.abs(dx) < 290 && Math.abs(dy) < 100;

      if (e.type === 'drone') {
        e.baseY = e.homeY + 28;
        e.y = e.baseY + Math.sin(e.t * 1.7) * 22 - e.h / 2;
        let target = e.homeX;
        if (Math.abs(dx) < 420 && Math.abs(dy) < 200) target = p.x + p.w / 2 - 130 * sign(dx);
        e.x += clamp(target - e.x, -75 * dt, 75 * dt);
        e.x = clamp(e.x, e.homeX - e.range, e.homeX + e.range);
        e.dir = dx > 0 ? 1 : -1;
        e.shootCd -= dt;
        if (e.shootCd <= 0 && Math.abs(dx) < 430 && Math.abs(dy) < 230) {
          e.shootCd = 2.2 + Math.random() * 0.8;
          const len = Math.hypot(dx, dy) || 1;
          this.spawnShot(e.x + e.w / 2, e.y + e.h - 4, dx / len * 190, dy / len * 190, 'spark');
          this.sound.tone(720, 280, 0.12, 'sawtooth', 0.04);
        }
      } else if (e.type === 'turret') {
        e.shootCd -= dt;
        e.dir = dx > 0 ? 1 : -1;
        if (e.shootCd <= 0 && Math.abs(dx) < 620 && Math.abs(dy) < 80) {
          e.shootCd = 1.9;
          this.spawnShot(e.x + (dx > 0 ? e.w : 0), e.y + e.h / 2, dx > 0 ? 300 : -300, 0, 'spark');
          this.sound.tone(580, 220, 0.1, 'square', 0.04);
        }
      } else {
        e.vy += 2100 * dt;
        e.vy = Math.min(e.vy, 900);
        const speed = e.type === 'rat' ? (near ? 155 : 55) : (near ? 42 : 16);
        if (near) e.dir = sign(dx);
        e.vx = e.dir * speed;
        e.x += e.vx * dt;
        this.enemyCollide(e, dt);
        if (e.onGround && !this.groundAhead(e, e.dir)) { e.dir *= -1; e.vx = 0; }
        if (e.x < e.homeX - e.range) { e.x = e.homeX - e.range; e.dir = 1; }
        if (e.x > e.homeX + e.range) { e.x = e.homeX + e.range; e.dir = -1; }
        if (e.type === 'sludge') {
          e.hopCd = (e.hopCd || 1.2) - dt;
          if (e.hopCd <= 0 && e.onGround) {
            e.hopCd = 2 + Math.random() * 1.6;
            e.vy = -330; e.vx = e.dir * 90;
          }
        }
      }

      if (!p.dead && p.invuln <= 0) {
        const box = rect(e.x + 4, e.y + 4, e.w - 8, e.h - 8);
        const pb = rect(p.x + 5, p.y + 5, p.w - 10, p.h - 9);
        if (overlap(box, pb)) this.damagePlayer(1, e.x + e.w / 2);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead || e.flash > 0);
  }

  enemyCollide(e, dt) {
    e.onGround = false;
    e.y += e.vy * dt;
    for (const s of this.room.solids) {
      if (!overlap(e, s)) continue;
      if (e.vy > 0) {
        if (s.oneWay && e.y + e.h - e.vy * dt > s.y + 8) continue;
        e.y = s.y - e.h; e.vy = 0; e.onGround = true;
      } else if (e.vy < 0 && !s.oneWay) { e.y = s.y + s.h; e.vy = 0; }
    }
    e.x = clamp(e.x, 0, this.room.w - e.w);
  }

  groundAhead(e, dir) {
    const probe = rect(e.x + (dir > 0 ? e.w : -6), e.y + e.h + 2, 8, 8);
    return this.room.solids.some((s) => overlap(probe, s));
  }

  hurtEnemy(e, dmg, dir) {
    e.hp -= dmg;
    e.flash = 0.18;
    e.x += dir * 5;
    this.spawnBurst(e.x + e.w / 2, e.y + e.h / 2, '#ffd36b', 8);
    this.sound.hit();
    this.camera.shake = Math.max(this.camera.shake, 3);
    if (e.hp <= 0) {
      e.dead = true;
      e.flash = 0.2;
      this.spawnBurst(e.x + e.w / 2, e.y + e.h / 2, e.type === 'sludge' ? '#a6ff5a' : '#ff8c62', 18);
      this.sound.tone(120, 45, 0.2, 'sawtooth', 0.07);
      if (this.player.hp < this.player.maxHp && Math.random() < 0.28) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.spawnBurst(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, '#ff7a6a', 10);
      }
    }
  }

  spawnShot(x, y, vx, vy, type = 'spark', gravity = 0) {
    this.projectiles.push({ x, y, vx, vy, type, gravity, t: 0, life: 4, dead: false, parryable: type !== 'wave' });
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.t += dt;
      pr.vy += pr.gravity * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.t > pr.life || pr.x < -50 || pr.x > this.room.w + 50 || pr.y > this.room.h + 50) pr.dead = true;
      const box = rect(pr.x - 7, pr.y - 7, 14, 14);
      if (this.room.solids.some((s) => !s.oneWay && overlap(box, s))) { pr.dead = true; this.spawnBurst(pr.x, pr.y, pr.type === 'acid' ? '#b6ff5a' : '#ffd36b', 5); }
      if (!p.dead && p.invuln <= 0 && overlap(box, rect(p.x + 5, p.y + 5, p.w - 10, p.h - 9))) {
        pr.dead = true;
        this.damagePlayer(1, pr.x);
      }
      if (pr.type === 'acid' && pr.t < 0.02 && Math.random() < 0.4) this.spawnParticle(pr.x, pr.y, rand(-20, 20), rand(-20, 20), 0.4, '#a6ff5a', 2, 0);
    }
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);
  }

  // ---------------------------------------------------------------- pickups / world events
  updatePickups(dt) {
    const p = this.player;
    const pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    for (const pk of this.pickups) {
      if (this.save.collected.includes(pk.id)) continue;
      const d = Math.hypot(pc.x - pk.x, pc.y - pk.y);
      if (d < 46) {
        this.save.collected.push(pk.id);
        this.persist();
        this.spawnBurst(pk.x, pk.y, pk.type === 'tank' ? '#7fdcff' : pk.type === 'ability' ? '#ffd36b' : '#9fffe0', 26);
        if (pk.type === 'ability') {
          this.abil[pk.ability] = true;
          this.save.abilities = { ...this.abil };
          this.persist();
          this.sound.pickup();
          this.freeze = 1.7;
          this.flash = 1;
          this.showToast(pk.title, pk.text, 6, ABILITY_INFO[pk.ability]?.color || '#ffd36b');
          document.body.classList.add('ability-flash');
          setTimeout(() => document.body.classList.remove('ability-flash'), 500);
        } else if (pk.type === 'tank') {
          p.maxHp += 1;
          p.hp = p.maxHp;
          this.save.maxHp = p.maxHp;
          this.persist();
          this.sound.pickup();
          this.showToast(pk.title, pk.text, 4.5, '#7fdcff');
        } else {
          this.sound.checkpoint();
          this.showToast(pk.title, pk.text, 6.5, '#9fffe0');
        }
        this.pickups = this.pickups.filter((x) => x.id !== pk.id);
        break;
      }
    }
  }

  updateCheckpoints(dt) {
    const p = this.player;
    for (const cp of this.checkpoints) {
      if (cp.active && this.save.checkpoint.id === cp.id) continue;
      const box = rect(cp.x - 46, cp.y - 90, 92, 100);
      if (overlap(p, box)) {
        cp.active = true;
        this.save.checkpoint = { room: this.roomId, id: cp.id, x: cp.x, y: cp.y };
        this.save.maxHp = p.maxHp;
        p.hp = p.maxHp;
        this.persist();
        this.sound.checkpoint();
        this.showToast('BEACON ONLINE', 'Checkpoint saved. The city remembers you.', 2.8, '#9fffe0');
        this.checkpointCd = 1;
      }
    }
  }

  updateDoors(dt) {
    if (this.doorLock > 0) return;
    const p = this.player;
    for (const d of this.room.doors) {
      if (!overlap(p, d)) continue;
      if (d.require && !this.abil[d.require]) {
        if (this.doorMsgCd <= 0) {
          this.doorMsgCd = 2.4;
          this.showToast('SEALED', d.locked || 'You are missing something.', 3.2, '#ff8a5c');
          this.sound.gate();
          this.camera.shake = 5;
        }
        const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        if (d.w < d.h) {
          if (p.x + p.w / 2 < cx) p.x = d.x - p.w - 2; else p.x = d.x + d.w + 2;
        } else {
          p.y = d.y + d.h + 2; p.vy = -40;
        }
        return;
      }
      this.startTransition(d.to, d.spawn);
      return;
    }
  }

  startTransition(to, spawn) {
    this.transition = { t: 0, to, spawn, switched: false };
    this.sound.gate();
  }

  updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    if (!tr.switched && tr.t >= 0.22) {
      this.loadRoom(tr.to, tr.spawn);
      tr.switched = true;
      this.transition = tr;
      this.doorLock = 0.8;
      this.player.invuln = 1.2;
    }
    if (tr.t >= 0.48) this.transition = null;
  }
  // ---------------------------------------------------------------- boss
  updateBoss(dt) {
    const b = this.boss, p = this.player;
    if (!b) return;
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt * 5);
    b.jaw = Math.max(0, b.jaw - dt * 3);

    if (b.state === 'dying') {
      b.y += dt * 18;
      b.hurt += dt;
      if (Math.random() < 0.25) this.spawnParticle(b.x + rand(0, b.w), b.y + rand(0, b.h), rand(-40, 40), rand(-120, -20), rand(0.4, 1), '#ff7a5c', rand(1, 3), 20);
      return;
    }

    if (b.state === 'sleep') {
      if (p.x > 260 || b.t > 2.5) {
        b.state = 'intro'; b.active = true; b.t = 0;
        this.sound.roar();
        this.camera.shake = 18;
        this.flash = 0.8;
        this.showToast('THE GUTTER KING', 'Something under the water has noticed you.', 4, '#ff665c');
      }
      return;
    }

    if (b.state === 'intro') {
      if (b.t > 1.5) { b.state = 'stalk'; b.t = 0; b.attackCd = 1.4; }
      return;
    }

    b.facing = (p.x + p.w / 2) < (b.x + b.w / 2) ? -1 : 1;
    b.attackCd = (b.attackCd || 1.5) - dt;

    if (b.state === 'stalk') {
      const dx = p.x + p.w / 2 - (b.x + b.w / 2);
      const speed = b.phase === 2 ? 95 : 62;
      if (Math.abs(dx) > 170) b.x += Math.sign(dx) * speed * dt;
      b.x = clamp(b.x, 140, this.room.w - b.w - 140);
      if (b.attackCd <= 0) {
        if (Math.abs(dx) > 330) { b.state = 'wind'; b.t = 0; b.jaw = 1; this.sound.roar(); }
        else if (b.phase === 2 && Math.random() < 0.45) { b.state = 'slamWind'; b.t = 0; }
        else { b.state = 'spitWind'; b.t = 0; }
      }
    } else if (b.state === 'wind') {
      if (b.t > 0.55) { b.state = 'charge'; b.t = 0; b.vx = b.facing * (b.phase === 2 ? 720 : 590); b.jaw = 1; }
    } else if (b.state === 'charge') {
      b.x += b.vx * dt;
      this.camera.shake = Math.max(this.camera.shake, 4);
      if (Math.random() < 0.6) this.spawnParticle(b.x + (b.facing > 0 ? 20 : b.w - 20), b.y + b.h - 6, -b.facing * rand(40, 160), rand(-120, -20), rand(0.25, 0.5), '#6b8f7a', rand(2, 5), 300);
      if (b.x < 140 || b.x + b.w > this.room.w - 140 || b.t > 1.6) {
        b.x = clamp(b.x, 140, this.room.w - b.w - 140);
        b.state = 'stun'; b.t = 0; b.vx = 0; b.jaw = 0;
        this.camera.shake = 20;
        this.sound.roar();
        this.spawnBurst(b.x + b.w / 2, b.y + b.h / 2, '#ffb35c', 20);
      }
    } else if (b.state === 'stun') {
      if (b.t > 1.6) {
        b.state = 'stalk'; b.t = 0; b.attackCd = b.phase === 2 ? 0.7 : 1.15;
      }
    } else if (b.state === 'spitWind') {
      b.jaw = 1;
      if (b.t > 0.5) {
        b.state = 'stalk'; b.t = 0; b.attackCd = 1.9;
        const sx = b.x + (b.facing > 0 ? b.w - 20 : 20), sy = b.y + 30;
        const dx = p.x + p.w / 2 - sx, dy = p.y + p.h / 2 - sy;
        const len = Math.hypot(dx, dy) || 1;
        for (let i = -1; i <= 1; i++) {
          const a = Math.atan2(dy, dx) + i * 0.18;
          this.spawnShot(sx, sy, Math.cos(a) * 320, Math.sin(a) * 320 - 70, 'acid', 500);
        }
        this.sound.splash();
      }
    } else if (b.state === 'slamWind') {
      b.jaw = 1;
      if (b.t > 0.45) {
        b.state = 'slam'; b.t = 0;
        b.vy = -780;
        b.vx = clamp((p.x + p.w / 2 - (b.x + b.w / 2)) * 0.8, -220, 220);
        this.sound.roar();
      }
    } else if (b.state === 'slam') {
      b.vy += 2200 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.x = clamp(b.x, 140, this.room.w - b.w - 140);
      if (b.y + b.h >= 840) {
        b.y = 840 - b.h; b.vy = 0; b.state = 'stalk'; b.t = 0; b.attackCd = 1.6;
        this.camera.shake = 22;
        this.sound.roar();
        this.spawnBurst(b.x + b.w / 2, 838, '#ffb35c', 22);
        this.spawnShot(b.x + 40, 830, -430, 0, 'wave');
        this.spawnShot(b.x + b.w - 40, 830, 430, 0, 'wave');
      }
    }

    if (b.phase === 1 && b.hp <= b.maxHp / 2) {
      b.phase = 2;
      this.sound.roar();
      this.flash = 0.9;
      this.camera.shake = 20;
      this.showToast('THE KING RISES', 'It is not finished. It is only angry.', 3.4, '#ff665c');
      if (!b.spawnedAdds) {
        b.spawnedAdds = true;
        this.enemies.push(this.makeEnemy({ type: 'rat', x: 600, y: 840, range: 180 }, 21));
        this.enemies.push(this.makeEnemy({ type: 'rat', x: 1320, y: 840, range: 180 }, 22));
      }
    }

    if (!p.dead && p.invuln <= 0) {
      const pb = rect(p.x + 5, p.y + 5, p.w - 10, p.h - 9);
      if (overlap(pb, rect(b.x + 26, b.y + 16, b.w - 52, b.h - 16))) this.damagePlayer(1, b.x + b.w / 2);
    }

    // Keep the fight in the chamber.
    if (b.active && !b.dead) {
      p.x = clamp(p.x, 48, this.room.w - p.w - 48);
      if (this.roomBanner < 1) this.roomBanner = 1;
    }
  }

  hurtBoss(dmg, dir) {
    const b = this.boss;
    if (!b || b.dead || !b.active || ['intro', 'sleep', 'dying'].includes(b.state)) return;
    b.hp -= dmg;
    b.flash = 0.16;
    b.x += dir * 4;
    this.sound.bossHit();
    this.camera.shake = 9;
    this.spawnBurst(b.x + b.w / 2 + rand(-80, 80), b.y + rand(10, b.h - 10), '#ffb35c', 12);
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      b.state = 'dying';
      b.t = 0;
      this.sound.roar();
      this.camera.shake = 26;
      this.flash = 1;
      this.save.bossDefeated = true;
      this.endingT = 4.2;
      this.persist();
      this.showToast('THE GUTTER KING FALLS', 'The water begins to move again — downward.', 4.5, '#ffb35c');
    }
  }

  showEnding() {
    this.state = 'ending';
    this.toasts = [];
    const logs = this.save.collected.filter((c) => c.startsWith('log-')).length;
    const tanks = this.save.collected.filter((c) => c.startsWith('tank-')).length;
    document.getElementById('ending-stats').innerHTML = `
      <div><span>TIME IN THE DARK</span><b>${this.formatTime(this.playTime)}</b></div>
      <div><span>BEACONS LOST</span><b>${this.save.deaths || 0}</b></div>
      <div><span>NOTES RECOVERED</span><b>${logs} / 4</b></div>
      <div><span>PRESSURE TANKS</span><b>${tanks} / 2</b></div>`;
    document.getElementById('ending').classList.remove('hidden');
    this.sound.checkpoint();
  }

  formatTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- particles / toasts
  spawnParticle(x, y, vx, vy, life, color, size, gravity = 220) {
    if (this.particles.length > 460) return;
    this.particles.push({ x, y, vx, vy, life, max: life, color, size, gravity });
  }

  spawnBurst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(40, 260);
      this.spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40, rand(0.25, 0.8), color, rand(1, 3.5), 420);
    }
  }

  updateParticles(dt, title = false) {
    this.steamAcc = (this.steamAcc || 0) + dt;
    if (this.steamAcc > 0.075 && this.room) {
      this.steamAcc = 0;
      for (const v of this.room.steam || []) {
        if (Math.random() < 0.7) this.spawnParticle(v.x + rand(-20, 20), v.y - rand(0, 8), rand(-14, 14), rand(-52, -20), rand(0.8, 1.8), 'rgba(180,230,215,.20)', rand(3, 8), -8);
      }
      if (!title && this.roomId === 'blackwater') {
        for (let i = 0; i < 2; i++) this.spawnParticle(rand(0, this.room.w), 812, rand(-10, 10), rand(-30, -8), rand(0.8, 1.6), 'rgba(255,100,80,.14)', rand(2, 5), -4);
      }
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.995;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  updateToasts(dt) {
    if (!this.toasts.length) return;
    const t = this.toasts[0];
    t.t += dt;
    if (t.t > t.dur) this.toasts.shift();
  }

  showToast(title, text, dur = 4, color = '#9fffe0') {
    this.toasts = [{ title, text, dur, t: 0, color }];
  }

  // ---------------------------------------------------------------- rendering
  visible(r) {
    return r.x + r.w > this.camX - 80 && r.x < this.camX + W / ZOOM + 80 && r.y + r.h > this.camY - 80 && r.y < this.camY + H / ZOOM + 80;
  }

  getPattern(theme) {
    if (!this.patterns) this.patterns = {};
    if (this.patterns[theme]) return this.patterns[theme];
    const th = THEMES[theme];
    const c = document.createElement('canvas');
    c.width = 128; c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = th.mortar;
    g.fillRect(0, 0, 128, 80);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? -32 : 0;
      for (let col = -1; col < 3; col++) {
        const x = off + col * 64, y = row * 20;
        const n = hash(row * 17 + col * 5 + theme.length);
        g.fillStyle = th.brick;
        g.globalAlpha = 0.8 + n * 0.2;
        g.fillRect(x + 2, y + 2, 60, 16);
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,255,255,.035)';
        g.fillRect(x + 2, y + 2, 60, 2);
        g.fillStyle = 'rgba(0,0,0,.16)';
        g.fillRect(x + 2, y + 16, 60, 2);
        if (n > 0.76) {
          g.fillStyle = 'rgba(20,70,45,.26)';
          g.fillRect(x + 8 + n * 30, y + 5, 14, 3);
        }
      }
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.09})`;
      g.fillRect(Math.random() * 128, Math.random() * 80, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    const pat = this.ctx.createPattern(c, 'repeat');
    this.patterns[theme] = pat;
    return pat;
  }

  render() {
    const ctx = this.ctx;
    const sh = this.camera.shake;
    this.camX = this.camera.x + (sh ? rand(-sh, sh) * 0.5 : 0);
    this.camY = this.camera.y + (sh ? rand(-sh, sh) * 0.5 : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.drawBackground();
    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-this.camX, -this.camY);
    this.drawWorld();
    ctx.restore();
    this.drawLighting();
    this.drawScreenFx();
    if (this.state !== 'title') this.drawHUD();
    this.drawToasts();
    if (this.state === 'title') this.drawTitleForeground();
    if (this.transition) {
      const tr = this.transition;
      const a = tr.t < 0.22 ? tr.t / 0.22 : Math.max(0, 1 - (tr.t - 0.22) / 0.26);
      ctx.fillStyle = `rgba(1,4,5,${clamp(a, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawTitleForeground() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(2,8,10,.36)');
    g.addColorStop(0.55, 'rgba(2,8,10,.10)');
    g.addColorStop(1, 'rgba(2,8,10,.66)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawBackground() {
    const ctx = this.ctx, th = THEMES[this.room.theme];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.deep);
    g.addColorStop(0.52, th.base);
    g.addColorStop(1, th.deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(-((this.camX * 0.22) % 128), -((this.camY * 0.22) % 80));
    ctx.fillStyle = this.getPattern(this.room.theme);
    ctx.fillRect(-128, -80, W + 256, H + 160);
    ctx.restore();

    // Deep tunnel mouths, drawn on a slower parallax plane.
    ctx.save();
    ctx.translate(-this.camX * 0.42, -this.camY * 0.42);
    for (let x = -400; x < this.room.w + 500; x += 620) {
      const top = 190 + hash(x) * 70;
      const w = 360 + hash(x + 1) * 110;
      ctx.fillStyle = 'rgba(1,5,6,.34)';
      ctx.beginPath();
      ctx.roundRect(x - this.camX * 0.58, top, w, 520, [w / 2, w / 2, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = th.fog;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,255,240,.035)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // Far pipes and haze.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(-this.camX * 0.6, -this.camY * 0.6);
    for (let i = 0; i < 3; i++) {
      const y = 90 + i * 46 + Math.sin(i * 7) * 16;
      ctx.fillStyle = 'rgba(3,10,11,.55)';
      ctx.fillRect(-200, y, this.room.w + 400, 12 + i * 3);
      ctx.fillStyle = 'rgba(120,170,150,.05)';
      ctx.fillRect(-200, y, this.room.w + 400, 2);
    }
    ctx.restore();

    const fog = ctx.createRadialGradient(W * 0.55, H * 0.55, 60, W * 0.55, H * 0.55, W * 0.75);
    fog.addColorStop(0, th.fog);
    fog.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);

    const low = ctx.createLinearGradient(0, H - 160, 0, H);
    low.addColorStop(0, 'rgba(0,0,0,0)');
    low.addColorStop(1, th.water + '55');
    ctx.fillStyle = low;
    ctx.fillRect(0, H - 160, W, 160);
  }

  drawWorld() {
    const ctx = this.ctx;
    for (const s of this.room.solids) if (this.visible(s)) this.drawSolid(s);
    for (const w of this.room.water || []) this.drawWater(w);
    for (const p of this.room.props || []) this.drawProp(p);
    this.drawLamps();
    for (const h of this.room.hazards || []) this.drawHazard(h);
    for (const d of this.room.doors) this.drawDoor(d);
    for (const cp of this.checkpoints) this.drawCheckpoint(cp);
    for (const h of this.room.hints || []) this.drawHint(h);
    for (const pk of this.pickups) this.drawPickup(pk);
    for (const e of this.enemies) if (!e.dead) this.drawEnemy(e);
    if (this.boss) this.drawBoss(this.boss);
    for (const pr of this.projectiles) this.drawProjectile(pr);
    this.drawPlayer();
    this.drawParticles();
  }

  drawSolid(s) {
    const ctx = this.ctx, th = THEMES[this.room.theme];
    if (s.oneWay) {
      ctx.fillStyle = '#1b2b2a';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(160,210,194,.22)';
      for (let x = s.x + 4; x < s.x + s.w - 4; x += 16) {
        ctx.fillRect(x, s.y + 6, 8, 3);
        ctx.save();
        ctx.translate(x, s.y + 12);
        ctx.rotate(-0.5);
        ctx.fillRect(0, 0, 13, 2);
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(210,245,232,.78)';
      ctx.fillRect(s.x, s.y, s.w, 2);
      ctx.fillStyle = 'rgba(255,211,107,.4)';
      ctx.fillRect(s.x, s.y + 2, s.w, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(s.x, s.y + s.h - 4, s.w, 4);
      ctx.strokeStyle = 'rgba(120,165,152,.35)'; ctx.lineWidth = 2;
      for (let x = s.x + 18; x < s.x + s.w; x += 88) {
        ctx.beginPath(); ctx.moveTo(x, s.y + s.h); ctx.lineTo(x - 9, s.y + s.h + 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, s.y + s.h); ctx.lineTo(x + 9, s.y + s.h + 10); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,211,107,.7)';
      for (let x = s.x + 10; x < s.x + s.w; x += 48) ctx.fillRect(x, s.y + 9, 3, 3);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    ctx.fillStyle = this.getPattern(this.room.theme);
    ctx.fillRect(s.x, s.y, s.w, s.h);
    const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
    g.addColorStop(0, 'rgba(190,235,215,.10)');
    g.addColorStop(0.22, 'rgba(0,0,0,0)');
    g.addColorStop(0.82, 'rgba(0,0,0,.22)');
    g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    const n = Math.floor(s.w / 90);
    for (let i = 0; i < n; i++) {
      const x = s.x + hash(s.x + i * 31) * s.w;
      const y = s.y + 8 + hash(s.y + i * 17) * Math.max(8, s.h - 20);
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10, y + 14);
      ctx.lineTo(x + 5, y + 24);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(196,244,226,.55)';
    ctx.fillRect(s.x, s.y, s.w, 3);
    ctx.fillStyle = 'rgba(255,211,107,.38)';
    ctx.fillRect(s.x, s.y + 3, s.w, 1);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(s.x, s.y + s.h - 4, s.w, 4);
    for (let x = s.x + 12; x < s.x + s.w - 8; x += 74) {
      ctx.fillStyle = 'rgba(11,22,22,.7)';
      ctx.beginPath(); ctx.arc(x, s.y + 11, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(190,220,208,.3)';
      ctx.beginPath(); ctx.arc(x - 0.7, s.y + 10.3, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    if (s.w > 120) {
      for (let i = 0; i < s.w / 120; i++) {
        if (hash(s.x + i * 13) > 0.5) {
          const x = s.x + hash(s.x + i * 7) * (s.w - 40);
          ctx.strokeStyle = 'rgba(80,140,76,.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, s.y);
          ctx.quadraticCurveTo(x + 6, s.y - 10, x + 16, s.y - 4);
          ctx.stroke();
        }
      }
    }
  }
  // ---------------------------------------------------------------- set dressing
  drawProp(p) {
    const ctx = this.ctx, t = this.player.anim, th = THEMES[this.room.theme];
    switch (p.t) {
      case 'sign': {
        ctx.save();
        ctx.fillStyle = 'rgba(5,13,14,.82)';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(198,166,104,.32)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
        ctx.fillStyle = 'rgba(255,211,107,.22)';
        ctx.fillRect(p.x, p.y, 4, p.h);
        for (let x = p.x + 10; x < p.x + p.w - 8; x += 24) {
          ctx.fillStyle = 'rgba(255,211,107,.15)';
          ctx.beginPath(); ctx.arc(x, p.y + p.h - 8, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = p.color || '#d8b06a';
        ctx.font = `700 ${Math.min(30, p.w / 10)}px "Courier New", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(p.text, p.x + 16, p.y + 38);
        ctx.fillStyle = 'rgba(200,230,220,.48)';
        ctx.font = '10px "Courier New", monospace';
        ctx.fillText(p.sub || '', p.x + 17, p.y + 60);
        ctx.restore();
        break;
      }
      case 'stencil': {
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.font = `900 ${p.size}px "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
        break;
      }
      case 'pipe': {
        const vert = p.w < p.h;
        ctx.save();
        if (vert) {
          const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
          g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(0.4, p.color); g.addColorStop(0.65, 'rgba(190,230,220,.2)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
          ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
          for (let y = p.y + 80; y < p.y + p.h; y += 180) {
            ctx.fillStyle = 'rgba(9,18,18,.65)'; ctx.fillRect(p.x - 5, y, p.w + 10, 9);
          }
        } else {
          const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
          g.addColorStop(0, 'rgba(180,225,210,.2)'); g.addColorStop(0.35, p.color); g.addColorStop(1, 'rgba(0,0,0,.65)');
          ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
          for (let x = p.x + 140; x < p.x + p.w; x += 260) {
            ctx.fillStyle = 'rgba(8,17,17,.6)'; ctx.fillRect(x, p.y - 4, 10, p.h + 8);
          }
        }
        ctx.restore();
        break;
      }
      case 'ladder': {
        ctx.save();
        ctx.strokeStyle = 'rgba(164,190,180,.34)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.h); ctx.moveTo(p.x + p.w, p.y); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = p.y + 12; y < p.y + p.h; y += 22) { ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'crate': {
        ctx.fillStyle = '#211a13'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(168,132,83,.42)'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
        ctx.beginPath(); ctx.moveTo(p.x + 2, p.y + 2); ctx.lineTo(p.x + p.w - 2, p.y + p.h - 2); ctx.moveTo(p.x + p.w - 2, p.y + 2); ctx.lineTo(p.x + 2, p.y + p.h - 2); ctx.stroke();
        break;
      }
      case 'barrel': {
        const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
        g.addColorStop(0, '#12201e'); g.addColorStop(0.45, '#32433b'); g.addColorStop(1, '#0d1716');
        ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'rgba(180,220,200,.18)'; ctx.fillRect(p.x + 3, p.y + 4, 3, p.h - 8);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(p.x, p.y + 8, p.w, 4); ctx.fillRect(p.x, p.y + p.h - 12, p.w, 4);
        break;
      }
      case 'hazardStripes': {
        ctx.save();
        ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
        ctx.fillStyle = '#b88a2f'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#131a18';
        for (let x = p.x - p.h; x < p.x + p.w + p.h; x += 26) {
          ctx.beginPath(); ctx.moveTo(x, p.y + p.h); ctx.lineTo(x + 13, p.y); ctx.lineTo(x + 26, p.y); ctx.lineTo(x + 13, p.y + p.h); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'puddle': {
        const g = ctx.createRadialGradient(p.x + p.w / 2, p.y, 4, p.x + p.w / 2, p.y, p.w / 2);
        g.addColorStop(0, 'rgba(90,220,195,.16)'); g.addColorStop(1, 'rgba(10,30,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, p.y, p.w / 2, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(150,255,230,.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, p.y - 2, p.w * 0.3, 5, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'cables': {
        ctx.save();
        ctx.strokeStyle = 'rgba(8,14,14,.8)'; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const x0 = p.x + i * (p.w / 4), x1 = x0 + p.w / 4;
          ctx.beginPath(); ctx.moveTo(x0, p.y); ctx.quadraticCurveTo((x0 + x1) / 2, p.y + 50 + i * 11, x1, p.y + 18); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'valve': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = 'rgba(190,220,210,.38)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + t * 0.05; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r); ctx.stroke(); }
        ctx.fillStyle = 'rgba(255,211,107,.25)'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'graffiti': {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-0.04);
        ctx.fillStyle = p.color; ctx.font = `700 ${p.size}px "Courier New", monospace`; ctx.textAlign = 'left';
        ctx.fillText(p.text, 0, 0); ctx.restore();
        break;
      }
      case 'arrowSign': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.fillStyle = 'rgba(5,12,13,.8)'; ctx.fillRect(-90, -22, 180, 44);
        ctx.strokeStyle = 'rgba(255,196,107,.3)'; ctx.lineWidth = 2; ctx.strokeRect(-87, -19, 174, 38);
        ctx.fillStyle = '#e0bd7d'; ctx.font = '700 13px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText(p.text, 0, 5);
        ctx.beginPath();
        if (p.dir === 'left') { ctx.moveTo(-74, 0); ctx.lineTo(-62, -7); ctx.lineTo(-62, 7); }
        else { ctx.moveTo(74, 0); ctx.lineTo(62, -7); ctx.lineTo(62, 7); }
        ctx.fill(); ctx.restore();
        break;
      }
      case 'fan': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.fillStyle = 'rgba(2,7,8,.62)'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(173,205,193,.26)'; ctx.lineWidth = 7; ctx.stroke();
        ctx.rotate(t * 1.2);
        ctx.fillStyle = 'rgba(134,173,160,.20)';
        for (let i = 0; i < 5; i++) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.ellipse(p.r * 0.42, 0, p.r * 0.38, p.r * 0.12, 0.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = 'rgba(160,200,190,.15)'; ctx.lineWidth = 2;
        for (let i = -p.r + 20; i < p.r - 10; i += 18) { ctx.beginPath(); ctx.moveTo(i, -p.r + 8); ctx.lineTo(i, p.r - 8); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'grate': {
        ctx.fillStyle = 'rgba(4,10,11,.9)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(150,185,175,.35)'; ctx.lineWidth = 3;
        for (let x = p.x + 8; x < p.x + p.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, p.y + 3); ctx.lineTo(x, p.y + p.h - 3); ctx.stroke(); }
        break;
      }
      case 'cage': {
        ctx.save(); ctx.strokeStyle = 'rgba(120,140,130,.3)'; ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        for (let x = p.x + 8; x < p.x + p.w; x += 12) { ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(120,140,130,.18)'; for (let y = p.y + 20; y < p.y + p.h; y += 22) { ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'bones': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = 'rgba(198,190,166,.28)'; ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          const x = hash(i + p.x) * p.w, y = 4 + hash(i * 2 + p.x) * 12, a = hash(i * 3) * 3;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 6); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.arc(x + Math.cos(a) * 24, y + Math.sin(a) * 6, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(198,190,166,.28)'; ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'nest': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.strokeStyle = 'rgba(92,76,52,.5)'; ctx.lineWidth = 3;
        for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(hash(i) * p.w, 0); ctx.quadraticCurveTo(hash(i + 2) * p.w, -p.h, hash(i + 4) * p.w, 4); ctx.stroke(); }
        ctx.fillStyle = 'rgba(55,44,30,.6)'; ctx.beginPath(); ctx.ellipse(p.w / 2, 0, p.w / 2, p.h, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'shaftLight': {
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0, 'rgba(150,255,225,.16)'); g.addColorStop(1, 'rgba(150,255,225,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.w, p.y); ctx.lineTo(p.x + p.w + 60, p.y + p.h); ctx.lineTo(p.x - 60, p.y + p.h); ctx.closePath(); ctx.fill();
        break;
      }
      case 'chain': {
        ctx.save(); ctx.strokeStyle = 'rgba(130,155,145,.28)'; ctx.lineWidth = 2;
        for (let y = p.y; y < p.y + p.h; y += 14) { ctx.beginPath(); ctx.ellipse(p.x, y, 5, 8, t * 0.05, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'gauge': {
        ctx.fillStyle = 'rgba(5,14,15,.85)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(150,200,205,.35)'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2 + 6, r = Math.min(p.w, p.h) * 0.32;
        ctx.strokeStyle = 'rgba(160,215,210,.5)'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI * 2); ctx.stroke();
        const a = Math.PI + 0.7 + Math.sin(t * 0.8) * 0.35;
        ctx.strokeStyle = 'rgba(255,120,95,.7)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        ctx.fillStyle = 'rgba(255,150,100,.5)'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'panel': {
        ctx.fillStyle = 'rgba(8,18,20,.92)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(110,200,210,.3)'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
        for (let i = 0; i < 8; i++) {
          const on = hash(i + p.x) > 0.45;
          ctx.fillStyle = on ? (i % 3 ? 'rgba(255,196,107,.8)' : 'rgba(111,220,255,.8)') : 'rgba(60,90,90,.4)';
          ctx.fillRect(p.x + 14 + (i % 4) * 24, p.y + 18 + Math.floor(i / 4) * 28, 12, 8);
        }
        ctx.fillStyle = 'rgba(140,210,210,.22)'; ctx.fillRect(p.x + 14, p.y + p.h - 24, p.w - 28, 3);
        break;
      }
      case 'turbine': {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.fillStyle = 'rgba(3,9,10,.9)'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(110,180,190,.3)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.rotate(t * 4);
        ctx.fillStyle = 'rgba(150,205,210,.18)';
        for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.fillRect(-4, 8, 8, p.r - 10); }
        ctx.fillStyle = 'rgba(255,211,107,.5)'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'waterfall': {
        ctx.save();
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0, 'rgba(120,240,225,.20)'); g.addColorStop(1, 'rgba(80,200,205,.03)');
        ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'rgba(190,255,245,.18)'; ctx.lineWidth = 1;
        for (let i = 0; i < 7; i++) {
          const x = p.x + (i / 7) * p.w + Math.sin(t * 2 + i) * 3;
          ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x + 5, p.y + p.h); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'throne': {
        ctx.fillStyle = 'rgba(24,17,16,.92)';
        ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h); ctx.lineTo(p.x + 30, p.y + 20); ctx.lineTo(p.x + p.w - 20, p.y); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,100,80,.18)'; ctx.lineWidth = 3;
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(p.x + 20 + i * 36, p.y + p.h); ctx.lineTo(p.x + 60 + i * 20, p.y + 20); ctx.stroke(); }
        ctx.fillStyle = 'rgba(200,190,160,.2)';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(p.x + 40 + i * 42, p.y + p.h - 20, 8, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      default: break;
    }
  }

  drawLamps() {
    const ctx = this.ctx, t = this.player.anim;
    for (const light of this.room.lights || []) {
      if (light.x < this.camX - 80 || light.x > this.camX + W / ZOOM + 80 || light.y < this.camY - 80 || light.y > this.camY + H / ZOOM + 80) continue;
      const x = light.x, y = light.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,150,140,.22)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 6); ctx.stroke();
      ctx.fillStyle = '#101b1a';
      ctx.beginPath(); ctx.roundRect(x - 8, y - 10, 16, 8, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(150,190,175,.3)'; ctx.stroke();
      ctx.fillStyle = light.color;
      ctx.beginPath(); ctx.arc(x, y - 2, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y - 2, 0, x, y - 2, 22 + Math.sin(t * 3 + x) * 3);
      g.addColorStop(0, this.hexA(light.color, 0.5));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - 2, 24, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawWater(w) {
    const ctx = this.ctx, t = this.player.anim;
    const th = THEMES[this.room.theme];
    const g = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
    g.addColorStop(0, w.toxic ? 'rgba(95,170,55,.38)' : 'rgba(30,120,115,.3)');
    g.addColorStop(0.45, w.toxic ? 'rgba(48,92,30,.45)' : 'rgba(10,60,62,.42)');
    g.addColorStop(1, 'rgba(2,12,14,.7)');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w.x, w.y + 2);
    for (let x = w.x; x <= w.x + w.w; x += 12) {
      ctx.lineTo(x, w.y + Math.sin(x * 0.024 + t * 2.1) * 3 + Math.sin(x * 0.007 - t * 1.2) * 2);
    }
    ctx.lineTo(w.x + w.w, w.y + w.h);
    ctx.lineTo(w.x, w.y + w.h);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = w.toxic ? 'rgba(174,255,98,.28)' : 'rgba(140,245,230,.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const y = w.y + 10 + i * 14;
      ctx.beginPath();
      for (let x = w.x; x <= w.x + w.w; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.03 + t * 1.5 + i) * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = w.toxic ? 'rgba(190,255,110,.5)' : 'rgba(170,255,240,.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = w.x; x <= w.x + w.w; x += 10) {
      const y = w.y + Math.sin(x * 0.024 + t * 2.1) * 3;
      if (x === w.x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (w.toxic) {
      ctx.fillStyle = 'rgba(174,255,98,.09)';
      for (let i = 0; i < 5; i++) {
        const x = w.x + hash(i + w.x) * w.w, y = w.y + 8 + hash(i + 2) * 20;
        ctx.beginPath(); ctx.arc(x, y, 2 + Math.sin(t * 2 + i) * 1.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawHazard(h) {
    const ctx = this.ctx, t = this.player.anim;
    if (h.type === 'steam') {
      ctx.save();
      const g = ctx.createLinearGradient(0, h.y - 90, 0, h.y + h.h);
      g.addColorStop(0, 'rgba(255,190,120,0)');
      g.addColorStop(0.55, 'rgba(255,220,180,.20)');
      g.addColorStop(1, 'rgba(255,250,235,.55)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(h.x + 4, h.y + h.h); ctx.quadraticCurveTo(h.x + h.w / 2 + Math.sin(t * 2) * 8, h.y - 100, h.x + h.w - 4, h.y + h.h); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,210,.28)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(h.x + h.w / 2 + Math.sin(t * 3 + i * 2) * 10, h.y - 10 - i * 22, 12 + i * 5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = `rgba(150,255,80,${0.12 + Math.sin(t * 3) * 0.04})`;
      ctx.fillRect(h.x, h.y - 14, h.w, 14);
      ctx.strokeStyle = 'rgba(190,255,110,.55)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = h.x; x <= h.x + h.w; x += 12) ctx.lineTo(x, h.y - 2 + Math.sin(x * 0.12 + t * 3) * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,255,110,.35)';
      for (let i = 0; i < 6; i++) {
        const x = h.x + hash(i + h.x) * h.w;
        ctx.beginPath(); ctx.arc(x, h.y - 6 - hash(i + 2) * 12, 2 + Math.sin(t * 4 + i) * 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  drawGlyph(id, x, y, s, color, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.10);
    ctx.lineCap = 'round';
    if (id === 'dash') {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.36 + i * s * 0.24, y - s * 0.26);
        ctx.lineTo(x - s * 0.12 + i * s * 0.24, y);
        ctx.lineTo(x - s * 0.36 + i * s * 0.24, y + s * 0.26);
        ctx.stroke();
      }
    } else if (id === 'wallGrip') {
      ctx.beginPath(); ctx.moveTo(x - s * 0.34, y - s * 0.34); ctx.lineTo(x - s * 0.34, y + s * 0.34);
      ctx.moveTo(x + s * 0.34, y - s * 0.34); ctx.lineTo(x + s * 0.34, y + s * 0.34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - s * 0.1, y + s * 0.18); ctx.lineTo(x + s * 0.06, y - s * 0.02); ctx.lineTo(x - s * 0.08, y - s * 0.14); ctx.lineTo(x + s * 0.16, y - s * 0.34); ctx.stroke();
    } else if (id === 'doubleJump') {
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.28, y + s * (0.18 - i * 0.28)); ctx.lineTo(x, y - s * (0.08 + i * 0.28)); ctx.lineTo(x + s * 0.28, y + s * (0.18 - i * 0.28));
        ctx.stroke();
      }
    } else if (id === 'wrench') {
      ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.3); ctx.lineTo(x + s * 0.16, y - s * 0.16); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + s * 0.22, y - s * 0.22, s * 0.16, 0.4, Math.PI * 1.65); ctx.stroke();
    }
    ctx.restore();
  }

  drawDoor(d) {
    const ctx = this.ctx, t = this.player.anim;
    const vertical = d.h >= d.w;
    const locked = d.require && !this.abil[d.require];
    const color = d.require ? (ABILITY_INFO[d.require]?.color || '#ffb35c') : '#74ffd0';
    ctx.save();
    if (vertical) {
      const g = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
      g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(0.5, 'rgba(4,12,13,.95)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(d.x, d.y, d.w, d.h, [0, 26, 26, 0]); ctx.fill();
      ctx.strokeStyle = 'rgba(140,200,185,.28)'; ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,255,215,.18)';
      ctx.fillRect(d.x + 4, d.y + d.h - 4, d.w - 8, 3);
      // Warn stripes beside the mouth.
      ctx.fillStyle = 'rgba(255,180,90,.18)';
      for (let y = d.y + 10; y < d.y + d.h - 10; y += 18) ctx.fillRect(d.x + (d.x < 20 ? d.w - 6 : 2), y, 4, 8);
      if (locked) {
        ctx.fillStyle = `rgba(255,140,80,${0.07 + Math.sin(t * 3) * 0.02})`;
        ctx.fillRect(d.x + 3, d.y + 3, d.w - 6, d.h - 6);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35 + Math.sin(t * 2) * 0.12;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(d.x + 6 + i * 8, d.y + 6); ctx.lineTo(d.x + 2 + i * 8, d.y + d.h - 6); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        this.drawGlyph(d.require, d.x + d.w / 2, d.y + d.h / 2, 22, color, 0.8);
      }
      if (d.label) {
        ctx.fillStyle = 'rgba(210,240,228,.42)';
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(d.x + d.w / 2 + (d.x < 20 ? 28 : -28), d.y + d.h / 2);
        ctx.rotate(-Math.PI / 2 * (d.x < 20 ? 1 : -1));
        ctx.fillText(d.label, 0, 0);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = 'rgba(1,6,7,.9)';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = 'rgba(150,210,195,.3)'; ctx.lineWidth = 3;
      ctx.strokeRect(d.x + 2, d.y + 2, d.w - 4, d.h - 4);
      ctx.fillStyle = locked ? 'rgba(255,140,80,.15)' : 'rgba(120,255,215,.12)';
      ctx.fillRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
      if (locked) this.drawGlyph(d.require, d.x + d.w / 2, d.y + d.h / 2, 20, color, 0.7);
      if (d.label) {
        ctx.fillStyle = 'rgba(210,240,228,.4)'; ctx.font = '9px "Courier New", monospace'; ctx.textAlign = 'left';
        ctx.fillText(d.label, d.x + 6, d.y + d.h + 12);
      }
    }
    ctx.restore();
  }

  drawCheckpoint(cp) {
    const ctx = this.ctx, t = this.player.anim;
    const active = cp.active || this.save.checkpoint.id === cp.id;
    const col = active ? '#89ffd0' : '#ffc46b';
    ctx.save();
    ctx.fillStyle = 'rgba(2,8,9,.8)';
    ctx.beginPath(); ctx.ellipse(cp.x, cp.y - 2, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = active ? 'rgba(130,255,210,.4)' : 'rgba(255,196,107,.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cp.x, cp.y - 3, 22, 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(160,190,180,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cp.x, cp.y - 8); ctx.lineTo(cp.x, cp.y - 58); ctx.stroke();
    const pulse = 0.7 + Math.sin(t * 2.4 + cp.x) * 0.25;
    const g = ctx.createRadialGradient(cp.x, cp.y - 64, 2, cp.x, cp.y - 64, 32);
    g.addColorStop(0, active ? `rgba(160,255,220,${pulse})` : `rgba(255,210,130,${pulse})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cp.x, cp.y - 64, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cp.x, cp.y - 64, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(cp.x, cp.y - 64, 10 + Math.sin(t * 2 + cp.x) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = active ? 'rgba(160,255,220,.55)' : 'rgba(255,210,130,.35)';
    ctx.font = '8px "Courier New", monospace'; ctx.textAlign = 'center';
    ctx.fillText(active ? 'BEACON' : 'BEACON', cp.x, cp.y - 82);
    ctx.restore();
  }

  drawPickup(pk) {
    const ctx = this.ctx, t = this.player.anim;
    const bob = Math.sin(t * 2 + pk.x * 0.05) * 5;
    const y = pk.y + bob;
    ctx.save();
    const g = ctx.createRadialGradient(pk.x, y, 2, pk.x, y, 44);
    const col = pk.type === 'tank' ? '#7fdcff' : pk.type === 'ability' ? '#ffd36b' : '#9fffe0';
    g.addColorStop(0, col + '55'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(pk.x, y, 44, 0, Math.PI * 2); ctx.fill();
    const beam = ctx.createLinearGradient(0, y - 80, 0, y + 20);
    beam.addColorStop(0, 'rgba(0,0,0,0)'); beam.addColorStop(1, col + '22');
    ctx.fillStyle = beam; ctx.fillRect(pk.x - 20, y - 80, 40, 100);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pk.x, y, 22 + Math.sin(t * 2.5) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (pk.type === 'ability') {
      ctx.save(); ctx.translate(pk.x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(10,18,17,.9)';
      ctx.fillRect(-17, -17, 34, 34);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(-17, -17, 34, 34);
      ctx.restore();
      this.drawGlyph(pk.ability, pk.x, y, 26, col);
      ctx.fillStyle = col + 'bb'; ctx.font = '9px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(pk.title, pk.x, y + 38);
    } else if (pk.type === 'tank') {
      ctx.fillStyle = 'rgba(8,22,28,.95)'; ctx.fillRect(pk.x - 11, y - 15, 22, 30);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(pk.x - 11, y - 15, 22, 30);
      ctx.fillStyle = col + '88'; ctx.fillRect(pk.x - 7, y - 4, 14, 15);
      ctx.fillStyle = col; ctx.fillRect(pk.x - 2, y - 11, 4, 10); ctx.fillRect(pk.x - 5, y - 8, 10, 4);
    } else {
      ctx.fillStyle = 'rgba(220,225,200,.9)';
      ctx.fillRect(pk.x - 12, y - 8, 24, 16);
      ctx.strokeStyle = 'rgba(30,50,50,.5)'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(pk.x - 8, y - 4 + i * 4); ctx.lineTo(pk.x + 8, y - 4 + i * 4); ctx.stroke(); }
      ctx.fillStyle = 'rgba(120,200,180,.5)'; ctx.fillRect(pk.x - 14, y - 3, 3, 6);
    }
    ctx.restore();
  }

  drawHint(h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(160,255,225,.26)';
    ctx.font = '10px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText(h.text, h.x, h.y);
    ctx.fillStyle = 'rgba(160,255,225,.32)';
    ctx.fillRect(h.x - 10, h.y - 8, 2, 2);
    ctx.restore();
  }
  // ---------------------------------------------------------------- creatures
  drawEnemy(e) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (e.type === 'drone') {
      const bob = Math.sin(e.t * 2) * 2;
      ctx.translate(0, bob);
      const g = ctx.createRadialGradient(0, -14, 2, 0, -14, 26);
      g.addColorStop(0, 'rgba(255,110,80,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -14, 26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(150,190,185,.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-26, -24); ctx.lineTo(26, -24); ctx.stroke();
      ctx.fillStyle = '#1c2a29';
      ctx.beginPath(); ctx.ellipse(0, -14, 15, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(160,205,195,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = e.flash > 0 ? '#ffd9a0' : 'rgba(255,90,70,.9)';
      ctx.beginPath(); ctx.arc(0, -14, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,90,.45)'; ctx.beginPath(); ctx.arc(0, -14, 7 + Math.sin(e.t * 4) * 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,190,.4)'; ctx.fillRect(-2, -8, 4, 6);
    } else if (e.type === 'turret') {
      ctx.translate(0, 0);
      ctx.fillStyle = '#172221'; ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-14, -26); ctx.lineTo(14, -26); ctx.lineTo(20, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,200,190,.3)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.scale(e.dir, 1);
      ctx.fillStyle = '#2a3c39'; ctx.fillRect(4, -21, 22, 8);
      ctx.fillStyle = 'rgba(10,18,18,.8)'; ctx.fillRect(18, -23, 8, 12);
      ctx.fillStyle = '#ff6a52'; ctx.beginPath(); ctx.arc(0, -18, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = e.flash > 0 ? '#ffe0b0' : 'rgba(255,120,90,.7)'; ctx.beginPath(); ctx.arc(0, -13, 2, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'sludge') {
      const wob = Math.sin(e.t * 3) * 2;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createLinearGradient(0, -30, 0, 0);
      g.addColorStop(0, e.flash > 0 ? '#e8ffd0' : '#4f6e32'); g.addColorStop(0.6, '#6da53d'); g.addColorStop(1, '#23381e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.quadraticCurveTo(-24, -17 + wob, -10, -24);
      ctx.quadraticCurveTo(0, -31 - wob, 12, -23);
      ctx.quadraticCurveTo(25, -15, 20, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(180,255,120,.25)';
      ctx.beginPath(); ctx.ellipse(-5, -20, 8, 3, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(210,255,160,.85)';
      ctx.beginPath(); ctx.arc(-7, -15, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -15, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,200,60,.4)';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(rand(-12, 12), -6 + Math.sin(e.t * 2 + i) * 3, 2, 0, Math.PI * 2); ctx.fill(); }
    } else {
      // rat
      const run = Math.sin(e.t * 11) * 3;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 22, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.scale(e.dir, 1);
      ctx.strokeStyle = 'rgba(168,120,112,.5)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-16, -10); ctx.bezierCurveTo(-30, -8, -34, -18, -28, -24); ctx.stroke();
      const g = ctx.createLinearGradient(0, -20, 0, 0);
      g.addColorStop(0, e.flash > 0 ? '#f0d0b0' : '#4a352a'); g.addColorStop(1, '#1d1410');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(-3, -11, 18, 9, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3e2b22'; ctx.beginPath(); ctx.ellipse(13, -12, 10, 8, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4d352a'; ctx.beginPath(); ctx.ellipse(10, -22, 5, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a3d2e'; ctx.beginPath(); ctx.moveTo(18, -15); ctx.lineTo(26, -12); ctx.lineTo(18, -9); ctx.fill();
      ctx.fillStyle = 'rgba(255,110,80,.95)'; ctx.beginPath(); ctx.arc(16, -14, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#33241d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-14 + run, 0); ctx.moveTo(4, -3); ctx.lineTo(8 - run, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawBoss(b) {
    const ctx = this.ctx, t = this.player.anim;
    const feet = b.y + b.h;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, feet + 2, b.w * 0.62, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,110,90,.18)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = 50 + i * 34 + Math.sin(t * 2 + i) * 6;
      ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, feet, r, r * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.translate(b.x + b.w / 2, feet);
    ctx.scale(b.facing, 1);
    if (b.state === 'dying') { ctx.globalAlpha = Math.max(0.25, 1 - b.hurt * 0.14); ctx.rotate(0.06); }

    // Tail
    ctx.strokeStyle = '#16251f'; ctx.lineWidth = 38; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-60, -42); ctx.bezierCurveTo(-130, -50, -185, -12, -216, -34); ctx.stroke();
    ctx.strokeStyle = '#243b30'; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.moveTo(-60, -42); ctx.bezierCurveTo(-130, -50, -185, -12, -216, -34); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,170,130,.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-70, -40); ctx.bezierCurveTo(-130, -50, -185, -12, -216, -34); ctx.stroke();

    // Back legs
    ctx.fillStyle = '#1b2c24';
    ctx.beginPath(); ctx.ellipse(-72, -4, 26, 16, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -2, 24, 13, 0.1, 0, Math.PI * 2); ctx.fill();

    // Body
    const g = ctx.createLinearGradient(0, -105, 0, 0);
    g.addColorStop(0, b.flash > 0 ? '#d8e6c0' : '#3b5644');
    g.addColorStop(0.5, '#22382c');
    g.addColorStop(1, '#101c16');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(-26, -48, 122, 44, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(45, -44, 62, 36, -0.1, 0, Math.PI * 2); ctx.fill();

    // Armor ridges
    ctx.fillStyle = 'rgba(114,152,116,.34)';
    for (let i = 0; i < 7; i++) {
      const x = -118 + i * 28;
      ctx.beginPath(); ctx.moveTo(x, -74 - (i % 3) * 4); ctx.lineTo(x + 14, -96 - (i % 3) * 6); ctx.lineTo(x + 28, -72 - (i % 3) * 3); ctx.closePath(); ctx.fill();
    }
    // Old chains
    ctx.strokeStyle = 'rgba(160,150,120,.35)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-96, -70); ctx.quadraticCurveTo(-20, -24, 54, -54); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,28,22,.7)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const x = -92 + i * 18, y = -62 + Math.sin(i * 1.2) * 12;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
    }

    // Head
    ctx.save();
    ctx.translate(88, -60);
    const hg = ctx.createLinearGradient(0, -30, 0, 34);
    hg.addColorStop(0, b.flash > 0 ? '#e8ffd8' : '#456450'); hg.addColorStop(1, '#1b2e24');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.ellipse(0, 0, 60, 30, -0.06, 0, Math.PI * 2); ctx.fill();
    // snout
    ctx.beginPath(); ctx.moveTo(16, -18); ctx.quadraticCurveTo(82, -20, 96, -2); ctx.quadraticCurveTo(84, 22, 18, 16); ctx.closePath(); ctx.fill();
    // upper teeth
    ctx.fillStyle = 'rgba(235,240,210,.85)';
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(36 + i * 8, 14); ctx.lineTo(40 + i * 8, 22); ctx.lineTo(44 + i * 8, 14); ctx.fill(); }
    // lower jaw
    ctx.save();
    ctx.translate(20, 18); ctx.rotate(b.jaw * 0.28);
    ctx.fillStyle = '#1a2a20'; ctx.beginPath(); ctx.ellipse(35, 8, 58, 13, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(225,230,205,.7)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(24 + i * 10, 2); ctx.lineTo(28 + i * 10, -7); ctx.lineTo(32 + i * 10, 2); ctx.fill(); }
    ctx.restore();
    // eyes
    const glow = b.state === 'stun' ? 0.35 : 0.9;
    ctx.fillStyle = `rgba(255,${b.phase === 2 ? 70 : 140},70,${glow})`;
    ctx.beginPath(); ctx.ellipse(22, -14, 6, 3.5, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,.85)';
    ctx.beginPath(); ctx.arc(22, -14, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(40,60,45,.6)';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-10 + i * 6, 8 + i * 2, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    if (b.state === 'stun') {
      ctx.fillStyle = 'rgba(255,220,120,.8)';
      for (let i = 0; i < 3; i++) {
        const a = t * 3 + i * 2.1;
        ctx.beginPath(); ctx.arc(108 + Math.cos(a) * 26, -92 + Math.sin(a) * 10, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- player
  drawPlayer() {
    const ctx = this.ctx, p = this.player, t = p.anim;
    if (p.invuln > 0 && Math.floor(t * 24) % 2 === 0 && (p.hurtT > 0 || this.state === 'play')) ctx.globalAlpha = 0.55;
    const cx = p.x + p.w / 2, bottom = p.y + p.h;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(cx, bottom - 22, 3, cx, bottom - 22, 62);
    aura.addColorStop(0, 'rgba(255,205,130,.16)');
    aura.addColorStop(0.5, 'rgba(120,255,215,.06)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(cx, bottom - 22, 62, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (p.onGround) {
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.ellipse(cx, bottom + 2, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(cx, bottom);
    ctx.scale(p.facing * 1.22, 1.22);
    if (p.dashT > 0) { ctx.rotate(0.12 * p.facing); ctx.scale(1.08, 0.94); }
    const run = Math.min(1, Math.abs(p.vx) / 220);
    const step = Math.sin(p.step * 2) * run;
    const bob = p.onGround ? Math.abs(Math.sin(p.step * 2)) * 1.3 * run : 0;
    ctx.translate(0, -bob);

    // Scarf tail, behind everything.
    const flow = 4 + Math.sin(t * 4) * 3 + Math.min(8, Math.abs(p.vx) * 0.025);
    ctx.strokeStyle = '#cf5638'; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -31); ctx.bezierCurveTo(-15, -32, -19 - flow, -29, -20 - flow, -23 + Math.sin(t * 5) * 2); ctx.stroke();
    ctx.strokeStyle = '#ef8651'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-7, -32); ctx.bezierCurveTo(-14, -33, -18 - flow, -30, -21 - flow, -24); ctx.stroke();

    // Backpack + lamp.
    ctx.fillStyle = '#1c2d29';
    ctx.beginPath(); ctx.roundRect(-13, -32, 7, 13, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,110,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-12.5, -32.5, 6, 12, 2); ctx.stroke();
    ctx.fillStyle = '#ffd08a';
    ctx.beginPath(); ctx.arc(-9.5, -25, 2.6, 0, Math.PI * 2); ctx.fill();

    // Legs.
    ctx.strokeStyle = '#0e1918'; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-3, -15); ctx.lineTo(-5 + step * 5, -5); ctx.lineTo(-8 + step * 8, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, -15); ctx.lineTo(5 - step * 5, -5); ctx.lineTo(9 - step * 8, -1); ctx.stroke();
    ctx.strokeStyle = '#2d4740'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-5 + step * 5, -7); ctx.lineTo(-4 + step * 5, -3); ctx.stroke();
    ctx.fillStyle = '#0a1212';
    ctx.beginPath(); ctx.ellipse(-8 + step * 8, -1, 4.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(9 - step * 8, -1, 4.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();

    // Long coat.
    const coat = ctx.createLinearGradient(0, -34, 0, -7);
    coat.addColorStop(0, p.flash > 0 ? '#d9fff2' : '#4d7467');
    coat.addColorStop(0.5, '#33554b');
    coat.addColorStop(1, '#1f3732');
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-8.5, -33);
    ctx.quadraticCurveTo(-12, -21, -10, -8);
    ctx.quadraticCurveTo(0, -5.5, 10, -8);
    ctx.quadraticCurveTo(12, -21, 8.5, -33);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(165,255,232,.32)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-8.2, -32); ctx.quadraticCurveTo(-11, -21, -9.4, -9); ctx.stroke();
    // Coat seam and belt.
    ctx.strokeStyle = 'rgba(9,20,18,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(1, -31); ctx.lineTo(1, -10); ctx.stroke();
    ctx.fillStyle = '#172825'; ctx.fillRect(-10, -21, 20, 3.5);
    ctx.fillStyle = '#d5a45e'; ctx.fillRect(3, -21, 3, 3.5);
    // Chest strap.
    ctx.strokeStyle = 'rgba(210,170,105,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, -31); ctx.lineTo(6, -20); ctx.stroke();

    // Hood and face.
    ctx.fillStyle = '#213932';
    ctx.beginPath();
    ctx.arc(0.5, -38, 8.6, Math.PI * 0.9, Math.PI * 2.08);
    ctx.quadraticCurveTo(-8, -31, -4, -29);
    ctx.lineTo(7, -29);
    ctx.quadraticCurveTo(10, -31, 9, -34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,255,235,.34)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(0.5, -38, 8.4, Math.PI * 1.02, Math.PI * 1.92); ctx.stroke();
    // Face.
    ctx.fillStyle = '#c89472';
    ctx.beginPath(); ctx.ellipse(4.2, -36.5, 4.4, 4.9, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7e553f';
    ctx.beginPath(); ctx.ellipse(2.6, -35.3, 1.1, 2.1, -0.2, 0, Math.PI * 2); ctx.fill();
    // Goggle / lamp visor.
    ctx.fillStyle = '#0e1c1a';
    ctx.beginPath(); ctx.roundRect(4.2, -39.5, 4.6, 3.1, 1); ctx.fill();
    ctx.fillStyle = '#ffcf82';
    ctx.fillRect(6.9, -38.8, 1.6, 1.4);
    ctx.strokeStyle = 'rgba(255,207,130,.55)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(4.5, -40); ctx.lineTo(8.8, -40); ctx.stroke();

    // Arm with pipe wrench.
    const swing = p.attackT > 0 ? (1 - p.attackT / 0.16) : 0;
    const armAngle = p.attackT > 0 ? -1.0 + swing * 2.2 : (p.dashT > 0 ? 0.75 : 0.18);
    ctx.save();
    ctx.translate(7, -27);
    ctx.rotate(armAngle);
    ctx.strokeStyle = '#2c4941'; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 4); ctx.stroke();
    ctx.fillStyle = '#bd8350';
    ctx.beginPath(); ctx.arc(10, 4, 2, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(11, 4); ctx.rotate(-0.2);
    // handle
    ctx.fillStyle = '#8f9c94'; ctx.fillRect(-2, -1.4, 17, 2.8);
    // open jaw
    ctx.strokeStyle = '#d3dfd7'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(15, -1.5, 4.6, -1.15, 1.75); ctx.stroke();
    ctx.beginPath(); ctx.arc(15, 1.5, 4.6, -1.4, 1.35); ctx.stroke();
    ctx.restore();
    ctx.restore();

    if (p.attackT > 0) {
      ctx.strokeStyle = 'rgba(220,255,235,.38)';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(7, -23, 29, -1.15, 0.85); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,211,107,.22)';
      ctx.beginPath(); ctx.arc(7, -23, 35, -1.05, 0.75); ctx.stroke();
    }
    if (p.wall) {
      ctx.fillStyle = 'rgba(160,255,225,.3)';
      ctx.fillRect(p.wall < 0 ? -13 : 11, -30, 2, 16);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawProjectile(pr) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (pr.type === 'wave') {
      ctx.strokeStyle = 'rgba(255,150,80,.7)'; ctx.lineWidth = 6;
      const y = 832;
      ctx.beginPath(); ctx.arc(pr.x, y + 10, 24, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,210,140,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pr.x, y + 10, 32, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    } else {
      const col = pr.type === 'acid' ? '#a6ff5a' : '#ffb35c';
      const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, 16);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pr.x, pr.y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.vx * 0.035, pr.y - pr.vy * 0.035); ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // ---------------------------------------------------------------- light + grade
  hexA(hex, a) {
    if (!hex || hex[0] !== '#') return hex;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  drawLighting() {
    const ctx = this.ctx, t = this.player.anim;
    if (!this.lightCanvas) {
      this.lightCanvas = document.createElement('canvas');
      this.lightCanvas.width = W; this.lightCanvas.height = H;
      this.lightCtx = this.lightCanvas.getContext('2d');
    }
    const l = this.lightCtx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, W, H);
    const dark = this.state === 'title' ? 0.52 : (this.room.dark ?? 0.62);
    l.fillStyle = `rgba(1,4,6,${dark})`;
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-out';

    const px = (this.player.x + this.player.w / 2 - this.camX) * ZOOM;
    const py = (this.player.y + this.player.h / 2 - this.camY) * ZOOM;
    l.fillStyle = '#fff';
    const pg = l.createRadialGradient(px, py, 4, px, py, 258);
    pg.addColorStop(0, 'rgba(255,255,255,1)');
    pg.addColorStop(0.55, 'rgba(255,255,255,.78)');
    pg.addColorStop(1, 'rgba(255,255,255,0)');
    l.fillStyle = pg;
    l.beginPath(); l.arc(px, py, 258, 0, Math.PI * 2); l.fill();

    // Torch cone from the helmet lamp.
    l.save();
    l.beginPath();
    l.moveTo(px, py);
    l.arc(px, py, 470, this.player.facing > 0 ? -0.48 : Math.PI - 0.48, this.player.facing > 0 ? 0.48 : Math.PI + 0.48);
    l.closePath();
    l.clip();
    const cg = l.createRadialGradient(px, py, 20, px, py, 470);
    cg.addColorStop(0, 'rgba(255,255,255,.9)');
    cg.addColorStop(0.5, 'rgba(255,255,255,.35)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    l.fillStyle = cg;
    l.fillRect(px - 490, py - 490, 980, 980);
    l.restore();

    for (const light of this.room.lights || []) {
      const lx = (light.x - this.camX) * ZOOM, ly = (light.y - this.camY) * ZOOM;
      if (lx < -light.r * ZOOM || lx > W + light.r * ZOOM || ly < -light.r * ZOOM || ly > H + light.r * ZOOM) continue;
      const flick = 0.86 + Math.sin(t * 2.1 + light.x * 0.05) * 0.07 + (hash(light.x) > 0.72 ? Math.sin(t * 13) * 0.05 : 0);
      const r = light.r * ZOOM * flick;
      const g = l.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, 'rgba(255,255,255,.85)');
      g.addColorStop(0.45, 'rgba(255,255,255,.38)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      l.fillStyle = g;
      l.beginPath(); l.arc(lx, ly, r, 0, Math.PI * 2); l.fill();
    }
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.lightCanvas, 0, 0);

    // Colored bloom pass.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const light of this.room.lights || []) {
      const lx = (light.x - this.camX) * ZOOM, ly = (light.y - this.camY) * ZOOM;
      if (lx < -light.r * ZOOM || lx > W + light.r * ZOOM || ly < -light.r * ZOOM || ly > H + light.r * ZOOM) continue;
      const r = light.r * ZOOM * 0.75;
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, this.hexA(light.color, 0.11));
      g.addColorStop(0.5, this.hexA(light.color, 0.035));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
    }
    const lamp = ctx.createRadialGradient(px, py, 0, px, py, 180);
    lamp.addColorStop(0, 'rgba(255,196,110,.12)');
    lamp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lamp;
    ctx.beginPath(); ctx.arc(px, py, 180, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawScreenFx() {
    const ctx = this.ctx;
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.24, W / 2, H / 2, H * 0.86);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.72, 'rgba(0,0,0,.14)');
    v.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    if (!this.grain) {
      const c = document.createElement('canvas'); c.width = 180; c.height = 180;
      const g = c.getContext('2d');
      const d = g.createImageData(180, 180);
      for (let i = 0; i < d.data.length; i += 4) {
        const v2 = Math.random() * 255;
        d.data[i] = v2; d.data[i + 1] = v2; d.data[i + 2] = v2; d.data[i + 3] = 15;
      }
      g.putImageData(d, 0, 0);
      this.grain = ctx.createPattern(c, 'repeat');
    }
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.translate(-Math.random() * 40, -Math.random() * 40);
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, W + 60, H + 60);
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,140,90,${this.flash * 0.11})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.player.hp <= 2 && !this.player.dead && this.state === 'play') {
      const pulse = 0.08 + Math.sin(this.player.anim * 3) * 0.03;
      const r = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
      r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, `rgba(180,20,20,${pulse})`);
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
    if (this.player.dead && this.state === 'play') {
      ctx.fillStyle = 'rgba(8,2,2,.48)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,120,96,.85)';
      ctx.font = '700 22px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '7px';
      ctx.fillText('SIGNAL LOST', W / 2, H / 2 - 8);
      ctx.letterSpacing = '2px';
      ctx.fillStyle = 'rgba(220,220,200,.5)';
      ctx.font = '10px "Courier New", monospace';
      ctx.fillText('REBOOTING FROM LAST BEACON', W / 2, H / 2 + 18);
      ctx.letterSpacing = '0px';
      const w = 220 * clamp(this.deadT / 1.7, 0, 1);
      ctx.fillStyle = 'rgba(255,120,96,.3)'; ctx.fillRect(W / 2 - 110, H / 2 + 34, 220, 2);
      ctx.fillStyle = 'rgba(255,120,96,.75)'; ctx.fillRect(W / 2 - 110, H / 2 + 34, w, 2);
    }
  }

  // ---------------------------------------------------------------- HUD
  drawHUD() {
    const ctx = this.ctx, p = this.player;
    ctx.save();
    // Vitals
    ctx.font = '9px "Courier New", monospace';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(180,225,210,.5)';
    ctx.fillText('VITALS', 24, 24);
    for (let i = 0; i < p.maxHp; i++) {
      const x = 24 + i * 19, y = 32;
      ctx.fillStyle = 'rgba(4,12,13,.72)';
      ctx.fillRect(x, y, 15, 9);
      ctx.strokeStyle = 'rgba(160,215,200,.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 14, 8);
      if (i < p.hp) {
        const g = ctx.createLinearGradient(0, y, 0, y + 9);
        g.addColorStop(0, p.hp <= 2 ? '#ff9a6c' : '#ffd36b');
        g.addColorStop(1, p.hp <= 2 ? '#ff4f42' : '#d97845');
        ctx.fillStyle = g;
        ctx.fillRect(x + 2, y + 2, 11, 5);
      }
    }
    // Kit
    ctx.fillStyle = 'rgba(160,225,210,.42)';
    ctx.fillText('KIT', 24, 58);
    const kit = [['wrench', true], ['dash', this.abil.dash], ['wallGrip', this.abil.wallGrip], ['doubleJump', this.abil.doubleJump]];
    kit.forEach(([id, on], i) => {
      const x = 24 + i * 31, y = 64;
      ctx.fillStyle = on ? 'rgba(8,20,20,.8)' : 'rgba(8,16,16,.45)';
      ctx.fillRect(x, y, 24, 22);
      ctx.strokeStyle = on ? 'rgba(160,240,215,.32)' : 'rgba(120,150,145,.14)';
      ctx.strokeRect(x + 0.5, y + 0.5, 23, 21);
      this.drawGlyph(id, x + 12, y + 11, 15, on ? '#a9ffdf' : '#4f6a63', on ? 0.9 : 0.4);
    });
    // Objective
    ctx.fillStyle = 'rgba(110,215,190,.55)';
    ctx.font = '8px "Courier New", monospace';
    ctx.letterSpacing = '2px';
    ctx.fillText('OBJECTIVE', 24, 103);
    ctx.fillStyle = 'rgba(205,235,225,.62)';
    ctx.font = '10px "Courier New", monospace';
    ctx.letterSpacing = '0.5px';
    ctx.fillText(this.objective(), 24, 118);

    this.drawMinimap();

    if (this.roomBanner > 0) {
      const a = Math.min(1, this.roomBanner * 1.5) * Math.min(1, (2.8 - this.roomBanner) * 3 + 0.2);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220,250,238,.92)';
      ctx.font = '700 20px "Courier New", monospace';
      ctx.letterSpacing = '7px';
      ctx.fillText(this.room.name, W / 2, 46);
      ctx.fillStyle = 'rgba(150,220,200,.48)';
      ctx.font = '9px "Courier New", monospace';
      ctx.letterSpacing = '2px';
      ctx.fillText(this.room.sub, W / 2, 64);
      ctx.fillStyle = 'rgba(160,240,215,.2)';
      ctx.fillRect(W / 2 - 120, 73, 240, 1);
      ctx.globalAlpha = 1;
    }

    if (this.boss && this.boss.active && !this.save.bossDefeated) this.drawBossBar();
    ctx.restore();
  }

  drawMinimap() {
    const ctx = this.ctx;
    const bx = W - 168, by = 16, bw = 144, bh = 108;
    ctx.fillStyle = 'rgba(4,12,13,.65)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(130,200,185,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = 'rgba(150,220,200,.45)';
    ctx.font = '8px "Courier New", monospace';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillText('SECTOR MAP', bx + 9, by + 14);
    const ox = bx + 20, oy = by + 26, cw = 24, ch = 16;
    ctx.strokeStyle = 'rgba(120,190,175,.16)';
    for (const [a, b] of LINKS) {
      if (!this.visited.has(a) || !this.visited.has(b)) continue;
      const pa = MAP[a], pb = MAP[b];
      ctx.beginPath();
      ctx.moveTo(ox + pa.x * cw + 8, oy + pa.y * ch + 5);
      ctx.lineTo(ox + pb.x * cw + 8, oy + pb.y * ch + 5);
      ctx.stroke();
    }
    for (const [id, pos] of Object.entries(MAP)) {
      if (!this.visited.has(id)) continue;
      const x = ox + pos.x * cw, y = oy + pos.y * ch;
      ctx.fillStyle = id === this.roomId ? 'rgba(130,255,215,.82)' : 'rgba(90,150,140,.4)';
      ctx.fillRect(x, y, 17, 10);
      if (id === this.roomId) {
        ctx.fillStyle = '#06110f'; ctx.fillRect(x + 4, y + 3, 9, 4);
      }
    }
    ctx.fillStyle = 'rgba(150,220,200,.28)';
    ctx.font = '7px "Courier New", monospace';
    ctx.fillText(this.abilityLine().replace(/<[^>]*>/g, ''), bx + 9, by + bh - 8);
    ctx.letterSpacing = '0px';
  }

  drawBossBar() {
    const ctx = this.ctx, b = this.boss;
    const alpha = b.state === 'sleep' ? 0 : 0.95;
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = 420, x = W / 2 - w / 2, y = H - 54;
    ctx.fillStyle = 'rgba(4,8,8,.72)';
    ctx.fillRect(x - 8, y - 20, w + 16, 42);
    ctx.strokeStyle = 'rgba(255,110,90,.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(x - 7.5, y - 19.5, w + 15, 41);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,170,140,.85)';
    ctx.font = '700 11px "Courier New", monospace';
    ctx.letterSpacing = '4px';
    ctx.fillText('THE GUTTER KING', W / 2, y - 6);
    ctx.fillStyle = 'rgba(20,8,8,.9)'; ctx.fillRect(x, y + 2, w, 8);
    const frac = clamp(b.hp / b.maxHp, 0, 1);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ff6b52'); g.addColorStop(0.6, '#ffb35c'); g.addColorStop(1, '#ff6b52');
    ctx.fillStyle = g; ctx.fillRect(x, y + 2, w * frac, 8);
    ctx.fillStyle = 'rgba(5,10,10,.7)';
    for (let i = 1; i < 10; i++) ctx.fillRect(x + (w / 10) * i, y + 2, 2, 8);
    ctx.fillStyle = 'rgba(255,180,150,.5)';
    ctx.font = '8px "Courier New", monospace';
    ctx.letterSpacing = '1px';
    ctx.fillText(b.phase === 2 ? 'PHASE II' : 'PHASE I', W / 2, y + 24);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  drawToasts() {
    if (!this.toasts.length) return;
    const ctx = this.ctx;
    const toast = this.toasts[0];
    const fade = Math.min(1, toast.t * 5) * Math.min(1, (toast.dur - toast.t) * 4);
    const maxW = 580;
    ctx.save();
    ctx.globalAlpha = clamp(fade, 0, 1);
    ctx.font = '10px "Courier New", monospace';
    ctx.letterSpacing = '0px';
    const words = toast.text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW - 48 && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    const h = 36 + lines.length * 14;
    const y = (this.boss && this.boss.active && !this.save.bossDefeated) ? H - 158 : H - 118;
    const x = W / 2 - (maxW + 20) / 2;
    ctx.fillStyle = 'rgba(3,9,10,.88)';
    ctx.fillRect(x, y, maxW + 20, h);
    ctx.strokeStyle = 'rgba(130,200,185,.2)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, maxW + 19, h - 1);
    ctx.fillStyle = toast.color;
    ctx.fillRect(x, y, 3, h);
    ctx.fillStyle = toast.color;
    ctx.font = '700 12px "Courier New", monospace';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.fillText(toast.title, x + 18, y + 19);
    ctx.fillStyle = 'rgba(215,235,225,.62)';
    ctx.font = '10px "Courier New", monospace';
    ctx.letterSpacing = '0.3px';
    lines.forEach((ln, i) => ctx.fillText(ln, x + 18, y + 36 + i * 14));
    ctx.restore();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.SILT = new Game();
});
