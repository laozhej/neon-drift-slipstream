import * as THREE from 'three';
import { SpriteBatch, KIND } from './sprites.js';
import { fieldX, fieldZ, linearColor } from './util.js';

// Cosmetic layers driven by simulation events: sparks, shockwave rings and the
// beams' light. None of it feeds back into gameplay.
const MAX_PARTICLES = 2600;
const MAX_RINGS = 36;
const MAX_BEAMS = 14;

const ringShader = {
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor; uniform float uAlpha; uniform float uWidth;
    varying vec2 vUv;
    void main() {
      float r = length(vUv);
      float front = 1.0 - smoothstep(0.965, 1.0, r);
      float tail = smoothstep(1.0 - uWidth * 2.6, 0.965, r);
      float band = (pow(tail, 5.0) + tail * 0.12) * front;
      float wash = (1.0 - smoothstep(0.0, 0.965, r)) * 0.025;
      gl_FragColor = vec4(uColor * (band + wash) * uAlpha, 1.0);
    }`,
};

const beamShader = {
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // uv.x runs along the beam, uv.y across it. While warning it is a thin, dashed
  // tracer inside a faint band that shows exactly how wide the burn will be.
  fragmentShader: /* glsl */`
    uniform vec3 uColor; uniform float uActive; uniform float uProgress; uniform float uTime; uniform float uLength; uniform float uCore;
    varying vec2 vUv;
    void main() {
      float across = abs(vUv.y - 0.5) * 2.0;
      float along = vUv.x * uLength;
      float nearFade = smoothstep(0.0, 14.0, along);
      vec3 col;
      if (uActive < 0.5) {
        float dash = step(0.45, fract(along / 26.0 - uTime * 3.0));
        float line = 1.0 - smoothstep(0.0, 0.07, across);
        float band = (1.0 - smoothstep(uCore * 0.9, uCore, across)) * 0.10;
        float urgency = 0.45 + 0.55 * uProgress;
        float blink = 0.7 + 0.3 * sin(uTime * (10.0 + uProgress * 34.0));
        col = uColor * (line * dash * 1.2 * urgency * blink + band * (0.4 + uProgress));
      } else {
        float fadeOut = smoothstep(0.0, 0.25, 1.0 - uProgress);
        float flicker = 0.88 + 0.12 * sin(uTime * 61.0 + along * 0.05);
        float core = 1.0 - smoothstep(uCore * 0.35, uCore * 0.8, across);
        float glow = exp(-across * across * 5.0);
        col = (vec3(1.5) * core + uColor * glow * 1.5) * flicker * fadeOut;
      }
      gl_FragColor = vec4(col * nearFade, 1.0);
    }`,
};

export class Effects {
  constructor(scene) {
    this.sparks = new SpriteBatch(MAX_PARTICLES + 64, 46);
    scene.add(this.sparks.mesh);

    // Particles: structure of arrays, swap-removed when they expire.
    this.count = 0;
    this.px = new Float32Array(MAX_PARTICLES); this.py = new Float32Array(MAX_PARTICLES); this.pz = new Float32Array(MAX_PARTICLES);
    this.vx = new Float32Array(MAX_PARTICLES); this.vy = new Float32Array(MAX_PARTICLES); this.vz = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES); this.maxLife = new Float32Array(MAX_PARTICLES);
    this.size = new Float32Array(MAX_PARTICLES); this.drag = new Float32Array(MAX_PARTICLES);
    this.kind = new Uint8Array(MAX_PARTICLES);
    this.tint = new Array(MAX_PARTICLES);

    const ringGeometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: MAX_RINGS }, () => {
      const uniforms = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uWidth: { value: 0.1 } };
      const mesh = new THREE.Mesh(ringGeometry, new THREE.ShaderMaterial({
        ...ringShader, uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      mesh.visible = false;
      mesh.renderOrder = 30;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, uniforms, life: 0, maxLife: 1, radius: 1, from: 0 };
    });

    const beamGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.beams = Array.from({ length: MAX_BEAMS }, () => {
      const uniforms = { uColor: { value: new THREE.Color() }, uActive: { value: 0 }, uProgress: { value: 0 },
        uTime: { value: 0 }, uLength: { value: 1000 }, uCore: { value: 0.4 } };
      const mesh = new THREE.Mesh(beamGeometry, new THREE.ShaderMaterial({
        ...beamShader, uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      mesh.visible = false;
      mesh.renderOrder = 34;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, uniforms };
    });
  }

  clear() {
    this.count = 0;
    for (const ring of this.rings) { ring.life = 0; ring.mesh.visible = false; }
  }

  // World-space particle. `y` is height above the field.
  particle(x, y, z, vx, vy, vz, life, size, color, kind = KIND.spark, drag = 2.4) {
    if (this.count >= MAX_PARTICLES) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size; this.drag[i] = drag; this.kind[i] = kind;
    this.tint[i] = typeof color === 'string' ? linearColor(color) : color;
  }

  // Sparks thrown outward and a little upward from a logical field position.
  burst(x, y, color, count, speed, { life = 0.5, size = 4, lift = 0.5, height = 6 } = {}) {
    const wx = fieldX(x);
    const wz = fieldZ(y);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.25 + Math.random() * 0.75);
      this.particle(wx, height, wz, Math.cos(angle) * velocity, (Math.random() - 0.25) * velocity * lift, Math.sin(angle) * velocity,
        life * (0.45 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), color);
    }
  }

  flash(x, y, color, size, life = 0.16, height = 8) {
    this.particle(fieldX(x), height, fieldZ(y), 0, 0, 0, life, size, color, KIND.flash, 0);
  }

  ring(x, y, radius, life, color, { width = 0.1, from = 0 } = {}) {
    let slot = this.rings[0];
    for (const ring of this.rings) {
      if (ring.life <= 0) { slot = ring; break; }
      if (ring.life / ring.maxLife < slot.life / slot.maxLife) slot = ring;
    }
    slot.life = slot.maxLife = life;
    slot.radius = radius;
    slot.from = from;
    slot.uniforms.uColor.value.copy(typeof color === 'string' ? linearColor(color) : color);
    slot.uniforms.uWidth.value = width;
    slot.mesh.position.set(fieldX(x), 2, fieldZ(y));
    slot.mesh.visible = true;
  }

  update(dt) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
          this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last]; this.drag[i] = this.drag[last]; this.kind[i] = this.kind[last];
          this.tint[i] = this.tint[last];
        }
        continue;
      }
      const slow = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= slow; this.vy[i] *= slow; this.vz[i] *= slow;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
    }
    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) { ring.mesh.visible = false; continue; }
      const t = 1 - ring.life / ring.maxLife;
      const eased = 1 - (1 - t) ** 3;
      const radius = ring.from + (ring.radius - ring.from) * eased;
      ring.mesh.scale.set(radius, 1, radius);
      ring.uniforms.uAlpha.value = (1 - t) ** 1.5 * 1.05;
    }
  }

  draw(time) {
    const batch = this.sparks;
    batch.begin(time);
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.maxLife[i];
      const kind = this.kind[i];
      if (kind === KIND.spark) {
        // Fast sparks stretch along their heading.
        const speed = Math.hypot(this.vx[i], this.vz[i]);
        const stretch = 1 + Math.min(3, speed * 0.012);
        const size = this.size[i] * (0.35 + t * 0.65);
        batch.add(this.px[i], this.py[i], this.pz[i], size * stretch, size, Math.atan2(-this.vz[i], this.vx[i]), kind, this.tint[i], Math.min(1, t * 2.5));
      } else {
        const size = this.size[i] * (kind === KIND.flash ? 1.3 - t * 0.5 : 1);
        batch.add(this.px[i], this.py[i], this.pz[i], size, size, 0, kind, this.tint[i], t);
      }
    }
  }

  // Mirrors the simulation's beams onto the pooled quads and returns the muzzle
  // points so the caller can add flares to its sprite batch.
  syncBeams(beams, time, batch) {
    let used = 0;
    for (const beam of beams) {
      if (beam.dead || used >= MAX_BEAMS) continue;
      const { mesh, uniforms } = this.beams[used++];
      const active = beam.warn <= 0;
      const width = active ? beam.width * 2.8 : beam.width * 1.25;
      mesh.visible = true;
      mesh.position.set(fieldX(beam.x), 5, fieldZ(beam.y));
      mesh.rotation.y = -beam.angle;
      mesh.scale.set(beam.length, 1, width);
      uniforms.uColor.value.copy(linearColor(beam.color));
      uniforms.uActive.value = active ? 1 : 0;
      uniforms.uProgress.value = active ? 1 - beam.life / beam.lifeTotal : 1 - beam.warn / beam.warnTotal;
      uniforms.uTime.value = time;
      uniforms.uLength.value = beam.length;
      // The lethal core is 0.8 × width; express it as a fraction of the quad.
      uniforms.uCore.value = active ? (beam.width * 0.8) / width : (beam.width * 0.8) / width;
      const charge = active ? 1 : 1 - beam.warn / beam.warnTotal;
      const flare = active ? beam.width * 2.4 : 6 + charge * beam.width * 1.2;
      batch.add(fieldX(beam.x), 7, fieldZ(beam.y), flare, flare, 0, KIND.flash, beam.color, active ? 0.8 : 0.2 + charge * 0.3);
    }
    for (let i = used; i < MAX_BEAMS; i++) this.beams[i].mesh.visible = false;
  }
}
