// Development aid: `node tests/browser/look.mjs <name> [url-suffix]` loads the
// running game (PORT, default 4173), runs the named scenario and writes
// screenshots to output/look/. Used to check by eye what the tests cannot judge.
import { launch } from './cdp.mjs';

const [scenario = 'title', suffix = ''] = process.argv.slice(2);
const base = `http://127.0.0.1:${process.env.PORT || 4173}/${suffix}`;
const out = name => `output/look/${name}.png`;
const page = await launch({ width: Number(process.env.W || 1600), height: Number(process.env.H || 900) });

const scenarios = {
  async title() {
    await page.sleep(2500);
    await page.screenshot(out('title'));
  },
  // Flies with a simple bot for a while and takes a picture every few seconds.
  async flight() {
    await page.click('#start-button');
    const seconds = Number(process.env.DURATION || 30);
    const every = Number(process.env.EVERY || 5);
    await page.evaluate(() => {
      const { game, input } = window.neonDrift;
      input.sample = () => {
        const p = game.player;
        const target = game.nearestTarget(p.x, p.y, Infinity);
        const wanted = target ? target.x : 240 + Math.sin(game.time * 0.9) * 150;
        const dx = wanted - p.x;
        if (game.flux >= 100 && game.bullets.length > 25 && !p.drift) game.useDrift({ x: Math.sign(dx) || 1, y: -0.4 });
        return { x: Math.abs(dx) < 4 ? 0 : Math.sign(dx), y: 0, focus: Boolean(game.boss), shooting: true, pointer: null };
      };
    });
    for (let elapsed = every; elapsed <= seconds; elapsed += every) {
      await page.sleep(every * 1000);
      await page.screenshot(out(`${process.env.TAG || 'flight'}-${String(elapsed).padStart(3, '0')}`));
    }
  },
  // Jumps to a sector's boss (use with ?sector=N&god) and photographs each phase.
  async boss() {
    const tag = process.env.TAG || 'boss';
    await page.click('#start-button');
    await page.evaluate(() => {
      const { game, input } = window.neonDrift;
      input.sample = () => {
        const p = game.player;
        const dx = (game.boss ? game.boss.x : 240) - p.x;
        return { x: Math.abs(dx) < 4 ? 0 : Math.sign(dx), y: 0, focus: true, shooting: true, pointer: null };
      };
      game.stageTime = game.sector.duration - 0.2;
    });
    await page.sleep(1700);
    await page.screenshot(out(`${tag}-0-enter`));
    for (const phase of [0, 1, 2]) {
      await page.waitFor(n => {
        const { boss } = window.neonDrift.game;
        return boss && !boss.entering && boss.transition <= 0 && boss.phase === n;
      }, 60000, phase);
      await page.sleep(phase === 0 ? 5200 : phase === 1 ? 6500 : 5000);
      await page.screenshot(out(`${tag}-${phase + 1}-phase`));
      // Skip the rest of the phase: leave a sliver above its floor for the guns.
      await page.evaluate(() => {
        const { boss } = window.neonDrift.game;
        if (boss) boss.hp = Math.min(boss.hp, (boss.phase < 2 ? boss.maxHp * (2 - boss.phase) / 3 : 0) + 60);
      });
    }
    await page.waitFor(() => !window.neonDrift.game.boss, 20000);
    await page.sleep(700);
    await page.screenshot(out(`${tag}-4-down`));
    await page.sleep(2600);
    await page.screenshot(out(`${tag}-5-after`));
  },
  // Drift, nova, pause, settings, results, Chinese.
  async screens() {
    await page.click('#start-button');
    const game = script => page.evaluate(script);
    await game(() => { const { game } = window.neonDrift; game.cheats.god = true; game.stageTime = 44; });
    await page.sleep(6500);
    // Fill the gauge, fly into the thick of it and drift.
    await game(() => { const { game } = window.neonDrift; game.flux = 300; game.player.y = 330; });
    await page.sleep(400);
    await page.screenshot(out('fx-1-overdrive'));
    await page.keyDown('ArrowUp');
    await page.press('KeyC');
    await page.sleep(120);
    await page.screenshot(out('fx-2-drift'));
    await page.keyUp('ArrowUp');
    await page.sleep(450);
    await page.screenshot(out('fx-3-shards'));
    await page.press('KeyX');
    await page.sleep(160);
    await page.screenshot(out('fx-4-nova'));
    await page.sleep(900);
    await page.keyDown('ShiftLeft');
    await page.sleep(300);
    await page.screenshot(out('fx-5-focus'));
    await page.keyUp('ShiftLeft');
    await page.press('Escape');
    await page.sleep(500);
    await page.screenshot(out('ui-1-pause'));
    await page.click('#pause-settings-button');
    await page.sleep(500);
    await page.screenshot(out('ui-2-settings'));
    await page.click('[data-setting="language"] [data-value="zh"]');
    await page.sleep(300);
    await page.screenshot(out('ui-3-settings-zh'));
    await page.click('#settings-close');
    await page.press('Escape');
    await page.sleep(300);
    await game(() => { const { game } = window.neonDrift; game.cheats.god = false; game.lives = 1; game.player.invulnerable = 0; game.hitPlayer(); });
    await page.sleep(500);
    await page.screenshot(out('ui-4-death'));
    await page.sleep(1600);
    await page.screenshot(out('ui-5-gameover-zh'));
    await page.click('#end-quit-button');
    await page.sleep(1500);
    await page.screenshot(out('ui-6-title-zh'));
    await page.click('#language-button');
  },
  // The signature move: a drift straight through a boss volley (use with ?sector=N&god).
  async slipstream() {
    await page.click('#start-button');
    await page.evaluate(() => { const { game } = window.neonDrift; game.stageTime = game.sector.duration; });
    await page.waitFor(() => { const { boss } = window.neonDrift.game; return boss && !boss.entering && boss.transition <= 0; }, 15000);
    await page.evaluate(() => {
      const { game } = window.neonDrift;
      game.boss.phase = 1;
      game.boss.hp = game.boss.maxHp * 2 / 3;
      game.signalPhase();
    });
    await page.sleep(3000);
    // Put a dense wall in the dash path (boss rings leave a gap aimed at the pilot), then go.
    await page.evaluate(() => {
      const { game } = window.neonDrift;
      const p = game.player;
      game.flux = 300; p.x = 150; p.y = 430;
      for (let i = 0; i < 18; i++) game.spawnBullet(p.x + 64 + (i % 6) * 20, p.y - 26 + Math.floor(i / 6) * 26, Math.PI / 2, 40, i % 2 ? '#ff72cb' : '#ffbe69', i % 3 ? 'orb' : 'diamond');
    });
    await page.sleep(120);
    await page.screenshot(out('slip-0-before'));
    await page.evaluate(() => window.neonDrift.game.useDrift({ x: 1, y: 0 }));
    await page.sleep(100);
    await page.screenshot(out('slip-1-during'));
    await page.sleep(300);
    await page.screenshot(out('slip-2-shards'));
    console.log(JSON.stringify(await page.evaluate(() => { const { stats, flux, chain } = window.neonDrift.game; return { ...stats, flux, chain }; })));
  },
  // Window shapes, the flat camera, mouse steering and low graphics.
  async layouts() {
    const settle = () => page.sleep(700);
    for (const [w, h] of [[1000, 800], [720, 900], [2560, 1080]]) {
      await page.resize(w, h);
      await settle();
      await page.screenshot(out(`layout-${w}x${h}-title`));
    }
    await page.resize(1600, 900);
    await page.click('#start-button');
    await page.evaluate(() => { const { game } = window.neonDrift; game.cheats.god = true; game.stageTime = 36; game.flux = 180; game.power = 3; });
    await page.sleep(5000);
    for (const [w, h] of [[1000, 800], [720, 900], [2560, 1080]]) {
      await page.resize(w, h);
      await settle();
      await page.screenshot(out(`layout-${w}x${h}-flight`));
    }
    await page.resize(1600, 900);
    await page.evaluate(() => {
      const { renderer, settings } = window.neonDrift;
      settings.camera = 'flat';
      renderer.setOptions({ cameraMode: 'flat', quality: 'low' });
      window.dispatchEvent(new Event('resize'));
    });
    await page.sleep(2500);
    await page.screenshot(out('layout-flat-low'));
    // Mouse steering: the ship should chase the cursor to the upper left.
    await page.evaluate(() => document.querySelector('.topbar #settings-button') && 0);
    await page.press('Escape');
    await page.click('#pause-settings-button');
    await page.click('#settings [data-movement="mouse"]');
    await page.click('#settings-close');
    await page.press('Escape');
    await page.mouseMove(700, 300);
    await page.sleep(900);
    const where = await page.evaluate(() => {
      const { game, renderer } = window.neonDrift;
      const at = renderer.fieldToScreen(game.player.x, game.player.y);
      return { mode: game.mode, x: Math.round(at.x), y: Math.round(at.y), cursor: getComputedStyle(document.getElementById('stage')).cursor };
    });
    console.log('mouse', JSON.stringify(where));
    await page.screenshot(out('layout-mouse'));
  },
};

try {
  await page.goto(base);
  await page.waitFor('Boolean(window.neonDrift) || !document.getElementById("fatal").hidden');
  if (!scenarios[scenario]) throw new Error(`Unknown scenario: ${scenario}`);
  await scenarios[scenario]();
  const info = await page.evaluate(() => {
    const nd = window.neonDrift;
    if (!nd) return { fatal: document.getElementById('fatal').textContent };
    const gl = nd.renderer.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { mode: nd.game.mode, time: nd.game.time, score: nd.game.score, lives: nd.game.lives,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', calls: nd.renderer.renderer.info.render.calls };
  });
  console.log(JSON.stringify(info));
  if (page.problems.length) console.log(`PROBLEMS:\n${page.problems.join('\n')}`);
} finally {
  await page.close();
}
