import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, STEP } from '../src/sim/config.js';
import { SHIPS, getShip } from '../src/sim/ships.js';
import { DIFFICULTIES } from '../src/sim/difficulty.js';
import { newGame, run, idle, firing, botInput } from './helpers.mjs';

test('three airframes are offered, and an unknown one falls back to the first', () => {
  assert.deepEqual(SHIPS.map(ship => ship.id), ['vector', 'halberd', 'mirage']);
  assert.equal(getShip('nonsense'), SHIPS[0]);
  assert.equal(newGame({ ship: 'nonsense' }).game.ship.id, 'vector');
  assert.equal(new Set(SHIPS.map(ship => ship.color)).size, SHIPS.length, 'each has its own colour');
});

test('the chosen airframe survives a restart and can be changed for the next flight', () => {
  const { game } = newGame({ ship: 'mirage' });
  game.reset('playing');
  assert.equal(game.ship.id, 'mirage');
  game.reset('playing', 'normal', { ship: 'halberd' });
  assert.equal(game.ship.id, 'halberd');
});

for (const ship of SHIPS) {
  test(`${ship.id}: flies at its own speed, fires its own lanes and deals its own damage`, () => {
    const { game } = newGame({ ship: ship.id });
    const x = game.player.x;
    run(game, 0.5, { ...idle, x: 1 });
    assert.ok(Math.abs(game.player.x - Math.min(480 - 17, x + ship.speed * 0.5)) < 1);
    run(game, 0.5, { ...idle, x: -1, focus: true });
    assert.ok(Math.abs(game.player.x - (Math.min(480 - 17, x + ship.speed * 0.5) - ship.focusSpeed * 0.5)) < 1);

    for (const power of [1, 3, 4]) {
      for (const focus of [false, true]) {
        const lanes = ship.lanes(power, focus);
        assert.ok(lanes.length >= 2 && lanes.length <= 7);
        // Every pattern is mirror-symmetric, so no airframe pulls to one side.
        const key = ([dx, vx]) => `${dx},${vx}`;
        const set = new Set(lanes.map(key));
        for (const [dx, vx] of lanes) assert.ok(set.has(key([-dx || 0, -vx || 0])), `${ship.id} power ${power} is symmetric`);
      }
    }
    game.shots.length = 0;
    game.player.shotTimer = 0;
    game.update(STEP, firing);
    assert.equal(game.shots.length, ship.lanes(1, false).length);
    assert.equal(game.shots[0].dmg, ship.shotDamage);
  });

  test(`${ship.id}: wisps and drift follow its rig`, () => {
    const { game } = newGame({ ship: ship.id });
    game.cheats.god = true;
    game.power = 2;
    game.spawnEnemy({ type: 'sentinel', x: 240, at: 0 });
    run(game, 1, firing);
    const loose = game.shots.filter(shot => shot.kind !== 'main');
    assert.ok(loose.length > 0 && loose.every(shot => shot.kind === ship.wisp.loose), `loose wisps fire ${ship.wisp.loose}s`);
    game.shots.length = 0;
    run(game, 0.6, { ...firing, focus: true });
    const tight = game.shots.filter(shot => shot.kind !== 'main');
    assert.ok(tight.length > 0 && tight.every(shot => shot.kind === ship.wisp.focused), `focused wisps fire ${ship.wisp.focused}s`);

    // A drift straight up covers the rig's distance and rams for the rig's damage.
    game.enemies.length = 0;
    game.shots.length = 0;
    game.flux = CONFIG.fluxSegment;
    game.player.x = 240;
    game.player.y = 600;
    const target = game.spawnEnemy({ type: 'sentinel', x: 240, at: 0 });
    target.y = 600 - ship.drift.speed * ship.drift.duration * 0.5;
    target.speed = 0;
    target.fireInterval = 0;
    target.hp = target.maxHp = 500;
    assert.ok(game.useDrift(idle));
    run(game, ship.drift.duration + STEP, idle);
    assert.ok(Math.abs(600 - game.player.y - ship.drift.speed * ship.drift.duration) < 12);
    assert.equal(target.hp, 500 - ship.drift.ram);
  });

  test(`${ship.id}: graze reach and flux gain are its own`, () => {
    const { game } = newGame({ ship: ship.id });
    const p = game.player;
    // One bullet just inside the reach, one just outside; neither can hit.
    const inside = game.spawnBullet(p.x + 60, p.y - 200, 0, 0, '#fff');
    const outside = game.spawnBullet(p.x - 60, p.y - 200, 0, 0, '#fff');
    for (const bullet of [inside, outside]) { bullet.vx = 0; bullet.vy = 0; bullet.y = p.y; }
    inside.x = p.x + ship.grazeRadius + inside.r - 1;
    outside.x = p.x - ship.grazeRadius - outside.r - 1;
    game.update(STEP, idle);
    assert.equal(inside.grazed, true);
    assert.equal(outside.grazed, false);
    assert.equal(game.lives, 3);
    assert.ok(Math.abs(game.flux - CONFIG.fluxPerGraze * ship.fluxGain) < 1e-9);

    // A flux cell is worth exactly one segment on every airframe.
    game.flux = 0;
    game.spawnPickup('flux', p.x, p.y);
    game.update(STEP, idle);
    assert.ok(Math.abs(game.flux - CONFIG.fluxSegment) < 1e-6);
  });
}

// The airframes differ in feel, not in whether the game can be finished.
for (const ship of SHIPS.slice(1)) {
  for (const { id } of DIFFICULTIES) {
    test(`the campaign can be flown to victory in the ${ship.id} on ${id}`, () => {
      const { game } = newGame({ difficulty: id, ship: ship.id });
      game.cheats.god = true;
      const limit = 14 * 60;
      while (game.mode === 'playing' && game.time < limit) {
        const input = botInput(game);
        if (game.fluxSegments > 0 && game.bullets.length > 12) game.useDrift(input);
        game.update(STEP, input);
      }
      assert.equal(game.mode, 'victory', `finished in ${Math.round(game.time)}s`);
      assert.equal(game.ship.id, ship.id);
    });
  }
}

test('boss fights last a comparable time on every airframe', () => {
  const times = {};
  for (const ship of SHIPS) {
    const { game } = newGame({ ship: ship.id });
    game.cheats.god = true;
    game.power = 3;
    game.stageTime = game.sector.duration;
    const started = game.time;
    while (game.mode === 'playing' && game.intermission === 0 && game.time < 300) game.update(STEP, botInput(game));
    times[ship.id] = game.time - started;
  }
  const values = Object.values(times);
  assert.ok(Math.max(...values) / Math.min(...values) < 1.6, `boss times ${JSON.stringify(times)}`);
});
