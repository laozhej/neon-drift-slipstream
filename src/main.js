import { Game } from './sim/game.js';
import { STEP } from './sim/config.js';
import { DIFFICULTIES, getDifficulty } from './sim/difficulty.js';
import { SECTORS } from './sim/sectors.js';
import { SHIPS, getShip } from './sim/ships.js';
import { Renderer } from './render/renderer.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { ACTIONS, assignBinding, bindingLabel, defaultBindings } from './bindings.js';
import { t, setLanguage, detectLanguage, translateDocument } from './i18n.js';
import { loadState, saveState, recordScore } from './storage.js';
import { Hud, formatScore, formatClock } from './hud.js';

const $ = id => document.getElementById(id);
const canvas = $('stage');

const CLASS_NOTES = {
  easy: 'Starlight Cruise — 5 lives, 3 novas and a shield. Slower shots, faster flux.',
  normal: 'Neon Drift — the reference campaign. Find your rhythm.',
  hard: 'Razor Current — wider fans, denser rings, a faster pulse.',
  lunatic: 'Prism Storm — boss crossfire and tighter corridors.',
  extreme: 'Event Horizon — relentless patterns; fallen enemies leave a final echo.',
};
const SHIP_NOTES = {
  vector: 'All-rounder — twin guns that widen with power. Wisps seek when loose and lock forward when focused.',
  halberd: 'Heavy — slow, with every barrel pointing forward. Its long drift rams for nearly triple damage.',
  mirage: 'Skirmisher — fast, with a wide fan and seeker wisps. Longer graze reach, quicker flux, stronger shards.',
};
const ACTION_NAMES = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', fire: 'Fire', focus: 'Focus',
  drift: 'Drift', bomb: 'Nova', pause: 'Pause', mute: 'Mute',
};
const PAUSE_NOTES = {
  manual: 'Your flight is paused. The stars can wait.',
  blur: 'Focus lost. Your flight is safe here.',
  settings: 'Settings open. Resume when you’re ready.',
};
const HINT_RUNS = 2;          // each first-flight hint is shown on this many runs, then never again

function boot() {
  let storage = null;
  try { storage = window.localStorage; } catch { /* Blocked storage: settings last for the session only. */ }
  const state = loadState(storage, detectLanguage());
  const settings = state.settings;
  const persist = () => saveState(storage, state);
  setLanguage(settings.language);

  // Practice flags: ?sector=2 starts at a later sector, ?god makes the ship untouchable.
  const query = new URLSearchParams(location.search);
  const practiceSector = Math.max(0, Math.min(SECTORS.length, Number.parseInt(query.get('sector'), 10) || 1) - 1);
  const practice = practiceSector > 0 || query.has('god');     // practice flights never touch the records

  const renderer = new Renderer(canvas, { quality: settings.quality, cameraMode: settings.camera, shake: settings.shake,
    glow: settings.glow, brightness: settings.brightness });
  const audio = new AudioEngine({ sfx: settings.sfx, music: settings.music, muted: settings.muted });
  const hud = new Hud();

  let run = { hints: new Set(), startBest: 0 };
  let settingsOpen = false;
  let endVisible = false;
  let uiKey = '';
  let listening = null;       // the binding slot waiting for a key
  let hitstop = 0;            // seconds of frozen simulation after taking a hit
  let slowmo = 0;             // seconds of slowed simulation after a boss falls
  let accumulator = 0;
  let padConfirm = false;

  const game = new Game({
    onEvent,
    difficulty: settings.difficulty,
    ship: settings.ship,
    best: state.records[settings.difficulty],
    saveBest: (best, difficulty) => { if (!practice && recordScore(state, difficulty, best)) persist(); },
  });
  game.cheats.god = query.has('god');
  if (practice) console.info('Neon Drift: practice flight — records are not saved.');

  // ───────────────────────────── Simulation events ─────────────────────────────

  function onEvent(type, data) {
    renderer.onEvent(type, data, game);
    audio.play(type, data);
    switch (type) {
      case 'start':
        run = { hints: new Set(), startBest: state.records[game.difficulty.id] };
        hud.reset();
        break;
      case 'flux':
        hint('flux', 'FLUX READY — press {key} to DRIFT through bullets', { key: driftKey() });
        break;
      case 'overdrive':
        hint('overdrive', 'OVERDRIVE — the gauge is full: guns +30% until you drift');
        break;
      case 'beamWarn':
        hint('beam', 'BEAM INCOMING — leave the line, or drift across it');
        break;
      case 'driftEnd':
        if (data.converted >= 3) {
          const at = renderer.fieldToScreen(data.x, data.y - 34);
          hud.floater(t('SLIPSTREAM ×{count}', { count: data.converted }), at.x, at.y, data.clean ? '' : '#7affea');
        }
        break;
      case 'hit':
      case 'shield':
        hitstop = 0.08;
        break;
      case 'bossDown':
        slowmo = 1.3;
        break;
      default:
        break;
    }
  }

  function hint(key, text, vars = null) {
    const seen = settings.hints[key] || 0;
    if (run.hints.has(key) || seen >= HINT_RUNS) return;
    run.hints.add(key);
    settings.hints[key] = seen + 1;
    persist();
    hud.toast(t(text, vars));
  }

  // ───────────────────────────── Bindings on screen ─────────────────────────────

  // The inputs worth showing for an action: mouse buttons first when flying by
  // mouse, keys only when flying by keyboard.
  function shownBindings(action, max = 2) {
    const codes = settings.bindings[action].filter(Boolean);
    const mouse = codes.filter(code => code.startsWith('Mouse'));
    const keys = codes.filter(code => !code.startsWith('Mouse'));
    const ordered = settings.movement === 'mouse' ? [...mouse, ...keys] : keys.length ? keys : mouse;
    return ordered.slice(0, max);
  }
  const keyName = code => t(bindingLabel(code));
  const driftKey = () => keyName(shownBindings('drift', 1)[0] ?? null);
  const keycap = label => {
    const cap = document.createElement('kbd');
    cap.textContent = label;
    return cap;
  };

  function renderManual() {
    const mouse = settings.movement === 'mouse';
    for (const slot of document.querySelectorAll('[data-keys]')) {
      const action = slot.dataset.keys;
      const codes = action === 'move' ? [] : shownBindings(action);
      const bothShifts = codes.includes('ShiftLeft') && codes.includes('ShiftRight');
      if (bothShifts) slot.replaceChildren(keycap('SHIFT'));
      else if (action !== 'move') slot.replaceChildren(...codes.map(code => keycap(keyName(code))));
      else if (mouse) slot.replaceChildren(keycap(t('MOUSE')));
      else slot.replaceChildren(...['up', 'left', 'down', 'right'].flatMap(a => shownBindings(a, 1)).map(code => keycap(keyName(code))));
    }
    $('move-hint').textContent = t(mouse ? 'Move the mouse to steer' : 'Steer your ship');
    for (const cap of document.querySelectorAll('kbd[data-key]')) cap.textContent = keyName(shownBindings(cap.dataset.key, 1)[0] ?? null);
  }

  function renderBindings() {
    $('bindings').replaceChildren(...ACTIONS.map(action => {
      const row = document.createElement('div');
      row.className = 'binding';
      const name = document.createElement('span');
      name.textContent = t(ACTION_NAMES[action]);
      row.append(name, ...settings.bindings[action].map((code, slot) => {
        const waiting = listening?.action === action && listening.slot === slot;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `slot${waiting ? ' listening' : code ? '' : ' empty'}`;
        button.dataset.action = action;
        button.dataset.slot = String(slot);
        button.textContent = waiting ? t('PRESS…') : keyName(code);
        button.setAttribute('aria-label', `${t(ACTION_NAMES[action])} ${slot + 1}: ${keyName(code)}`);
        return button;
      }));
      return row;
    }));
  }

  $('bindings').addEventListener('click', async event => {
    const button = event.target instanceof Element ? event.target.closest('.slot') : null;
    if (!button) return;
    const { action } = button.dataset;
    const slot = Number(button.dataset.slot);
    const mine = listening = { action, slot };
    $('bindings-status').textContent = '';
    renderBindings();
    const code = await input.captureNext();
    if (listening === mine) listening = null;
    if (code !== undefined) {
      const result = assignBinding(settings.bindings, action, slot, code);
      if (result.ok) {
        settings.bindings = result.bindings;
        input.setBindings(settings.bindings);
        persist();
      }
      $('bindings-status').textContent = t(result.ok ? 'Controls saved on this device.' : 'Pause needs at least one binding.');
    }
    renderBindings();
    renderManual();
    hud.refresh();
    if (settingsOpen && !listening) $('bindings').querySelector(`[data-action="${action}"][data-slot="${slot}"]`)?.focus();
  });

  $('bindings-reset').addEventListener('click', () => {
    settings.bindings = defaultBindings();
    input.setBindings(settings.bindings);
    persist();
    $('bindings-status').textContent = t('Controls saved on this device.');
    renderBindings();
    renderManual();
    hud.refresh();
  });

  // ───────────────────────────── Options ─────────────────────────────

  const setChecked = (element, on) => element.setAttribute('aria-checked', String(on));
  const setSwitch = (element, on) => {
    setChecked(element, on);
    element.textContent = t(on ? 'ON' : 'OFF');
  };

  $('difficulty').replaceChildren(...DIFFICULTIES.map(profile => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.dataset.difficulty = profile.id;
    chip.style.setProperty('--chip', profile.color);
    return chip;
  }));

  $('ships').replaceChildren(...SHIPS.map(ship => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.dataset.ship = ship.id;
    chip.style.setProperty('--chip', ship.color);
    return chip;
  }));

  function renderOptions() {
    for (const chip of $('ships').children) {
      chip.textContent = t(chip.dataset.ship.toUpperCase());
      setChecked(chip, chip.dataset.ship === settings.ship);
    }
    $('ship-note').textContent = t(SHIP_NOTES[settings.ship]);
    document.documentElement.style.setProperty('--ship', getShip(settings.ship).color);
    for (const chip of $('difficulty').children) {
      chip.textContent = t(chip.dataset.difficulty.toUpperCase());
      setChecked(chip, chip.dataset.difficulty === settings.difficulty);
    }
    const best = document.createElement('b');
    best.textContent = t('BEST {score}', { score: formatScore(state.records[settings.difficulty]) });
    $('difficulty-note').replaceChildren(`${t(CLASS_NOTES[settings.difficulty])} `, best);

    for (const button of document.querySelectorAll('[data-movement]')) setChecked(button, button.dataset.movement === settings.movement);
    for (const group of document.querySelectorAll('[data-setting]')) {
      const value = settings[group.dataset.setting];
      for (const button of group.children) setChecked(button, button.dataset.value === value);
    }
    setSwitch($('autofire-toggle'), settings.autoFire);
    setSwitch($('shake-toggle'), settings.shake);
    $('glow-level').value = String(Math.round(settings.glow * 100));
    $('brightness-level').value = String(Math.round(settings.brightness * 100));
    $('music-volume').value = String(Math.round(settings.music * 100));
    $('sfx-volume').value = String(Math.round(settings.sfx * 100));
    $('mute-button').textContent = t(settings.muted ? 'SOUND OFF' : 'SOUND ON');
    $('language-button').textContent = settings.language === 'zh' ? 'EN' : '中文';
  }

  // Everything that carries text: called once at boot and after a language change.
  function renderAll() {
    translateDocument();
    renderOptions();
    renderManual();
    renderBindings();
    hud.refresh();
    uiKey = '';
  }

  function setDifficulty(id) {
    settings.difficulty = getDifficulty(id).id;
    persist();
    renderOptions();
  }

  // The title shows the chosen airframe at once; a flight in progress keeps its own.
  function setShip(id) {
    settings.ship = getShip(id).id;
    persist();
    if (game.mode === 'title') game.reset('title', settings.difficulty, { ship: settings.ship });
    renderOptions();
  }

  function setMovement(mode) {
    settings.movement = mode === 'mouse' ? 'mouse' : 'keyboard';
    input.setMovementMode(settings.movement);
    persist();
    renderOptions();
    renderManual();
    hud.refresh();
    uiKey = '';
  }

  function setLanguageSetting(language) {
    settings.language = setLanguage(language);
    persist();
    renderAll();
  }

  function toggleMute() {
    settings.muted = audio.setMuted(!settings.muted);
    persist();
    renderOptions();
  }

  function layout() {
    renderer.resize();
    hud.layout(renderer.fieldRect, renderer.width);
  }

  $('difficulty').addEventListener('click', event => {
    const chip = event.target instanceof Element ? event.target.closest('[data-difficulty]') : null;
    if (chip) setDifficulty(chip.dataset.difficulty);
  });
  $('ships').addEventListener('click', event => {
    const chip = event.target instanceof Element ? event.target.closest('[data-ship]') : null;
    if (chip) setShip(chip.dataset.ship);
  });
  for (const button of document.querySelectorAll('[data-movement]')) {
    button.addEventListener('click', () => setMovement(button.dataset.movement));
  }
  for (const [id, key] of [['glow-level', 'glow'], ['brightness-level', 'brightness']]) {
    const slider = $(id);
    slider.addEventListener('input', () => {
      settings[key] = Number(slider.value) / 100;
      renderer.setOptions({ [key]: settings[key] });
    });
    slider.addEventListener('change', persist);
  }
  for (const group of document.querySelectorAll('[data-setting]')) {
    group.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('[data-value]') : null;
      if (!button) return;
      const { setting } = group.dataset;
      const { value } = button.dataset;
      if (setting === 'language') { setLanguageSetting(value); return; }
      settings[setting] = value;
      persist();
      if (setting === 'quality') renderer.setOptions({ quality: value });
      if (setting === 'camera') renderer.setOptions({ cameraMode: value });
      layout();
      renderOptions();
    });
  }
  $('autofire-toggle').addEventListener('click', () => {
    settings.autoFire = input.autoFire = !settings.autoFire;
    persist();
    renderOptions();
  });
  $('shake-toggle').addEventListener('click', () => {
    settings.shake = !settings.shake;
    renderer.setOptions({ shake: settings.shake });
    persist();
    renderOptions();
  });
  for (const [id, kind] of [['music-volume', 'music'], ['sfx-volume', 'sfx']]) {
    const slider = $(id);
    slider.addEventListener('input', () => {
      settings[kind] = Number(slider.value) / 100;
      audio.setVolume(kind, settings[kind]);
    });
    slider.addEventListener('change', () => {
      persist();
      if (kind === 'sfx') audio.play('pickup');
    });
  }
  $('language-button').addEventListener('click', () => setLanguageSetting(settings.language === 'zh' ? 'en' : 'zh'));
  $('mute-button').addEventListener('click', toggleMute);
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        // Where supported, Esc pauses instead of dropping out of fullscreen.
        navigator.keyboard?.lock?.(['Escape'])?.catch(() => {});
      }
    } catch { /* Fullscreen is a convenience; refusing it is harmless. */ }
  });

  // ───────────────────────────── Flow ─────────────────────────────

  function startRun() {
    audio.unlock();
    closeSettings();
    hitstop = slowmo = accumulator = 0;
    game.best = state.records[settings.difficulty];
    game.reset('playing', settings.difficulty, { sector: practiceSector, ship: settings.ship });
  }

  function quitToTitle() {
    closeSettings();
    game.persistBest();
    game.reset('title', settings.difficulty, { ship: settings.ship });
    renderOptions();
  }

  function pauseGame(reason) {
    if (game.mode !== 'playing') return;
    game.pause(reason);
    game.persistBest();
    input.clear();
  }

  function resumeGame() {
    if (game.mode !== 'paused' || settingsOpen) return;
    audio.unlock();
    input.clear();
    game.resume();
  }

  function openSettings() {
    pauseGame('settings');
    settingsOpen = true;
    $('bindings-status').textContent = '';
    $('settings').hidden = false;
    $('settings-close').focus();
  }

  function closeSettings() {
    if (!settingsOpen) return;
    input.cancelCapture();
    settingsOpen = false;
    $('settings').hidden = true;
    uiKey = '';               // hands focus back to whichever screen is underneath
  }

  $('start-button').addEventListener('click', startRun);
  $('restart-button').addEventListener('click', startRun);
  $('pause-restart-button').addEventListener('click', startRun);
  $('resume-button').addEventListener('click', resumeGame);
  $('pause-quit-button').addEventListener('click', quitToTitle);
  $('end-quit-button').addEventListener('click', quitToTitle);
  $('pause-button').addEventListener('click', () => (game.mode === 'paused' ? resumeGame() : pauseGame('manual')));
  $('settings-button').addEventListener('click', openSettings);
  $('pause-settings-button').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', event => { if (event.target === event.currentTarget) closeSettings(); });

  const input = new Input(window, canvas, {
    isPlaying: () => game.mode === 'playing',
    isUiActive: () => settingsOpen,
    toField: (x, y) => renderer.screenToField(x, y),
    blur: () => pauseGame('blur'),
    pause: () => {
      if (settingsOpen) return;
      if (game.mode === 'playing') pauseGame('manual');
      else resumeGame();
    },
    bomb: () => { game.useBomb(); },
    drift: () => { if (game.mode === 'playing') game.useDrift(input.sample()); },
    mute: toggleMute,
  });
  input.setBindings(settings.bindings);
  input.setMovementMode(settings.movement);
  input.autoFire = settings.autoFire;

  // Keys that belong to the menus rather than to the flight.
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (settingsOpen) {
      if (event.code === 'Escape') { event.preventDefault(); closeSettings(); }
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const enter = event.code === 'Enter' || event.code === 'NumpadEnter';
    if (game.mode === 'title') {
      // Enter launches from anywhere on the title — including right after picking
      // a class with the mouse — except from the top bar's own buttons.
      const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
      if (enter && !target?.closest('.topbar')) {
        event.preventDefault();
        startRun();
      } else if (step) {
        const index = DIFFICULTIES.findIndex(profile => profile.id === settings.difficulty);
        setDifficulty(DIFFICULTIES[(index + step + DIFFICULTIES.length) % DIFFICULTIES.length].id);
        event.preventDefault();
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        // Up and down walk the airframes, left and right the flight classes.
        const index = SHIPS.findIndex(ship => ship.id === settings.ship);
        setShip(SHIPS[(index + (event.code === 'ArrowDown' ? 1 : SHIPS.length - 1)) % SHIPS.length].id);
        event.preventDefault();
      }
    } else if (endVisible && enter && !target?.closest('.topbar, #end-quit-button')) {
      event.preventDefault();
      startRun();
    }
  });

  // Browsers only allow sound after a gesture.
  for (const name of ['pointerdown', 'keydown']) window.addEventListener(name, () => audio.unlock(), { capture: true, passive: true });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('button')) audio.play('ui');
  });
  window.addEventListener('resize', layout);
  window.addEventListener('pagehide', () => game.persistBest());

  // ───────────────────────────── Screens ─────────────────────────────

  function fillResults() {
    const won = game.mode === 'victory';
    const { stats } = game;
    $('end-kicker').textContent = t(won ? 'EXPEDITION CLEAR / TRANSMISSION COMPLETE' : 'SIGNAL LOST / FLIGHT ENDED');
    $('end-title').textContent = t(won ? 'A new dawn.' : 'One more flight.');
    $('end-note').textContent = t(won ? 'Three sectors liberated. The Helix Crown falls silent.' : 'Every flight brings you closer. Find your line.');
    $('final-score').textContent = formatScore(game.score);
    $('record-label').textContent = t(practice ? 'PRACTICE FLIGHT' : game.score > run.startBest ? 'NEW PERSONAL BEST' : 'FLIGHT RECORDED');
    $('result-class').textContent = t('{ship} · {difficulty} · SCORE ×{multiplier}',
      { ship: game.ship.id.toUpperCase(), difficulty: game.difficulty.id.toUpperCase(), multiplier: game.difficulty.scoreMultiplier });
    $('result-kills').textContent = String(stats.kills);
    $('result-grazes').textContent = String(stats.grazes);
    $('result-drifts').textContent = String(stats.drifts);
    $('result-converted').textContent = String(stats.converted);
    $('result-slipstream').textContent = `×${stats.bestDrift}`;
    $('result-chain').textContent = `×${stats.maxChain.toFixed(1)}`;
    $('result-sectors').textContent = `${stats.sectorsCleared} / ${SECTORS.length}`;
    $('result-time').textContent = formatClock(game.time);
  }

  // Shows the screen that matches the simulation. Runs every frame, acts on change.
  function syncScreens() {
    const { mode } = game;
    const ended = mode === 'victory' || mode === 'gameover';
    // The results wait for the explosion (or the boss wreck) to play out.
    endVisible = ended && renderer.endTimer >= (mode === 'victory' ? 3.6 : 1.3);
    const key = `${mode}:${endVisible}:${game.pauseReason}`;
    if (key === uiKey) return;
    uiKey = key;

    for (const name of ['title', 'playing', 'paused', 'victory', 'gameover']) document.body.classList.toggle(`mode-${name}`, name === mode);
    document.body.classList.toggle('mouse-flight', mode === 'playing' && settings.movement === 'mouse');
    $('title-screen').hidden = mode !== 'title';
    $('hud').hidden = mode === 'title';
    $('pause-screen').hidden = mode !== 'paused';
    $('end-screen').hidden = !endVisible;
    $('pause-button').hidden = mode !== 'playing' && mode !== 'paused';
    if (mode === 'paused') $('pause-note').textContent = t(PAUSE_NOTES[game.pauseReason] ?? PAUSE_NOTES.manual);
    if (endVisible) fillResults();
    if (mode === 'title') renderOptions();
    if (settingsOpen) return;
    const focus = mode === 'title' ? $('start-button') : mode === 'paused' ? $('resume-button') : endVisible ? $('restart-button') : canvas;
    focus.focus({ preventScroll: true });
  }

  // ───────────────────────────── Loop ─────────────────────────────

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (game.mode === 'playing') {
      const sample = input.sample();
      let simulated = dt;
      if (hitstop > 0) { hitstop -= dt; simulated = 0; }
      else if (slowmo > 0) { slowmo -= dt; simulated = dt * 0.4; }
      accumulator += simulated;
      while (accumulator >= STEP && game.mode === 'playing') {
        game.update(STEP, sample);
        accumulator -= STEP;
      }
      if (game.sectorIndex === 0 && game.stageTime > 15.5 && game.stageTime < 16.5) hint('graze', 'Graze bullets to charge FLUX');
      hud.tick(dt);
    } else {
      accumulator = 0;
      // The gamepad's A button confirms whichever screen is up.
      const confirm = Boolean(input.readPad()?.fire);
      if (confirm && !padConfirm && !settingsOpen) {
        if (game.mode === 'title' || endVisible) startRun();
        else if (game.mode === 'paused') resumeGame();
      }
      padConfirm = confirm;
    }

    syncScreens();
    const { mode } = game;
    if (mode === 'gameover') audio.setScene('off');
    else if (mode === 'playing') audio.setScene(game.boss ? 'boss' : 'stage', game.sectorIndex);
    else audio.setScene('title', mode === 'title' ? 0 : game.sectorIndex);   // paused and victory: the drums drop out
    audio.tick();

    renderer.render(game, dt);
    if (mode !== 'title') hud.update(game, { driftKey: driftKey() });
  }

  renderAll();
  layout();
  syncScreens();
  requestAnimationFrame(frame);

  // For the console and for automated checks.
  window.neonDrift = { game, renderer, audio, input, hud, settings };
}

try {
  boot();
} catch (error) {
  console.error(error);
  const fatal = $('fatal');
  fatal.textContent = `Neon Drift: Slipstream could not start — it needs a browser with WebGL 2.\n无法启动：需要支持 WebGL 2 的浏览器。\n\n${error?.message ?? error}`;
  fatal.style.whiteSpace = 'pre-line';
  fatal.hidden = false;
}
