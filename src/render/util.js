import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { WIDTH, HEIGHT } from '../sim/config.js';

// The simulation's 480 × 720 field lies on the world XZ plane, centred on the
// origin. Logical y grows down the screen, which is +Z towards the camera.
export const fieldX = x => x - WIDTH / 2;
export const fieldZ = y => y - HEIGHT / 2;

// Hex strings are parsed once into linear working-space colours.
const colorCache = new Map();
export function linearColor(hex) {
  let color = colorCache.get(hex);
  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }
  return color;
}

// Flat-shaded solid from explicit triangles.
export function poly(faces) {
  const positions = new Float32Array(faces.length * 9);
  faces.forEach((face, i) => face.forEach((vertex, j) => positions.set(vertex, i * 9 + j * 3)));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A double pyramid over an outline: the quickest way to a faceted hull.
export function fanSolid(rim, top, bottom) {
  const faces = [];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % rim.length];
    faces.push([top, a, b], [bottom, b, a]);
  }
  return poly(faces);
}

// Merges primitives and hand-built solids into one non-indexed geometry.
export function merge(...geometries) {
  const parts = geometries.map(geometry => {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    part.deleteAttribute('uv');
    if (!part.attributes.normal) part.computeVertexNormals();
    return part;
  });
  return mergeGeometries(parts, false);
}

export const placed = (geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  if (rx || ry || rz) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  geometry.translate(x, y, z);
  return geometry;
};

const tubeGeometryCache = new WeakMap();
function edgeLines(geometry, threshold) {
  let lines = tubeGeometryCache.get(geometry);
  if (!lines) {
    const edges = new THREE.EdgesGeometry(geometry, threshold);
    lines = new LineSegmentsGeometry().setPositions(edges.attributes.position.array);
    edges.dispose();
    tubeGeometryCache.set(geometry, lines);
  }
  return lines;
}

// The house style: a dark glass body whose edges are lit neon tubes. Each model
// asks for a relative `glow`; TUBE_GAIN sets how bright that is on screen, just
// above the bloom threshold so an edge reads as lit without flooding its surroundings.
const TUBE_GAIN = 0.62;
export const tubeSettings = { pixelRatio: 1 };
const tubeMaterials = new Set();
export function setTubePixelRatio(ratio) {
  tubeSettings.pixelRatio = ratio;
  for (const material of tubeMaterials) material.linewidth = material.userData.width * ratio;
}

export function tube(geometry, hex, { glow = 1.7, width = 1.8, threshold = 18, body = 0x0a1020, bodyGlow = 0.1 } = {}) {
  const color = linearColor(hex).clone();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: body, roughness: 0.42, metalness: 0.25, flatShading: true, side: THREE.DoubleSide,
    emissive: color.clone().multiplyScalar(bodyGlow),
    // Faces sit a hair behind their own edges, so the tubes never z-fight.
    polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2,
  });
  const lineMaterial = new LineMaterial({ color: 0xffffff, linewidth: width * tubeSettings.pixelRatio });
  lineMaterial.color.copy(color).multiplyScalar(glow * TUBE_GAIN);
  lineMaterial.userData.width = width;
  tubeMaterials.add(lineMaterial);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, bodyMaterial);
  const lines = new LineSegments2(edgeLines(geometry, threshold), lineMaterial);
  group.add(mesh, lines);
  return {
    group, mesh, lines, bodyMaterial, lineMaterial, base: color, glow,
    // 0 = resting colour, 1 = white hit flash; dim scales the tube brightness.
    tint(flash = 0, dim = 1) {
      lineMaterial.color.copy(color).multiplyScalar(glow * dim * TUBE_GAIN);
      if (flash > 0) lineMaterial.color.lerp(WHITE_HOT, flash);
      bodyMaterial.emissive.copy(color).multiplyScalar(bodyGlow * dim + flash * 0.9);
    },
    recolor(hexColor) {
      color.copy(linearColor(hexColor));
    },
    dispose() {
      tubeMaterials.delete(lineMaterial);
      lineMaterial.dispose();
      bodyMaterial.dispose();
    },
  };
}

const WHITE_HOT = new THREE.Color(1.5, 1.5, 1.5);

export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const smooth = t => t * t * (3 - 2 * t);
