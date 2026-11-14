// Key and mouse assignments. DOM-free, so the rules are covered by Node tests.
export const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'fire', 'focus', 'drift', 'bomb', 'pause', 'mute']);
export const SLOTS = 3;

export const DEFAULT_BINDINGS = Object.freeze({
  up: Object.freeze(['ArrowUp', 'KeyW', null]),
  down: Object.freeze(['ArrowDown', 'KeyS', null]),
  left: Object.freeze(['ArrowLeft', 'KeyA', null]),
  right: Object.freeze(['ArrowRight', 'KeyD', null]),
  fire: Object.freeze(['KeyZ', 'Space', 'Mouse0']),
  focus: Object.freeze(['ShiftLeft', 'ShiftRight', null]),
  drift: Object.freeze(['KeyC', 'KeyV', 'Mouse2']),
  bomb: Object.freeze(['KeyX', 'KeyB', 'Mouse1']),
  pause: Object.freeze(['Escape', 'KeyP', null]),
  mute: Object.freeze(['KeyM', null, null]),
});

const NAMED_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Escape', 'Tab',
  'ShiftLeft', 'ShiftRight', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
  'Quote', 'Comma', 'Period', 'Slash', 'CapsLock',
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
]);

export function isBindingCode(code) {
  return typeof code === 'string' && (NAMED_KEYS.has(code)
    || /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Mouse[0-4])$/.test(code));
}

// Chords with Ctrl/Alt/Meta belong to the browser, never to the game.
export function keyboardBinding(event) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.key === 'Process') return null;
  return isBindingCode(event.code) && !event.code.startsWith('Mouse') ? event.code : null;
}

export const defaultBindings = () => Object.fromEntries(ACTIONS.map(action => [action, [...DEFAULT_BINDINGS[action]]]));

// A corrupt or hand-edited save falls back to the defaults as a whole.
export function normalizeBindings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultBindings();
  const seen = new Set();
  const normalized = {};
  for (const action of ACTIONS) {
    const slots = Object.hasOwn(value, action) ? value[action] : null;
    if (!Array.isArray(slots) || slots.length !== SLOTS) return defaultBindings();
    for (const code of slots) {
      if (code === null) continue;
      if (!isBindingCode(code) || seen.has(code)) return defaultBindings();
      seen.add(code);
    }
    normalized[action] = [...slots];
  }
  // Pause must always stay reachable.
  return normalized.pause.some(Boolean) ? normalized : defaultBindings();
}

// Assigns `code` to one slot. The same input can only drive one action, so it is
// taken away from wherever it was — unless that would leave pause unbound.
export function assignBinding(bindings, action, slot, code) {
  const next = Object.fromEntries(ACTIONS.map(name => [name, [...bindings[name]]]));
  if (code !== null) {
    if (!isBindingCode(code)) return { ok: false, reason: 'invalid', bindings };
    for (const name of ACTIONS) {
      const index = next[name].indexOf(code);
      if (index >= 0 && !(name === action && index === slot)) next[name][index] = null;
    }
  }
  next[action][slot] = code;
  if (!next.pause.some(Boolean)) return { ok: false, reason: 'pause', bindings };
  return { ok: true, bindings: next };
}

const LABELS = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', Backspace: 'BKSP', Delete: 'DEL', Insert: 'INS', PageUp: 'PGUP', PageDown: 'PGDN',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', CapsLock: 'CAPS', Home: 'HOME', End: 'END',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'MB4', Mouse4: 'MB5',
};

export function bindingLabel(code) {
  if (!code) return '—';
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6).toUpperCase()}`;
  return code.toUpperCase();
}

export const firstBinding = (bindings, action, { mouse = false } = {}) =>
  bindings[action].find(code => code && (mouse || !code.startsWith('Mouse'))) ?? bindings[action].find(Boolean) ?? null;
