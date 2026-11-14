import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, STEP, WIDTH } from '../src/sim/config.js';
import { SECTORS, ENEMY_TYPES, SUPPLY_TYPES } from '../src/sim/sectors.js';
import { DIFFICULTIES } from '../src/sim/difficulty.js';
import { newGame, run, idle, firing, botInput } from './helpers.mjs';

test('every sector schedule is sorted, valid and leaves room for the boss warning', () => {
  assert.equal(SECTORS.length, 3);
  for (const sector of SECTORS) {
    let previous = -Infinity;
    for (const wave of sector.waves) {
      assert.ok(wave.at >= previous, `${sector.name} is sorted`);
      previous = wave.at;
      assert.ok(ENEMY_TYPES[wave.type], `${wave.type} exists`);
      if (wave.path !== 'swoop') assert.ok(wave.x >= 26 && wave.x <= WIDTH - 26, `${sector.name} spawn x ${wave.x}`);
      assert.ok(wave.at <= sector.duration - 5, `${sector.name} keeps its final seconds clear`);
    }
    for (const supply of sector.supplies) assert.ok(SUPPLY_TYPES.includes(supply.type));
    assert.equal(sector.phases.length, 3);
    assert.ok(sector.sections.at(-1).label.startsWith('WARNING'));
  }
});

test('the new enemy types all appear in the campaign', () => {
  const seen = new Set(SECTORS.flatMap(sector => sector.waves.map(wave => wave.type)));
  for (const type of Object.keys(ENEMY_TYPES)) assert.ok(seen.has(type), `${type} is used`);
  const paths = new Set(SECTORS.flatMap(sector => sector.waves.map(wave => wave.path ?? ENEMY_TYPES[wave.type].path ?? 'fall')));
  assert.deepEqual([...paths].sort(), ['dive', 'fall', 'hold', 'rise', 'swoop']);
});

test('an enemy surfacing from the depth cannot be touched until it arrives', () => {
  const { game } = newGame();
  const e = game.spawnEnemy({ type: 'scout', x: 240, at: 0, path: 'rise', y: 300 });
  assert.ok(e.alt < -300);
  game.player.x = 240;
  game.player.y = 300;
  game.update(STEP, firing);
  assert.equal(game.lives, 3, 'no collision below the plane');
  assert.equal(game.nearestTarget(240, 300, Infinity), null);
  game.player.y = 600;
  run(game, 1, idle);
  assert.equal(e.alt, 0);
  assert.ok(e.y > 300, 'it descends once it has surfaced');
});

test('a swoop crosses the field and leaves on the far side', () => {
  const { game } = newGame();
  const e = game.spawnEnemy({ type: 'scout', x: 0, at: 0, path: 'swoop', side: -1, y: 100 });
  assert.equal(e.x, -30);
  run(game, 1.8, idle);
  assert.ok(e.x > 200 && e.y > 200, 'it dips toward the middle');
  run(game, 3, idle);
  assert.equal(e.gone, true);
  assert.equal(game.enemies.includes(e), false);
});

test('a lancer parks, telegraphs a beam, and withdraws', () => {
  const { game, events } = newGame();
  game.cheats.god = true;   // the pilot sits still under an aimed beam
  const e = game.spawnEnemy({ type: 'lancer', x: 240, at: 0 });
  game.player.x = 60;
  run(game, 1.5, idle);
  assert.equal(e.state, 1);
  run(game, 1.2, idle);
  assert.equal(game.beams.length, 1);
  assert.ok(events.some(ev => ev.type === 'beamWarn'));
  run(game, 9, idle);
  assert.equal(e.gone, true);
  assert.equal(game.beams.length, 0);
});

test('a beam dies with its lancer', () => {
  const { game } = newGame();
  const e = game.spawnEnemy({ type: 'lancer', x: 240, at: 0 });
  game.player.x = 60;
  run(game, 2.7, idle);
  assert.equal(game.beams.length, 1);
  game.damageEnemy(e, 9999);
  game.update(STEP, idle);
  assert.equal(game.beams.length, 0);
});

test('a bloom bursts into petals when destroyed away from the pilot', () => {
  const { game } = newGame();
  const e = game.spawnEnemy({ type: 'bloom', x: 240, at: 0 });
  e.y = 200;
  game.damageEnemy(e, 9999);
  assert.equal(game.bullets.length, 10);
  assert.ok(game.bullets.every(b => b.turn !== 0));
});

test('a dart flies at the pilot but always downwards', () => {
  const { game } = newGame();
  game.player.x = 60;
  const e = game.spawnEnemy({ type: 'dart', x: 400, at: 0 });
  assert.ok(e.vx < 0 && e.vy > 0);
  assert.ok(e.vy > Math.abs(e.vx) * 0.6);
});

test('the boss arrives when the sector timer ends and changes phase at each third', () => {
  const { game, events } = newGame();
  game.cheats.god = true;
  game.stageTime = game.sector.duration - STEP;
  game.update(STEP, idle);
  const b = game.boss;
  assert.ok(b && b.entering);
  assert.equal(game.banner.tone, 'warn');
  run(game, 2.5, idle);
  assert.equal(b.entering, false);
  assert.ok(b.transition > 0);
  game.damageBoss(9999);
  assert.equal(b.hp, b.maxHp, 'untouchable during the phase signal');
  run(game, 2, idle);
  game.damageBoss(b.maxHp);
  assert.equal(b.phase, 1);
  assert.equal(b.hp, Math.round(b.maxHp * 2 / 3));
  run(game, 2, idle);
  game.damageBoss(b.maxHp);
  assert.equal(b.phase, 2);
  run(game, 2, idle);
  const lives = game.lives;
  const bombs = game.bombs;
  game.damageBoss(b.maxHp);
  assert.equal(game.boss, null);
  assert.equal(game.intermission, CONFIG.intermissionDuration);
  assert.equal(game.stats.sectorsCleared, 1);
  assert.ok(events.some(e => e.type === 'bossDown'));
  run(game, CONFIG.intermissionDuration + 0.1, idle);
  assert.equal(game.sectorIndex, 1);
  assert.equal(game.lives, lives + 1);
  assert.equal(game.bombs, bombs + 1);
  assert.equal(game.player.x, WIDTH / 2);
});

test('a phase change cancels the field into motes and clears beams', () => {
  const { game } = newGame();
  game.cheats.god = true;
  game.stageTime = game.sector.duration;
  run(game, 5, idle);
  run(game, 6, idle);
  assert.ok(game.bullets.length > 10);
  const bullets = game.bullets.length;
  game.spawnBeam({ x: 0, y: 0, angle: 0, warn: 9 });
  game.damageBoss(game.boss.maxHp);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.beams.length, 0);
  assert.ok(game.motes.length >= Math.min(bullets, CONFIG.moteLimit) - 5);
});

test('every boss phase actually fires, including its new hazards', () => {
  for (let sector = 0; sector < SECTORS.length; sector++) {
    const { game, events } = newGame({ sector });
    game.cheats.god = true;
    game.stageTime = game.sector.duration;
    run(game, 4.5, idle);
    for (let phase = 0; phase < 3; phase++) {
      assert.equal(game.boss.phase, phase);
      let peak = 0;
      run(game, 12, g => { peak = Math.max(peak, g.bullets.length); return idle; });
      assert.ok(peak > 15, `${game.sector.bossName} phase ${phase + 1} fills the field (${peak})`);
      if (phase < 2) { game.damageBoss(game.boss.maxHp); run(game, 2, idle); }
    }
    assert.ok(events.some(e => e.type === 'beamFire'), `${game.sector.bossName} uses a beam`);
  }
});

for (const { id } of DIFFICULTIES) {
  test(`the campaign can be flown to victory on ${id}`, () => {
    let saved = 0;
    const { game } = newGame({ difficulty: id, saveBest: score => { saved = score; } });
    game.cheats.god = true;
    let peakBullets = 0;
    let drifts = 0;
    const limit = 14 * 60;
    while (game.mode === 'playing' && game.time < limit) {
      const input = botInput(game);
      if (game.fluxSegments > 0 && game.bullets.length > 12 && game.useDrift(input)) drifts++;
      game.update(STEP, input);
      peakBullets = Math.max(peakBullets, game.bullets.length);
      const p = game.player;
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(game.score));
    }
    assert.equal(game.mode, 'victory', `finished in ${Math.round(game.time)}s`);
    assert.equal(game.stats.sectorsCleared, 3);
    assert.ok(peakBullets <= CONFIG.bulletLimit);
    assert.ok(game.stats.kills > 100);
    assert.ok(drifts > 3, `the bot drifted ${drifts} times`);
    assert.equal(saved, game.best);
    assert.ok(game.bullets.every(b => Number.isFinite(b.x) && Number.isFinite(b.y)));
  });
}
