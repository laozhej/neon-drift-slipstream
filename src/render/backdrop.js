import * as THREE from 'three';
import { linearColor, damp } from './util.js';
import { SECTORS } from '../sim/sectors.js';

// Everything behind and beneath the playfield: stars, the glass lane, and one
// environment per sector. The world streams towards +Z to sell forward flight.
const NOISE = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }
`;
const WORLD_VERTEX = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const random = (() => {
  let state = 987654321;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
})();
const range = (min, max) => min + random() * (max - min);

// ───────────────────────────── Stars and warp streaks ─────────────────────────────

function makeStars(count, { yMin, yMax, spread, size, tints }) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions.set([range(-spread, spread), range(yMin, yMax), range(-2600, 1400)], i * 3);
    const depth = (positions[i * 3 + 1] - yMin) / (yMax - yMin);       // 1 = near the field
    speeds[i] = 0.25 + depth * 0.9;
    sizes[i] = size * range(0.5, 1.4) * (0.6 + depth * 0.7);
    const tint = linearColor(tints[i % tints.length]);
    const gain = range(0.5, 1.3);
    colors.set([tint.r * gain, tint.g * gain, tint.b * gain], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(colors, 3));
  const uniforms = { uScroll: { value: 0 }, uScale: { value: 1 }, uGain: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSpeed; attribute float aSize; attribute vec3 aTint;
      uniform float uScroll; uniform float uScale;
      varying vec3 vTint;
      void main() {
        vec3 p = position;
        p.z = mod(p.z + uScroll * aSpeed + 2600.0, 4000.0) - 2600.0;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = aSize * uScale * (1400.0 / -view.z);
        vTint = aTint * smoothstep(-2600.0, -1800.0, p.z) * (1.0 - smoothstep(1100.0, 1400.0, p.z));
      }`,
    fragmentShader: /* glsl */`
      uniform float uGain;
      varying vec3 vTint;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vTint * uGain * exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return { points, uniforms };
}

function makeStreaks(count) {
  const positions = new Float32Array(count * 6);
  const ends = new Float32Array(count * 2);
  const speeds = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = range(-1500, 1500);
    const y = range(-900, -60);
    const z = range(-2600, 1400);
    positions.set([x, y, z, x, y, z], i * 6);
    ends.set([0, 1], i * 2);
    const speed = range(0.6, 1.4);
    speeds.set([speed, speed], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  const uniforms = { uScroll: { value: 0 }, uStretch: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aEnd; attribute float aSpeed;
      uniform float uScroll; uniform float uStretch;
      varying float vFade;
      void main() {
        vec3 p = position;
        p.z = mod(p.z + uScroll * aSpeed + 2600.0, 4000.0) - 2600.0 - aEnd * uStretch * aSpeed;
        vFade = (1.0 - aEnd) * smoothstep(-2600.0, -1600.0, p.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uStretch;
      varying float vFade;
      void main() { gl_FragColor = vec4(uColor * vFade * min(1.0, uStretch / 220.0) * 1.6, 1.0); }`,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = 3;
  return { lines, uniforms };
}

// ───────────────────────────── The glass lane ─────────────────────────────

function makeLane() {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(480, 3200).rotateX(-Math.PI / 2).translate(0, -0.6, -1140);
  const uniforms = { uColor: { value: new THREE.Color() }, uScroll: { value: 0 }, uDim: { value: 0.72 } };
  const glass = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uScroll; uniform float uDim;
      varying vec3 vWorld;
      void main() {
        float x = vWorld.x / 240.0;
        float ax = abs(x);
        float z = vWorld.z - uScroll;
        float far = smoothstep(-2700.0, -900.0, vWorld.z);
        float edge = smoothstep(0.86, 1.0, ax);
        float ticks = step(0.955, ax) * step(0.55, fract(z / 80.0));
        float columns = 1.0 - smoothstep(0.0, 0.010, abs(fract(x * 2.0 + 0.5) - 0.5));
        float rows = 1.0 - smoothstep(0.0, 0.012, abs(fract(z / 160.0) - 0.5));
        vec3 light = uColor * (edge * 0.05 + ticks * 0.34 + (columns + rows) * 0.022);
        gl_FragColor = vec4(light * far, uDim * far);
      }`,
  }));
  glass.renderOrder = 10;
  const railMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const railGeometry = new THREE.BoxGeometry(2.4, 2.4, 3200).translate(0, 0, -1140);
  const rails = [-241.2, 241.2].map(x => {
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.x = x;
    return rail;
  });
  group.add(glass, ...rails);
  return { group, uniforms, railMaterial };
}

// ───────────────────────────── Sector 01: Outer Orbit ─────────────────────────────

function makeOrbit() {
  const group = new THREE.Group();
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, depthWrite: false,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vWorld.xz * 0.00042 + vec2(0.0, -uTime * 0.012);
        float a = fbm(p * 1.6 + fbm(p * 2.4) * 0.8);
        float b = fbm(p * 3.1 + 9.0);
        vec3 col = vec3(0.004, 0.010, 0.022);
        col += vec3(0.006, 0.050, 0.060) * smoothstep(0.42, 0.85, a);
        col += vec3(0.046, 0.014, 0.075) * smoothstep(0.5, 0.9, b);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  nebula.position.y = -3200;
  nebula.renderOrder = 0;

  const planetUniforms = { uRim: { value: linearColor('#72f6e2').clone() }, uLight: { value: new THREE.Vector3(-0.5, 0.75, 0.35).normalize() } };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1150, 64, 40), new THREE.ShaderMaterial({
    uniforms: planetUniforms,
    vertexShader: /* glsl */`
      varying vec3 vNormalW; varying vec3 vWorld; varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uRim; uniform vec3 uLight;
      varying vec3 vNormalW; varying vec3 vWorld; varying vec3 vLocal;
      ${NOISE}
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.4);
        float lit = smoothstep(-0.25, 0.9, dot(n, uLight));
        float bands = fbm(vec2(vLocal.y * 0.006 + fbm(vLocal.xz * 0.003) * 0.9, atan(vLocal.z, vLocal.x) * 1.4));
        vec3 surface = mix(vec3(0.003, 0.008, 0.016), vec3(0.010, 0.042, 0.054), bands) * (0.12 + lit);
        gl_FragColor = vec4(surface + uRim * fres * (0.25 + lit) * 0.55, 1.0);
      }`,
  }));
  planet.position.set(1180, -2150, -820);

  const ring = new THREE.Mesh(new THREE.RingGeometry(1420, 2300, 128, 1), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: linearColor('#72f6e2').clone() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying float vRadius;
      void main() { vRadius = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vRadius;
      void main() {
        float t = (vRadius - 1420.0) / 880.0;
        float bands = 0.5 + 0.5 * sin(t * 70.0) * sin(t * 23.0 + 1.0);
        float body = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.85, 1.0, t));
        gl_FragColor = vec4(uColor * body * (0.018 + bands * 0.05), 1.0);
      }`,
  }));
  ring.position.copy(planet.position);
  ring.rotation.set(-Math.PI / 2 + 0.28, 0.2, 0);
  ring.renderOrder = 1;

  const count = 86;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0x2a3547, roughness: 0.95, metalness: 0.05, flatShading: true }), count);
  const rockData = Array.from({ length: count }, () => {
    // Keep the largest rocks away from directly under the lane.
    const y = range(-1000, -110);
    const size = range(10, 26) * (1 + Math.abs(y) / 420);
    return {
      x: range(-1500, 1500), y, z: range(-2600, 1400), speed: range(70, 150) * (1.2 - Math.abs(y) / 1400),
      scale: new THREE.Vector3(size * range(0.7, 1.3), size * range(0.6, 1.1), size * range(0.7, 1.3)),
      axis: new THREE.Vector3(range(-1, 1), range(-1, 1), range(-1, 1)).normalize(), spin: range(-0.6, 0.6), angle: range(0, 6.28),
    };
  });
  rocks.frustumCulled = false;
  group.add(nebula, planet, ring, rocks);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  return {
    group, fog: '#04101a', fogDensity: 0.00034,
    update(dt, time, speed) {
      nebula.material.uniforms.uTime.value = time;
      planet.rotation.y += dt * 0.012;
      for (let i = 0; i < count; i++) {
        const rock = rockData[i];
        rock.z += rock.speed * speed * dt;
        if (rock.z > 1400) rock.z -= 4000;
        rock.angle += rock.spin * dt;
        quaternion.setFromAxisAngle(rock.axis, rock.angle);
        matrix.compose(position.set(rock.x, rock.y, rock.z), quaternion, rock.scale);
        rocks.setMatrixAt(i, matrix);
      }
      rocks.instanceMatrix.needsUpdate = true;
    },
  };
}

// ───────────────────────────── Sector 02: Prism Reef ─────────────────────────────

function makeReef() {
  const group = new THREE.Group();
  const floorUniforms = { uScroll: { value: 0 }, uTime: { value: 0 } };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: floorUniforms, depthWrite: true,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */`
      uniform float uScroll; uniform float uTime;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vec2(vWorld.x, vWorld.z - uScroll) * 0.0016;
        float warp = fbm(p * 1.3 + uTime * 0.03);
        float veins = abs(fbm(p * 2.6 + warp * 1.4) - 0.5);
        float lines = 1.0 - smoothstep(0.0, 0.055, veins);
        float pools = smoothstep(0.45, 0.8, fbm(p * 0.7 + 4.0));
        vec3 col = vec3(0.004, 0.016, 0.040);
        col += vec3(0.020, 0.135, 0.250) * lines * (0.35 + pools * 0.6);
        col += vec3(0.20, 0.10, 0.48) * pools * 0.11;
        float fade = 1.0 - smoothstep(1800.0, 5200.0, length(vWorld.xz));
        gl_FragColor = vec4(mix(vec3(0.004, 0.014, 0.032), col, fade), 1.0);
      }`,
  }));
  floor.position.y = -880;

  const count = 130;
  const crystalGeometry = new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0);
  const crystalUniforms = {
    uDeep: { value: new THREE.Color(0.006, 0.03, 0.08) }, uBody: { value: linearColor('#1d5fa8').clone() },
    uGlow: { value: linearColor('#86cfff').clone() }, uAccent: { value: linearColor('#b5a3ff').clone() },
  };
  const crystals = new THREE.InstancedMesh(crystalGeometry, new THREE.ShaderMaterial({
    uniforms: crystalUniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld; varying float vHeight; varying float vHue;
      void main() {
        vHeight = position.y;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vHue = fract(instanceMatrix[3].x * 0.0137 + instanceMatrix[3].y * 0.0071);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep; uniform vec3 uBody; uniform vec3 uGlow; uniform vec3 uAccent;
      varying vec3 vWorld; varying float vHeight; varying float vHue;
      void main() {
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(n, v)), 2.0);
        float lit = 0.5 + 0.5 * dot(n, normalize(vec3(0.45, 0.7, 0.35)));
        vec3 glow = mix(uGlow, uAccent, step(0.6, vHue));
        vec3 col = mix(uDeep, uBody, vHeight) * (0.25 + lit * 0.75);
        col += glow * (fres * 0.55 + pow(vHeight, 4.0) * 0.9);
        float depth = smoothstep(-880.0, -500.0, vWorld.y);
        gl_FragColor = vec4(mix(vec3(0.004, 0.016, 0.040), col * 0.72, 0.25 + depth * 0.75), 1.0);
      }`,
  }), count);
  crystals.frustumCulled = false;
  const data = Array.from({ length: count }, () => {
    const height = range(180, 760);
    return { x: range(-1500, 1500), z: range(-2600, 1400), height, radius: height * range(0.07, 0.14),
      lean: new THREE.Euler(range(-0.22, 0.22), range(0, 6.28), range(-0.22, 0.22)) };
  });
  group.add(floor, crystals);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return {
    group, fog: '#041428', fogDensity: 0.0003,
    update(dt, time, speed, scroll) {
      floorUniforms.uScroll.value = scroll * 0.8;
      floorUniforms.uTime.value = time;
      for (let i = 0; i < count; i++) {
        const crystal = data[i];
        crystal.z += 96 * speed * dt;
        if (crystal.z > 1400) crystal.z -= 4000;
        quaternion.setFromEuler(crystal.lean);
        matrix.compose(position.set(crystal.x, -880, crystal.z), quaternion, scale.set(crystal.radius, crystal.height, crystal.radius));
        crystals.setMatrixAt(i, matrix);
      }
      crystals.instanceMatrix.needsUpdate = true;
    },
  };
}

// ───────────────────────────── Sector 03: Solar Forge ─────────────────────────────

function makeForge() {
  const group = new THREE.Group();
  const plasmaUniforms = { uScroll: { value: 0 }, uTime: { value: 0 } };
  const plasma = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: plasmaUniforms,
    vertexShader: WORLD_VERTEX,
    fragmentShader: /* glsl */`
      uniform float uScroll; uniform float uTime;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vec2(vWorld.x, vWorld.z - uScroll) * 0.0011;
        vec2 flow = vec2(fbm(p * 1.7 + uTime * 0.06), fbm(p * 1.3 - uTime * 0.05 + 7.0));
        float n = fbm(p * 1.9 + flow * 1.1);
        float cells = smoothstep(0.34, 0.72, n);
        float cracks = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
        vec3 col = mix(vec3(0.024, 0.0045, 0.001), vec3(0.095, 0.020, 0.002), cells);
        col += vec3(1.0, 0.60, 0.18) * pow(cells, 6.0) * 0.10;
        col += vec3(1.0, 0.40, 0.07) * cracks * 0.15;
        float fade = 1.0 - smoothstep(2200.0, 5600.0, length(vWorld.xz));
        gl_FragColor = vec4(mix(vec3(0.012, 0.002, 0.0), col, fade), 1.0);
      }`,
  }));
  plasma.position.y = -1050;

  // Half hoops under the lane: forge ribs that rush past and give the speed away.
  const ribs = [];
  const ribGeometry = new THREE.TorusGeometry(560, 11, 5, 22, Math.PI).rotateX(Math.PI);
  const seamGeometry = new THREE.TorusGeometry(560, 2.4, 4, 44, Math.PI).rotateX(Math.PI);
  const pylonGeometry = new THREE.BoxGeometry(26, 90, 26);
  const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.6, metalness: 0.4, flatShading: true,
    emissive: new THREE.Color(0.10, 0.03, 0.0) });
  const seamMaterial = new THREE.MeshBasicMaterial({ color: linearColor('#ffb45a').clone().multiplyScalar(1.25) });
  const SPACING = 640;
  const RIBS = 7;
  for (let i = 0; i < RIBS; i++) {
    const rib = new THREE.Group();
    const seam = new THREE.Mesh(seamGeometry, seamMaterial);
    seam.position.z = 12;
    rib.add(new THREE.Mesh(ribGeometry, ribMaterial), seam);
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeometry, ribMaterial);
      pylon.position.set(side * 560, 20, 0);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 30), seamMaterial);
      cap.position.set(side * 560, 66, 0);
      rib.add(pylon, cap);
    }
    rib.position.z = -2800 + i * SPACING;
    ribs.push(rib);
    group.add(rib);
  }
  group.add(plasma);

  return {
    group, fog: '#1c0802', fogDensity: 0.00028,
    update(dt, time, speed, scroll) {
      plasmaUniforms.uScroll.value = scroll * 0.9;
      plasmaUniforms.uTime.value = time;
      for (const rib of ribs) {
        rib.position.z += 330 * speed * dt;
        if (rib.position.z > 1500) rib.position.z -= SPACING * RIBS;
      }
    },
  };
}

// ───────────────────────────── Backdrop ─────────────────────────────

const STAR_TINTS = [
  ['#ffffff', '#bff7ff', '#72f6e2', '#c5b8ff'],
  ['#ffffff', '#86cfff', '#b5a3ff', '#82f6e9'],
  ['#ffffff', '#ffc479', '#ff9779', '#ffe9b0'],
];

export class Backdrop {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scroll = 0;
    this.speed = 1;          // 1 = cruise; the warp between sectors pushes it far higher
    this.warp = 0;
    this.sector = -1;
    this.stars = STAR_TINTS.map(tints => makeStars(900, { yMin: -1500, yMax: -70, spread: 1900, size: 2.3, tints }));
    this.dust = makeStars(260, { yMin: -70, yMax: -8, spread: 760, size: 1.3, tints: ['#ffffff'] });
    this.streaks = makeStreaks(520);
    this.lane = makeLane();
    this.environments = [makeOrbit(), makeReef(), makeForge()];
    for (const { points } of this.stars) this.group.add(points);
    this.group.add(this.dust.points, this.streaks.lines, this.lane.group);
    for (const environment of this.environments) this.group.add(environment.group);
    scene.add(this.group);
    scene.fog = new THREE.FogExp2(0x000000, 0.0003);
    this.setSector(0);
  }

  setSector(index) {
    if (index === this.sector) return;
    this.sector = index;
    const color = linearColor(SECTORS[index].color);
    this.environments.forEach((environment, i) => { environment.group.visible = i === index; });
    this.stars.forEach(({ points }, i) => { points.visible = i === index; });
    const environment = this.environments[index];
    this.scene.fog.color.copy(linearColor(environment.fog));
    this.scene.fog.density = environment.fogDensity;
    this.scene.background = linearColor(environment.fog).clone().multiplyScalar(0.55);
    this.lane.uniforms.uColor.value.copy(color);
    this.lane.railMaterial.color.copy(color).multiplyScalar(1.05);
    this.streaks.uniforms.uColor.value.copy(color).lerp(new THREE.Color(1, 1, 1), 0.5);
  }

  setPixelRatio(ratio) {
    for (const { uniforms } of this.stars) uniforms.uScale.value = ratio;
    this.dust.uniforms.uScale.value = ratio;
  }

  update(dt, time, warpTarget) {
    this.warp = damp(this.warp, warpTarget, warpTarget > this.warp ? 2.2 : 3.2, dt);
    this.speed = 1 + this.warp * 9;
    this.scroll += 150 * this.speed * dt;
    for (const { uniforms } of this.stars) {
      uniforms.uScroll.value = this.scroll;
      uniforms.uGain.value = 1 + this.warp * 0.8;
    }
    this.dust.uniforms.uScroll.value = this.scroll * 1.6;
    this.streaks.uniforms.uScroll.value = this.scroll * 1.2;
    this.streaks.uniforms.uStretch.value = this.warp * 900;
    this.streaks.lines.visible = this.warp > 0.02;
    this.lane.uniforms.uScroll.value = this.scroll * 1.6;
    this.environments[this.sector].update(dt, time, this.speed, this.scroll);
  }
}
