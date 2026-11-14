import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WIDTH, HEIGHT, CONFIG } from '../sim/config.js';
import { SECTORS } from '../sim/sectors.js';
import { fieldX, fieldZ, linearColor, damp, clamp, setTubePixelRatio } from './util.js';
import { SpriteBatch, KIND } from './sprites.js';
import { Backdrop } from './backdrop.js';
import { Effects } from './effects.js';
import { makeShip, makeEnemy, makeBoss, makePickup, PICKUP_STYLE } from './models.js';

const BASE_FOV = 32;
const BASE_TILT = 0.31;       // radians from straight down: the "behind the ship" lean
const DRAMA_TILT = 0.5;       // boss entrances lean further back
const PLANE = 5;              // bullets and the pilot's hitbox share one height: no parallax between them
const FLUX = '#d29bff';
const BLOOM_AT_FULL = 0.95;    // bloom strength when the glow setting is at 100 %

// Last pass before tone mapping: lens fringe on impact, vignette, screen flash.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uAberration: { value: 0.0012 }, uVignette: { value: 0.42 },
    uFlash: { value: new THREE.Color(1, 1, 1) }, uFlashAmount: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uAberration; uniform float uVignette; uniform vec3 uFlash; uniform float uFlashAmount;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 offset = d * uAberration * (0.5 + r2 * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + offset).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - offset).b);
      col *= 1.0 - uVignette * smoothstep(0.18, 0.75, r2);
      col += uFlash * uFlashAmount;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, { quality = 'high', cameraMode = 'dynamic', shake = true, glow = 0.4, brightness = 0.5 } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.glow = glow;
    this.brightness = brightness;
    this.cameraMode = cameraMode;
    this.shakeEnabled = shake;
    this.time = 0;
    this.frame = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 20, 16000);
    this.scratch = new THREE.PerspectiveCamera(BASE_FOV, 1, 20, 16000);
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLANE);
    this.v3 = new THREE.Vector3();
    this.v2 = new THREE.Vector2();

    this.scene.add(new THREE.HemisphereLight(0xc8dcff, 0x0c1424, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-0.6, 1, 0.55);
    this.rim = new THREE.DirectionalLight(0xffffff, 1.8);
    this.rim.position.set(0.8, 0.35, -0.7);
    this.scene.add(key, this.rim);

    this.backdrop = new Backdrop(this.scene);
    this.effects = new Effects(this.scene);
    this.friendly = new SpriteBatch(800, 48);
    this.hostile = new SpriteBatch(CONFIG.bulletLimit + 40, 52);
    this.top = new SpriteBatch(24, 60);
    this.scene.add(this.friendly.mesh, this.hostile.mesh, this.top.mesh);

    this.ships = new Map();        // airframe id → its models, built the first time it is flown
    this.ship = null;
    this.ghostTimer = 0;
    this.trail = 0;

    this.enemyVisuals = new Map();
    this.enemyPool = new Map();
    this.pickupVisuals = new Map();
    this.pickupPool = new Map();
    this.bossVisuals = [];
    this.dying = null;

    // Camera state. `cam` is what is on screen; every frame it eases to a goal.
    this.cam = { tilt: 1.12, yaw: 0, logDist: Math.log(120), tx: 0, ty: 6, tz: 250, fov: 40, roll: 0 };
    this.orbit = 0;
    this.drama = 0;
    this.fovKick = 0;
    this.shake = 0;
    this.aberration = 0;
    this.flashAmount = 0;
    this.endTimer = 0;
    this.lastMode = 'title';
    this.fits = { base: { dist: 1400, tz: 0 }, drama: { dist: 1500, tz: 0 }, flat: { dist: 1400, tz: 0 } };
    this.fieldRect = null;

    this.buildComposer();
    this.resize();
  }

  // ───────────────────────────── Setup ─────────────────────────────

  pixelRatio() {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.25 : 1;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  buildComposer() {
    this.composer?.dispose();
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.4, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.applyLight();
  }

  // Glow is how far light spills around bright things; brightness is the exposure of the whole picture.
  applyLight() {
    this.bloom.strength = this.glow * BLOOM_AT_FULL;
    this.bloom.enabled = this.quality !== 'low' && this.glow > 0.005;
    this.renderer.toneMappingExposure = 0.62 + this.brightness * 0.76;
  }

  setOptions({ quality, cameraMode, shake, glow, brightness }) {
    if (cameraMode) this.cameraMode = cameraMode;
    if (typeof shake === 'boolean') this.shakeEnabled = shake;
    if (typeof glow === 'number') this.glow = clamp(glow, 0, 1);
    if (typeof brightness === 'number') this.brightness = clamp(brightness, 0, 1);
    this.applyLight();
    if (quality && quality !== this.quality) {
      this.quality = quality;
      this.buildComposer();
      this.resize();
    }
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const ratio = this.pixelRatio();
    this.width = width;
    this.height = height;
    this.aspect = width / height;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.backdrop.setPixelRatio(ratio * height / 900);
    setTubePixelRatio(ratio * clamp(height / 900, 0.8, 2));
    this.camera.aspect = this.aspect;
    this.fits.base = this.fit(BASE_TILT);
    this.fits.drama = this.fit(DRAMA_TILT);
    this.fits.flat = this.fit(0);
    this.measureField();
  }

  pose(camera, c, shakeX = 0, shakeY = 0) {
    const st = Math.sin(c.tilt), ct = Math.cos(c.tilt), sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    camera.position.set(c.tx + c.dist * st * sy, c.ty + c.dist * ct, c.tz + c.dist * st * cy);
    camera.up.set(-ct * sy, st, -ct * cy);
    camera.lookAt(c.tx, c.ty, c.tz);
    if (c.roll) camera.rotateZ(c.roll);
    if (shakeX || shakeY) { camera.translateX(shakeX); camera.translateY(shakeY); }
  }

  // Finds the camera distance and look-at point that frame the whole 480 × 720
  // field for a given lean, whatever the window's shape.
  fit(tilt) {
    const camera = this.scratch;
    camera.fov = BASE_FOV;
    camera.aspect = this.aspect;
    camera.updateProjectionMatrix();
    const v = this.v3;
    const measure = (dist, tz) => {
      this.pose(camera, { tilt, yaw: 0, dist, tx: 0, ty: 0, tz, roll: 0 });
      camera.updateMatrixWorld();
      const top = v.set(0, PLANE, -HEIGHT / 2).project(camera).y;
      const bottom = v.set(0, PLANE, HEIGHT / 2).project(camera).y;
      const side = Math.max(Math.abs(v.set(WIDTH / 2, PLANE, HEIGHT / 2).project(camera).x), Math.abs(v.set(WIDTH / 2, PLANE, -HEIGHT / 2).project(camera).x));
      return { top, bottom, side };
    };
    let near = 300;
    let far = 12000;
    let tz = 0;
    for (let i = 0; i < 30; i++) {
      const dist = (near + far) / 2;
      let low = -340;
      let high = 340;
      let result;
      for (let j = 0; j < 22; j++) {
        tz = (low + high) / 2;
        result = measure(dist, tz);
        if (result.top + result.bottom > 0) high = tz; else low = tz;
      }
      if (result.top <= 0.945 && result.side <= 0.965) far = dist; else near = dist;
    }
    measure(far, tz);
    return { dist: far, tz };
  }

  // Where the field's corners land on screen at rest, for the interface layout.
  measureField() {
    const camera = this.scratch;
    const flat = this.cameraMode === 'flat';
    const fit = flat ? this.fits.flat : this.fits.base;
    this.pose(camera, { tilt: flat ? 0 : BASE_TILT, yaw: 0, dist: fit.dist, tx: 0, ty: 0, tz: fit.tz, roll: 0 });
    camera.updateMatrixWorld();
    const corner = (x, z) => {
      const v = this.v3.set(x, PLANE, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
    };
    this.fieldRect = {
      topLeft: corner(-WIDTH / 2, -HEIGHT / 2), topRight: corner(WIDTH / 2, -HEIGHT / 2),
      bottomLeft: corner(-WIDTH / 2, HEIGHT / 2), bottomRight: corner(WIDTH / 2, HEIGHT / 2),
    };
    return this.fieldRect;
  }

  // Cursor position → logical field coordinates on the bullet plane.
  screenToField(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.v2.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.v2, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.v3);
    return hit ? { x: hit.x + WIDTH / 2, y: hit.z + HEIGHT / 2 } : null;
  }

  fieldToScreen(x, y, height = PLANE) {
    const v = this.v3.set(fieldX(x), height, fieldZ(y)).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  // ───────────────────────────── Simulation events ─────────────────────────────

  kick(shake = 0, aberration = 0) {
    if (this.shakeEnabled) this.shake = Math.max(this.shake, shake);
    this.aberration = Math.max(this.aberration, aberration);
  }

  flash(color, amount) {
    this.finish.uniforms.uFlash.value.copy(typeof color === 'string' ? linearColor(color) : color);
    this.flashAmount = Math.max(this.flashAmount, amount);
  }

  onEvent(type, d, game) {
    const fx = this.effects;
    const SHIP = game.ship.color;
    const PALE = this.shipVisual(game.ship).pale;
    switch (type) {
      case 'start':
        fx.clear();
        this.dying = null;
        this.endTimer = 0;
        this.flash(SHIP, 0.2);
        break;
      case 'sector':
        this.flash('#ffffff', 0.7);
        this.kick(5, 0.012);
        break;
      case 'spark':
        fx.burst(d.x, d.y, d.color, d.big ? 12 : 2, d.big ? 260 : 150, { life: d.big ? 0.4 : 0.2, size: d.big ? 4 : 2.8 });
        if (d.big) fx.flash(d.x, d.y, d.color, 30, 0.14);
        break;
      case 'explode': {
        const big = d.size > 19;
        fx.burst(d.x, d.y, d.color, Math.round(10 + d.size * 0.9), big ? 330 : 240, { life: big ? 0.7 : 0.5, size: big ? 5 : 4 });
        fx.burst(d.x, d.y, '#ffffff', 5, 120, { life: 0.3, size: 3 });
        fx.flash(d.x, d.y, d.color, d.size * 2.6, 0.2);
        fx.ring(d.x, d.y, d.size * (big ? 4.2 : 3), big ? 0.45 : 0.32, d.color, { width: 0.16 });
        this.kick(big ? 3 : 1.2);
        break;
      }
      case 'graze':
        fx.burst(d.x, d.y, PALE, 2, 190, { life: 0.22, size: 2.6, lift: 1.2 });
        break;
      case 'convert':
        fx.flash(d.x, d.y, d.color, 15, 0.2);
        fx.burst(d.x, d.y, '#ffffff', 2, 130, { life: 0.25, size: 2.4 });
        break;
      case 'drift':
        fx.ring(d.x, d.y, 70, 0.3, PALE, { width: 0.2 });
        fx.burst(d.x, d.y, SHIP, 16, 300, { life: 0.35, size: 3.4 });
        this.fovKick = 3.2;
        this.kick(1.5, 0.012);
        break;
      case 'driftEnd':
        fx.ring(d.x, d.y, d.clean ? 150 : 60, d.clean ? 0.5 : 0.28, d.clean ? FLUX : SHIP, { width: 0.12 });
        if (d.clean) { fx.burst(d.x, d.y, FLUX, 26, 340, { life: 0.5, size: 4 }); this.kick(2.5, 0.008); }
        break;
      case 'flux':
      case 'overdrive':
        fx.ring(game.player.x, game.player.y, type === 'overdrive' ? 120 : 64, 0.45, FLUX, { width: 0.14, from: 14 });
        break;
      case 'hit':
        fx.burst(d.x, d.y, SHIP, 46, 420, { life: 0.8, size: 5 });
        fx.burst(d.x, d.y, '#ffffff', 16, 240, { life: 0.5, size: 4 });
        fx.ring(d.x, d.y, CONFIG.hitClearRadius, 0.5, '#ff6b8f', { width: 0.1 });
        fx.flash(d.x, d.y, '#ffffff', 90, 0.25);
        this.flash('#ff3b6b', 0.28);
        this.kick(10, 0.03);
        break;
      case 'shield':
        fx.ring(d.x, d.y, CONFIG.hitClearRadius, 0.5, '#8dbdff', { width: 0.14 });
        fx.burst(d.x, d.y, '#8dbdff', 30, 360, { life: 0.6, size: 4 });
        this.flash('#8dbdff', 0.16);
        this.kick(5, 0.016);
        break;
      case 'bomb':
        fx.ring(d.x, d.y, 950, 0.8, '#8cfff0', { width: 0.07 });
        fx.ring(d.x, d.y, 520, 0.6, '#ffffff', { width: 0.12 });
        fx.burst(d.x, d.y, '#8cfff0', 80, 620, { life: 0.9, size: 5 });
        this.flash('#bffff6', 0.34);
        this.kick(8, 0.03);
        break;
      case 'pickup': {
        const color = PICKUP_STYLE[d.type].color;
        fx.ring(d.x, d.y, 62, 0.4, color, { width: 0.16 });
        fx.burst(d.x, d.y, color, 14, 220, { life: 0.45, size: 3.4, lift: 1.4 });
        break;
      }
      case 'phase':
        fx.ring(d.x, d.y, 520, 0.7, d.color, { width: 0.08 });
        fx.burst(d.x, d.y, d.color, 40, 420, { life: 0.7, size: 4.5 });
        this.flash(d.color, 0.14);
        this.kick(4, 0.014);
        break;
      case 'bossDown':
        this.dying = { variant: d.variant, t: 0, next: 0, x: d.x, y: d.y };
        this.flash('#ffffff', 0.4);
        this.kick(9, 0.03);
        break;
      case 'ring':
        fx.ring(d.x, d.y, d.radius, d.life, d.color, { width: 0.14 });
        break;
      case 'beamFire':
        this.kick(2.2, 0.008);
        break;
      case 'bounce':
        fx.burst(d.x, d.y, d.color, 3, 110, { life: 0.22, size: 2.6 });
        break;
      case 'gameover':
        fx.burst(d.x, d.y, SHIP, 90, 520, { life: 1.2, size: 6 });
        fx.ring(d.x, d.y, 380, 0.9, SHIP, { width: 0.08 });
        this.kick(14, 0.04);
        break;
      default:
        break;
    }
  }

  // ───────────────────────────── Frame ─────────────────────────────

  render(game, dt) {
    this.frame++;
    const paused = game.mode === 'paused';
    const live = paused ? 0 : dt;         // cosmetic time stands still while paused
    this.time += live;
    if (game.mode === 'victory' || game.mode === 'gameover') this.endTimer += dt;
    if (game.mode !== this.lastMode) {
      if (this.lastMode === 'title' || (this.lastMode === 'victory' && game.mode !== 'paused')) {
        this.cam.yaw = Math.atan2(Math.sin(this.cam.yaw), Math.cos(this.cam.yaw));
      }
      this.lastMode = game.mode;
    }

    this.updateCamera(game, dt, live);
    this.backdrop.setSector(game.sectorIndex);
    this.rim.color.copy(linearColor(SECTORS[game.sectorIndex].color));
    this.backdrop.update(live, this.time, game.intermission > 0 ? 1 : 0);

    this.friendly.begin(this.time);
    this.hostile.begin(this.time);
    this.top.begin(this.time);

    this.syncShip(game, live);
    this.syncEnemies(game, live);
    this.syncBoss(game, live);
    this.syncPickups(game, live);
    this.effects.syncBeams(game.beams, this.time, this.friendly);
    this.syncProjectiles(game);

    this.effects.update(live);
    this.effects.draw(this.time);
    this.effects.sparks.end();
    this.friendly.end();
    this.hostile.end();
    this.top.end();

    this.shake = Math.max(0, this.shake - dt * 26);
    this.aberration = damp(this.aberration, 0, 7, dt);
    this.flashAmount = Math.max(0, this.flashAmount - dt * 1.9);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.finish.uniforms.uAberration.value = 0.0012 + this.aberration + (game.overdrive ? 0.0012 : 0);
    this.finish.uniforms.uFlashAmount.value = this.flashAmount;
    this.composer.render(dt);
  }

  updateCamera(game, dt, live) {
    const p = game.player;
    const cam = this.cam;
    const orbiting = game.mode === 'title' || (game.mode === 'victory' && this.endTimer > 2.4);
    let goal;
    if (orbiting) {
      this.orbit = cam.yaw + dt * 0.22;
      goal = { tilt: 1.1, yaw: this.orbit, dist: game.mode === 'title' ? 128 : 200, tx: fieldX(p.x), ty: 6, tz: fieldZ(p.y) - 4, fov: 40, roll: 0 };
    } else {
      const flat = this.cameraMode === 'flat';
      this.drama = damp(this.drama, !flat && game.boss?.entering ? 1 : 0, 1.6, live);
      const from = flat ? this.fits.flat : this.fits.base;
      const to = flat ? this.fits.flat : this.fits.drama;
      const offset = (p.x - WIDTH / 2) / (WIDTH / 2);
      goal = {
        tilt: flat ? 0 : BASE_TILT + (DRAMA_TILT - BASE_TILT) * this.drama,
        yaw: flat ? 0 : offset * 0.018,
        dist: from.dist + (to.dist - from.dist) * this.drama,
        tx: flat ? 0 : offset * 9, ty: 0,
        tz: from.tz + (to.tz - from.tz) * this.drama,
        fov: BASE_FOV + this.fovKick + this.backdrop.warp * 7,
        roll: flat ? 0 : offset * -0.011,
      };
    }
    // The lens settles quickly in play and glides between the title and the flight.
    const rate = orbiting ? 2 : 2.6;
    cam.tilt = damp(cam.tilt, goal.tilt, rate, dt);
    cam.yaw = damp(cam.yaw, goal.yaw, orbiting ? 8 : rate, dt);
    cam.logDist = damp(cam.logDist, Math.log(goal.dist), rate, dt);
    cam.tx = damp(cam.tx, goal.tx, rate * 1.4, dt);
    cam.ty = damp(cam.ty, goal.ty, rate, dt);
    cam.tz = damp(cam.tz, goal.tz, rate, dt);
    cam.roll = damp(cam.roll, goal.roll, 4, dt);
    cam.fov = damp(cam.fov, goal.fov, 5, dt);
    const shakeX = this.shake ? (Math.random() - 0.5) * 2 * this.shake : 0;
    const shakeY = this.shake ? (Math.random() - 0.5) * 2 * this.shake : 0;
    this.pose(this.camera, { ...cam, dist: Math.exp(cam.logDist) }, shakeX, shakeY);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  // ───────────────────────────── Pilot ─────────────────────────────

  shipVisual(ship) {
    let visual = this.ships.get(ship.id);
    if (!visual) {
      visual = makeShip(ship);
      this.scene.add(visual.group);
      for (const wisp of visual.wisps) this.scene.add(wisp.group);
      for (const ghost of visual.ghosts) this.scene.add(ghost.group);
      this.ships.set(ship.id, visual);
    }
    return visual;
  }

  // Makes one airframe the visible one and puts the others away.
  useShip(ship) {
    const visual = this.shipVisual(ship);
    if (this.ship !== visual) {
      for (const other of this.ships.values()) {
        if (other === visual) continue;
        other.group.visible = false;
        for (const wisp of other.wisps) wisp.group.visible = false;
        for (const ghost of other.ghosts) { ghost.group.visible = false; ghost.life = 0; }
      }
      this.ship = visual;
    }
    return visual;
  }

  syncShip(game, dt) {
    const p = game.player;
    const ship = this.useShip(game.ship);
    const SHIP = game.ship.color;
    const x = fieldX(p.x);
    const z = fieldZ(p.y);
    const alive = game.mode !== 'gameover';
    const drifting = Boolean(p.drift);
    ship.group.visible = alive;
    ship.group.position.set(x, PLANE + Math.sin(this.time * 2.3) * 1.1, z);
    ship.bank.rotation.z = -p.tilt * 0.8;
    ship.bank.rotation.x = clamp(p.vy / CONFIG.playerSpeed, -1, 1) * 0.16;
    ship.bank.rotation.y = -p.tilt * 0.12;

    const blink = p.invulnerable > 0 && !drifting && game.mode === 'playing' && Math.sin(this.time * 46) < 0;
    const boost = game.overdrive ? 1.3 + Math.sin(this.time * 9) * 0.15 : 1;
    ship.hull.tint(drifting ? 1 : 0, blink ? 0.22 : boost);
    const closeUp = 1 - clamp((Math.exp(this.cam.logDist) - 150) / 700, 0, 1);
    ship.flameMaterial.color.copy(ship.light).multiplyScalar(1.25 - closeUp * 0.7);
    ship.flames.forEach((flame, i) => {
      flame.scale.set(1, 1, (drifting ? 2.6 : 0.85 + Math.max(0, -p.vy / 400)) + Math.sin(this.time * 55 + i * 2) * 0.16);
      flame.visible = !blink;
    });

    ship.shield.group.visible = alive && game.shield;
    if (game.shield) {
      ship.shield.group.rotation.y += dt * 0.9;
      ship.shield.group.rotation.x += dt * 0.5;
      ship.shield.tint(0, 0.55 + Math.sin(this.time * 4) * 0.12);
    }

    const wisps = game.wispCount > 0 && alive && game.mode !== 'title';
    ship.wisps.forEach((wisp, i) => {
      wisp.group.visible = wisps;
      if (!wisps) return;
      const source = p.wisps[i];
      const lift = p.focus ? 2 : Math.sin(p.wispAngle + i * Math.PI + Math.PI / 2) * 10;
      wisp.group.position.set(fieldX(source.x), PLANE + 2 + lift, fieldZ(source.y));
      wisp.group.rotation.y += dt * 4;
      wisp.group.rotation.x += dt * 2.4;
      wisp.tint(0, boost);
      this.friendly.add(wisp.group.position.x, wisp.group.position.y, wisp.group.position.z, 10, 10, 0, KIND.flash, SHIP, 0.3);
    });

    // Drift afterimages.
    this.ghostTimer -= dt;
    if (drifting && this.ghostTimer <= 0) {
      this.ghostTimer = 0.026;
      const ghost = ship.ghosts.reduce((oldest, candidate) => (candidate.life < oldest.life ? candidate : oldest));
      ghost.life = 0.3;
      ghost.group.position.copy(ship.group.position);
      ghost.group.rotation.copy(ship.bank.rotation);
      ghost.group.visible = true;
    }
    for (const ghost of ship.ghosts) {
      if (ghost.life <= 0) continue;
      ghost.life -= dt;
      ghost.group.visible = ghost.life > 0;
      ghost.lineMaterial.opacity = Math.max(0, ghost.life / 0.3) * 0.85;
    }

    if (!alive) return;
    // Engine wake.
    if (game.mode === 'playing' || game.mode === 'title' || game.mode === 'victory') {
      this.trail += dt * (drifting ? 300 : 60 - closeUp * 30);
      while (this.trail >= 1) {
        this.trail -= 1;
        const side = Math.random() < 0.5 ? -ship.engines : ship.engines;
        this.effects.particle(x + side + (Math.random() - 0.5) * 2, PLANE, z + 14, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 10,
          150 + Math.random() * 80, 0.16 + Math.random() * 0.14, drifting ? 3.8 : 2.4 - closeUp * 1.2,
          drifting ? ship.pale : closeUp > 0.5 ? ship.dim : ship.light);
      }
    }
    if (game.mode !== 'playing' && game.mode !== 'paused') return;

    // Flux pips trail behind the ship so the gauge is readable without looking away.
    const segments = game.fluxSegments;
    for (let i = 0; i < 3; i++) {
      const lit = i < segments;
      const pulse = game.overdrive ? 0.75 + 0.25 * Math.sin(this.time * 12 + i) : 1;
      this.friendly.add(x + (i - 1) * 8, PLANE, z + 26, lit ? 5.2 : 2.2, lit ? 5.2 : 2.2, 0, KIND.spark, lit ? FLUX : '#4a3a66', lit ? pulse : 0.55);
    }
    // The hitbox is always visible; focusing adds the graze boundary.
    if (p.focus) {
      const radius = (game.ship.grazeRadius + 5) / 0.82;
      this.top.add(x, PLANE, z, radius, radius, this.time * 1.5, KIND.ring, SHIP, 0.7);
    }
    this.top.add(x, PLANE, z, 8, 8, 0, KIND.hitbox, SHIP, 1);
  }

  // ───────────────────────────── Hostiles ─────────────────────────────

  acquire(pool, type, make) {
    const free = pool.get(type);
    if (free?.length) {
      const visual = free.pop();
      visual.group.visible = true;
      return visual;
    }
    const visual = make(type);
    this.scene.add(visual.group);
    return visual;
  }

  release(pool, visual) {
    visual.group.visible = false;
    if (!pool.has(visual.type)) pool.set(visual.type, []);
    pool.get(visual.type).push(visual);
  }

  syncEnemies(game, dt) {
    const stamp = this.frame;
    for (const e of game.enemies) {
      let visual = this.enemyVisuals.get(e);
      if (!visual) {
        visual = this.acquire(this.enemyPool, e.type, makeEnemy);
        visual.lastX = e.x;
        visual.lastY = e.y;
        visual.roll = 0;
        visual.heading = 0;
        this.enemyVisuals.set(e, visual);
        // A marker on the glass shows where something is about to surface.
        if (e.path === 'rise') this.effects.ring(e.x, e.y, e.r * 2.4, 0.9, e.color, { width: 0.1, from: e.r * 3.4 });
      }
      visual.stamp = stamp;
      if (dt > 0) {
        const vx = (e.x - visual.lastX) / dt;
        const vy = (e.y - visual.lastY) / dt;
        visual.lastX = e.x;
        visual.lastY = e.y;
        visual.roll = damp(visual.roll, clamp(vx / 170, -1, 1) * 0.65, 8, dt);
        const turns = e.path === 'swoop' || e.path === 'dive';
        visual.heading = damp(visual.heading, turns && (vx || vy) ? Math.atan2(vx, vy) : 0, 10, dt);
      }
      const depth = clamp(1 + e.alt / 340, 0, 1);
      visual.group.position.set(fieldX(e.x), PLANE - 1 + e.alt, fieldZ(e.y));
      visual.bank.rotation.set(0, visual.heading, -visual.roll);
      const flash = e.hitFlash > 0 ? 0.5 : 0;
      const dim = 0.25 + depth * 0.75;
      for (const part of visual.tubes) part.tint(flash, dim);
      if (visual.spinner) {
        visual.spinner.rotation.y += dt * (e.type === 'bloom' ? 0.9 : 2.2);
        if (e.type === 'bloom') visual.spinner.scale.setScalar(1 + Math.sin(this.time * 5 + e.phase) * 0.1);
      }
      if (e.type === 'sentinel' || e.type === 'bloom') visual.bank.rotation.y = this.time * 0.5 + e.phase;
    }
    for (const [e, visual] of this.enemyVisuals) {
      if (visual.stamp === stamp) continue;
      this.release(this.enemyPool, visual);
      this.enemyVisuals.delete(e);
    }
  }

  bossVisual(variant) {
    if (!this.bossVisuals[variant]) {
      const visual = makeBoss(variant);
      this.scene.add(visual.root);
      if (visual.parts) for (const part of visual.parts) this.scene.add(part.group);
      visual.lastX = 0;
      visual.roll = 0;
      this.bossVisuals[variant] = visual;
    }
    return this.bossVisuals[variant];
  }

  syncBoss(game, dt) {
    const b = game.boss;
    const fx = this.effects;
    for (const visual of this.bossVisuals) {
      if (!visual) continue;
      visual.root.visible = false;
      if (visual.parts) for (const part of visual.parts) part.group.visible = false;
    }

    if (this.dying) {
      // The wreck lists and sinks through the glass, shedding explosions.
      const d = this.dying;
      const visual = this.bossVisual(d.variant);
      d.t += dt;
      d.next -= dt;
      visual.root.visible = true;
      visual.root.position.set(fieldX(d.x) + (Math.random() - 0.5) * 5, PLANE - d.t * 46, fieldZ(d.y));
      visual.root.rotation.z += dt * 0.5;
      visual.root.rotation.x += dt * 0.22;
      for (const part of visual.tubes) part.tint(Math.random() < 0.3 ? 1 : 0, 1);
      const color = SECTORS[d.variant].phases[2].color;
      if (d.next <= 0) {
        d.next = 0.08;
        const x = d.x + (Math.random() - 0.5) * 120;
        const y = d.y + (Math.random() - 0.5) * 100;
        fx.burst(x, y, color, 14, 320, { life: 0.6, size: 5 });
        fx.flash(x, y, '#ffffff', 46, 0.16);
        this.kick(3.5);
      }
      if (d.t >= 1.5) {
        fx.burst(d.x, d.y, color, 120, 720, { life: 1.3, size: 7 });
        fx.burst(d.x, d.y, '#ffffff', 50, 420, { life: 0.9, size: 5 });
        fx.ring(d.x, d.y, 700, 1, color, { width: 0.07 });
        fx.ring(d.x, d.y, 360, 0.7, '#ffffff', { width: 0.12 });
        this.flash('#ffffff', 0.75);
        this.kick(16, 0.04);
        visual.root.visible = false;
        visual.root.rotation.set(0, 0, 0);
        this.dying = null;
      }
      return;
    }
    if (!b) return;

    const visual = this.bossVisual(b.variant);
    const p = game.player;
    // Bosses surface from the depth as they slide into the arena.
    const alt = b.entering ? -(112 - b.y) * 2.3 : 0;
    const depth = clamp(1 + alt / 420, 0.2, 1);
    if (dt > 0) {
      visual.roll = damp(visual.roll, clamp((b.x - visual.lastX) / dt / 90, -1, 1) * 0.22, 4, dt);
      visual.lastX = b.x;
    }
    const tremor = b.transition > 0 ? (Math.random() - 0.5) * 3 : 0;
    visual.root.visible = true;
    visual.root.position.set(fieldX(b.x) + tremor, PLANE + 2 + alt + Math.sin(this.time * 1.7) * 2, fieldZ(b.y));
    visual.root.rotation.set(0, 0, -visual.roll);
    const flash = b.transition > 0 ? 0.35 + 0.35 * Math.sin(this.time * 30) : b.hitFlash > 0 ? 0.28 : 0;
    visual.core.recolor(b.phases[b.phase].color);
    for (const part of visual.tubes) part.tint(part === visual.core ? flash * 0.5 : flash, depth);
    for (const [object, axis, speed] of visual.spinners) object.rotation[axis] += dt * speed * (1 + b.phase * 0.35);
    if (visual.parts) {
      visual.parts.forEach((part, i) => {
        const source = b.parts[i];
        part.group.visible = true;
        part.group.position.set(fieldX(source.x), PLANE + 4 + alt, fieldZ(source.y));
        if (b.variant === 1) part.group.rotation.y = Math.atan2(p.x - source.x, p.y - source.y);
        else part.group.rotation.y += dt * (i ? -2.4 : 2.4);
      });
    }
    // The core breathes light while a volley is charging.
    const charge = b.entering || b.transition > 0 ? 0 : clamp(1 - b.fireTimer / 0.5, 0, 1);
    if (charge > 0) this.friendly.add(fieldX(b.x), PLANE + 20 + alt, fieldZ(b.y) + 14, 30 * charge, 30 * charge, 0, KIND.flash, b.phases[b.phase].color, 0.38);
  }

  syncPickups(game, dt) {
    const stamp = this.frame;
    for (const pickup of game.pickups) {
      let visual = this.pickupVisuals.get(pickup);
      if (!visual) {
        visual = this.acquire(this.pickupPool, pickup.type, makePickup);
        this.pickupVisuals.set(pickup, visual);
      }
      visual.stamp = stamp;
      visual.group.position.set(fieldX(pickup.x), PLANE + 6 + Math.sin(pickup.age * 3) * 2.5, fieldZ(pickup.y));
      visual.token.group.rotation.y += dt * 2.2;
      visual.token.group.rotation.x = 0.4;
      // Supplies blink for their last three seconds.
      visual.group.visible = pickup.age < 15 || Math.sin(pickup.age * 22) > 0;
      this.friendly.add(visual.group.position.x, PLANE, visual.group.position.z, 26, 26, 0, KIND.flash, PICKUP_STYLE[pickup.type].color, 0.32);
    }
    for (const [pickup, visual] of this.pickupVisuals) {
      if (visual.stamp === stamp) continue;
      this.release(this.pickupPool, visual);
      this.pickupVisuals.delete(pickup);
    }
  }

  // ───────────────────────────── Projectiles ─────────────────────────────

  syncProjectiles(game) {
    const friendly = this.friendly;
    for (const shot of game.shots) {
      if (shot.dead) continue;
      const rotation = Math.atan2(-shot.vy, shot.vx);
      if (shot.kind === 'main') friendly.add(fieldX(shot.x), PLANE, fieldZ(shot.y), 12, 3.2, rotation, KIND.shot, game.overdrive ? this.ship.pale : this.ship.light, 1);
      else if (shot.kind === 'bolt') friendly.add(fieldX(shot.x), PLANE, fieldZ(shot.y), 15, 3.2, rotation, KIND.shot, '#b9d7ff', 1);
      else friendly.add(fieldX(shot.x), PLANE, fieldZ(shot.y), 10, 4.2, rotation, KIND.shard, this.ship.pale, 0.9);
    }
    for (const shard of game.shards) {
      if (shard.dead) continue;
      const fade = Math.min(1, shard.life * 3);
      friendly.add(fieldX(shard.x), PLANE + 2, fieldZ(shard.y), 13, 6, Math.atan2(-shard.vy, shard.vx), KIND.shard, shard.color, fade);
    }
    for (const mote of game.motes) {
      if (mote.dead) continue;
      friendly.add(fieldX(mote.x), PLANE, fieldZ(mote.y), 7.5, 7.5, mote.age * 5, KIND.mote, '#ffe7a3', Math.min(1, 0.4 + mote.age * 3));
    }

    const hostile = this.hostile;
    for (const bullet of game.bullets) {
      if (bullet.dead) continue;
      // Bullets swell into existence so a fresh volley reads as a burst.
      const birth = 1 + Math.max(0, 0.14 - bullet.age) * 6;
      const size = bullet.r * 2 * birth;
      const alpha = Math.min(1, 0.35 + bullet.age * 6);
      const x = fieldX(bullet.x);
      const z = fieldZ(bullet.y);
      if (bullet.kind === 'orb') hostile.add(x, PLANE, z, size, size, 0, KIND.orb, bullet.color, alpha);
      else if (bullet.kind === 'heavy') hostile.add(x, PLANE, z, size, size, 0, KIND.heavy, bullet.color, alpha, bullet.x * 0.01);
      else {
        const rotation = Math.atan2(-bullet.vy, bullet.vx);
        if (bullet.kind === 'needle') hostile.add(x, PLANE, z, size * 2.1, size * 0.9, rotation, KIND.needle, bullet.color, alpha);
        else hostile.add(x, PLANE, z, size * 1.28, size, rotation, KIND.diamond, bullet.color, alpha);
      }
    }
  }
}
