const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
  KeyX: 'attack', KeyJ: 'attack',
  KeyC: 'dash', KeyK: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'map',
  KeyN: 'mute',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.virtual = new Set();
    this.anyPressed = false;
    this._bindKeyboard();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressed.add(action);
      this.down.add(action);
      this.anyPressed = true;
    });
    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      this.down.delete(action);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.virtual.clear();
    });
  }

  press(action) { this.pressed.add(action); this.down.add(action); this.anyPressed = true; }
  release(action) { this.down.delete(action); }
  isDown(action) { return this.down.has(action) || this.virtual.has(action); }
  justPressed(action) { return this.pressed.has(action); }
  endFrame() { this.pressed.clear(); this.anyPressed = false; }
}
