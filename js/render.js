import {
  TILE as T, VIEW_W, VIEW_H, clamp, lerp, rand, hash,
  THEMES, PHYS, RELICS, TOKEN_TOTAL, ROOM_TOTAL,
  roundRect, heartPath, tokenPath,
} from './common.js';
import { MAP_LAYOUT, ROOM_ORDER } from './levels.js';

export class Renderer {
  constructor(canvas, mapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.worldCanvas = document.createElement('canvas');
    this.worldCtx = this.worldCanvas.getContext('2d');
    this.scale = 0.85;
    this.setScale(this.scale);
    this._perfT = 0;
    this._perfFrames = 0;
    this._perfLast = performance.now();
    this.mapCanvas = mapCanvas;
    this.mapCtx = mapCanvas.getContext('2d');
    this.lightCanvas = document.createElement('canvas');
    this.lightCanvas.width = Math.ceil(VIEW_W / 2);
    this.lightCanvas.height = Math.ceil(VIEW_H / 2);
    this.lctx = this.lightCanvas.getContext('2d');
    this.mapRects = {};

    // static room layer cache keeps software rendering fast
    this.staticCache = null;
    this.staticRoom = null;
    this.staticVersion = -1;
    this.bgCache = null;
    this.bgRoom = null;
    this.dynamicProps = new Set(['waterfall', 'lift', 'fan', 'valve', 'chains', 'lamp']);
    this.lightSprite = this.makeRadialSprite('255,255,255');
    this.glowSprites = new Map();
  }

  makeRadialSprite(rgb) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 63);
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(0.5, `rgba(${rgb},0.74)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return c;
  }

  glowSprite(color) {
    let s = this.glowSprites.get(color);
    if (s) return s;
    let rgb = '255,255,255';
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
      rgb = `${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)}`;
    }
    s = this.makeRadialSprite(rgb);
    this.glowSprites.set(color, s);
    return s;
  }

  getBackground(def) {
    if (this.bgRoom === def && this.bgCache) return this.bgCache;
    const c = document.createElement('canvas');
    c.width = VIEW_W; c.height = VIEW_H;
    const g = c.getContext('2d');
    const old = this.ctx;
    this.ctx = g;
    this.drawBackground(def, { x: 0, y: 0 }, 0);
    this.ctx = old;
    this.bgCache = c;
    this.bgRoom = def;
    return c;
  }

  getStatic(def, game) {
    const ver = game.staticVersion || 0;
    if (this.staticRoom === def && this.staticVersion === ver) return this.staticCache;
    const c = document.createElement('canvas');
    c.width = def.w * T;
    c.height = def.h * T;
    const g = c.getContext('2d');
    const old = this.ctx;
    this.ctx = g;
    this.drawTiles(def, { x: 0, y: 0 }, true);
    for (const p of def.props) {
      if (this.dynamicProps.has(p.type) || p.type === 'drip' || p.type === 'steam' || p.type === 'bubbles' || p.type === 'sludge' || p.type === 'spikes') continue;
      this.drawProp(p, { x: 0, y: 0 }, 0, false);
    }
    this.ctx = old;
    this.staticCache = c;
    this.staticRoom = def;
    this.staticVersion = ver;
    return c;
  }

  setScale(scale) {
    this.scale = Math.round(scale * 100) / 100;
    this.worldCanvas.width = Math.round(VIEW_W * this.scale);
    this.worldCanvas.height = Math.round(VIEW_H * this.scale);
  }

  adaptScale(game) {
    const now = performance.now();
    this._perfFrames++;
    if (now - this._perfLast < 2500) return;
    const fps = this._perfFrames / ((now - this._perfLast) / 1000);
    this._perfFrames = 0;
    this._perfLast = now;
    if (game.state === 'play') {
      if (fps < 30 && this.scale > 0.76) this.setScale(this.scale - 0.1);
      else if (fps > 56 && this.scale < 0.99) this.setScale(this.scale + 0.05);
    }
  }

  render(game) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (game.state === 'title') {
      this.drawTitle(game);
      this._perfLast = performance.now();
      this._perfFrames = 0;
      return;
    }
    if (!game.room) return;
    this.adaptScale(game);

    const wctx = this.worldCtx;
    wctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    wctx.clearRect(0, 0, VIEW_W, VIEW_H);
    this.ctx = wctx;
    this.drawScene(game);
    this.drawLighting(game);
    this.drawForeground(game);
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.worldCanvas, 0, 0, VIEW_W, VIEW_H);
    this.drawHUD(game);
    this.drawTransition(game);
  }

  /* ================================================================
     scene
     ================================================================ */
  drawScene(game) {
    const { ctx } = this;
    const def = game.room;
    const cam = game.cam;
    const shake = game.shake;
    const sx = shake > 0 ? rand(-shake, shake) : 0;
    const sy = shake > 0 ? rand(-shake, shake) : 0;

    ctx.save();
    ctx.translate(sx, sy);
    this.currentTheme = def.theme;
    ctx.drawImage(this.getBackground(def), 0, 0);
    const staticLayer = this.getStatic(def, game);
    ctx.drawImage(staticLayer, -cam.x, -cam.y);
    this.drawHazards(def, cam, game.time);
    this.drawBreakables(def, cam);
    this.drawProps(def, cam, game.time);
    this.drawBarriers(game, cam, game.time);
    this.drawItems(game, cam, game.time);
    this.drawNotes(game, cam, game.time);
    this.drawProjectiles(game, cam, game.time);
    this.drawEnemies(game, cam, game.time);
    this.drawBoss(game, cam, game.time);
    this.drawParticles(game, cam);
    this.drawPlayer(game, cam, game.time);
    ctx.restore();
  }

  drawBackground(def, cam, time) {
    const { ctx } = this;
    const th = THEMES[def.theme] || THEMES.hub;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, th.bg1);
    g.addColorStop(0.55, th.bg2);
    g.addColorStop(1, '#010302');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // huge distant vault / arches
    const par = 0.16;
    const off = ((-(cam.x * par)) % 340 + 340) % 340;
    for (let i = -1; i < 5; i++) {
      const x = off + i * 340 - 90;
      const y = 110 - cam.y * par * 0.35 + (i % 2) * 24;
      const w = 250, h = VIEW_H + 160;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + 92);
      ctx.quadraticCurveTo(x, y, x + w / 2, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + 92);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? th.far : th.far2;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = th.edge;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // distant service lights
    for (let i = 0; i < 12; i++) {
      const n = hash(i, 3, 7);
      const x = ((i * 173 - cam.x * 0.22) % (VIEW_W + 120) + VIEW_W + 120) % (VIEW_W + 120) - 60;
      const y = 70 + n * 300 - cam.y * 0.08;
      if (n > 0.58) {
        ctx.globalAlpha = 0.22 + 0.18 * Math.sin(time * 1.4 + i);
        ctx.fillStyle = th.accent;
        ctx.fillRect(x, y, 3, 9);
        ctx.globalAlpha = 1;
      }
    }

    // fog band
    const fog = ctx.createLinearGradient(0, VIEW_H * 0.45, 0, VIEW_H);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, th.fog + '55');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (def.theme === 'sump') {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(VIEW_W / 2 - cam.x * 0.05, VIEW_H * 0.52 - cam.y * 0.05, 330, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(VIEW_W / 2 - cam.x * 0.05, VIEW_H * 0.52 - cam.y * 0.05, 290, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (def.theme === 'croc') {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = th.accent;
      for (let i = 0; i < 9; i++) {
        const x = 80 + i * 110 - (cam.x * 0.1) % 110;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 10, 0);
        ctx.lineTo(x + 4, 120 + (i % 3) * 40);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // distant pipework
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = th.metal;
    ctx.lineWidth = 12;
    for (let i = 0; i < 3; i++) {
      const y = 40 + i * 54 - cam.y * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = th.metalEdge;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 137 - cam.x * 0.12) % (VIEW_W + 100) + VIEW_W + 100) % (VIEW_W + 100) - 50;
      const y = 40 + (i % 3) * 54 - cam.y * 0.12;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawTiles(def, cam, full = false) {
    const { ctx } = this;
    const th = THEMES[def.theme] || THEMES.hub;
    const x0 = full ? 0 : Math.max(0, Math.floor(cam.x / T) - 1);
    const x1 = full ? def.w - 1 : Math.min(def.w - 1, Math.ceil((cam.x + VIEW_W) / T) + 1);
    const y0 = full ? 0 : Math.max(0, Math.floor(cam.y / T) - 1);
    const y1 = full ? def.h - 1 : Math.min(def.h - 1, Math.ceil((cam.y + VIEW_H) / T) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const mat = def.tiles[y * def.w + x];
        if (!mat) continue;
        const px = x * T - cam.x;
        const py = y * T - cam.y;
        const n = hash(x, y, def.w);
        let base = mat === 2 ? th.metal : mat === 3 ? th.tileC : mat === 5 ? th.metal : (n > 0.5 ? th.tileA : th.tileB);
        if (mat === 4) base = th.metal;

        ctx.fillStyle = base;
        ctx.fillRect(px, py, T + 1, T + 1);

        // block texture
        if (mat === 1 || mat === 3) {
          ctx.fillStyle = th.mortar;
          ctx.globalAlpha = 0.8;
          ctx.fillRect(px, py + (n > 0.5 ? 15 : 16), T + 1, 2);
          const vx = n > 0.5 ? 10 : 22;
          ctx.fillRect(px + vx, py, 2, 16);
          ctx.fillRect(px + (vx + 12) % T, py + 16, 2, 16);
          ctx.globalAlpha = 1;
          if (n > 0.72) {
            ctx.strokeStyle = th.mortar;
            ctx.globalAlpha = 0.75;
            ctx.beginPath();
            ctx.moveTo(px + 7, py + 5);
            ctx.lineTo(px + 13, py + 12);
            ctx.lineTo(px + 10, py + 20);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        } else if (mat === 2 || mat === 5) {
          ctx.strokeStyle = th.mortar;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, T - 4, T - 4);
          ctx.fillStyle = th.metalEdge;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(px + 5, py + 5, 3, 3);
          ctx.fillRect(px + T - 8, py + T - 8, 3, 3);
          ctx.globalAlpha = 1;
          if (mat === 5) {
            ctx.fillStyle = th.mortar;
            for (let i = 0; i < 4; i++) ctx.fillRect(px + 4 + i * 8, py + 3, 2, T - 6);
          }
          if (n > 0.86) {
            ctx.fillStyle = 'rgba(0,0,0,.3)';
            ctx.fillRect(px + 4, py + 12, T - 8, 4);
          }
        }

        // exposed edges
        if (!def.solid(x, y - 1)) {
          ctx.fillStyle = th.edge;
          ctx.globalAlpha = 0.72;
          ctx.fillRect(px, py, T + 1, 3);
          ctx.globalAlpha = 1;
          if (n > 0.62 && (def.theme === 'hub' || def.theme === 'sump' || def.theme === 'rats')) {
            ctx.fillStyle = th.moss;
            ctx.globalAlpha = 0.5;
            const mw = 4 + Math.floor(hash(x, y, 9) * 10);
            ctx.fillRect(px + 4 + Math.floor(n * 14), py - 4, mw, 5);
            ctx.globalAlpha = 1;
          }
        }
        if (!def.solid(x - 1, y)) {
          ctx.fillStyle = th.edge;
          ctx.globalAlpha = 0.23;
          ctx.fillRect(px, py, 2, T);
          ctx.globalAlpha = 1;
        }
        if (!def.solid(x, y + 1)) {
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(px, py + T - 4, T + 1, 4);
        }
      }
    }
  }

  drawHazards(def, cam, time) {
    const { ctx } = this;
    for (const h of def.hazards) {
      const px = h.x * T - cam.x;
      const py = h.y * T - cam.y;
      const pw = h.w * T;
      const ph = Math.max(h.h * T, 18);
      if (px > VIEW_W || px + pw < 0) continue;
      if (h.type === 'spikes') {
        ctx.fillStyle = '#8c9490';
        ctx.strokeStyle = '#2b3531';
        ctx.lineWidth = 2;
        const count = Math.round(h.w * 3);
        for (let i = 0; i < count; i++) {
          const sx = px + i * (pw / count);
          const sh = 18 + hash(i, 2, 3) * 9;
          ctx.beginPath();
          ctx.moveTo(sx, py + ph);
          ctx.lineTo(sx + (pw / count) * 0.5, py + ph - sh);
          ctx.lineTo(sx + pw / count, py + ph);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (h.type === 'steam') {
        ctx.globalAlpha = 0.28;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = '#ffd9ae';
          const yy = py - ((time * 60 + i * 26) % 70);
          ctx.beginPath();
          ctx.ellipse(px + pw / 2 + Math.sin(time * 2 + i) * 8, yy, 12 + i * 4, 26, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff9b4a';
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px, py + ph - 6, pw, 3);
        ctx.globalAlpha = 1;
      } else {
        // sludge
        const acid = def.theme === 'croc';
        const top = py + ph - 12;
        const grd = ctx.createLinearGradient(0, top - 8, 0, top + 26);
        grd.addColorStop(0, acid ? 'rgba(190,255,80,.92)' : 'rgba(120,220,110,.78)');
        grd.addColorStop(0.4, acid ? 'rgba(120,200,40,.55)' : 'rgba(70,170,95,.5)');
        grd.addColorStop(1, 'rgba(10,40,25,.12)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(px, top + 30);
        ctx.lineTo(px, top);
        for (let i = 0; i <= 16; i++) {
          const xx = px + (pw * i) / 16;
          const yy = top + Math.sin(time * 2.1 + i * 0.8 + h.x) * 3 + Math.sin(time * 1.3 + i) * 1.5;
          ctx.lineTo(xx, yy);
        }
        ctx.lineTo(px + pw, top + 30);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = acid ? '#d6ff6a' : '#9bff9c';
        for (let i = 0; i < 5; i++) {
          const xx = px + ((time * 22 + i * 73) % pw);
          ctx.fillRect(xx, top + 2 + Math.sin(time * 2 + i) * 4, 6, 2);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  drawPropsBack(def, cam, time) {
    const { ctx } = this;
    for (const p of def.props) {
      if (!this.dynamicProps.has(p.type)) continue;
      this.drawProp(p, cam, time, true);
    }
  }

  drawProps(def, cam, time) {
    const { ctx } = this;
    for (const p of def.props) {
      if (!this.dynamicProps.has(p.type)) continue;
      const px = p.x * T - cam.x;
      const py = p.y * T - cam.y;
      if (px < -260 || px > VIEW_W + 260 || py < -260 || py > VIEW_H + 300) continue;
      this.drawProp(p, cam, time, false);
    }
  }

  drawProp(p, cam, time, back) {
    const { ctx } = this;
    const th = THEMES[this.currentTheme] || THEMES.hub;
    const px = p.x * T - cam.x;
    const py = p.y * T - cam.y;
    switch (p.type) {
      case 'lamp': {
        ctx.strokeStyle = 'rgba(190,210,190,.28)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + 26);
        ctx.stroke();
        ctx.fillStyle = '#151b17';
        ctx.beginPath();
        ctx.moveTo(px - 13, py + 26);
        ctx.lineTo(px + 13, py + 26);
        ctx.lineTo(px + 9, py + 36);
        ctx.lineTo(px - 9, py + 36);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = p.color || th.lamp;
        ctx.beginPath();
        ctx.arc(px, py + 40, 4 + Math.sin(time * 5 + px) * 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'sign': {
        const color = p.color || th.accent;
        const big = !p.small;
        const size = big ? 13 : 9;
        ctx.font = `700 ${size}px "Courier New", monospace`;
        const tw = Math.max(ctx.measureText(p.text).width, p.sub ? ctx.measureText(p.sub).width * 0.82 : 0);
        const w = tw + 20;
        const h = p.sub ? (big ? 46 : 34) : (big ? 28 : 20);
        ctx.fillStyle = 'rgba(4,9,7,.82)';
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 1.5;
        ctx.fillRect(px, py, w, h);
        ctx.strokeRect(px, py, w, h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, px + 10, py + (p.sub ? 14 : h / 2));
        if (p.sub) {
          ctx.globalAlpha = 0.6;
          ctx.font = `400 ${big ? 7 : 6}px "Courier New", monospace`;
          ctx.fillText(p.sub, px + 10, py + h - 11);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'pipes': {
        const w = (p.w || 6) * T;
        ctx.fillStyle = th.metal;
        ctx.fillRect(px, py - 6, w, 12);
        ctx.fillStyle = th.metalEdge;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(px, py - 6, w, 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0b1210';
        for (let i = 1; i < (p.w || 6); i += 2) {
          ctx.fillRect(px + i * T, py - 9, 4, 18);
        }
        break;
      }
      case 'chains': {
        const n = p.n || 3;
        ctx.strokeStyle = 'rgba(160,180,160,.35)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < n; i++) {
          const cx = px + i * 17;
          const len = 40 + hash(i, 1, 2) * 90;
          ctx.beginPath();
          ctx.moveTo(cx, py);
          ctx.lineTo(cx + Math.sin(time + i) * 2, py + len);
          ctx.stroke();
          for (let j = 0; j < len; j += 9) {
            ctx.strokeRect(cx - 2, py + j, 4, 5);
          }
        }
        break;
      }
      case 'trash': {
        ctx.fillStyle = '#101512';
        for (let i = 0; i < 3; i++) {
          const ox = i * 13 - 6;
          ctx.beginPath();
          ctx.ellipse(px + ox, py - 3 - i * 4, 13 - i * 2, 9, i * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(180,200,180,.12)';
        ctx.beginPath();
        ctx.ellipse(px - 4, py - 10, 5, 2, -0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crate': {
        ctx.fillStyle = '#4a3b28';
        ctx.fillRect(px - 14, py - 26, 28, 26);
        ctx.strokeStyle = '#2b2116';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 14, py - 26, 28, 26);
        ctx.beginPath();
        ctx.moveTo(px - 12, py - 24);
        ctx.lineTo(px + 12, py - 2);
        ctx.moveTo(px + 12, py - 24);
        ctx.lineTo(px - 12, py - 2);
        ctx.stroke();
        break;
      }
      case 'barrel': {
        ctx.fillStyle = '#3f4a3a';
        ctx.beginPath();
        ctx.ellipse(px, py - 23, 11, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(px - 11, py - 23, 22, 23);
        ctx.fillStyle = '#232b20';
        ctx.fillRect(px - 11, py - 17, 22, 3);
        ctx.fillRect(px - 11, py - 8, 22, 3);
        break;
      }
      case 'bench': {
        // lamp
        ctx.strokeStyle = 'rgba(190,210,190,.3)';
        ctx.beginPath();
        ctx.moveTo(px, py - 95);
        ctx.lineTo(px, py - 70);
        ctx.stroke();
        ctx.fillStyle = '#1a201b';
        ctx.beginPath();
        ctx.moveTo(px - 14, py - 70);
        ctx.lineTo(px + 14, py - 70);
        ctx.lineTo(px + 8, py - 60);
        ctx.lineTo(px - 8, py - 60);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#a6ff9a';
        ctx.beginPath();
        ctx.arc(px, py - 56, 4, 0, Math.PI * 2);
        ctx.fill();
        // bench
        ctx.fillStyle = '#3d4a3a';
        ctx.fillRect(px - 32, py - 30, 64, 9);
        ctx.fillStyle = '#2c372a';
        ctx.fillRect(px - 32, py - 21, 64, 4);
        ctx.fillRect(px - 26, py - 17, 6, 17);
        ctx.fillRect(px + 20, py - 17, 6, 17);
        ctx.fillStyle = 'rgba(220,255,200,.55)';
        ctx.font = '600 7px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SAVE', px, py - 36);
        break;
      }
      case 'pedestal': {
        ctx.fillStyle = '#3c4a3d';
        ctx.fillRect(px - 16, py - 18, 32, 18);
        ctx.fillStyle = '#4f6350';
        ctx.fillRect(px - 20, py - 22, 40, 5);
        ctx.fillStyle = 'rgba(185,242,60,.25)';
        ctx.fillRect(px - 12, py - 20, 24, 2);
        break;
      }
      case 'fan': {
        const r = p.radius || 40;
        ctx.strokeStyle = 'rgba(170,200,180,.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(time * 0.7);
        ctx.fillStyle = 'rgba(150,180,165,.18)';
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.ellipse(0, -r * 0.45, r * 0.2, r * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'valve': {
        ctx.strokeStyle = 'rgba(210,170,120,.55)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(px, py, p.radius || 28, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + time * 0.05;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a) * (p.radius || 28), py + Math.sin(a) * (p.radius || 28));
          ctx.stroke();
        }
        break;
      }
      case 'waterfall': {
        const w = (p.w || 4) * T;
        const h = (p.h || 20) * T;
        const grd = ctx.createLinearGradient(0, py, 0, py + h);
        grd.addColorStop(0, 'rgba(150,220,255,.28)');
        grd.addColorStop(0.7, 'rgba(110,190,230,.12)');
        grd.addColorStop(1, 'rgba(90,170,210,.22)');
        ctx.fillStyle = grd;
        ctx.fillRect(px, py, w, h);
        ctx.strokeStyle = 'rgba(210,245,255,.22)';
        ctx.lineWidth = 1;
        for (let i = 0; i < w / 8; i++) {
          const xx = px + i * 8 + Math.sin(time * 4 + i) * 2;
          ctx.beginPath();
          ctx.moveTo(xx, py + ((time * 300 + i * 40) % h));
          ctx.lineTo(xx, py + ((time * 300 + i * 40) % h) + 28);
          ctx.stroke();
        }
        break;
      }
      case 'lift': {
        const w = 4 * T;
        const h = (p.h || 12) * T;
        ctx.globalAlpha = 0.4;
        const grd = ctx.createLinearGradient(0, py + h, 0, py);
        grd.addColorStop(0, 'rgba(185,242,60,.05)');
        grd.addColorStop(0.6, 'rgba(185,242,60,.22)');
        grd.addColorStop(1, 'rgba(120,255,190,.02)');
        ctx.fillStyle = grd;
        ctx.fillRect(px, py, w, h);
        ctx.strokeStyle = 'rgba(185,242,60,.35)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const yy = py + h - ((time * 160 + i * 90) % h);
          ctx.beginPath();
          ctx.moveTo(px + 14, yy);
          ctx.lineTo(px + w / 2, yy - 10);
          ctx.lineTo(px + w - 14, yy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'grate': {
        const w = (p.w || 3) * T;
        ctx.fillStyle = 'rgba(6,10,8,.8)';
        ctx.fillRect(px, py - 2, w, 5);
        ctx.fillStyle = 'rgba(100,130,115,.5)';
        for (let i = 0; i < w; i += 9) ctx.fillRect(px + i, py - 3, 4, 7);
        break;
      }
      case 'puddle': {
        const w = (p.w || 4) * T;
        ctx.fillStyle = 'rgba(120,200,190,.08)';
        ctx.beginPath();
        ctx.ellipse(px + w / 2, py, w / 2, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(190,240,230,.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(px + w / 2 + Math.sin(time + p.x) * 4, py - 1, w / 2 - 6, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'spikes':
        break;
      case 'graffiti': {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rot || 0);
        ctx.globalAlpha = 0.32;
        ctx.font = '900 20px Impact, "Arial Black", sans-serif';
        ctx.fillStyle = p.color || th.accent;
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.lineWidth = 3;
        ctx.strokeText(p.text, 0, 0);
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        break;
      }
      case 'drip':
        break;
      case 'steam':
        break;
      case 'bubbles':
        break;
      case 'bones': {
        ctx.strokeStyle = 'rgba(210,205,180,.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 12, py - 2);
        ctx.lineTo(px + 12, py - 8);
        ctx.stroke();
        ctx.fillStyle = 'rgba(210,205,180,.4)';
        ctx.beginPath();
        ctx.arc(px - 14, py - 1, 3, 0, Math.PI * 2);
        ctx.arc(px + 14, py - 9, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'skull': {
        ctx.fillStyle = 'rgba(220,215,190,.42)';
        ctx.beginPath();
        ctx.ellipse(px, py, 8, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(px - 4, py + 4, 8, 5);
        ctx.fillStyle = '#1a1510';
        ctx.fillRect(px - 4, py - 2, 3, 3);
        ctx.fillRect(px + 2, py - 2, 3, 3);
        break;
      }
      case 'mushroom': {
        for (let i = 0; i < 3; i++) {
          const ox = i * 9 - 8;
          const s = 3 + hash(i, p.x, 2) * 3;
          ctx.fillStyle = 'rgba(190,255,150,.5)';
          ctx.beginPath();
          ctx.ellipse(px + ox, py - i * 2, s + 2, s, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = 'rgba(220,240,210,.35)';
          ctx.fillRect(px + ox - 1, py - i * 2, 2, 4);
        }
        break;
      }
      case 'algae': {
        const w = (p.w || 4) * T;
        ctx.strokeStyle = 'rgba(100,200,110,.3)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const xx = px + (i / 10) * w;
          ctx.beginPath();
          ctx.moveTo(xx, py);
          ctx.lineTo(xx + Math.sin(time + i) * 4, py - 6 - hash(i, 1, 3) * 10);
          ctx.stroke();
        }
        break;
      }
      case 'vent': {
        ctx.fillStyle = '#39443a';
        ctx.fillRect(px - 14, py - 6, 28, 6);
        ctx.fillStyle = '#11190f';
        for (let i = 0; i < 3; i++) ctx.fillRect(px - 11 + i * 8, py - 5, 4, 4);
        break;
      }
      case 'lockers': {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i === 1 ? '#48594b' : '#3c4a3f';
          ctx.fillRect(px + i * 22, py - 56, 20, 56);
          ctx.strokeStyle = '#1a241d';
          ctx.strokeRect(px + i * 22, py - 56, 20, 56);
          ctx.fillStyle = '#7e8f78';
          ctx.fillRect(px + i * 22 + 15, py - 34, 2, 6);
        }
        break;
      }
      case 'shelf': {
        ctx.fillStyle = '#4a3d2c';
        ctx.fillRect(px - 18, py - 30, 60, 5);
        ctx.fillStyle = '#5b4b35';
        for (let i = 0; i < 5; i++) {
          const hh = 8 + hash(i, 2, 5) * 12;
          ctx.fillRect(px - 14 + i * 11, py - 30 - hh, 7, hh);
        }
        break;
      }
      case 'mop': {
        ctx.strokeStyle = '#8b7355';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 10, py - 42);
        ctx.stroke();
        ctx.fillStyle = '#a8a37d';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(px - 4 + i * 3, py - 5, 2, 6);
        }
        break;
      }
      case 'sludge':
        break;
    }
  }

  drawBreakables(def, cam) {
    const { ctx } = this;
    for (const b of def.breakables) {
      if (b.hp <= 0) continue;
      const px = b.x * T - cam.x;
      const py = b.y * T - cam.y;
      if (px < -100 || px > VIEW_W + 100) continue;
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#0a0d0a';
      ctx.lineWidth = 2;
      for (let i = 0; i < b.w; i++) {
        ctx.beginPath();
        ctx.moveTo(px + i * T + 8, py + 4);
        ctx.lineTo(px + i * T + 18, py + 14);
        ctx.lineTo(px + i * T + 11, py + 22);
        ctx.lineTo(px + i * T + 20, py + 31);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#c9d8b0';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillText('HIT', px + 5, py + T * b.h - 8);
      ctx.restore();
    }
  }

  drawBarriers(game, cam, time) {
    const { ctx } = this;
    if (!game.activeBarriers || game.activeBarriers.size === 0) return;
    for (const it of game.room.interacts) {
      if (it.type !== 'barrier' || !game.activeBarriers.has(it.id)) continue;
      const x = it.x * T - cam.x, y = it.y * T - cam.y;
      const w = it.w * T, h = it.h * T;
      ctx.save();
      ctx.fillStyle = 'rgba(185,242,60,.09)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(185,242,60,.55)';
      ctx.lineWidth = 2;
      for (let i = 6; i < w; i += 12) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + h);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#b9f23c';
      for (let i = 0; i < 4; i++) {
        const yy = y + ((time * 70 + i * 19) % h);
        ctx.fillRect(x + 4, yy, w - 8, 2);
      }
      ctx.restore();
    }
  }

  drawItems(game, cam, time) {
    const { ctx } = this;
    for (const it of game.items) {
      if (it.taken) continue;
      if (it.bossDrop && !game.bosses[it.bossDrop]) continue;
      const px = it.x * T - cam.x;
      const py = it.y * T - cam.y;
      if (px < -80 || px > VIEW_W + 80) continue;
      const bob = Math.sin(time * 2.4 + it.x) * 3;
      ctx.save();
      if (it.type === 'token') {
        ctx.translate(px, py + bob);
        ctx.rotate(Math.sin(time * 1.2) * 0.2);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ffd86a';
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#d8a93f';
        tokenPath(ctx, 0, 0, 9);
        ctx.fill();
        ctx.strokeStyle = '#ffe9a0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#0c1209';
        ctx.fillRect(-3, -3, 6, 6);
      } else if (it.type === 'cell') {
        ctx.translate(px, py + bob);
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#ff6b5a';
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff8873';
        heartPath(ctx, -8, -7, 16);
        ctx.fill();
        ctx.strokeStyle = '#ffd3c6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (it.type === 'relic') {
        ctx.translate(px, py + bob);
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = it.ability === 'dash' ? '#ff9b4a' : it.ability === 'boots' ? '#9ad8ff' : '#b9f23c';
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.rotate(time * 0.8);
        ctx.strokeStyle = it.ability === 'dash' ? '#ffd08a' : it.ability === 'boots' ? '#d8f4ff' : '#e3ffa0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const r = 15;
          if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#f2ffe0';
        ctx.font = '700 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyph = RELICS[it.ability]?.glyph || '◆';
        ctx.fillText(glyph, 0, 0);
      }
      ctx.restore();
    }
  }

  drawNotes(game, cam) {
    const { ctx } = this;
    for (const n of game.notes) {
      if (game.collected.has(n.id)) continue;
      const px = n.x * T - cam.x;
      const py = n.y * T - cam.y;
      if (px < -60 || px > VIEW_W + 60) continue;
      ctx.save();
      ctx.translate(px, py - 8);
      ctx.rotate(-0.06);
      ctx.fillStyle = '#e8dfc4';
      ctx.fillRect(-7, -5, 14, 10);
      ctx.fillStyle = 'rgba(60,55,35,.5)';
      ctx.fillRect(-5, -2, 9, 1);
      ctx.fillRect(-5, 1, 7, 1);
      ctx.restore();
    }
  }

  drawProjectiles(game, cam, time) {
    const { ctx } = this;
    for (const p of game.projectiles) {
      const px = p.x - cam.x, py = p.y - cam.y;
      ctx.save();
      if (p.type === 'acid') {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#b9f23c';
        ctx.beginPath();
        ctx.arc(px, py, p.r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c7f25c';
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0ffc0';
        ctx.beginPath();
        ctx.arc(px - 2, py - 2, p.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'wave') {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#b9f23c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const xx = px - p.vx * 0.01 * i;
          const yy = py + i * 6;
          ctx.moveTo(xx, yy + 18);
          ctx.lineTo(xx + 2, yy);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(185,242,60,.18)';
        ctx.fillRect(px - 12, py, 24, 34);
      } else {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ffcf8a';
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffe3b0';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles(game, cam) {
    const { ctx } = this;
    for (const p of game.particles) {
      if (p.fg) continue;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * (p.alpha ?? 1);
      ctx.fillStyle = p.color;
      if (p.glow) {
        ctx.globalAlpha = a * 0.25;
        ctx.beginPath();
        ctx.arc(p.x - cam.x, p.y - cam.y, p.size * 3 * a, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.9;
      }
      if (p.shape === 'square') {
        ctx.fillRect(p.x - cam.x - p.size / 2, p.y - cam.y - p.size / 2, p.size, p.size);
      } else if (p.shape === 'streak') {
        ctx.fillRect(p.x - cam.x, p.y - cam.y, p.size, p.size * 0.4);
      } else {
        ctx.beginPath();
        ctx.arc(p.x - cam.x, p.y - cam.y, p.size * (0.4 + a * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ================================================================
     entities
     ================================================================ */
  drawPlayer(game, cam, time) {
    const { ctx } = this;
    const p = game.player;
    const px = p.x + p.w / 2 - cam.x;
    const py = p.y + p.h - cam.y;

    if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    // shadow
    if (p.onGround) {
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath();
      ctx.ellipse(px, py + 2, 16, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // dash afterimages
    if (p.dashTimer > 0) {
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.12 * (4 - i);
        ctx.fillStyle = '#9ad8ff';
        ctx.fillRect(px - p.facing * i * 14 - 8, py - 34, 16, 34);
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(p.facing, 1);
    const run = p.onGround ? Math.sin(p.runPhase) : 0;
    const moving = Math.abs(p.vx) > 30 && p.onGround;
    const bob = moving ? Math.abs(Math.sin(p.runPhase)) * 1.5 : 0;

    // legs
    ctx.fillStyle = '#1b2a22';
    const legA = moving ? run * 6 : 0;
    ctx.save();
    ctx.translate(-5, -12);
    ctx.rotate(legA * 0.12);
    ctx.fillRect(-3, 0, 6, 13);
    ctx.fillStyle = '#0f1813';
    ctx.fillRect(-4, 10, 9, 3);
    ctx.restore();
    ctx.save();
    ctx.translate(5, -12);
    ctx.rotate(-legA * 0.12);
    ctx.fillStyle = '#22352a';
    ctx.fillRect(-3, 0, 6, 13);
    ctx.fillStyle = '#0f1813';
    ctx.fillRect(-4, 10, 9, 3);
    ctx.restore();

    // torso / coveralls
    ctx.fillStyle = '#375241';
    roundRect(ctx, -10, -27 - bob, 20, 17, 4);
    ctx.fill();
    ctx.fillStyle = '#2a4034';
    ctx.fillRect(-10, -16 - bob, 20, 3);
    // hi-vis stripe
    ctx.fillStyle = 'rgba(185,242,60,.72)';
    ctx.fillRect(-8, -23 - bob, 16, 2);
    ctx.fillStyle = 'rgba(185,242,60,.25)';
    ctx.fillRect(-8, -21 - bob, 16, 1);

    // scarf
    const flap = Math.sin(time * 5 + p.runPhase * 0.4) * 3 + (p.vy < -100 ? 4 : 0);
    ctx.fillStyle = '#a34b38';
    ctx.beginPath();
    ctx.moveTo(-7, -27 - bob);
    ctx.lineTo(-16, -26 - bob + flap);
    ctx.lineTo(-12, -21 - bob);
    ctx.closePath();
    ctx.fill();

    // head / hood
    ctx.fillStyle = '#2c4436';
    ctx.beginPath();
    ctx.arc(0, -32 - bob, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#20332a';
    ctx.beginPath();
    ctx.arc(2, -30 - bob, 6, 0, Math.PI * 2);
    ctx.fill();
    // face shadow
    ctx.fillStyle = '#0c1511';
    ctx.beginPath();
    ctx.ellipse(4, -30 - bob, 4.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // eye glint
    ctx.fillStyle = '#d7ffb0';
    ctx.fillRect(6, -32 - bob, 2, 2);
    // headlamp
    ctx.fillStyle = '#ffd877';
    ctx.beginPath();
    ctx.arc(7, -37 - bob, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // arm + wrench
    const swing = p.attackTimer > 0 ? 1 - p.attackTimer / 0.26 : 0;
    const angle = p.attackTimer > 0 ? -1.5 + swing * 2.6 : (moving ? Math.sin(p.runPhase) * 0.3 : 0.25);
    ctx.save();
    ctx.translate(5, -24 - bob);
    ctx.rotate(angle);
    ctx.fillStyle = '#31523f';
    ctx.fillRect(0, -2, 13, 4);
    ctx.fillStyle = '#c8cfc2';
    ctx.fillRect(11, -4, 13, 4);
    ctx.fillStyle = '#98a295';
    ctx.beginPath();
    ctx.arc(26, -2, 4, -0.7, 2.4);
    ctx.fill();
    ctx.fillStyle = '#e8eee0';
    ctx.fillRect(22, -5, 3, 2);
    ctx.restore();

    ctx.restore();
    ctx.globalAlpha = 1;

    // swing arc fx
    if (p.attackTimer > 0) {
      const prog = 1 - p.attackTimer / 0.26;
      ctx.save();
      ctx.translate(px, py - 22);
      ctx.scale(p.facing, 1);
      ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.55;
      ctx.strokeStyle = '#e6ffc0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(10, 0, 34, -1.4 + prog * 0.4, 0.6 + prog * 1.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemies(game, cam, time) {
    const { ctx } = this;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const px = e.x + e.w / 2 - cam.x;
      const py = e.y + e.h - cam.y;
      if (px < -120 || px > VIEW_W + 120) continue;
      ctx.save();
      if (e.hurtFlash > 0) ctx.globalAlpha = 0.75;
      switch (e.kind) {
        case 'rat': {
          const dir = e.facing;
          ctx.translate(px, py);
          ctx.scale(dir, 1);
          const bob = Math.sin(time * 14 + e.seed) * 1.5;
          ctx.fillStyle = '#3b4034';
          ctx.beginPath();
          ctx.ellipse(0, -8 + bob, 15, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#565d4b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#4b4f3e';
          ctx.beginPath();
          ctx.ellipse(10, -12 + bob, 7, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3b4034';
          ctx.beginPath();
          ctx.arc(8, -17 + bob, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#7b5e49';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-14, -8 + bob);
          ctx.quadraticCurveTo(-26, -12 + bob + Math.sin(time * 10) * 3, -30, -2 + bob);
          ctx.stroke();
          ctx.fillStyle = '#ffcf6a';
          ctx.fillRect(12, -13 + bob, 2, 2);
          ctx.fillStyle = '#c9b8a0';
          ctx.fillRect(15, -10 + bob, 3, 1);
          break;
        }
        case 'roach': {
          ctx.translate(px, py);
          ctx.scale(e.facing, 1);
          const w = e.fly ? Math.sin(time * 20 + e.seed) * 2 : 0;
          ctx.fillStyle = '#463729';
          ctx.beginPath();
          ctx.ellipse(0, -13 + w, 13, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#66503a';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#5d4a33';
          ctx.beginPath();
          ctx.ellipse(1, -15 + w, 10, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#2c2117';
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-6 + i * 6, -8 + w);
            ctx.lineTo(-10 + i * 8, 1);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(10, -16 + w);
          ctx.quadraticCurveTo(20, -22 + w, 23, -28 + w);
          ctx.moveTo(10, -13 + w);
          ctx.quadraticCurveTo(20, -14 + w, 24, -20 + w);
          ctx.stroke();
          ctx.fillStyle = '#ffcf6a';
          ctx.fillRect(8, -17 + w, 2, 2);
          if (e.fly) {
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#c8d8b0';
            ctx.beginPath();
            ctx.ellipse(-4, -22 + w, 11, 4, -0.4, 0, Math.PI * 2);
            ctx.ellipse(6, -22 + w, 11, 4, 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'sludge': {
          ctx.translate(px, py);
          const squash = 1 + Math.sin(time * 5 + e.seed) * 0.06;
          ctx.fillStyle = 'rgba(80,180,100,.18)';
          ctx.beginPath();
          ctx.arc(0, -10, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#4f9a5c';
          ctx.beginPath();
          ctx.ellipse(0, -12, 18, 15 * squash, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#74c778';
          ctx.beginPath();
          ctx.ellipse(-4, -16, 10, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#10200f';
          ctx.fillRect(-7, -16, 3, 4);
          ctx.fillRect(4, -16, 3, 4);
          ctx.fillStyle = '#e8ffd0';
          ctx.fillRect(-6, -15, 1, 2);
          ctx.fillRect(5, -15, 1, 2);
          break;
        }
        case 'blast': {
          ctx.translate(px, py);
          ctx.fillStyle = '#2f3b32';
          ctx.fillRect(-16, -24, 32, 24);
          ctx.strokeStyle = '#5c6b58';
          ctx.lineWidth = 2;
          ctx.strokeRect(-16, -24, 32, 24);
          ctx.fillStyle = '#0e1710';
          ctx.beginPath();
          ctx.arc(0, -14, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = e.dir > 0 ? '#7f8d6f' : '#7f8d6f';
          ctx.fillRect(e.dir > 0 ? 12 : -20, -18, 8, 8);
          ctx.strokeStyle = '#92a287';
          ctx.beginPath();
          ctx.arc(0, -14, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff8f5c';
          ctx.fillRect(-9, -22, 3, 3);
          break;
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // hp pips
      if (e.hp < e.maxHp && e.kind !== 'rat') {
        const w = 24;
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillRect(px - w / 2, py - e.h - 10, w, 3);
        ctx.fillStyle = '#d6ff8a';
        ctx.fillRect(px - w / 2, py - e.h - 10, w * (e.hp / e.maxHp), 3);
      }
    }
  }

  drawBoss(game, cam, time) {
    const { ctx } = this;
    const b = game.boss;
    if (!b || b.dead) return;
    const px = b.x + b.w / 2 - cam.x;
    const py = b.y + b.h - cam.y;
    ctx.save();
    if (b.hurtFlash > 0) ctx.globalAlpha = 0.8;
    if (b.kind === 'warden') {
      ctx.translate(px, py);
      const squash = b.state === 'telegraph' ? 0.82 : 1;
      ctx.fillStyle = 'rgba(60,160,90,.14)';
      ctx.beginPath();
      ctx.arc(0, -40, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.enraged ? '#6a8b3c' : '#4f8f58';
      ctx.beginPath();
      ctx.ellipse(0, -38, 58 * (2 - squash), 44 * squash, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6fb26a';
      ctx.beginPath();
      ctx.ellipse(-8, -52, 32, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      // eyes
      const glow = b.state === 'telegraph' ? '#ff8f5c' : '#d6ff8a';
      ctx.fillStyle = '#12220f';
      ctx.beginPath();
      ctx.arc(-16, -54, 9, 0, Math.PI * 2);
      ctx.arc(16, -54, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(-14, -54, 3.5, 0, Math.PI * 2);
      ctx.arc(18, -54, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // pipe crown
      ctx.strokeStyle = '#9aa58c';
      ctx.lineWidth = 5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 18, -78);
        ctx.lineTo(i * 20, -96 + Math.abs(i) * 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#3c4a37';
      ctx.fillRect(-44, -86, 88, 6);
      // drips
      ctx.fillStyle = 'rgba(150,255,150,.5)';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-40 + i * 26, -20 + Math.sin(time * 3 + i) * 5, 3, 10);
      }
    } else {
      // croc
      const dir = b.facing;
      ctx.translate(px, py);
      ctx.scale(dir, 1);
      const angry = b.phase >= 2;
      ctx.fillStyle = 'rgba(185,242,60,.1)';
      ctx.beginPath();
      ctx.ellipse(0, -40, 100, 52, 0, 0, Math.PI * 2);
      ctx.fill();
      // tail
      ctx.strokeStyle = '#3d4a2e';
      ctx.lineWidth = 26;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-45, -30);
      ctx.quadraticCurveTo(-100, -20 + Math.sin(time * 2) * 8, -118, -4);
      ctx.stroke();
      ctx.fillStyle = '#4d5c38';
      ctx.beginPath();
      ctx.ellipse(0, -48, 70, 38, 0, 0, Math.PI * 2);
      ctx.fill();
      // back ridges
      ctx.fillStyle = '#2f3c23';
      for (let i = 0; i < 6; i++) {
        const rx = -50 + i * 18;
        ctx.beginPath();
        ctx.moveTo(rx, -80);
        ctx.lineTo(rx + 7, -92);
        ctx.lineTo(rx + 14, -80);
        ctx.closePath();
        ctx.fill();
      }
      // snout
      ctx.fillStyle = '#55643d';
      roundRect(ctx, 22, -58, 82, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#3d4a2e';
      roundRect(ctx, 22, -40, 82, 14, 6);
      ctx.fill();
      // teeth
      ctx.fillStyle = '#ded8b8';
      for (let i = 0; i < 8; i++) {
        ctx.fillRect(32 + i * 9, -42, 4, 7);
      }
      // jaw line
      ctx.strokeStyle = '#232d19';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, -38);
      ctx.lineTo(103, -38);
      ctx.stroke();
      // eye
      ctx.fillStyle = '#1a2114';
      ctx.beginPath();
      ctx.arc(60, -64, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = angry ? '#ff5c3c' : '#d6ff6a';
      ctx.beginPath();
      ctx.arc(62, -64, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,220,.8)';
      ctx.fillRect(63, -66, 2, 2);
      // nostrils
      ctx.fillStyle = '#232d19';
      ctx.fillRect(94, -54, 4, 4);
      // legs
      ctx.fillStyle = '#3d4a2e';
      ctx.fillRect(-18, -20, 20, 20);
      ctx.fillRect(28, -18, 18, 18);
      // belly glow
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#b9f23c';
      ctx.fillRect(-30, -26, 60, 8);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawForeground(game) {
    const { ctx } = this;
    // screen-space drips and dust
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#9ad8ff';
    for (const p of game.particles) {
      if (p.fg) {
        ctx.globalAlpha = 0.5 * (p.life / p.max);
        ctx.fillRect(p.x - game.cam.x, p.y - game.cam.y, 1, 7);
      }
    }
    ctx.restore();

    // low health vignette
    if (game.player && game.player.hp <= 1 && game.state === 'play') {
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 180, VIEW_W / 2, VIEW_H / 2, 620);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(140,10,10,${0.28 + Math.sin(game.time * 4) * 0.06})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /* ================================================================
     lighting
     ================================================================ */
  drawLighting(game) {
    const { lctx, lightCanvas, ctx } = this;
    const def = game.room;
    const cam = game.cam;
    lctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    lctx.clearRect(0, 0, VIEW_W, VIEW_H);
    lctx.globalCompositeOperation = 'source-over';
    const dark = clamp(0.62 - (def.light ?? 0.3) * 0.6, 0.24, 0.52);
    lctx.fillStyle = `rgba(2,6,7,${dark})`;
    lctx.fillRect(0, 0, VIEW_W, VIEW_H);
    lctx.globalCompositeOperation = 'destination-out';

    const punch = (x, y, r, strength = 1) => {
      if (x < -r || x > VIEW_W + r || y < -r || y > VIEW_H + r) return;
      lctx.globalAlpha = strength;
      lctx.drawImage(this.lightSprite, x - r, y - r, r * 2, r * 2);
      lctx.globalAlpha = 1;
    };

    const p = game.player;
    if (p) {
      const px = p.x + p.w / 2 - cam.x;
      const py = p.y + p.h / 2 - cam.y;
      punch(px, py, 340 + Math.sin(game.time * 9) * 8, 0.32);
      punch(px, py, 208 + Math.sin(game.time * 9) * 5, 0.94);
    }
    for (const prop of def.props) {
      if (prop.type === 'lamp') punch(prop.x * T - cam.x, prop.y * T + 38 - cam.y, (prop.radius || 190) + 12, 0.94);
      if (prop.type === 'bench') punch(prop.x * T - cam.x, prop.y * T - 56 - cam.y, 170, 0.82);
      if (prop.type === 'waterfall') punch(prop.x * T - cam.x, prop.y * T - cam.y + 80, 150, 0.25);
      if (prop.type === 'lift') punch(prop.x * T + 2 * T - cam.x, prop.y * T - cam.y + 120, 90, game.updraftActive ? 0.75 : 0.15);
    }
    for (const h of def.hazards) {
      if (h.type === 'sludge') {
        punch((h.x + h.w / 2) * T - cam.x, (h.y + h.h / 2) * T - cam.y, Math.max(90, h.w * 14), 0.28);
      }
    }
    for (const it of game.items) {
      if (it.taken) continue;
      if (it.bossDrop && !game.bosses[it.bossDrop]) continue;
      punch(it.x * T - cam.x, it.y * T - cam.y, it.type === 'relic' ? 120 : 70, 0.65);
    }
    if (game.boss && !game.boss.dead) {
      punch(game.boss.x + game.boss.w / 2 - cam.x, game.boss.y + game.boss.h / 2 - cam.y, 160, 0.4);
    }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0, VIEW_W, VIEW_H);

    // additive glows
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = (x, y, r, color, alpha) => {
      if (x < -r || x > VIEW_W + r || y < -r || y > VIEW_H + r) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.glowSprite(color), x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    };
    if (p) glow(p.x + p.w / 2 - cam.x, p.y + p.h / 2 - cam.y, 240, THEMES[def.theme]?.lamp || '#ffc06a', 0.16);
    for (const prop of def.props) {
      if (prop.type === 'lamp') glow(prop.x * T - cam.x, prop.y * T + 38 - cam.y, (prop.radius || 190) + 15, prop.color || '#ffc06a', 0.27);
      if (prop.type === 'bench') glow(prop.x * T - cam.x, prop.y * T - 56 - cam.y, 145, '#a6ff9a', 0.19);
    }
    for (const it of game.items) {
      if (it.taken) continue;
      if (it.bossDrop && !game.bosses[it.bossDrop]) continue;
      const col = it.type === 'token' ? '#ffd86a' : it.type === 'cell' ? '#ff6b5a' : '#b9f23c';
      glow(it.x * T - cam.x, it.y * T - cam.y, 60, col, 0.2);
    }
    ctx.restore();
  }

  /* ================================================================
     HUD
     ================================================================ */
  drawHUD(game) {
    const { ctx } = this;
    const p = game.player;
    if (!p) return;
    if (game.state === 'dead' || game.state === 'ending') return;

    // hearts
    for (let i = 0; i < game.maxHp; i++) {
      const x = 24 + i * 27;
      const y = 22;
      const filled = i < p.hp;
      ctx.save();
      heartPath(ctx, x, y, 19);
      ctx.fillStyle = filled ? '#ff6b5a' : 'rgba(12,20,16,.75)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = filled ? '#ffc5b7' : 'rgba(160,180,150,.25)';
      ctx.stroke();
      if (filled) {
        ctx.fillStyle = 'rgba(255,255,220,.55)';
        ctx.fillRect(x + 4, y + 4, 4, 3);
      }
      ctx.restore();
    }

    // tokens
    const tx = VIEW_W - 32;
    ctx.save();
    ctx.translate(tx, 32);
    ctx.fillStyle = '#d8a93f';
    tokenPath(ctx, 0, 0, 8);
    ctx.fill();
    ctx.fillStyle = '#0c1209';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.fillStyle = 'rgba(255,230,160,.9)';
    ctx.font = '700 10px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${String(game.tokens.size).padStart(2, '0')} / 0${TOKEN_TOTAL}`, -16, 1);
    ctx.restore();

    // chart hint
    if (game.state === 'play') {
      ctx.fillStyle = 'rgba(210,230,200,.42)';
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('[M] CHART', VIEW_W - 24, 56);
    }

    // ability glyphs
    const abilities = ['grip', 'boots', 'dash'];
    abilities.forEach((a, i) => {
      const x = 26 + i * 34;
      const y = VIEW_H - 30;
      ctx.save();
      ctx.globalAlpha = game.abilities[a] ? 0.95 : 0.16;
      ctx.strokeStyle = '#b9f23c';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 9, y - 12, 22, 22);
      ctx.fillStyle = game.abilities[a] ? '#d9ff7a' : '#b9f23c';
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(RELICS[a].glyph, x + 2, y);
      ctx.restore();
    });

    // dash cooldown
    if (game.abilities.dash && p.dashCd > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(24, VIEW_H - 48, 70, 4);
      ctx.fillStyle = 'rgba(255,179,92,.7)';
      ctx.fillRect(24, VIEW_H - 48, 70 * (1 - p.dashCd / PHYS.dashCd), 4);
    }

    // room banner
    if (game.banner && game.banner.t > 0) {
      const b = game.banner;
      const a = b.t > 3.4 ? (4 - b.t) * 2.5 : Math.min(1, b.t);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(3,9,6,.65)';
      const w = Math.max(ctx.measureText(b.name).width + 90, 340);
      ctx.fillRect(VIEW_W / 2 - w / 2, 76, w, 62);
      ctx.fillStyle = 'rgba(185,242,60,.4)';
      ctx.fillRect(VIEW_W / 2 - w / 2, 76, w, 1);
      ctx.fillRect(VIEW_W / 2 - w / 2, 137, w, 1);
      ctx.fillStyle = '#e9f4d8';
      ctx.font = '700 22px "Courier New", monospace';
      ctx.fillText(b.name, VIEW_W / 2, 103);
      ctx.fillStyle = 'rgba(185,242,60,.72)';
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText(b.sub, VIEW_W / 2, 122);
      ctx.restore();
    }

    // big pickup banner
    if (game.bigBanner && game.bigBanner.t > 0) {
      const b = game.bigBanner;
      ctx.save();
      ctx.globalAlpha = clamp(b.t < 0.5 ? b.t * 2 : b.t > 3 ? (4 - b.t) : 1, 0, 1);
      ctx.textAlign = 'center';
      const w = 420;
      const y = 190;
      ctx.fillStyle = 'rgba(3,9,6,.78)';
      ctx.fillRect(VIEW_W / 2 - w / 2, y, w, 74);
      ctx.strokeStyle = 'rgba(185,242,60,.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(VIEW_W / 2 - w / 2 + 4, y + 4, w - 8, 66);
      ctx.fillStyle = '#b9f23c';
      ctx.font = '700 10px "Courier New", monospace';
      ctx.fillText(b.kicker, VIEW_W / 2, y + 20);
      ctx.fillStyle = '#f0ffd8';
      ctx.font = '700 24px "Courier New", monospace';
      ctx.fillText(b.title, VIEW_W / 2, y + 45);
      ctx.fillStyle = 'rgba(220,240,210,.72)';
      ctx.font = '10px "Courier New", monospace';
      ctx.fillText(b.sub, VIEW_W / 2, y + 61);
      ctx.restore();
    }

    // interact prompt
    if (game.prompt && game.state === 'play') {
      ctx.save();
      ctx.textAlign = 'center';
      const label = game.prompt;
      ctx.font = '700 11px "Courier New", monospace';
      const w = ctx.measureText(label).width + 64;
      const y = VIEW_H - 92;
      ctx.fillStyle = 'rgba(4,10,7,.8)';
      ctx.fillRect(VIEW_W / 2 - w / 2, y, w, 32);
      ctx.strokeStyle = 'rgba(185,242,60,.45)';
      ctx.strokeRect(VIEW_W / 2 - w / 2 + 0.5, y + 0.5, w - 1, 31);
      ctx.fillStyle = '#b9f23c';
      ctx.font = '700 13px "Courier New", monospace';
      ctx.fillText('▲', VIEW_W / 2 - w / 2 + 20, y + 21);
      ctx.fillStyle = '#e9f4d8';
      ctx.font = '700 11px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, VIEW_W / 2 - w / 2 + 38, y + 21);
      ctx.restore();
    }

    // toast
    if (game.toast && game.toast.t > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(game.toast.t < 0.4 ? game.toast.t * 2.5 : game.toast.t > 2.5 ? (3 - game.toast.t) * 2 : 1, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = '700 11px "Courier New", monospace';
      const w = ctx.measureText(game.toast.text).width + 40;
      ctx.fillStyle = 'rgba(3,9,6,.8)';
      ctx.fillRect(VIEW_W / 2 - w / 2, VIEW_H - 142, w, 28);
      ctx.fillStyle = '#d9ff7a';
      ctx.fillText(game.toast.text, VIEW_W / 2, VIEW_H - 123);
      ctx.restore();
    }

    // boss bar
    if (game.boss && game.bossActive && !game.boss.dead) {
      const b = game.boss;
      const w = 420, x = VIEW_W / 2 - w / 2, y = 24;
      ctx.save();
      ctx.fillStyle = 'rgba(3,8,6,.72)';
      ctx.fillRect(x - 6, y - 6, w + 12, 38);
      ctx.strokeStyle = 'rgba(255,120,90,.4)';
      ctx.strokeRect(x - 5.5, y - 5.5, w + 11, 37);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(x, y + 10, w, 10);
      ctx.fillStyle = b.kind === 'croc' ? '#ff8f6a' : '#b9f23c';
      ctx.fillRect(x, y + 10, w * clamp(b.hp / b.maxHp, 0, 1), 10);
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(x, y + 10, w * clamp(b.hp / b.maxHp, 0, 1), 3);
      ctx.fillStyle = '#f0e8d0';
      ctx.font = '700 10px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(b.name, x, y + 5);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(240,232,208,.5)';
      ctx.fillText(b.phase >= 2 ? 'ENRAGED' : 'ALIVE', x + w, y + 5);
      ctx.restore();
    }

    // objective ticker on first rooms
    if (game.state === 'play' && game.showHint && game.showHint.t > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(game.showHint.t, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(185,242,60,.7)';
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText(game.showHint.text, VIEW_W / 2, VIEW_H - 210);
      ctx.restore();
    }
  }

  drawTransition(game) {
    const tr = game.transition;
    if (!tr) return;
    const { ctx } = this;
    const half = tr.dur / 2;
    const a = tr.time < half ? tr.time / half : 1 - (tr.time - half) / half;
    ctx.fillStyle = `rgba(2,5,4,${clamp(a, 0, 1)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /* ================================================================
     title
     ================================================================ */
  drawTitle(game) {
    const { ctx } = this;
    const def = game.rooms.hub;
    this.currentTheme = def.theme;
    const t = game.titleTime;
    const cam = { x: 240 + Math.sin(t * 0.12) * 90, y: 392 };
    ctx.save();
    ctx.translate(0, 0);
    this.drawBackground(def, cam, t);
    this.drawTiles(def, cam);
    this.drawHazards(def, cam, t);
    this.drawProps(def, cam, t);
    this.drawBreakables(def, cam);
    // lone figure by the bench
    const dummy = {
      x: 9.2 * T, y: 27 * T - 34, w: 22, h: 34, facing: 1, runPhase: t * 2,
      vx: 0, vy: 0, onGround: true, attackTimer: 0, invuln: 0, dashTimer: 0,
    };
    this.drawPlayer({ player: dummy, state: 'title' }, cam, t);
    this.drawLighting({
      room: def, cam, time: t, player: dummy, items: [],
      bosses: {}, taken: new Set(), boss: null, updraftActive: false,
    });
    ctx.restore();

    // ambient motes
    ctx.save();
    for (let i = 0; i < 36; i++) {
      const x = ((i * 137 + t * (3 + (i % 5))) % (VIEW_W + 80)) - 40;
      const y = (i * 71 - t * (8 + (i % 4) * 3)) % VIEW_H;
      ctx.globalAlpha = 0.06 + hash(i, 1, 2) * 0.14;
      ctx.fillStyle = i % 3 === 0 ? '#b9f23c' : '#9ad8ff';
      ctx.fillRect(x, (y + VIEW_H) % VIEW_H, 1.5, 1.5);
    }
    ctx.restore();

    // dark title wash
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.5, 120, VIEW_W / 2, VIEW_H * 0.5, 620);
    g.addColorStop(0, 'rgba(2,6,5,.06)');
    g.addColorStop(0.65, 'rgba(2,6,5,.3)');
    g.addColorStop(1, 'rgba(2,5,4,.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /* ================================================================
     map
     ================================================================ */
  drawMap(game) {
    const ctx = this.mapCtx;
    const W = this.mapCanvas.width, H = this.mapCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#07130e');
    bg.addColorStop(1, '#030806');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(185,242,60,.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const layout = Object.entries(MAP_LAYOUT);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, m] of layout) {
      minX = Math.min(minX, m.col); minY = Math.min(minY, m.row);
      maxX = Math.max(maxX, m.col + m.w); maxY = Math.max(maxY, m.row + m.h);
    }
    const pad = 34;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
    const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
    const rect = (m) => ({ x: m.col * scale + ox, y: m.row * scale + oy, w: m.w * scale, h: m.h * scale });
    const centers = {};
    for (const [id, m] of layout) {
      const r = rect(m);
      centers[id] = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    // connections
    const drawn = new Set();
    for (const room of Object.values(game.rooms)) {
      for (const [side, ex] of Object.entries(room.exits)) {
        const key = [room.id, ex.to].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const a = centers[room.id], b = centers[ex.to];
        if (!a || !b) continue;
        const seen = game.visited.has(room.id) || game.visited.has(ex.to);
        ctx.strokeStyle = seen ? 'rgba(185,242,60,.35)' : 'rgba(120,140,120,.1)';
        ctx.lineWidth = seen ? 2 : 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // rooms
    for (const [id, m] of layout) {
      const r = rect(m);
      const seen = game.visited.has(id);
      const current = game.room && game.room.id === id;
      const room = game.rooms[id];
      ctx.save();
      if (current) {
        ctx.shadowColor = 'rgba(185,242,60,.65)';
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = seen ? 'rgba(185,242,60,.14)' : 'rgba(150,170,150,.025)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = current ? '#b9f23c' : seen ? 'rgba(185,242,60,.55)' : 'rgba(150,170,150,.16)';
      ctx.lineWidth = current ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.restore();

      // hatch lines
      if (seen) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(185,242,60,.07)';
        for (let i = -r.h; i < r.w; i += 7) {
          ctx.beginPath();
          ctx.moveTo(r.x + i, r.y + r.h);
          ctx.lineTo(r.x + i + r.h, r.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (seen) {
        ctx.fillStyle = current ? '#d9ff7a' : 'rgba(220,240,210,.62)';
        ctx.font = '700 8px "Courier New", monospace';
        ctx.textAlign = 'center';
        const label = room.name.length > 18 ? room.name.slice(0, 16) + '…' : room.name;
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 3);
        if (current) {
          const px = r.x + r.w / 2;
          const py = r.y + r.h / 2 - 12 + Math.sin(game.time * 3) * 2;
          ctx.fillStyle = '#b9f23c';
          ctx.beginPath();
          ctx.moveTo(px, py - 5);
          ctx.lineTo(px + 5, py + 4);
          ctx.lineTo(px - 5, py + 4);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(150,170,150,.12)';
        ctx.font = '7px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('?', r.x + r.w / 2, r.y + r.h / 2 + 2);
      }
    }

    // token markers for visited rooms with remaining tokens
    for (const [id, m] of layout) {
      if (!game.visited.has(id)) continue;
      const room = game.rooms[id];
      const remaining = room.items.filter(i => i.type === 'token' && !game.taken.has(i.id));
      if (!remaining.length) continue;
      const r = rect(m);
      ctx.fillStyle = 'rgba(255,216,106,.8)';
      for (let i = 0; i < remaining.length && i < 3; i++) {
        ctx.beginPath();
        ctx.arc(r.x + r.w - 7 - i * 7, r.y + 7, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // legend footer
    ctx.fillStyle = 'rgba(185,242,60,.35)';
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('N.Y.C. BUREAU OF SEWERS — INTERNAL SURVEY — DO NOT DISTRIBUTE', 14, H - 12);
  }
}
