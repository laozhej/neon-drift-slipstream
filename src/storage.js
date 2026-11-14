import { DIFFICULTIES, getDifficulty } from './sim/difficulty.js';
import { normalizeBindings } from './bindings.js';
import { getShip } from './sim/ships.js';

// One JSON document in localStorage. Every field is validated on load, so a
// corrupt or older save degrades to defaults instead of breaking the game.
const KEY = 'neon-drift-slipstream-v1';
const validScore = value => Number.isSafeInteger(value) && value >= 0;
const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);
const unit = (value, fallback) => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback);
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

export function defaultSettings(language = 'en') {
  return {
    language, difficulty: 'normal', ship: 'vector', movement: 'keyboard', autoFire: false,
    quality: 'high', camera: 'dynamic', shake: true, glow: 0.4, brightness: 0.5,
    music: 0.55, sfx: 0.8, muted: false,
    bindings: normalizeBindings(null), hints: {},
  };
}

export function loadState(storage, language = 'en') {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(KEY)); } catch { /* Storage is optional. */ }
  const base = defaultSettings(language);
  const s = saved?.settings ?? {};
  const settings = {
    language: oneOf(s.language, ['en', 'zh'], base.language),
    difficulty: getDifficulty(s.difficulty).id,
    ship: getShip(s.ship).id,
    movement: oneOf(s.movement, ['keyboard', 'mouse'], base.movement),
    autoFire: flag(s.autoFire, base.autoFire),
    quality: oneOf(s.quality, ['high', 'medium', 'low'], base.quality),
    camera: oneOf(s.camera, ['dynamic', 'flat'], base.camera),
    shake: flag(s.shake, base.shake),
    glow: unit(s.glow, base.glow),
    brightness: unit(s.brightness, base.brightness),
    music: unit(s.music, base.music),
    sfx: unit(s.sfx, base.sfx),
    muted: flag(s.muted, base.muted),
    bindings: normalizeBindings(s.bindings),
    hints: s.hints && typeof s.hints === 'object' && !Array.isArray(s.hints) ? { ...s.hints } : {},
  };
  const records = Object.fromEntries(DIFFICULTIES.map(({ id }) => [id, validScore(saved?.records?.[id]) ? saved.records[id] : 0]));
  return { settings, records };
}

export function saveState(storage, state) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;   // Private mode or a full quota: the session keeps its values in memory.
  }
}

export function recordScore(state, difficulty, score) {
  if (!DIFFICULTIES.some(({ id }) => id === difficulty) || !validScore(score)) return false;
  if (score <= (state.records[difficulty] || 0)) return false;
  state.records[difficulty] = score;
  return true;
}
