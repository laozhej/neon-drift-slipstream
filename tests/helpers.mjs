import { Game } from '../src/sim/game.js';
import { STEP } from '../src/sim/config.js';

export function newGame(options = {}) {
  const events = [];
  const game = new Game({ onEvent: (type, data) => events.push({ type, ...data }), ...options });
  game.reset('playing', options.difficulty ?? 'normal', { sector: options.sector ?? 0 });
  events.length = 0;
  return { game, events };
}

export function run(game, seconds, input) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps && game.mode === 'playing'; i++) {
    game.update(STEP, typeof input === 'function' ? input(game, i) : input);
  }
}

export const idle = { x: 0, y: 0, focus: false, shooting: false, pointer: null };
export const firing = { ...idle, shooting: true };

// A bot that cannot dodge: it tracks the nearest target, fires constantly and
// drifts whenever it can. With god mode on it proves the campaign can be flown
// from the first wave to the last boss without the simulation breaking.
export function botInput(game) {
  const p = game.player;
  const target = game.nearestTarget(p.x, p.y, Infinity);
  const wanted = target ? target.x : 240 + Math.sin(game.time * 0.9) * 150;
  const dx = wanted - p.x;
  // A forward drift carries the ship up the field; fall back to the launch line afterwards.
  return { x: Math.abs(dx) < 4 ? 0 : Math.sign(dx), y: p.y < 596 ? 1 : 0, focus: Boolean(game.boss), shooting: true, pointer: null };
}
