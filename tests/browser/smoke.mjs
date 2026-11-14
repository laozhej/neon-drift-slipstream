// End-to-end check in headless Chrome: `npm run test:browser`.
// Boots the source tree and the bundled build, plays through every screen with
// real key and mouse events, and fails on any console error.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';
import { decodePng, sample } from './png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KEY = 'neon-drift-slipstream-v1';
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed++; console.log(`  ✓ ${message}`); };

function serve(port, folder) {
  const child = spawn(process.execPath, [resolve(root, 'server.mjs'), ...(folder ? [folder] : [])],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Server on ${port} did not start`)), 10000);
    child.once('error', fail);
    child.stderr.once('data', data => { clearTimeout(timer); fail(new Error(String(data))); });
    child.stdout.once('data', () => { clearTimeout(timer); done(child); });
  });
}

const build = spawnSync(process.execPath, [resolve(root, 'scripts/build.mjs')], { cwd: root, encoding: 'utf8' });
assert.equal(build.status, 0, `Build failed:\n${build.stdout}${build.stderr}`);

const servers = [await serve(4197), await serve(4198, 'dist')];
const page = await launch({ width: 1600, height: 900 });
const state = (script, ...args) => page.evaluate(script, ...args);
const visible = id => page.evaluate(name => !document.getElementById(name).hidden, id);
const mode = () => state(() => window.neonDrift.game.mode);
const frames = (count = 3) => page.evaluate(n => new Promise(done => {
  const step = () => (n-- > 0 ? requestAnimationFrame(step) : done(true));
  step();
}), count);

try {
  console.log('Boot');
  await page.goto('http://127.0.0.1:4197/');
  await page.waitFor('Boolean(window.neonDrift) || !document.getElementById("fatal").hidden');
  await state(key => localStorage.removeItem(key), KEY);
  await page.goto('http://127.0.0.1:4197/');
  await page.waitFor('Boolean(window.neonDrift)');
  ok(!(await visible('fatal')), 'the game starts without a fatal error');
  ok(await visible('title-screen') && !(await visible('hud')), 'the title screen is up and the flight interface is hidden');
  ok(await state(() => document.querySelectorAll('#difficulty [role="radio"]').length) === 5, 'five flight classes are offered');
  ok(await state(() => document.activeElement.id) === 'start-button', 'the launch button has focus');

  console.log('Title');
  await page.press('ArrowRight');
  ok(await state(() => window.neonDrift.settings.difficulty) === 'hard', 'arrow keys change the flight class');
  await page.press('ArrowLeft');
  await page.click('#language-button');
  ok(await state(() => document.documentElement.lang) === 'zh-CN' && (await state(() => document.querySelector('#start-button span').textContent)) === '开始飞行',
    'the interface switches to Chinese');
  ok(await state(() => [...document.querySelectorAll('[data-i18n]')].every(node => node.textContent.trim().length > 0)), 'no label is left blank in Chinese');
  await page.click('#language-button');
  ok(await state(() => document.querySelector('#start-button span').textContent) === 'INITIATE FLIGHT', 'and back to English');
  await page.click('[data-difficulty="easy"]');
  await page.click('[data-difficulty="normal"]');

  console.log('Airframes');
  ok(await state(() => document.querySelectorAll('#ships [role="radio"]').length) === 3, 'three airframes are offered');
  await page.press('ArrowDown');
  ok(await state(() => window.neonDrift.settings.ship) === 'halberd', 'up and down arrows change the airframe');
  await page.click('[data-ship="mirage"]');
  await frames(3);
  ok(await state(() => window.neonDrift.game.ship.id) === 'mirage' && (await state(() => window.neonDrift.renderer.ship.id)) === 'mirage',
    'the title shows the chosen airframe at once');
  ok(await state(key => JSON.parse(localStorage.getItem(key)).settings.ship, KEY) === 'mirage', 'and the choice is saved');
  await page.click('#start-button');
  await page.waitFor(() => window.neonDrift.game.mode === 'playing');
  await frames(3);
  ok(await state(() => window.neonDrift.game.ship.id) === 'mirage' && (await state(() => document.getElementById('run-class').textContent)).startsWith('MIRAGE'),
    'the flight uses it and the interface names it');
  await page.keyDown('KeyZ');
  await page.sleep(300);
  await page.keyUp('KeyZ');
  ok(await state(() => window.neonDrift.game.stats.shots % 3) === 0 && (await state(() => window.neonDrift.game.stats.shots)) > 0, 'it fires its own three-lane fan');
  await page.press('Escape');
  await page.click('#pause-quit-button');
  await frames(3);
  await page.click('[data-ship="vector"]');
  ok(await state(() => window.neonDrift.game.ship.id) === 'vector', 'and the airframe can be changed back');

  console.log('Flight');
  await page.press('Enter');      // focus is on a class chip: Enter must still launch
  await page.waitFor(() => window.neonDrift.game.mode === 'playing');
  ok(await visible('hud') && !(await visible('title-screen')), 'Enter launches the flight and swaps the screens');
  ok(await state(() => window.neonDrift.audio.context?.state) === 'running', 'audio unlocks on the first gesture');
  const x0 = await state(() => window.neonDrift.game.player.x);
  await page.keyDown('ArrowLeft');
  await page.keyDown('KeyZ');
  await page.sleep(600);
  await page.keyUp('ArrowLeft');
  ok(await state(() => window.neonDrift.game.player.x) < x0 - 60, 'the ship flies left while the arrow key is held');
  ok(await state(() => window.neonDrift.game.stats.shots) > 6, 'holding fire shoots');
  await page.keyUp('KeyZ');
  ok(await state(() => window.neonDrift.audio.lastPlayed.has('shoot')), 'shots are audible');

  await state(() => { window.neonDrift.game.flux = 100; });
  await page.keyDown('ArrowUp');
  await page.press('KeyC');
  await page.keyUp('ArrowUp');
  ok(await state(() => window.neonDrift.game.stats.drifts) === 1 && (await state(() => window.neonDrift.game.flux)) < 50, 'the drift key spends one flux segment');
  await page.press('KeyC');
  ok(await state(() => window.neonDrift.game.stats.drifts) === 1, 'an empty gauge cannot drift');
  const novas = await state(() => window.neonDrift.game.bombs);
  await page.press('KeyX');
  ok(await state(() => window.neonDrift.game.bombs) === novas - 1, 'the nova key spends a nova');
  ok(await state(() => document.getElementById('score').textContent.length) === 6, 'the score readout is live');

  console.log('Pause and settings');
  await page.press('Escape');
  ok(await mode() === 'paused' && await visible('pause-screen'), 'Esc pauses');
  const frozen = await state(() => window.neonDrift.game.time);
  await page.sleep(300);
  ok(await state(() => window.neonDrift.game.time) === frozen, 'the simulation stands still while paused');
  await page.click('#pause-settings-button');
  ok(await visible('settings'), 'settings open from the pause menu');
  await page.click('#bindings [data-action="fire"][data-slot="0"]');
  await page.press('KeyK');
  ok(await state(() => window.neonDrift.settings.bindings.fire[0]) === 'KeyK', 'a control can be rebound');
  ok(await state(key => JSON.parse(localStorage.getItem(key)).settings.bindings.fire[0], KEY) === 'KeyK', 'and the binding is saved');
  await page.click('#bindings [data-action="pause"][data-slot="0"]');
  await page.press('Backspace');
  await page.click('#bindings [data-action="pause"][data-slot="1"]');
  await page.press('Backspace');
  ok(await state(() => window.neonDrift.settings.bindings.pause.some(Boolean)), 'pause can never be left without a key');
  await page.click('#bindings-reset');
  ok(await state(() => window.neonDrift.settings.bindings.fire[0]) === 'KeyZ', 'controls reset to the defaults');
  await page.click('[data-setting="camera"] [data-value="flat"]');
  await page.click('[data-setting="quality"] [data-value="low"]');
  await frames(4);
  ok(await state(() => window.neonDrift.renderer.cameraMode) === 'flat' && (await state(() => window.neonDrift.renderer.bloom.enabled)) === false,
    'camera and graphics options apply at once');
  await page.click('[data-setting="camera"] [data-value="dynamic"]');
  await page.click('[data-setting="quality"] [data-value="high"]');
  const slide = (id, value) => state((name, v) => {
    const slider = document.getElementById(name);
    slider.value = String(v);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, id, value);
  const light = () => state(() => {
    const { renderer } = window.neonDrift;
    return { strength: renderer.bloom.strength, enabled: renderer.bloom.enabled, exposure: renderer.renderer.toneMappingExposure };
  });
  const before = await light();
  await slide('glow-level', 100);
  await slide('brightness-level', 100);
  const raised = await light();
  ok(raised.strength > before.strength * 2 && raised.exposure > before.exposure + 0.2, 'the glow and brightness sliders raise the light');
  await slide('glow-level', 0);
  await slide('brightness-level', 0);
  const lowered = await light();
  ok(lowered.enabled === false && lowered.exposure < before.exposure - 0.2, 'and lower it: glow at zero switches the halo off');
  ok(await state(key => JSON.parse(localStorage.getItem(key)).settings.glow, KEY) === 0, 'light settings are saved');
  await slide('glow-level', 40);
  await slide('brightness-level', 50);
  await page.press('Escape');
  ok(!(await visible('settings')) && await mode() === 'paused', 'Esc closes settings and the flight stays paused');
  await page.press('Escape');
  ok(await mode() === 'playing', 'Esc resumes');

  console.log('Mouse steering');
  await page.press('Escape');
  await page.click('#pause-settings-button');
  await page.click('#settings [data-movement="mouse"]');
  await page.click('#settings-close');
  await page.click('#resume-button');
  await page.mouseMove(720, 320);
  await page.sleep(900);
  const ship = await state(() => {
    const { game, renderer } = window.neonDrift;
    return renderer.fieldToScreen(game.player.x, game.player.y);
  });
  ok(Math.hypot(ship.x - 720, ship.y - 320) < 6, 'the ship follows the cursor');
  await page.mouseDown(720, 320);
  await page.sleep(250);
  await page.mouseUp(720, 320);
  ok(await state(() => window.neonDrift.game.shots.length) > 0, 'the left mouse button fires');
  await page.press('Escape');
  await page.click('#pause-settings-button');
  await page.click('#settings [data-movement="keyboard"]');
  await page.click('#settings-close');
  await page.click('#resume-button');

  console.log('Results');
  const score = await state(() => {
    const { game } = window.neonDrift;
    game.addScore(4321, false);
    game.lives = 1;
    game.shield = false;
    game.player.invulnerable = 0;
    game.hitPlayer();
    return game.score;
  });
  ok(await mode() === 'gameover', 'losing the last life ends the flight');
  await page.waitFor(() => !document.getElementById('end-screen').hidden, 5000);
  ok(await state(() => Number(document.getElementById('final-score').textContent)) === score, 'the results show the final score');
  ok(await state(() => document.getElementById('record-label').textContent) === 'NEW PERSONAL BEST', 'a first score is a personal best');
  ok(await state(key => JSON.parse(localStorage.getItem(key)).records.normal, KEY) === score, 'the record is saved for its flight class');
  await page.press('Enter');
  ok(await mode() === 'playing' && (await state(() => window.neonDrift.game.score)) === 0, 'Enter starts a fresh flight');
  ok(await state(() => window.neonDrift.game.best) === score, 'the new flight chases the saved record');
  await page.press('Escape');
  await page.click('#pause-quit-button');
  ok(await mode() === 'title' && await visible('title-screen'), 'quitting returns to the title');
  ok((await state(() => document.getElementById('difficulty-note').textContent)).includes(String(score).padStart(6, '0')), 'the title shows the record');

  console.log('Sectors');
  for (const sector of [1, 2, 3]) {
    await page.goto(`http://127.0.0.1:4197/?sector=${sector}&god`);
    await page.waitFor('Boolean(window.neonDrift)');
    await page.click('#start-button');
    await page.sleep(1500);
    const rect = await state(() => window.neonDrift.renderer.fieldRect);
    const image = decodePng(await readFile(await page.screenshot(resolve(root, `output/smoke/sector-${sector}.png`))));
    // The backdrop under the lane must stay dark enough for bullets to read.
    const lumas = [];
    for (let v = 0.15; v < 0.9; v += 0.05) {
      for (let u = 0.1; u < 0.95; u += 0.05) {
        const left = rect.topLeft.x + (rect.bottomLeft.x - rect.topLeft.x) * v;
        const right = rect.topRight.x + (rect.bottomRight.x - rect.topRight.x) * v;
        const y = rect.topLeft.y + (rect.bottomLeft.y - rect.topLeft.y) * v;
        lumas.push(sample(image, Math.round(left + (right - left) * u) - 3, Math.round(y) - 3, 6, 6).luma);
      }
    }
    lumas.sort((a, b) => a - b);
    const median = lumas[lumas.length >> 1];
    let peak = 0;
    for (let y = 20; y < image.height; y += 40) for (let x = 20; x < image.width; x += 40) peak = Math.max(peak, sample(image, x, y, 8, 8).luma);
    ok(peak > 60 && median < 60, `sector ${sector} renders, and its lane is dark enough (median luma ${median}, brightest patch ${peak})`);
  }

  console.log('Boss');
  await state(() => { const { game } = window.neonDrift; game.stageTime = game.sector.duration; });
  await page.waitFor(() => Boolean(window.neonDrift.game.boss), 5000);
  await frames(3);
  ok(await visible('bossbar') && !(await visible('progress')), 'a boss replaces the sector progress with its health bar');
  await state(() => { const { game } = window.neonDrift; game.boss.entering = false; game.boss.transition = 0; game.damageBoss(game.boss.maxHp); });
  await page.sleep(300);
  await state(() => { const { game } = window.neonDrift; for (let i = 0; i < 4 && game.boss; i++) { game.boss.transition = 0; game.damageBoss(game.boss.maxHp); } });
  ok(await mode() === 'victory', 'defeating the last boss wins the campaign');
  await page.waitFor(() => !document.getElementById('end-screen').hidden, 8000);
  ok(await state(() => document.getElementById('end-title').textContent) === 'A new dawn.', 'the victory results appear');

  console.log('Window shapes');
  for (const [width, height] of [[720, 900], [1000, 700], [1920, 1080], [2560, 1080]]) {
    await page.resize(width, height);
    await page.goto('http://127.0.0.1:4197/');
    await page.waitFor('Boolean(window.neonDrift)');
    const title = await state(() => {
      const button = document.getElementById('start-button').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, left: button.left, right: button.right };
    });
    ok(!title.overflow && title.left >= 0 && title.right <= width, `the title fits ${width}×${height}`);
    await page.click('#start-button');
    await frames(4);
    const hud = await state(() => [...document.querySelectorAll('#hud .hud-block, #hud .hud-top')].every(block => {
      const box = block.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
    }));
    ok(hud, `the flight interface fits ${width}×${height}`);
  }
  await page.resize(1600, 900);

  console.log('Frame rate');
  await page.goto('http://127.0.0.1:4197/?sector=3&god');
  await page.waitFor('Boolean(window.neonDrift)');
  await page.click('[data-difficulty="extreme"]');
  await page.click('#start-button');
  await state(() => { const { game } = window.neonDrift; game.stageTime = game.sector.duration; });
  await page.waitFor(() => { const { boss } = window.neonDrift.game; return boss && !boss.entering && boss.transition <= 0; }, 15000);
  await state(() => {
    const { game } = window.neonDrift;
    game.boss.phase = 2;
    game.boss.hp = game.boss.maxHp / 3;
    game.signalPhase();
  });
  await page.sleep(6000);
  const timing = await page.evaluate(() => new Promise(done => {
    const deltas = [];
    let last = performance.now();
    let bullets = 0;
    const step = now => {
      deltas.push(now - last);
      last = now;
      bullets = Math.max(bullets, window.neonDrift.game.bullets.length);
      if (performance.now() - start < 4000) requestAnimationFrame(step);
      else {
        deltas.sort((x, y) => x - y);
        done({ average: deltas.reduce((sum, d) => sum + d, 0) / deltas.length, worst: deltas[Math.floor(deltas.length * 0.95)], bullets });
      }
    };
    const start = performance.now();
    requestAnimationFrame(step);
  }));
  console.log(`  · Extreme, final boss, final phase, up to ${timing.bullets} bullets: ${timing.average.toFixed(1)} ms average frame, ${timing.worst.toFixed(1)} ms at the 95th percentile`);
  ok(timing.average < 40, 'the densest fight holds a playable frame rate on this machine');
  await page.click('[data-difficulty="normal"]').catch(() => {});

  console.log('Bundled build');
  await page.goto('http://127.0.0.1:4198/');
  await page.waitFor('Boolean(window.neonDrift) || !document.getElementById("fatal").hidden');
  ok(!(await visible('fatal')) && await mode() === 'title', 'dist/ boots from a single bundled script');
  await page.click('#start-button');
  await page.sleep(800);
  ok(await mode() === 'playing' && (await state(() => window.neonDrift.game.time)) > 0.3, 'and flies');
  await page.goto(pathToFileURL(resolve(root, 'dist/index.html')).href);
  await page.waitFor('Boolean(window.neonDrift) || !document.getElementById("fatal").hidden');
  ok(!(await visible('fatal')) && await mode() === 'title', 'dist/index.html also opens straight from disk');

  console.log('Single-file edition');
  const single = resolve(root, 'Neon Drift Slipstream.html');
  const source = await readFile(single, 'utf8');
  ok(!/<link[^>]+stylesheet|<script[^>]+src=|importmap/.test(source), 'the single file references no other file');
  await page.goto(pathToFileURL(single).href);
  await page.waitFor('Boolean(window.neonDrift) || !document.getElementById("fatal").hidden');
  ok(!(await visible('fatal')) && await mode() === 'title', 'it opens straight from disk');
  ok(await state(() => getComputedStyle(document.body).overflow) === 'hidden' && (await state(() => document.styleSheets.length)) === 1, 'with its styles inlined');
  await page.click('#start-button');
  await page.keyDown('KeyZ');
  await page.sleep(900);
  await page.keyUp('KeyZ');
  ok(await mode() === 'playing' && (await state(() => window.neonDrift.game.stats.shots)) > 6, 'and it flies and shoots');
  await state(() => { const { game } = window.neonDrift; game.addScore(777, false); game.lives = 1; game.player.invulnerable = 0; game.hitPlayer(); });
  await page.goto(pathToFileURL(single).href);
  await page.waitFor('Boolean(window.neonDrift)');
  ok((await state(() => document.getElementById('difficulty-note').textContent)).includes('000777'), 'and it keeps its records between visits');

  assert.deepEqual(page.problems, [], `Console errors:\n${page.problems.join('\n')}`);
  console.log(`\n${passed} browser checks passed, no console errors.`);
} finally {
  await page.close();
  for (const server of servers) server.kill();
}
