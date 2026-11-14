// The selectable airframes. Each one reshapes how the same campaign is flown:
// where the guns point, how the wisps behave, and what a drift is good for.
// Everything here is plain data read by the simulation; the models live in the renderer.

// A lane is [x offset from the nose, sideways speed]. Shots always travel up the field.
const VECTOR_LANES = (power, focus) => {
  const lanes = [[-8, 0], [8, 0]];
  if (power >= 3) lanes.push([-18, focus ? -22 : -90], [18, focus ? 22 : 90]);
  if (power >= 4) lanes.push([-27, focus ? -40 : -165], [27, focus ? 40 : 165]);
  return lanes;
};
// Everything goes straight ahead: more barrels, never more width.
const HALBERD_LANES = power => {
  const lanes = [[-5, 0], [5, 0]];
  if (power >= 3) lanes.push([-12, 0], [12, 0]);
  if (power >= 4) lanes.push([0, 0]);
  return lanes;
};
// A fan from the first shot; focusing folds it forward.
const MIRAGE_LANES = (power, focus) => {
  const lanes = [[0, 0], [-10, focus ? -18 : -78], [10, focus ? 18 : 78]];
  if (power >= 3) lanes.push([-18, focus ? -38 : -160], [18, focus ? 38 : 160]);
  if (power >= 4) lanes.push([-25, focus ? -60 : -250], [25, focus ? 60 : 250]);
  return lanes;
};

export const SHIPS = Object.freeze([
  {
    id: 'vector', color: '#7affea',
    speed: 270, focusSpeed: 112,
    shotDamage: 8, shotInterval: 0.09, lanes: VECTOR_LANES,
    // Wisps seek when loose and fire straight bolts when focused.
    wisp: { interval: 0.3, focusInterval: 0.15, damage: 5, homing: 4.6, loose: 'dart', focused: 'bolt' },
    drift: { duration: 0.22, pointerDuration: 0.36, speed: 720, radius: 38, ram: 36 },
    grazeRadius: 20, fluxGain: 1, shardDamage: 9,
  },
  {
    // The heavy: slow, all guns forward, and a long drift that hits like a ram.
    id: 'halberd', color: '#ffd27a',
    speed: 236, focusSpeed: 100,
    shotDamage: 10, shotInterval: 0.1, lanes: HALBERD_LANES,
    wisp: { interval: 0.2, focusInterval: 0.2, damage: 6, homing: 0, loose: 'bolt', focused: 'bolt' },
    drift: { duration: 0.3, pointerDuration: 0.44, speed: 720, radius: 42, ram: 96 },
    grazeRadius: 18, fluxGain: 0.9, shardDamage: 9,
  },
  {
    // The skirmisher: fast, wide and light, built to graze and to turn bullets around.
    id: 'mirage', color: '#9fb4ff',
    speed: 312, focusSpeed: 128,
    shotDamage: 6, shotInterval: 0.08, lanes: MIRAGE_LANES,
    wisp: { interval: 0.24, focusInterval: 0.24, damage: 5, homing: 7, loose: 'dart', focused: 'dart' },
    drift: { duration: 0.2, pointerDuration: 0.34, speed: 760, radius: 40, ram: 30 },
    grazeRadius: 27, fluxGain: 1.2, shardDamage: 12,
  },
].map(ship => Object.freeze({ ...ship, wisp: Object.freeze(ship.wisp), drift: Object.freeze(ship.drift) })));

export function getShip(id) {
  return SHIPS.find(ship => ship.id === id) ?? SHIPS[0];
}
