import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, SLOTS, DEFAULT_BINDINGS, defaultBindings, normalizeBindings, assignBinding, bindingLabel, isBindingCode } from '../src/bindings.js';
import { loadState, saveState, recordScore, defaultSettings } from '../src/storage.js';
import { t, setLanguage, hasTranslation } from '../src/i18n.js';
import { SECTORS } from '../src/sim/sectors.js';
import { DIFFICULTIES } from '../src/sim/difficulty.js';
import { SHIPS } from '../src/sim/ships.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
};

// ───────────────────────────── Bindings ─────────────────────────────

test('default bindings give every action its slots and never reuse an input', () => {
  const seen = new Set();
  for (const action of ACTIONS) {
    assert.equal(DEFAULT_BINDINGS[action].length, SLOTS);
    for (const code of DEFAULT_BINDINGS[action]) {
      if (code === null) continue;
      assert.ok(isBindingCode(code), `${code} is bindable`);
      assert.ok(!seen.has(code), `${code} is bound once`);
      seen.add(code);
    }
  }
});

test('assigning an input takes it away from the action that had it', () => {
  const { ok, bindings } = assignBinding(defaultBindings(), 'drift', 0, 'KeyZ');
  assert.ok(ok);
  assert.equal(bindings.drift[0], 'KeyZ');
  assert.ok(!bindings.fire.includes('KeyZ'));
});

test('pause can never lose its last binding', () => {
  let bindings = defaultBindings();
  bindings = assignBinding(bindings, 'pause', 0, null).bindings;
  const cleared = assignBinding(bindings, 'pause', 1, null);
  assert.equal(cleared.ok, false);
  assert.equal(cleared.reason, 'pause');
  // Stealing pause's only key for another action is refused as well.
  const stolen = assignBinding(bindings, 'fire', 0, 'KeyP');
  assert.equal(stolen.ok, false);
});

test('invalid inputs are rejected and corrupt saves fall back to the defaults', () => {
  assert.equal(assignBinding(defaultBindings(), 'fire', 0, 'ControlLeft').ok, false);
  assert.deepEqual(normalizeBindings({ fire: ['KeyZ'] }), defaultBindings());
  assert.deepEqual(normalizeBindings('nonsense'), defaultBindings());
  const duplicated = defaultBindings();
  duplicated.bomb[0] = 'KeyZ';
  assert.deepEqual(normalizeBindings(duplicated), defaultBindings());
});

test('inputs have readable labels', () => {
  assert.equal(bindingLabel('KeyC'), 'C');
  assert.equal(bindingLabel('Mouse2'), 'RMB');
  assert.equal(bindingLabel('ArrowUp'), '↑');
  assert.equal(bindingLabel(null), '—');
});

// ───────────────────────────── Storage ─────────────────────────────

test('a missing or corrupt save loads as defaults', () => {
  for (const storage of [null, memoryStorage(), memoryStorage({ 'neon-drift-slipstream-v1': '{not json' })]) {
    const state = loadState(storage, 'zh');
    assert.deepEqual(state.settings, defaultSettings('zh'));
    assert.ok(DIFFICULTIES.every(({ id }) => state.records[id] === 0));
  }
});

test('settings and records survive a save and load, and bad fields are dropped', () => {
  const storage = memoryStorage();
  const state = loadState(storage, 'en');
  state.settings.movement = 'mouse';
  state.settings.music = 0.25;
  assert.ok(recordScore(state, 'hard', 12345));
  assert.equal(recordScore(state, 'hard', 100), false, 'a lower score is not a record');
  assert.equal(recordScore(state, 'nightmare', 5), false, 'unknown classes are ignored');
  assert.ok(saveState(storage, state));
  const reloaded = loadState(storage, 'en');
  assert.equal(reloaded.settings.movement, 'mouse');
  assert.equal(reloaded.settings.music, 0.25);
  assert.equal(reloaded.records.hard, 12345);

  const saved = JSON.parse(storage.data.get('neon-drift-slipstream-v1'));
  saved.settings.quality = 'ultra';
  saved.settings.ship = 'starfighter';
  saved.settings.glow = 3;
  saved.settings.sfx = 7;
  saved.records.normal = -4;
  storage.setItem('neon-drift-slipstream-v1', JSON.stringify(saved));
  const repaired = loadState(storage, 'en');
  assert.equal(repaired.settings.quality, 'high');
  assert.equal(repaired.settings.ship, 'vector');
  assert.equal(repaired.settings.glow, 0.4);
  assert.equal(repaired.settings.sfx, 0.8);
  assert.equal(repaired.records.normal, 0);
});

test('a storage that refuses writes does not throw', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(saveState(full, loadState(full)), false);
});

// ───────────────────────────── Translations ─────────────────────────────

// Every single-quoted literal inside a piece of source text.
const literals = source => [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1].replace(/\\'/g, "'"));
// The argument text of every call to `name(`, with nested parentheses.
function callArguments(source, name) {
  const found = [];
  const pattern = new RegExp(`(?<![\\w.$])${name.replace('.', '\\.')}\\(`, 'g');
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let depth = 1;
    let index = pattern.lastIndex;
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth++;
      else if (source[index] === ')') depth--;
      index++;
    }
    found.push(source.slice(pattern.lastIndex, index - 1));
  }
  return found;
}
const block = (source, name) => source.slice(source.indexOf(`const ${name} = {`), source.indexOf('};', source.indexOf(`const ${name} = {`)));

test('every string the interface can show has a Chinese translation', () => {
  const wanted = new Set();
  const html = read('../index.html');
  for (const match of html.matchAll(/data-i18n(?:-label|-title)?="([^"]+)"/g)) wanted.add(match[1].replaceAll('&amp;', '&'));

  const main = read('../src/main.js');
  const hud = read('../src/hud.js');
  for (const source of [main, hud]) {
    for (const args of callArguments(source, 't')) for (const text of literals(args)) wanted.add(text);
  }
  for (const name of ['CLASS_NOTES', 'SHIP_NOTES', 'ACTION_NAMES', 'PAUSE_NOTES']) {
    for (const match of block(main, name).matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) wanted.add(match[1]);
  }

  // Banners come from the simulation in English and are translated on display.
  const game = read('../src/sim/game.js');
  const tones = new Set(['sector', 'warn', 'info', 'phase', 'clear', 'pickup', 'WARNING']);
  for (const args of callArguments(game, 'this.say')) for (const text of literals(args)) if (!tones.has(text)) wanted.add(text);
  for (const match of game.matchAll(/\b(?:title|subtitle) = ([^;]+);/g)) for (const text of literals(match[1])) wanted.add(text);
  for (const sector of SECTORS) {
    for (const text of [sector.label, sector.name, sector.bossName]) wanted.add(text);
    for (const section of sector.sections) wanted.add(section.label);
    for (const phase of sector.phases) { wanted.add(phase.name); wanted.add(phase.subtitle); }
  }
  for (const { id } of DIFFICULTIES) wanted.add(id.toUpperCase());
  for (const { id } of SHIPS) wanted.add(id.toUpperCase());
  for (const label of ['LMB', 'MMB', 'RMB']) wanted.add(label);

  wanted.delete('');
  assert.ok(wanted.size > 150, `collected ${wanted.size} strings`);
  const missing = [...wanted].filter(text => /[A-Za-z]/.test(text) && !hasTranslation(text));
  assert.deepEqual(missing, []);
});

test('placeholders are filled in, and their values are translated too', () => {
  try {
    setLanguage('zh');
    assert.equal(t('{label} CLEAR', { label: 'SECTOR 01' }), '区域 01 已肃清');
    assert.equal(t('SLIPSTREAM ×{count}', { count: 12 }), '光流连斩 ×12');
    assert.equal(t('Not in the table'), 'Not in the table');
    setLanguage('en');
    assert.equal(t('PHASE 0{n} / {name}', { n: 2, name: 'PULSE BLOOM' }), 'PHASE 02 / PULSE BLOOM');
  } finally {
    setLanguage('en');
  }
});
