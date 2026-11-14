import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { CONFIG, STEP, WIDTH, HEIGHT } from '../src/sim/config.js';
import { newGame, run, idle, firing } from './helpers.mjs';

const bulletAt = (game, x, y, extra = {}) => {
  const bullet = { x, y, vx: 0, vy: 0, r: 5, color: '#fff', kind: 'orb', age: 0, turn: 0, turnFor: 0, accel: 0,
    vmin: 20, vmax: 420, bounce: 0, stage: null, grazed: false, dead: false, ...extra };
  game.bullets.push(bullet);
  return bullet;
};
const dummy = (game, x = 240, y = 200, hp = 1e6) => game.spawnEnemy({ type: 'sentinel', x, hp, speed: 0, fireInterval: 0, drift: 0, at: 0 }) && Object.assign(game.enemies.at(-1), { y });

test('the title screen holds still until a flight starts', () => {
  const game = new Game();
  game.update(1, firing);
  assert.equal(game.mode, 'title');
  assert.equal(game.time, 0);
  game.reset('playing');
  assert.equal(game.mode, 'playing');
  assert.equal(game.lives, 3);
  assert.equal(game.bombs, 2);
  assert.equal(game.banner.title, 'SECTOR 01');
});

test('the ship moves at full and focus speed and stays inside the field', () => {
  const { game } = newGame();
  const x = game.player.x;
  run(game, 0.5, { ...idle, x: 1 });
  assert.ok(Math.abs(game.player.x - (x + game.ship.speed * 0.5)) < 1);
  run(game, 0.5, { ...idle, x: -1, focus: true });
  assert.ok(Math.abs(game.player.x - (x + game.ship.speed * 0.5 - game.ship.focusSpeed * 0.5)) < 1);
  run(game, 5, { ...idle, x: 1, y: 1 });
  assert.equal(game.player.x, WIDTH - 17);
  assert.equal(game.player.y, HEIGHT - 22);
});

test('the mouse steers by chasing the cursor instead of teleporting', () => {
  const { game } = newGame();
  game.update(STEP, { ...idle, pointer: { x: 60, y: 300 } });
  assert.ok(game.player.x > 200, 'one step cannot cross the field');
  run(game, 1, { ...idle, pointer: { x: 60, y: 300 } });
  assert.equal(game.player.x, 60);
  assert.equal(game.player.y, 300);
});

test('power widens the gun and brings the wisps online', () => {
  const lanes = power => {
    const { game } = newGame();
    game.power = power;
    game.update(STEP, firing);
    return { main: game.shots.filter(s => s.kind === 'main').length, wisp: game.shots.filter(s => s.kind !== 'main').length };
  };
  assert.deepEqual(lanes(1), { main: 2, wisp: 0 });
  assert.deepEqual(lanes(2), { main: 2, wisp: 2 });
  assert.deepEqual(lanes(3), { main: 4, wisp: 2 });
  assert.deepEqual(lanes(4), { main: 6, wisp: 2 });
});

test('wisp darts home on a target and focused wisps fire straight bolts', () => {
  const { game } = newGame();
  game.power = 2;
  dummy(game, 400, 300);
  game.update(STEP, firing);
  const dart = game.shots.find(s => s.kind === 'dart');
  const before = dart.vx;
  run(game, 0.25, idle);
  assert.ok(dart.vx > before, 'the dart bends toward the target on its right');
  const focused = newGame().game;
  focused.power = 2;
  focused.update(STEP, { ...firing, focus: true });
  assert.ok(focused.shots.some(s => s.kind === 'bolt' && s.vx === 0));
});

test('a graze pays once per bullet and charges flux and chain', () => {
  const { game, events } = newGame();
  const bullet = bulletAt(game, game.player.x + 15, game.player.y);
  game.update(STEP, idle);
  assert.equal(bullet.grazed, true);
  assert.equal(game.stats.grazes, 1);
  assert.equal(game.flux, CONFIG.fluxPerGraze);
  assert.ok(game.chain > 1);
  assert.equal(game.score, Math.round(CONFIG.grazeScore * game.chain));
  assert.ok(events.some(e => e.type === 'graze'));
  game.update(STEP, idle);
  assert.equal(game.stats.grazes, 1);
});

test('a drift needs a full flux segment', () => {
  const { game } = newGame();
  game.flux = CONFIG.fluxSegment - 1;
  assert.equal(game.useDrift(idle), false);
  game.flux = CONFIG.fluxSegment;
  assert.equal(game.useDrift(idle), true);
  assert.equal(game.flux, 0);
  assert.equal(game.useDrift(idle), false, 'no second drift while one is running');
});

test('a drift dashes in the held direction and forward by default', () => {
  const { game } = newGame();
  game.flux = CONFIG.fluxMax;
  const y = game.player.y;
  game.useDrift(idle);
  run(game, game.ship.drift.duration + STEP, idle);
  assert.equal(game.player.drift, null);
  assert.ok(Math.abs(y - game.player.y - game.ship.drift.speed * game.ship.drift.duration) < 12);
  const x = game.player.x;
  game.useDrift({ ...idle, x: -1 });
  run(game, game.ship.drift.duration + STEP, { ...idle, x: -1 });
  assert.ok(x - game.player.x > 140);
});

test('drifting through bullets converts them and never hurts', () => {
  const { game, events } = newGame();
  dummy(game);
  game.flux = CONFIG.fluxSegment;
  for (let i = 0; i < 10; i++) bulletAt(game, game.player.x - 20 + i * 4, game.player.y - 40 - i * 10);
  game.useDrift(idle);
  run(game, game.ship.drift.duration + STEP, idle);
  assert.equal(game.lives, 3);
  assert.equal(game.stats.converted, 10);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.shards.length, 10, 'bullets become shards while a target exists');
  const end = events.find(e => e.type === 'driftEnd');
  assert.equal(end.converted, 10);
  assert.equal(end.clean, true);
  assert.equal(game.flux, CONFIG.driftRefund, 'a clean slipstream refunds flux');
  assert.equal(game.stats.bestDrift, 10);
});

test('shards seek a target and damage it; without one bullets become motes', () => {
  const { game } = newGame();
  dummy(game, 240, 200, 500);
  game.flux = CONFIG.fluxSegment;
  for (let i = 0; i < 6; i++) bulletAt(game, game.player.x, game.player.y - 30 - i * 10);
  game.useDrift(idle);
  run(game, 2.5, idle);
  assert.equal(game.shards.length, 0);
  assert.equal(game.enemies[0].hp, 500 - 6 * game.ship.shardDamage);

  const empty = newGame().game;
  empty.flux = CONFIG.fluxSegment;
  bulletAt(empty, empty.player.x, empty.player.y - 30);
  empty.useDrift(idle);
  empty.update(STEP, idle);
  assert.equal(empty.shards.length, 0);
  assert.equal(empty.motes.length, 1);
  const score = empty.score;
  run(empty, 1.5, idle);
  assert.equal(empty.motes.length, 0);
  assert.ok(empty.score > score, 'the mote flies home and pays out');
});

test('a drift rams enemies once', () => {
  const { game } = newGame();
  dummy(game, game.player.x, game.player.y - 80, 500);
  game.flux = CONFIG.fluxSegment;
  game.useDrift(idle);
  run(game, game.ship.drift.duration + STEP, idle);
  assert.equal(game.enemies[0].hp, 500 - game.ship.drift.ram);
  assert.equal(game.lives, 3);
});

test('with the mouse a drift keeps following the cursor, faster', () => {
  const { game } = newGame();
  game.flux = CONFIG.fluxSegment;
  const pointer = { x: 100, y: 400 };
  game.useDrift({ ...idle, pointer });
  assert.equal(game.player.drift.free, true);
  run(game, 0.2, { ...idle, pointer });
  assert.equal(game.player.x, 100);
  assert.equal(game.player.y, 400);
});

test('a full gauge is overdrive and strengthens the guns', () => {
  const { game, events } = newGame();
  game.flux = CONFIG.fluxMax - 1;
  game.addFlux(5);
  assert.equal(game.overdrive, true);
  assert.ok(events.some(e => e.type === 'overdrive'));
  game.update(STEP, firing);
  assert.equal(game.shots[0].dmg, game.ship.shotDamage * CONFIG.overdriveDamage);
});

test('the chain holds, then decays, and never drops below one', () => {
  const { game } = newGame();
  game.bumpChain(1);
  run(game, CONFIG.chainHold - 0.1, idle);
  assert.equal(game.chain, 2);
  run(game, 1.1, idle);
  assert.ok(game.chain < 2 && game.chain > 1);
  run(game, 10, idle);
  assert.equal(game.chain, 1);
  game.bumpChain(100);
  assert.equal(game.chain, CONFIG.chainMax);
});

test('a hit costs a life, a power level and the chain, and clears nearby bullets', () => {
  const { game, events } = newGame();
  game.power = 3;
  game.bumpChain(2);
  bulletAt(game, game.player.x, game.player.y);
  const near = bulletAt(game, game.player.x + 100, game.player.y);
  const far = bulletAt(game, game.player.x, game.player.y - 400);
  game.update(STEP, idle);
  assert.equal(game.lives, 2);
  assert.equal(game.power, 2);
  assert.equal(game.chain, 1);
  assert.equal(near.dead, true);
  assert.equal(far.dead, false);
  assert.ok(events.some(e => e.type === 'hit'));
  bulletAt(game, game.player.x, game.player.y);
  game.update(STEP, idle);
  assert.equal(game.lives, 2, 'invulnerable right after a hit');
});

test('the shield absorbs one hit and the last life ends the flight', () => {
  const { game } = newGame({ difficulty: 'easy' });
  assert.equal(game.shield, true);
  bulletAt(game, game.player.x, game.player.y);
  game.update(STEP, idle);
  assert.equal(game.shield, false);
  assert.equal(game.lives, 5);
  let saved = null;
  const last = new Game({ saveBest: (score, id) => { saved = [score, id]; } });
  last.reset('playing');
  last.lives = 1;
  last.score = last.best = 1234;
  bulletAt(last, last.player.x, last.player.y);
  last.update(STEP, idle);
  assert.equal(last.mode, 'gameover');
  assert.deepEqual(saved, [1234, 'normal']);
});

test('a nova clears the field into motes, hurts enemies and shields the pilot', () => {
  const { game } = newGame();
  dummy(game, 240, 200, 300);
  for (let i = 0; i < 20; i++) bulletAt(game, 50 + i * 10, 300);
  game.spawnBeam({ x: 0, y: 0, angle: 0, warn: 5 });
  assert.equal(game.useBomb(), true);
  assert.equal(game.bombs, 1);
  assert.equal(game.bullets.length, 0);
  assert.equal(game.beams.length, 0);
  assert.equal(game.motes.length, 20);
  assert.equal(game.enemies[0].hp, 300 - CONFIG.bombDamage);
  assert.ok(game.player.invulnerable >= CONFIG.bombInvulnerability);
  game.bombs = 0;
  assert.equal(game.useBomb(), false);
});

test('a beam is harmless while it warns and deadly while it burns', () => {
  const { game, events } = newGame();
  const p = game.player;
  game.spawnBeam({ x: p.x, y: 0, angle: Math.PI / 2, warn: 0.5, life: 0.5, width: 14 });
  run(game, 0.45, idle);
  assert.equal(game.lives, 3);
  run(game, 0.1, idle);
  assert.equal(game.lives, 2);
  assert.ok(events.some(e => e.type === 'beamWarn'));
  assert.ok(events.some(e => e.type === 'beamFire'));
  run(game, 1, idle);
  assert.equal(game.beams.length, 0);
});

test('riding beside a live beam grazes it continuously', () => {
  const { game } = newGame();
  const p = game.player;
  game.spawnBeam({ x: p.x + 18, y: 0, angle: Math.PI / 2, warn: 0.01, life: 1, width: 14 });
  run(game, 0.9, idle);
  assert.equal(game.lives, 3);
  assert.ok(game.stats.grazes >= 7);
  assert.ok(game.flux > 0);
});

test('beam distance is measured to the segment, not the infinite line', () => {
  const { game } = newGame();
  const beam = { x: 100, y: 100, angle: 0, length: 50 };
  assert.equal(game.beamDistance(beam, { x: 120, y: 110 }), 10);
  assert.equal(game.beamDistance(beam, { x: 90, y: 100 }), 10);
  assert.equal(game.beamDistance(beam, { x: 160, y: 100 }), 10);
});

test('nothing spawns on top of the pilot', () => {
  const { game } = newGame();
  const p = game.player;
  assert.equal(game.spawnBullet(p.x + 10, p.y - 10, 0, 100, '#fff'), null);
  assert.ok(game.spawnBullet(p.x, p.y - 200, 0, 100, '#fff'));
  const hard = newGame({ difficulty: 'hard' }).game;
  assert.equal(hard.spawnBullet(hard.player.x + 80, hard.player.y, 0, 100, '#fff'), null, 'extra modes never spawn level with the ship');
});

test('bullets can bounce once, curve, split and re-aim', () => {
  const { game } = newGame();
  const bouncer = game.spawnBullet(20, 100, Math.PI, 200, '#fff', 'diamond', 5, { bounce: 1 });
  run(game, 0.3, idle);
  assert.ok(bouncer.vx > 0);
  assert.equal(bouncer.bounce, 0);

  const curver = game.spawnBullet(240, 100, Math.PI / 2, 100, '#fff', 'orb', 5, { turn: 1, turnFor: 0.5 });
  run(game, 1, idle);
  assert.ok(Math.abs(Math.atan2(curver.vy, curver.vx) - (Math.PI / 2 + 0.5)) < 0.02, 'turns for half a second, then flies straight');

  const count = game.bullets.length;
  game.spawnBullet(240, 100, Math.PI / 2, 60, '#fff', 'heavy', 8, { stage: { at: 0.2, kind: 'split', count: 6, speed: 80, color: '#0ff', bulletKind: 'diamond' } });
  run(game, 0.3, idle);
  assert.equal(game.bullets.length, count + 6);

  const seeker = game.spawnBullet(100, 100, 0, 60, '#fff', 'heavy', 8, { accel: -200, vmin: 5, stage: { at: 0.4, kind: 'aim', speed: 150 } });
  run(game, 0.5, idle);
  const wanted = Math.atan2(game.player.y - seeker.y, game.player.x - seeker.x);
  assert.ok(Math.abs(Math.atan2(seeker.vy, seeker.vx) - wanted) < 0.05);
  assert.ok(Math.abs(Math.hypot(seeker.vx, seeker.vy) - 150) < 1);
});

test('the bullet limit is never exceeded', () => {
  const { game } = newGame();
  for (let i = 0; i < CONFIG.bulletLimit + 50; i++) game.spawnBullet(240, 100, 0, 0, '#fff');
  assert.equal(game.bullets.length, CONFIG.bulletLimit);
});

test('supplies upgrade the ship and pay a bonus when already full', () => {
  const { game } = newGame();
  const p = game.player;
  for (const type of ['power', 'bomb', 'shield', 'flux']) {
    game.spawnPickup(type, p.x, p.y);
    game.update(STEP, idle);
  }
  assert.equal(game.power, 2);
  assert.equal(game.bombs, 3);
  assert.equal(game.shield, true);
  assert.equal(game.flux, CONFIG.fluxSegment);
  assert.equal(game.score, 1000);
  game.power = CONFIG.maxPower;
  game.spawnPickup('power', p.x, p.y);
  game.update(STEP, idle);
  assert.equal(game.score, 1750);
  assert.throws(() => game.spawnPickup('cake', 0, 0), RangeError);
});

test('every fifteenth kill drops a rotating supply', () => {
  const { game } = newGame();
  for (let i = 0; i < 30; i++) {
    const e = game.spawnEnemy({ type: 'scout', x: 100, at: 0 });
    e.y = 200;
    game.damageEnemy(e, 999);
  }
  assert.deepEqual(game.pickups.map(p => p.type), ['power', 'flux']);
  assert.equal(game.stats.kills, 30);
});

test('pausing freezes the simulation', () => {
  const { game } = newGame();
  game.pause('focus');
  const time = game.time;
  game.update(1, firing);
  assert.equal(game.time, time);
  assert.equal(game.pauseReason, 'focus');
  game.resume();
  assert.equal(game.mode, 'playing');
});

test('the same seed and inputs replay identically', () => {
  const play = () => {
    const { game } = newGame({ seed: 7 });
    game.cheats.god = true;
    run(game, 40, (g, i) => ({ x: Math.sin(i / 90), y: 0, focus: false, shooting: true, pointer: null }));
    return [game.score, game.stats.kills, game.bullets.length, game.player.x];
  };
  assert.deepEqual(play(), play());
});
