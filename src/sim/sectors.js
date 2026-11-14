// Enemy roster and the authored campaign. All times are stage seconds; the gaps
// between groups are deliberate recovery windows. Boss patterns live in bosses.js.

// The first five silhouettes come from the original game. Lancer, bloom and dart
// are new: a beam emitter, a pod that bursts into drift bait, and fast popcorn.
export const ENEMY_TYPES = Object.freeze({
  scout:    { hp: 24, r: 14, speed: 145, fireInterval: 0, drift: 0, score: 100, chain: 0.05, color: '#ff719c' },
  hunter:   { hp: 40, r: 18, speed: 62, fireInterval: 1.85, drift: 0, score: 200, chain: 0.08, color: '#ffca76' },
  weaver:   { hp: 56, r: 21, speed: 55, fireInterval: 2.55, drift: 20, score: 300, chain: 0.1, color: '#d797ff' },
  striker:  { hp: 48, r: 17, speed: 112, fireInterval: 1.55, drift: 55, score: 250, chain: 0.1, color: '#ff9779' },
  sentinel: { hp: 112, r: 25, speed: 40, fireInterval: 2.85, drift: 12, score: 450, chain: 0.15, color: '#86cfff' },
  lancer:   { hp: 96, r: 20, speed: 150, fireInterval: 2.6, drift: 0, score: 400, chain: 0.15, color: '#c9ff8a',
              path: 'hold', holdY: 128, holdTime: 6.4 },
  bloom:    { hp: 72, r: 22, speed: 46, fireInterval: 0, drift: 26, score: 350, chain: 0.12, color: '#ff8ad8' },
  dart:     { hp: 14, r: 10, speed: 255, fireInterval: 0, drift: 0, score: 80, chain: 0.04, color: '#ff5d7a',
              path: 'dive' },
});

// A group is [at, type, xs, tuning, stagger]. It expands into plain spawn records,
// so the simulation only ever consumes a sorted schedule.
//   path 'fall'  – enters above the field and descends (the original behaviour)
//   path 'rise'  – surfaces out of the depth at (x, y), then descends
//   path 'swoop' – crosses the field in an arc from one side (x is ignored)
//   path 'hold'  – parks at holdY, fights for holdTime seconds, then withdraws
//   path 'dive'  – flies a straight line at the pilot's position at launch
function build(groups) {
  const result = [];
  for (const [at, type, xs, tuning = {}, stagger = 0.34] of groups) {
    xs.forEach((x, index) => result.push({
      at: at + index * stagger, type, x, phase: index * 1.45, ...tuning,
    }));
  }
  return Object.freeze(result.sort((a, b) => a.at - b.at).map(Object.freeze));
}

const swoop = (side, y, extra = {}) => ({ path: 'swoop', side, y, ...extra });
const rise = (y, extra = {}) => ({ path: 'rise', y, ...extra });

const orbitWaves = build([
  // 0–26 s: learn the silhouettes, aimed fire, and enemies surfacing from below.
  [2, 'scout', [80, 145, 210, 275, 340]],
  [6.5, 'scout', [400, 335, 270, 205, 140]],
  [11, 'dart', [70, 410, 150, 330], {}, 0.22],
  [14.5, 'hunter', [130, 350]],
  [18.5, 'scout', [105, 240, 375], rise(96), 0.3],
  [21.5, 'hunter', [180, 300]],
  [24.5, 'scout', [70, 165, 315, 410], { speed: 155 }],
  // 27–31 s: breathing room. The first flux segment is usually banked by now.
  [32, 'scout', [0, 0, 0, 0, 0], swoop(-1, 110), 0.26],
  [36, 'weaver', [165, 315], { fireInterval: 2.7 }],
  [40, 'scout', [0, 0, 0, 0, 0], swoop(1, 150), 0.26],
  [44, 'hunter', [90, 240, 390], { fireInterval: 1.75 }],
  [48, 'bloom', [240]],
  [51.5, 'dart', [80, 400, 160, 320, 240], {}, 0.2],
  [54.5, 'weaver', [120, 360]],
  // 58–62 s: regroup before the first beams.
  [63, 'lancer', [140, 340], {}, 1.1],
  [67, 'scout', [75, 155, 240, 325, 405], { speed: 170 }],
  [71, 'hunter', [105, 240, 375], rise(104, { speed: 44 }), 0.4],
  [75.5, 'bloom', [130, 350]],
  [79, 'weaver', [90, 240, 390], { speed: 62, drift: 16, fireInterval: 2.6 }, 0.7],
  [83, 'scout', [0, 0, 0, 0], swoop(-1, 120), 0.26],
  [84.3, 'scout', [0, 0, 0, 0], swoop(1, 170), 0.26],
  [87.5, 'lancer', [240]],
  [89, 'hunter', [120, 360], { speed: 76, fireInterval: 1.6 }],
  [91.5, 'dart', [60, 420, 130, 350, 200, 280], {}, 0.18],
  // 94–100 s: warning and a clean transition to the boss arena.
]);

const reefWaves = build([
  [2, 'scout', [0, 0, 0, 0], swoop(-1, 100), 0.26],
  [5, 'striker', [125, 355]],
  [9, 'hunter', [105, 240, 375], rise(100, { speed: 46 }), 0.35],
  [13, 'scout', [400, 300, 200, 100], { speed: 180 }],
  [16.5, 'striker', [100, 240, 380]],
  [20, 'bloom', [160, 320]],
  [23.5, 'weaver', [155, 325]],
  // 27–31 s
  [31, 'sentinel', [140, 340]],
  [35, 'dart', [50, 430, 110, 370, 170, 310], {}, 0.16],
  [38.5, 'striker', [0, 0, 0], swoop(1, 90, { amp: 110 }), 0.5],
  [42, 'lancer', [110, 370], {}, 0.9],
  [46, 'hunter', [100, 240, 380]],
  [49.5, 'sentinel', [240], rise(120, { speed: 30 })],
  // 53–57 s
  [57, 'striker', [110, 240, 370]],
  [60.5, 'weaver', [125, 355]],
  [63.5, 'bloom', [90, 240, 390], {}, 0.5],
  [67, 'sentinel', [115, 365]],
  [70.5, 'scout', [0, 0, 0, 0, 0], swoop(-1, 110), 0.24],
  [71.3, 'scout', [0, 0, 0, 0, 0], swoop(1, 180), 0.24],
  [74, 'lancer', [240, 120, 360], {}, 0.7],
  [77, 'striker', [160, 320]],
  // 80–84 s: warning
]);

const forgeWaves = build([
  [2, 'striker', [125, 355]],
  [5.5, 'dart', [60, 420, 120, 360, 180, 300, 240, 240], {}, 0.14],
  [9, 'sentinel', [150, 330]],
  [13, 'scout', [0, 0, 0, 0, 0], swoop(-1, 100), 0.24],
  [13.8, 'scout', [0, 0, 0, 0, 0], swoop(1, 170), 0.24],
  [16.5, 'hunter', [105, 240, 375], { fireInterval: 1.7 }],
  [19.5, 'lancer', [90, 390], {}, 0.6],
  [22.5, 'striker', [100, 240, 380]],
  [26, 'bloom', [120, 240, 360], {}, 0.45],
  // 30–33 s
  [33, 'weaver', [105, 375]],
  [36, 'striker', [0, 0, 0, 0], swoop(-1, 90, { amp: 120 }), 0.45],
  [40, 'sentinel', [100, 240, 380], {}, 0.9],
  [45.5, 'scout', [75, 155, 325, 405], { speed: 210 }],
  [48, 'hunter', [145, 335], rise(110, { speed: 48 })],
  [51, 'lancer', [240]],
  // 55–58 s
  [58, 'sentinel', [145, 335]],
  [61.5, 'striker', [100, 240, 380]],
  [65, 'weaver', [120, 360]],
  [68, 'bloom', [80, 400]],
  [69.5, 'dart', [60, 420, 140, 340, 210, 270], {}, 0.16],
  [72, 'lancer', [130, 350, 240], {}, 0.7],
  [76, 'scout', [400, 320, 240, 160, 80], { speed: 210 }],
  [79, 'striker', [120, 360]],
  [82, 'hunter', [170, 310]],
  // 86–90 s: warning
]);

const supplies = events => Object.freeze(events.map(([at, type, x]) => Object.freeze({ at, type, x })));
const sector = data => Object.freeze({
  ...data,
  sections: Object.freeze(data.sections.map(Object.freeze)),
  phases: Object.freeze(data.phases.map(Object.freeze)),
});

export const SUPPLY_TYPES = Object.freeze(['power', 'flux', 'shield', 'bomb']);

export const SECTORS = Object.freeze([
  sector({
    id: 'orbit', name: 'OUTER ORBIT', label: 'SECTOR 01', duration: 100,
    bossName: 'DREADNOUGHT', color: '#72f6e2', bossHealth: 7800,
    waves: orbitWaves,
    sections: [
      { at: 0, label: '01 · OUTER ORBIT' }, { at: 31, label: '02 · SIGNAL INTERFERENCE' },
      { at: 62, label: '03 · NEON CURRENT' }, { at: 95, label: 'WARNING · HOSTILE CORE' },
    ],
    phases: [
      { name: 'VECTOR LOCK', subtitle: 'Aimed fans and wing rails · keep moving', color: '#ffbe69' },
      { name: 'PULSE BLOOM', subtitle: 'Expanding rings · find the opening', color: '#ff72cb' },
      { name: 'EVENT HORIZON', subtitle: 'Curving spirals · drift through the arms', color: '#b19bff' },
    ],
    supplies: supplies([[9, 'power', 240], [29, 'flux', 170], [47, 'shield', 310], [60, 'power', 240], [78, 'bomb', 170], [94, 'flux', 300]]),
  }),
  sector({
    id: 'reef', name: 'PRISM REEF', label: 'SECTOR 02', duration: 84,
    bossName: 'MIRROR WARDEN', color: '#86cfff', bossHealth: 8600,
    waves: reefWaves,
    sections: [
      { at: 0, label: '01 · GLASS TIDE' }, { at: 30, label: '02 · MIRROR FIELD' },
      { at: 56, label: '03 · SHATTERED LIGHT' }, { at: 80, label: 'WARNING · MIRROR WARDEN' },
    ],
    phases: [
      { name: 'MIRROR FAN', subtitle: 'Twin fans rebound off the walls', color: '#86cfff' },
      { name: 'CRYSTAL RAIN', subtitle: 'Falling curtains · follow the open lane', color: '#b5a3ff' },
      { name: 'REFRACTION', subtitle: 'Rings and splitting prisms · find the opening', color: '#82f6e9' },
    ],
    supplies: supplies([[4, 'power', 240], [26, 'shield', 170], [40, 'flux', 300], [52, 'bomb', 310], [72, 'power', 240]]),
  }),
  sector({
    id: 'forge', name: 'SOLAR FORGE', label: 'SECTOR 03', duration: 90,
    bossName: 'HELIX CROWN', color: '#ffc479', bossHealth: 9600,
    waves: forgeWaves,
    sections: [
      { at: 0, label: '01 · EMBER TRAIL' }, { at: 32, label: '02 · FUSION CHAMBER' },
      { at: 57, label: '03 · CROWN GATE' }, { at: 86, label: 'WARNING · HELIX CROWN' },
    ],
    phases: [
      { name: 'SOLAR FLARE', subtitle: 'Sweeping arcs and a flare beam · stay wide', color: '#ffb978' },
      { name: 'ORBITAL CROWN', subtitle: 'Orbiting emitters · watch both sides', color: '#ff819b' },
      { name: 'HELIX STORM', subtitle: 'Twin spirals · breathe between pulses', color: '#f8d989' },
    ],
    supplies: supplies([[5, 'power', 240], [28, 'shield', 310], [44, 'flux', 170], [54, 'bomb', 170], [74, 'shield', 240], [84, 'flux', 240]]),
  }),
]);
