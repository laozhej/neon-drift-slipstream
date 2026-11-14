import * as THREE from 'three';
import { linearColor } from './util.js';

// One draw call for every bullet, shot, shard, mote and spark. Each instance is a
// camera-facing quad; the fragment shader paints the shape from its `kind`.
export const KIND = Object.freeze({
  orb: 0, diamond: 1, needle: 2, heavy: 3,      // hostile bullets: opaque core, dark rim
  shot: 4, spark: 5, mote: 6, shard: 7,          // friendly and cosmetic: additive light
  flash: 8, hitbox: 9, ring: 10,
});

const vertexShader = /* glsl */`
  attribute vec3 aPos;
  attribute vec2 aSize;
  attribute vec4 aMisc;   // rotation, kind, alpha, seed
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vKind;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vUv = position.xy;
    vColor = aColor;
    vKind = aMisc.y;
    vAlpha = aMisc.z;
    vSeed = aMisc.w;
    float c = cos(aMisc.x);
    float s = sin(aMisc.x);
    vec2 corner = position.xy * aSize;
    vec4 view = viewMatrix * vec4(aPos, 1.0);
    view.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    gl_Position = projectionMatrix * view;
  }
`;

// Output is premultiplied: rgb with alpha 0 adds light, alpha 1 covers what is
// behind it. Hostile bullets use both, so they stay readable over any backdrop.
const fragmentShader = /* glsl */`
  precision highp float;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vKind;
  varying float vAlpha;
  varying float vSeed;

  vec4 bullet(float d, float coreEdge, float bodyEdge) {
    float aa = fwidth(d) * 1.2 + 0.01;
    float core = 1.0 - smoothstep(coreEdge - aa, coreEdge + aa, d);
    float body = 1.0 - smoothstep(bodyEdge - aa, bodyEdge + aa, d);
    float rim = 1.0 - smoothstep(bodyEdge + 0.10 - aa, bodyEdge + 0.10 + aa, d);
    float halo = exp(-max(d - bodyEdge, 0.0) * 6.5) * 0.26;
    vec3 rgb = vColor * 1.12 * (body - core) + vec3(1.08) * core + vColor * halo * (1.0 - body);
    float alpha = max(body, rim * 0.72);
    return vec4(rgb, alpha);
  }

  void main() {
    vec2 uv = vUv;
    float r = length(uv);
    vec4 color;
    if (vKind < 0.5) {                       // orb
      color = bullet(r, 0.30, 0.58);
    } else if (vKind < 1.5) {                // diamond
      float d = (abs(uv.x) + abs(uv.y)) * 0.86;
      color = bullet(d, 0.26, 0.60);
    } else if (vKind < 2.5) {                // needle (quad is stretched along x)
      float d = length(vec2(uv.x * 0.92, uv.y));
      color = bullet(d, 0.34, 0.62);
    } else if (vKind < 3.5) {                // heavy
      float pulse = 0.04 * sin(uTime * 7.0 + vSeed * 6.283);
      vec4 outer = bullet(r, 0.22 + pulse, 0.62);
      float band = smoothstep(0.34, 0.38, r) * (1.0 - smoothstep(0.44, 0.48, r));
      outer.rgb += vec3(0.8) * band;
      color = outer;
    } else if (vKind < 4.5) {                // player shot
      float across = abs(uv.y);
      float along = abs(uv.x);
      float taper = 1.0 - smoothstep(0.55, 1.0, along);
      float beam = exp(-across * across * 14.0) * taper;
      float core = exp(-across * across * 90.0) * taper;
      color = vec4(vColor * beam * 0.8 + vec3(0.62) * core, 0.0);
    } else if (vKind < 5.5) {                // spark
      float glow = exp(-r * r * 5.0);
      color = vec4(vColor * glow * 1.25 + vec3(0.4) * exp(-r * r * 30.0), 0.0);
    } else if (vKind < 6.5) {                // mote: four-point glint
      float star = exp(-abs(uv.x) * 9.0 - abs(uv.y) * 1.2) + exp(-abs(uv.y) * 9.0 - abs(uv.x) * 1.2);
      float glow = exp(-r * r * 6.0);
      color = vec4(vColor * (star * 1.15 + glow * 0.5) * (1.0 - smoothstep(0.7, 1.0, r)), 0.0);
    } else if (vKind < 7.5) {                // shard
      float d = abs(uv.x) * 0.55 + abs(uv.y) * 1.5;
      float body = 1.0 - smoothstep(0.35, 0.60, d);
      float glow = exp(-r * r * 3.5);
      color = vec4(vColor * (body * 1.4 + glow * 0.5) + vec3(0.8) * (1.0 - smoothstep(0.08, 0.25, d)), 0.0);
    } else if (vKind < 8.5) {                // soft flash
      color = vec4(vColor * exp(-r * r * 3.2) * 1.15 * (1.0 - smoothstep(0.75, 1.0, r)), 0.0);
    } else if (vKind < 9.5) {                // the pilot's hitbox: always on top
      float aa = fwidth(r) * 1.2 + 0.01;
      float dot_ = 1.0 - smoothstep(0.30 - aa, 0.30 + aa, r);
      float ringD = abs(r - 0.66);
      float ring = 1.0 - smoothstep(0.07 - aa, 0.07 + aa, ringD);
      float dark = 1.0 - smoothstep(0.52 - aa, 0.52 + aa, r);
      color = vec4(vec3(1.5) * dot_ + vColor * 1.2 * ring, max(max(dot_, ring * 0.9), dark * 0.6));
    } else {                                 // thin ring
      float d = abs(r - 0.82);
      color = vec4(vColor * (1.0 - smoothstep(0.012, 0.05, d)) * 0.95, 0.0);
    }
    gl_FragColor = color * vAlpha;
  }
`;

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);

export class SpriteBatch {
  constructor(capacity, renderOrder = 50) {
    this.capacity = capacity;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity * 2);
    this.misc = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 3);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
    const dynamic = (array, itemSize) => {
      const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    geometry.setAttribute('aPos', dynamic(this.pos, 3));
    geometry.setAttribute('aSize', dynamic(this.size, 2));
    geometry.setAttribute('aMisc', dynamic(this.misc, 4));
    geometry.setAttribute('aColor', dynamic(this.color, 3));
    geometry.instanceCount = 0;
    this.uniforms = { uTime: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.geometry = geometry;
  }

  begin(time) {
    this.count = 0;
    this.uniforms.uTime.value = time;
  }

  // sx is the half extent along the rotation direction, sy across it.
  add(x, y, z, sx, sy, rotation, kind, hex, alpha = 1, seed = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const color = typeof hex === 'string' ? linearColor(hex) : hex;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i * 2] = sx; this.size[i * 2 + 1] = sy;
    this.misc[i * 4] = rotation; this.misc[i * 4 + 1] = kind; this.misc[i * 4 + 2] = alpha; this.misc[i * 4 + 3] = seed;
    this.color[i * 3] = color.r; this.color[i * 3 + 1] = color.g; this.color[i * 3 + 2] = color.b;
  }

  end() {
    const { geometry } = this;
    geometry.instanceCount = this.count;
    for (const name of ['aPos', 'aSize', 'aMisc', 'aColor']) {
      const attribute = geometry.attributes[name];
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
}
