import { ACTIONS, normalizeBindings, keyboardBinding } from './bindings.js';

// MouseEvent.button order differs from MouseEvent.buttons: middle is bit 4, right is bit 2.
const MOUSE_BITS = [1, 4, 2, 8, 16];
const ONE_SHOT = new Set(['pause', 'bomb', 'drift', 'mute']);
const mouseCode = event => (Number.isInteger(event.button) && event.button >= 0 && event.button <= 4 ? `Mouse${event.button}` : null);
const within = (target, selector) => typeof Element !== 'undefined' && target instanceof Element && target.closest(selector);
const DEADZONE = 0.22;

// Keyboard, mouse and gamepad folded into one sample per simulation step.
// `host` answers what the game is doing and receives the one-shot actions.
export class Input {
  constructor(target, canvas, host) {
    this.host = host;
    this.canvas = canvas;
    this.held = new Set();
    this.movementMode = 'keyboard';
    this.autoFire = false;
    this.cursor = null;          // last mouse position in client pixels
    this.capture = null;         // rebinding: the next press goes here instead
    this.pad = { pause: false, bomb: false, drift: false };
    this.setBindings();

    target.addEventListener('keydown', event => {
      if (this.capture) {
        // Rebinding: Esc cancels, Backspace/Delete clears the slot.
        event.preventDefault();
        event.stopPropagation();
        if (event.code === 'Escape') this.finishCapture(undefined);
        else if (event.code === 'Backspace' || event.code === 'Delete') this.finishCapture(null);
        else if (keyboardBinding(event)) this.finishCapture(keyboardBinding(event));
        return;
      }
      const code = keyboardBinding(event);
      if (!code || !this.actionFor.has(code)) return;
      // Dialogs and native controls keep their own keys.
      if (host.isUiActive() || within(event.target, 'input, select, textarea')) return;
      // A focused menu button keeps Space/Enter for activation outside of play.
      if (!host.isPlaying() && within(event.target, 'button') && ['Space', 'Enter', 'NumpadEnter'].includes(code)) return;
      if (!host.isPlaying() && this.actionFor.get(code) !== 'pause' && this.actionFor.get(code) !== 'mute') return;
      event.preventDefault();
      const fresh = !this.held.has(code);
      this.held.add(code);
      if (fresh && !event.repeat) this.trigger(code);
    }, true);
    target.addEventListener('keyup', event => { this.held.delete(event.code); });
    target.addEventListener('blur', () => { this.clear(); host.blur(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); host.blur(); } });

    // While rebinding, any mouse button anywhere is the answer. The click that
    // follows that press must not reach whatever happens to be under the cursor.
    target.addEventListener('mousedown', event => {
      if (!this.capture) return;
      event.preventDefault();
      event.stopPropagation();
      this.swallowClick = true;
      const code = mouseCode(event);
      if (code) this.finishCapture(code);
    }, true);
    for (const name of ['click', 'auxclick', 'contextmenu']) {
      target.addEventListener(name, event => {
        if (!this.swallowClick) return;
        event.preventDefault();
        event.stopPropagation();
        if (name !== 'contextmenu') this.swallowClick = false;
      }, true);
    }

    canvas.addEventListener('mousedown', event => {
      const code = mouseCode(event);
      if (!host.isPlaying() || host.isUiActive()) return;
      event.preventDefault();
      if (!code || !this.actionFor.has(code)) return;
      const fresh = !this.held.has(code);
      this.held.add(code);
      if (fresh) this.trigger(code);
    });
    target.addEventListener('mouseup', event => {
      const code = mouseCode(event);
      if (code) this.held.delete(code);
      this.releaseMissing(event.buttons);
    });
    target.addEventListener('mousemove', event => {
      this.cursor = { x: event.clientX, y: event.clientY };
      this.releaseMissing(event.buttons);
    });
    canvas.addEventListener('mouseleave', () => { this.clearMouse(); });
    // The right button is a game input over the playfield, never a menu.
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('auxclick', event => event.preventDefault());
  }

  setBindings(bindings) {
    this.bindings = normalizeBindings(bindings);
    this.actionFor = new Map();
    for (const action of ACTIONS) {
      for (const code of this.bindings[action]) if (code) this.actionFor.set(code, action);
    }
    this.clear();
  }

  setMovementMode(mode) {
    this.movementMode = mode === 'mouse' ? 'mouse' : 'keyboard';
    this.clear();
  }

  // Resolves with a binding code, null (cleared) or undefined (cancelled).
  captureNext() {
    this.cancelCapture();
    this.swallowClick = false;
    return new Promise(resolve => { this.capture = { resolve }; });
  }

  finishCapture(code) {
    const { resolve } = this.capture;
    this.capture = null;
    resolve(code);
  }

  cancelCapture() {
    if (this.capture) this.finishCapture(undefined);
  }

  trigger(code) {
    const action = this.actionFor.get(code);
    if (ONE_SHOT.has(action)) this.host[action]();
  }

  releaseMissing(buttons) {
    if (!Number.isInteger(buttons)) return;
    for (let button = 0; button < MOUSE_BITS.length; button++) {
      if (!(buttons & MOUSE_BITS[button])) this.held.delete(`Mouse${button}`);
    }
  }

  clearMouse() {
    for (let button = 0; button < MOUSE_BITS.length; button++) this.held.delete(`Mouse${button}`);
  }

  clear() {
    this.held.clear();
  }

  down(action) {
    for (const code of this.bindings[action]) if (code && this.held.has(code)) return true;
    return false;
  }

  // Standard-mapping gamepad: stick or d-pad to fly, A fire, B nova, X drift,
  // either shoulder or trigger to focus, Start to pause.
  readPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
      const pressed = index => Boolean(pad.buttons[index]?.pressed);
      let x = Math.abs(pad.axes[0]) > DEADZONE ? pad.axes[0] : 0;
      let y = Math.abs(pad.axes[1]) > DEADZONE ? pad.axes[1] : 0;
      if (pressed(14)) x = -1; else if (pressed(15)) x = 1;
      if (pressed(12)) y = -1; else if (pressed(13)) y = 1;
      const state = { x, y, fire: pressed(0), focus: pressed(4) || pressed(5) || pressed(6) || pressed(7),
        bomb: pressed(1), drift: pressed(2) || pressed(3), pause: pressed(9) };
      for (const action of ['pause', 'bomb', 'drift']) {
        // Latch first: the host may sample input again while it handles the press.
        const fresh = state[action] && !this.pad[action];
        this.pad[action] = state[action];
        if (fresh) this.host[action]();
      }
      return state;
    }
    return null;
  }

  sample() {
    const pad = this.readPad();
    let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let y = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
    let pointer = null;
    if (pad && (pad.x || pad.y)) { x = pad.x; y = pad.y; }
    else if (this.movementMode === 'mouse' && this.cursor && !x && !y) pointer = this.host.toField(this.cursor.x, this.cursor.y);
    return {
      x, y, pointer,
      focus: this.down('focus') || Boolean(pad?.focus),
      shooting: this.autoFire || this.down('fire') || Boolean(pad?.fire),
    };
  }
}
