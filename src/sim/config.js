// Logical pixels and seconds. The simulation always runs on a 480 × 720 field,
// whatever the 3D camera does with it. These values are the main tuning knobs.
export const WIDTH = 480;
export const HEIGHT = 720;
export const STEP = 1 / 120;

export const CONFIG = Object.freeze({
  // Ship. Speeds, guns, wisps, drift and graze reach are per airframe: see ships.js.
  // playerSpeed is the reference the pointer speeds below were tuned against.
  playerSpeed: 270,
  pointerSpeed: 1000,
  pointerFocusSpeed: 320,
  playerRadius: 3,
  hitInvulnerability: 2,
  hitClearRadius: 140,
  maxLives: 5,
  maxBombs: 5,

  // Main gun and wisps (option drones)
  shotSpeed: 700,
  maxPower: 4,
  wispDartSpeed: 470,
  wispBoltSpeed: 760,

  // Nova bomb
  bombInvulnerability: 2.5,
  bombDamage: 220,

  // Hostile fire
  bossBulletSpeed: 135,
  bulletLimit: 900,
  spawnSafeRadius: 58,

  // Supplies
  pickupSpeed: 68,
  pickupCollectRadius: 22,
  pickupMagnetRadius: 74,

  // Graze
  grazeScore: 25,

  // Flux and Drift: graze fills the gauge, each segment buys one drift.
  fluxMax: 300,
  fluxSegment: 100,
  fluxPerGraze: 7,
  fluxPerKill: 2,
  fluxPerMote: 1.5,
  fluxPerBeamTick: 3,
  driftPointerSpeed: 1500,
  driftGrace: 0.3,
  driftRefundAt: 8,
  driftRefund: 40,
  overdriveDamage: 1.3,

  // Converted bullets
  shardSpeed: 540,
  shardLife: 2.4,
  shardLimit: 90,
  moteLimit: 160,
  moteScore: 40,

  // Chain multiplier
  chainMax: 8,
  chainHold: 2.5,
  chainDecay: 0.35,
  chainPerGraze: 0.025,
  chainPerConvert: 0.02,

  intermissionDuration: 4,
});
