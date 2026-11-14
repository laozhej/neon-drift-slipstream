import * as THREE from 'three';
import { poly, fanSolid, merge, placed, tube, linearColor } from './util.js';
import { ENEMY_TYPES } from '../sim/sectors.js';

// Every model is built in code from a handful of facets: no asset files to load.
// The pilot's ship points up the screen (−Z); hostiles point down it (+Z).
const cache = new Map();
const once = (name, build) => {
  if (!cache.has(name)) cache.set(name, build());
  return cache.get(name);
};
const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => placed(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const TAU = Math.PI * 2;

// ───────────────────────────── Pilot ─────────────────────────────

// Nose, wing tips, tail notch, spine and keel: six points make a faceted dart.
const dart = (N, L, R, T, S, B) => poly([[N, S, L], [N, R, S], [L, S, T], [S, R, T], [N, L, B], [N, B, R], [L, T, B], [B, T, R]]);

// Each airframe: its silhouette and where its two engines sit.
const AIRFRAMES = {
  // The original delta: twin gun rails and canted wingtip fins.
  vector: {
    engines: 5.5,
    geometry: () => merge(dart([0, 0, -22], [-15, -1.5, 12], [15, -1.5, 12], [0, 0, 5], [0, 5.5, 0], [0, -3.5, 2]),
      box(2.2, 2.2, 13, -8, 0.6, -6), box(2.2, 2.2, 13, 8, 0.6, -6),
      box(1.2, 6, 8, -14.2, 1.6, 9, 0, 0, 0.35), box(1.2, 6, 8, 14.2, 1.6, 9, 0, 0, -0.35)),
  },
  // A long narrow spear between two forward lances, with stub wings and a tail fin.
  halberd: {
    engines: 3.6,
    geometry: () => merge(dart([0, 0, -30], [-7, -1.5, 13], [7, -1.5, 13], [0, 0, 8], [0, 5.5, 2], [0, -3.5, 4]),
      box(1.8, 1.8, 24, -8.5, 0.3, -8), box(1.8, 1.8, 24, 8.5, 0.3, -8),
      box(3, 1, 3, -7, 0.2, 2), box(3, 1, 3, 7, 0.2, 2),
      fanSolid([[6, 0, 5], [20, 0, 16], [6, 0, 14]], [9, 1.5, 11], [9, -1, 11]),
      fanSolid([[-6, 0, 14], [-20, 0, 16], [-6, 0, 5]], [-9, 1.5, 11], [-9, -1, 11]),
      fanSolid([[0, 3, 4], [0, 9.5, 15], [0, 3, 14]], [0.8, 5, 11], [-0.8, 5, 11])),
  },
  // A wide swept crescent with a deep tail notch, engine pods and upturned tips.
  mirage: {
    engines: 9,
    geometry: () => merge(dart([0, 0, -16], [-25, -1, 10], [25, -1, 10], [0, 0, -2], [0, 4.5, -5], [0, -3, -4]),
      box(3.2, 3.2, 11, -9, 0.2, 4), box(3.2, 3.2, 11, 9, 0.2, 4),
      box(1.2, 6.5, 8, -24.4, 2, 8.5, 0, 0, 0.5), box(1.2, 6.5, 8, 24.4, 2, 8.5, 0, 0, -0.5),
      box(7, 1, 3, -6.5, 0.6, -10, 0, 0.3, 0), box(7, 1, 3, 6.5, 0.6, -10, 0, -0.3, 0)),
  },
};
const shipGeometry = id => once(`ship:${id}`, AIRFRAMES[id].geometry);

// `ship` is an entry of the simulation's SHIPS table: its id picks the airframe, its colour the light.
export function makeShip(ship) {
  const { id, color } = ship;
  const airframe = AIRFRAMES[id] ?? AIRFRAMES.vector;
  const group = new THREE.Group();
  const hull = tube(shipGeometry(AIRFRAMES[id] ? id : 'vector'), color, { glow: 2.0, width: 2.1, bodyGlow: 0.09 });
  const bank = new THREE.Group();        // rolls and pitches; the outer group only translates
  bank.add(hull.group);

  const flameMaterial = new THREE.MeshBasicMaterial({ color: linearColor(color).clone(),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeometry = once('flame', () => placed(new THREE.ConeGeometry(2.6, 16, 6, 1, true), 0, 0, 8, Math.PI / 2));
  const flames = [-airframe.engines, airframe.engines].map(x => {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(x, 0, 6);
    bank.add(flame);
    return flame;
  });

  const shield = tube(once('shield', () => new THREE.IcosahedronGeometry(25, 1)), '#8dbdff', { glow: 1.3, width: 1.2, threshold: 1 });
  shield.mesh.visible = false;
  shield.group.visible = false;

  const wisps = [0, 1].map(() => {
    const wisp = tube(once('wisp', () => new THREE.OctahedronGeometry(5.2)), color, { glow: 2.2, width: 1.6, bodyGlow: 0.5 });
    wisp.group.visible = false;
    return wisp;
  });

  // Ghost outlines left behind by a drift: tubes only, fading out.
  const ghosts = Array.from({ length: 7 }, () => {
    const ghost = tube(shipGeometry(AIRFRAMES[id] ? id : 'vector'), color, { glow: 1.6, width: 1.6 });
    ghost.mesh.visible = false;
    ghost.lineMaterial.transparent = true;
    ghost.lineMaterial.depthWrite = false;
    ghost.group.visible = false;
    ghost.life = 0;
    return ghost;
  });

  group.add(bank, shield.group);
  // Colours the renderer reuses every frame: the airframe's own light, a pale
  // version for drifts and overdrive, and a dim one for the close-up wake.
  const light = linearColor(color).clone();
  const pale = light.clone().lerp(new THREE.Color(1, 1, 1), 0.62);
  const dim = light.clone().multiplyScalar(0.13);
  return { id, group, bank, hull, flames, flameMaterial, shield, wisps, ghosts, engines: airframe.engines, light, pale, dim };
}

// ───────────────────────────── Hostiles ─────────────────────────────

const ENEMY_GEOMETRY = {
  scout: () => fanSolid([[0, 0, 15], [12, 0, -9], [0, 0, -4], [-12, 0, -9]], [0, 4.5, -3], [0, -2.5, -3]),
  dart: () => fanSolid([[0, 0, 12], [7, 0, -7], [0, 0, -3], [-7, 0, -7]], [0, 3, -3], [0, -2, -3]),
  hunter: () => merge(placed(new THREE.OctahedronGeometry(1).scale(12, 5.5, 17)),
    box(3.4, 3.4, 15, -12, 0, 6), box(3.4, 3.4, 15, 12, 0, 6), box(26, 2.4, 5, 0, 0, -3), box(8, 6, 6, 0, 1, -13)),
  weaver: () => merge(fanSolid([[0, 0, 13], [24, 0, 3], [15, 0, -11], [0, 0, -4], [-15, 0, -11], [-24, 0, 3]], [0, 5.5, 0], [0, -3, 0]),
    box(4, 4, 8, -19, 0, 7), box(4, 4, 8, 19, 0, 7)),
  striker: () => fanSolid([[0, 0, 21], [5, 0, 4], [17, 0, -12], [4, 0, -8], [0, 0, -15], [-4, 0, -8], [-17, 0, -12], [-5, 0, 4]],
    [0, 4.5, -2], [0, -2.5, -2]),
  sentinel: () => merge(new THREE.CylinderGeometry(22, 24, 7, 6), box(7, 4, 7, 0, 0, 23), box(7, 4, 7, 20, 0, -11.5), box(7, 4, 7, -20, 0, -11.5)),
  lancer: () => merge(box(20, 9, 14, 0, 0, -10), box(7, 7, 34, 0, 0, 8), box(38, 3, 7, 0, 0, -13),
    box(3, 10, 12, -19, 2, -12), box(3, 10, 12, 19, 2, -12)),
  bloom: () => new THREE.IcosahedronGeometry(13, 0),
};

const sentinelCore = () => once('sentinelCore', () => new THREE.OctahedronGeometry(9));
const bloomPetals = () => once('bloomPetals', () => {
  const petals = [];
  for (let k = 0; k < 6; k++) {
    const petal = new THREE.ConeGeometry(4.5, 14, 4);
    petal.rotateZ(-Math.PI / 2);
    petal.translate(19, 0, 0);
    petal.rotateY(k * TAU / 6);
    petals.push(petal);
  }
  return merge(...petals);
});

export function makeEnemy(type) {
  const color = ENEMY_TYPES[type].color;
  const group = new THREE.Group();
  const bank = new THREE.Group();
  group.add(bank);
  const body = tube(once(`enemy:${type}`, ENEMY_GEOMETRY[type]), color);
  bank.add(body.group);
  const tubes = [body];
  let spinner = null;
  if (type === 'sentinel') {
    const core = tube(sentinelCore(), color, { glow: 2.2, bodyGlow: 0.45 });
    core.group.position.y = 8;
    bank.add(core.group);
    tubes.push(core);
    spinner = core.group;
  } else if (type === 'bloom') {
    const petals = tube(bloomPetals(), color, { glow: 1.9 });
    bank.add(petals.group);
    tubes.push(petals);
    spinner = petals.group;
  }
  return { type, group, bank, tubes, spinner, lastX: 0, roll: 0 };
}

// ───────────────────────────── Bosses ─────────────────────────────

function dreadnought() {
  const root = new THREE.Group();
  const hullGeometry = once('boss0', () => merge(
    fanSolid([[0, 0, 46], [26, 0, 30], [40, 0, 4], [30, 0, -30], [10, 0, -40], [-10, 0, -40], [-30, 0, -30], [-40, 0, 4], [-26, 0, 30]],
      [0, 14, -4], [0, -9, -4]),
    box(18, 8, 24, 0, 11, -14), box(150, 4, 8, 0, 1, 4),
    ...[-1, 1].flatMap(s => [box(17, 11, 40, s * 74, 2, 6), box(6, 6, 26, s * 74, 2, 34), box(3, 15, 18, s * 84, 6, -6)]),
  ));
  const hull = tube(hullGeometry, '#ff7397', { glow: 1.8, width: 2.2 });
  const core = tube(once('gem', () => new THREE.OctahedronGeometry(10)), '#ffbe69', { glow: 2.6, bodyGlow: 0.9 });
  core.group.position.set(0, 14, 18);
  root.add(hull.group, core.group);
  return { root, hull, core, tubes: [hull, core], parts: null, spinners: [[core.group, 'y', 1.6]] };
}

function mirrorWarden() {
  const root = new THREE.Group();
  const hull = tube(once('boss1', () => merge(
    new THREE.OctahedronGeometry(1).scale(24, 18, 40), new THREE.CylinderGeometry(31, 31, 4, 6), box(70, 3, 5, 0, 0, 0),
  )), '#86cfff', { glow: 1.8, width: 2.2 });
  const core = tube(once('gem', () => new THREE.OctahedronGeometry(10)), '#86cfff', { glow: 2.6, bodyGlow: 0.9 });
  core.group.position.set(0, 22, 0);
  const halo = tube(once('halo1', () => new THREE.TorusGeometry(47, 2, 4, 6).rotateX(Math.PI / 2)), '#b5a3ff', { glow: 1.6, width: 1.6 });
  const halo2 = tube(once('halo2', () => new THREE.TorusGeometry(39, 1.5, 4, 8).rotateX(Math.PI / 2)), '#82f6e9', { glow: 1.6, width: 1.4 });
  halo2.group.rotation.z = 0.5;
  root.add(hull.group, core.group, halo.group, halo2.group);
  const mirrorGeometry = once('mirror', () => merge(
    new THREE.CylinderGeometry(19, 19, 3, 6).rotateX(Math.PI / 2 - 0.55), box(4, 4, 14, 0, -6, -10)));
  const parts = [0, 1].map(() => {
    const mirror = tube(mirrorGeometry, '#d8f6ff', { glow: 2.0, width: 1.8, bodyGlow: 0.5 });
    return mirror;
  });
  return { root, hull, core, tubes: [hull, core, halo, halo2, ...parts], parts,
    spinners: [[core.group, 'y', 1.8], [halo.group, 'y', 0.5], [halo2.group, 'y', -0.8]] };
}

function helixCrown() {
  const root = new THREE.Group();
  const crownGeometry = once('boss2', () => {
    const spikes = [];
    for (let k = 0; k < 8; k++) {
      const spike = new THREE.ConeGeometry(5, 24, 4);
      spike.rotateZ(-Math.PI / 2 + 0.35);
      spike.translate(46, 5, 0);
      spike.rotateY(k * TAU / 8);
      spikes.push(spike);
    }
    return merge(new THREE.TorusGeometry(38, 3.4, 4, 8).rotateX(Math.PI / 2), ...spikes);
  });
  const hull = tube(crownGeometry, '#ffc479', { glow: 1.9, width: 2.2 });
  const core = tube(once('sun', () => new THREE.IcosahedronGeometry(20, 1)), '#ffb978', { glow: 2.2, bodyGlow: 1.5, width: 1.4 });
  const arcGeometry = once('arc', () => new THREE.TorusGeometry(55, 1.7, 4, 14, Math.PI * 0.7).rotateX(Math.PI / 2));
  const arcA = tube(arcGeometry, '#ff819b', { glow: 1.7, width: 1.5 });
  const arcB = tube(arcGeometry, '#f8d989', { glow: 1.7, width: 1.5 });
  arcB.group.rotation.y = Math.PI;
  arcA.group.position.y = 6;
  arcB.group.position.y = -4;
  root.add(hull.group, core.group, arcA.group, arcB.group);
  const orbiterGeometry = once('orbiter', () => merge(new THREE.OctahedronGeometry(11), new THREE.TorusGeometry(15, 1.3, 4, 8).rotateX(Math.PI / 2)));
  const parts = [0, 1].map(() => tube(orbiterGeometry, '#ff819b', { glow: 2.0, width: 1.7, bodyGlow: 0.5 }));
  return { root, hull, core, tubes: [hull, core, arcA, arcB, ...parts], parts,
    spinners: [[hull.group, 'y', 0.35], [core.group, 'y', -0.9], [arcA.group, 'y', 1.3], [arcB.group, 'y', -1.1]] };
}

export function makeBoss(variant) {
  return [dreadnought, mirrorWarden, helixCrown][variant]();
}

// ───────────────────────────── Supplies ─────────────────────────────

export const PICKUP_STYLE = Object.freeze({
  power: { color: '#7affea', letter: 'P' },
  bomb: { color: '#ffcc82', letter: 'N' },
  shield: { color: '#8dbdff', letter: 'S' },
  flux: { color: '#d29bff', letter: 'F' },
});

function letterTexture(letter, color) {
  return once(`letter:${letter}`, () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const context = canvas.getContext('2d');
    context.font = '700 62px "Bahnschrift", "DIN Alternate", "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = color;
    context.shadowBlur = 14;
    context.fillStyle = '#ffffff';
    context.fillText(letter, 48, 52);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

export function makePickup(type) {
  const { color, letter } = PICKUP_STYLE[type];
  const group = new THREE.Group();
  const token = tube(once('token', () => new THREE.OctahedronGeometry(11)), color, { glow: 2.0, width: 1.8, bodyGlow: 0.35 });
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(letter, color), depthTest: false, transparent: true }));
  label.scale.set(17, 17, 1);
  label.renderOrder = 45;
  group.add(token.group, label);
  return { type, group, token, label };
}
