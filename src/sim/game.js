import { CONFIG, WIDTH, HEIGHT } from './config.js';
import { SECTORS, ENEMY_TYPES, SUPPLY_TYPES } from './sectors.js';
import { getDifficulty } from './difficulty.js';
import { getShip } from './ships.js';
import { fireBoss, moveBoss, placeParts, bossCrossfire } from './bosses.js';

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const overlaps = (a, b) => distanceSquared(a, b) < (a.r + b.r) ** 2;
const idleInput = Object.freeze({ x: 0, y: 0, focus: false, shooting: false, pointer: null });

// Removes dead entries without allocating a new array every step.
function compact(list, keep) {
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const item = list[read];
    if (keep(item)) list[write++] = item;
  }
  list.length = write;
}

// No DOM, WebGL or wall-clock dependencies: the same fixed-step simulation runs
// in the browser and in the Node test suite. Everything the renderer and the
// audio engine need beyond plain state arrives through onEvent(type, data).
export class Game {
  constructor({ onEvent = () => {}, best = 0, saveBest = () => {}, difficulty = 'normal', ship = 'vector', seed = 20261114 } = {}) {
    this.onEvent = onEvent;
    this.best = best;
    this.saveBest = saveBest;
    this.seed = seed;
    this.cheats = { god: false };
    this.ship = getShip(ship);
    this.reset('title', difficulty);
  }

  reset(mode = 'playing', difficulty = this.difficulty.id, { sector = 0, ship = this.ship.id } = {}) {
    this.difficulty = getDifficulty(difficulty);
    this.ship = getShip(ship);
    this.rngState = this.seed >>> 0;
    this.mode = mode;
    this.time = 0;
    this.dt = 0;
    this.stageTime = 0;
    this.sectorIndex = clamp(Math.trunc(sector) || 0, 0, SECTORS.length - 1);
    this.intermission = 0;
    this.score = 0;
    this.lives = this.difficulty.startingLives;
    this.bombs = this.difficulty.startingBombs;
    this.power = 1;
    this.shield = this.difficulty.startingShield;
    this.flux = 0;
    this.chain = 1;
    this.chainTimer = 0;
    this.player = {
      x: WIDTH / 2, y: 610, r: CONFIG.playerRadius, vx: 0, vy: 0,
      invulnerable: 0, shotTimer: 0, wispTimer: 0, wispAngle: 0, beamGraze: 0,
      focus: false, tilt: 0, drift: null,
      wisps: [{ x: WIDTH / 2, y: 610 }, { x: WIDTH / 2, y: 610 }],
    };
    this.enemies = [];
    this.bullets = [];
    this.shots = [];
    this.shards = [];
    this.motes = [];
    this.beams = [];
    this.pickups = [];
    this.pendingHazards = [];
    this.boss = null;
    this.bossSpawned = false;
    this.waveIndex = 0;
    this.sectionIndex = 0;
    this.supplyIndex = 0;
    this.pauseReason = '';
    this.stats = {
      kills: 0, shots: 0, bombsUsed: 0, hits: 0, grazes: 0,
      drifts: 0, converted: 0, bestDrift: 0, maxChain: 1, sectorsCleared: 0,
    };
    this.banner = null;
    if (mode === 'playing') {
      this.say(this.sector.label, this.sector.name, 3, 'sector');
      this.emit('start', { sector: this.sectorIndex });
    }
  }

  get sector() { return SECTORS[this.sectorIndex]; }
  get overdrive() { return this.flux >= CONFIG.fluxMax; }
  get fluxSegments() { return Math.floor(this.flux / CONFIG.fluxSegment + 1e-9); }
  get wispCount() { return this.power >= 2 ? 2 : 0; }
  // How much gauge one unit of flux is worth for this class and airframe.
  get fluxRate() { return this.difficulty.fluxGain * this.ship.fluxGain; }

  // Deterministic mulberry32, so a run replays identically from its seed.
  rand() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  emit(type, data) { this.onEvent(type, data); }

  // Banner text is English with {placeholders}; the interface translates it.
  say(title, subtitle, remaining, tone = 'info', vars = null) {
    this.banner = { title, subtitle, remaining, tone, vars };
  }

  pause(reason = 'manual') {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.pauseReason = reason;
  }

  resume() {
    if (this.mode === 'paused') this.mode = 'playing';
  }

  addScore(points, chained = true) {
    const gained = Math.round(points * this.difficulty.scoreMultiplier * (chained ? this.chain : 1));
    this.score += gained;
    // Persistence is deferred to pause/end by the host; no disk writes per shot.
    if (this.score > this.best) this.best = this.score;
    return gained;
  }

  persistBest() { this.saveBest(this.best, this.difficulty.id); }

  addFlux(amount) {
    if (this.flux >= CONFIG.fluxMax) return;
    const before = this.fluxSegments;
    this.flux = Math.min(CONFIG.fluxMax, this.flux + amount * this.fluxRate);
    if (this.fluxSegments > before) this.emit(this.overdrive ? 'overdrive' : 'flux', { segments: this.fluxSegments });
  }

  bumpChain(amount) {
    this.chain = Math.min(CONFIG.chainMax, this.chain + amount);
    this.chainTimer = CONFIG.chainHold;
    if (this.chain > this.stats.maxChain) this.stats.maxChain = this.chain;
  }

  update(dt, input = idleInput) {
    if (this.mode !== 'playing' || dt <= 0) return;
    this.dt = dt;
    this.time += dt;
    if (this.banner) {
      this.banner.remaining -= dt;
      if (this.banner.remaining <= 0) this.banner = null;
    }
    if (this.chainTimer > 0) this.chainTimer -= dt;
    else this.chain = Math.max(1, this.chain - CONFIG.chainDecay * dt);

    if (this.intermission > 0) {
      // The ship flies itself back to the launch point while the drive charges.
      this.intermission = Math.max(0, this.intermission - dt);
      const p = this.player;
      const ease = Math.min(1, dt * 2.5);
      const px = p.x;
      p.x += (WIDTH / 2 - p.x) * ease;
      p.y += (610 - p.y) * ease;
      p.vx = (p.x - px) / dt;
      p.tilt += (clamp(p.vx / this.ship.speed, -1, 1) - p.tilt) * Math.min(1, dt * 12);
      p.focus = false;
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      this.updateWisps(dt);
      this.updateShards(dt);
      this.updateMotes(dt);
      this.cleanup();
      if (this.intermission === 0) this.beginNextSector();
      return;
    }

    this.stageTime = Math.min(this.sector.duration, this.stageTime + dt);
    this.updatePlayer(dt, input);
    this.scheduleWaves();
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateHazards(dt);
    this.updateBullets(dt);
    this.updateBeams(dt);
    this.updateShots(dt);
    this.updateShards(dt);
    this.updatePickups(dt);
    this.updateMotes(dt);
    this.handleCollisions();
    this.cleanup();
  }

  beginNextSector() {
    this.sectorIndex++;
    this.stageTime = 0;
    this.waveIndex = 0;
    this.sectionIndex = 0;
    this.supplyIndex = 0;
    this.bossSpawned = false;
    this.intermission = 0;
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.shots.length = 0;
    this.beams.length = 0;
    this.pickups.length = 0;
    this.pendingHazards.length = 0;
    const p = this.player;
    p.x = WIDTH / 2;
    p.y = 610;
    p.shotTimer = 0;
    p.drift = null;
    p.invulnerable = Math.max(p.invulnerable, 2.5);
    this.lives = Math.min(CONFIG.maxLives, this.lives + 1);
    this.bombs = Math.min(CONFIG.maxBombs, this.bombs + 1);
    this.say(this.sector.label, this.sector.name, 3, 'sector');
    this.emit('sector', { sector: this.sectorIndex });
  }

  // ───────────────────────────── Player ─────────────────────────────

  updatePlayer(dt, input) {
    const p = this.player;
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.focus = Boolean(input.focus);
    const px = p.x;
    const py = p.y;
    const pointer = input.pointer && Number.isFinite(input.pointer.x) && Number.isFinite(input.pointer.y) ? input.pointer : null;
    const drift = p.drift;

    if (drift && !drift.free) {
      p.x = clamp(p.x + drift.vx * dt, 17, WIDTH - 17);
      p.y = clamp(p.y + drift.vy * dt, 22, HEIGHT - 22);
    } else if (pointer) {
      // The ship chases the cursor instead of teleporting, so it can never be
      // dragged through a wall of bullets in a single frame.
      const tx = clamp(pointer.x, 17, WIDTH - 17);
      const ty = clamp(pointer.y, 22, HEIGHT - 22);
      const dx = tx - p.x;
      const dy = ty - p.y;
      const distance = Math.hypot(dx, dy);
      const agility = this.ship.speed / CONFIG.playerSpeed;
      const reach = (drift ? CONFIG.driftPointerSpeed : (p.focus ? CONFIG.pointerFocusSpeed : CONFIG.pointerSpeed) * agility) * dt;
      if (distance <= reach) { p.x = tx; p.y = ty; }
      else { p.x += dx / distance * reach; p.y += dy / distance * reach; }
    } else {
      // Analog sticks keep their magnitude; keyboard diagonals are normalized.
      const length = Math.max(1, Math.hypot(input.x, input.y));
      const speed = p.focus ? this.ship.focusSpeed : this.ship.speed;
      p.x = clamp(p.x + input.x / length * speed * dt, 17, WIDTH - 17);
      p.y = clamp(p.y + input.y / length * speed * dt, 22, HEIGHT - 22);
    }

    p.vx = (p.x - px) / dt;
    p.vy = (p.y - py) / dt;
    p.tilt += (clamp(p.vx / this.ship.speed, -1, 1) - p.tilt) * Math.min(1, dt * 12);

    if (drift) {
      drift.t += dt;
      this.driftSweep();
      if (drift.t >= drift.dur) this.endDrift();
    }

    this.updateWisps(dt);

    // The guns stay cold during a drift: the dash is the attack.
    if (input.shooting && !p.drift) {
      p.shotTimer -= dt;
      p.wispTimer -= dt;
      const ship = this.ship;
      const damage = ship.shotDamage * (this.overdrive ? CONFIG.overdriveDamage : 1);
      while (p.shotTimer <= 0) {
        const lanes = ship.lanes(this.power, p.focus);
        for (const [dx, vx] of lanes) {
          this.shots.push({ x: p.x + dx, y: p.y - 18, vx, vy: -CONFIG.shotSpeed, r: 3, dmg: damage, kind: 'main', homing: 0 });
        }
        this.stats.shots += lanes.length;
        p.shotTimer += ship.shotInterval;
        this.emit('shoot');
      }
      if (this.wispCount === 0) p.wispTimer = 0;
      while (p.wispTimer <= 0 && this.wispCount > 0) {
        const haste = this.power >= 4 ? 0.7 : 1;
        const rig = this.ship.wisp;
        p.wispTimer += (p.focus ? rig.focusInterval : rig.interval) * haste;
        const wispDamage = rig.damage * (this.overdrive ? CONFIG.overdriveDamage : 1);
        const bolts = (p.focus ? rig.focused : rig.loose) === 'bolt';
        p.wisps.forEach((wisp, index) => {
          const side = index ? 1 : -1;
          // Bolts fly straight; darts leave sideways and seek the nearest target.
          this.shots.push(bolts
            ? { x: wisp.x, y: wisp.y - 6, vx: 0, vy: -CONFIG.wispBoltSpeed, r: 3, dmg: wispDamage, kind: 'bolt', homing: 0 }
            : { x: wisp.x, y: wisp.y - 6, vx: side * 110, vy: -CONFIG.wispDartSpeed, r: 4, dmg: wispDamage, kind: 'dart', homing: rig.homing });
        });
        this.stats.shots += 2;
      }
    } else {
      p.shotTimer = Math.max(0, p.shotTimer - dt);
      p.wispTimer = Math.max(0, p.wispTimer - dt);
    }
  }

  updateWisps(dt) {
    const p = this.player;
    p.wispAngle += dt * 3.2;
    const follow = Math.min(1, dt * 16);
    for (let i = 0; i < p.wisps.length; i++) {
      const wisp = p.wisps[i];
      const side = i ? 1 : -1;
      let tx;
      let ty;
      if (p.focus) {
        tx = p.x + side * 15;
        ty = p.y - 20;
      } else {
        const angle = p.wispAngle + i * Math.PI;
        tx = p.x + Math.cos(angle) * 34;
        ty = p.y + 4 + Math.sin(angle) * 15;
      }
      wisp.x += (tx - wisp.x) * follow;
      wisp.y += (ty - wisp.y) * follow;
    }
  }

  // Spends one flux segment on a short invulnerable dash. Every bullet the ship
  // brushes on the way is converted into a homing shard (or a score mote).
  useDrift(input = idleInput) {
    const p = this.player;
    if (this.mode !== 'playing' || this.intermission > 0 || p.drift || this.flux < CONFIG.fluxSegment) return false;
    const pointer = input.pointer && Number.isFinite(input.pointer.x) && Number.isFinite(input.pointer.y) ? input.pointer : null;
    let dx = pointer ? pointer.x - p.x : input.x || 0;
    let dy = pointer ? pointer.y - p.y : input.y || 0;
    let length = Math.hypot(dx, dy);
    if (length < (pointer ? 6 : 0.2)) { dx = 0; dy = -1; length = 1; }
    dx /= length;
    dy /= length;
    this.flux -= CONFIG.fluxSegment;
    // With the mouse the ship keeps chasing the cursor, only much faster; on
    // keys it commits to a straight dash in the held direction (forward if none).
    const rig = this.ship.drift;
    p.drift = {
      t: 0, dur: pointer ? rig.pointerDuration : rig.duration, free: Boolean(pointer),
      vx: dx * rig.speed, vy: dy * rig.speed, converted: 0, rammed: new Set(), rammedBoss: false,
    };
    p.invulnerable = Math.max(p.invulnerable, p.drift.dur + CONFIG.driftGrace);
    this.stats.drifts++;
    this.emit('drift', { x: p.x, y: p.y, dx, dy });
    this.driftSweep();
    return true;
  }

  driftSweep() {
    const p = this.player;
    const drift = p.drift;
    const reach = this.ship.drift.radius;
    for (const bullet of this.bullets) {
      if (!bullet.dead && distanceSquared(bullet, p) < (reach + bullet.r) ** 2) this.convertBullet(bullet);
    }
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.alt < -20 || drift.rammed.has(e)) continue;
      if (distanceSquared(e, p) < (reach + e.r) ** 2) {
        drift.rammed.add(e);
        this.emit('spark', { x: e.x, y: e.y, color: '#d4fffa', big: true });
        this.damageEnemy(e, this.ship.drift.ram);
      }
    }
    const b = this.boss;
    if (b && !drift.rammedBoss && !b.entering && distanceSquared(b, p) < (reach + b.r) ** 2) {
      drift.rammedBoss = true;
      this.emit('spark', { x: p.x, y: p.y, color: '#d4fffa', big: true });
      this.damageBoss(this.ship.drift.ram);
    }
  }

  convertBullet(bullet) {
    bullet.dead = true;
    this.stats.converted++;
    const drift = this.player.drift;
    if (drift) drift.converted++;
    this.bumpChain(CONFIG.chainPerConvert);
    this.addScore(10);
    if (this.shards.length < CONFIG.shardLimit && this.nearestTarget(bullet.x, bullet.y, Infinity)) {
      const angle = this.rand() * TAU;
      const speed = 150 + this.rand() * 130;
      this.shards.push({ x: bullet.x, y: bullet.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, life: CONFIG.shardLife, target: null, color: bullet.color });
    } else {
      this.spawnMote(bullet.x, bullet.y);
    }
    this.emit('convert', { x: bullet.x, y: bullet.y, color: bullet.color, count: drift ? drift.converted : 1 });
  }

  endDrift() {
    const p = this.player;
    const drift = p.drift;
    p.drift = null;
    p.invulnerable = Math.max(p.invulnerable, CONFIG.driftGrace);
    this.stats.bestDrift = Math.max(this.stats.bestDrift, drift.converted);
    const clean = drift.converted >= CONFIG.driftRefundAt;
    if (clean) {
      // A full slipstream pays part of its own cost back.
      this.addFlux(CONFIG.driftRefund / this.fluxRate);
      this.addScore(drift.converted * 20);
    }
    this.emit('driftEnd', { x: p.x, y: p.y, converted: drift.converted, clean });
  }

  // ───────────────────────────── Waves and enemies ─────────────────────────────

  scheduleWaves() {
    const { sections, waves, supplies, duration } = this.sector;
    while (this.sectionIndex < sections.length && sections[this.sectionIndex].at <= this.stageTime) {
      const section = sections[this.sectionIndex++];
      if (section.at > 0) {
        this.say(section.label, '{label} / {name}', 2.5, section.label.startsWith('WARNING') ? 'warn' : 'info',
          { label: this.sector.label, name: this.sector.name });
      }
    }
    while (this.waveIndex < waves.length && waves[this.waveIndex].at <= this.stageTime) {
      this.spawnEnemy(waves[this.waveIndex++]);
    }
    while (this.supplyIndex < supplies.length && supplies[this.supplyIndex].at <= this.stageTime) {
      const supply = supplies[this.supplyIndex++];
      this.spawnPickup(supply.type, supply.x, -18);
    }
    if (this.stageTime >= duration && !this.bossSpawned) this.spawnBoss();
  }

  spawnEnemy(wave) {
    const base = ENEMY_TYPES[wave.type];
    if (!base) throw new RangeError(`Unknown enemy: ${wave.type}`);
    const e = { path: 'fall', phase: 0, ...base, ...wave, age: 0, hitFlash: 0, alt: 0, state: 0, gone: false };
    e.hp = Math.ceil(e.hp * this.difficulty.enemyHealth);
    e.maxHp = e.hp;
    e.baseX = e.x;
    e.fireTimer = 1.15 + e.phase * 0.12;
    if (e.path === 'rise') {
      // Surfaces from below the field; untouchable until it reaches the plane.
      e.y = wave.y ?? 100;
      e.alt = -340;
    } else if (e.path === 'swoop') {
      e.side = wave.side ?? -1;
      e.x = e.side < 0 ? -30 : WIDTH + 30;
      e.y0 = wave.y ?? 130;
      e.y = e.y0;
      e.amp = wave.amp ?? 150;
    } else if (e.path === 'dive') {
      e.y = -30;
      // Mostly downwards: a dart may lead the pilot but never flies sideways.
      const aim = clamp(Math.atan2(this.player.y - e.y, this.player.x - e.x), Math.PI / 2 - 0.85, Math.PI / 2 + 0.85);
      e.vx = Math.cos(aim) * e.speed;
      e.vy = Math.sin(aim) * e.speed;
    } else {
      e.y = -30;
    }
    this.enemies.push(e);
    return e;
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      e.age += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      const sway = () => clamp(e.baseX + Math.sin(e.age * 1.15 + e.phase) * e.drift, 26, WIDTH - 26);

      if (e.path === 'rise' && e.alt < 0) {
        e.alt = Math.min(0, e.alt + 380 * dt);
        continue;
      } else if (e.path === 'swoop') {
        const direction = -e.side;
        e.x += direction * e.speed * dt;
        const progress = clamp((direction > 0 ? e.x + 30 : WIDTH + 30 - e.x) / (WIDTH + 60), 0, 1);
        e.y = e.y0 + Math.sin(progress * Math.PI) * e.amp;
        if (progress >= 1) e.gone = true;
      } else if (e.path === 'hold') {
        if (e.state === 0) {
          e.y += (e.holdY - e.y) * (1 - Math.exp(-3 * dt)) + 12 * dt;
          if (e.y >= e.holdY - 2) { e.state = 1; e.holdLeft = e.holdTime; e.fireTimer = 0.7 + e.phase * 0.25; }
        } else if (e.state === 1) {
          e.holdLeft -= dt;
          if (e.holdLeft <= 0 && !e.firing) e.state = 2;
        } else {
          e.y -= e.speed * dt;
          if (e.y < -60) e.gone = true;
        }
      } else if (e.path === 'dive') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        e.y += e.speed * dt;
        e.x = sway();
      }

      if (!e.fireInterval) continue;
      e.fireTimer -= dt * this.difficulty.fireRate;
      // Never shoot from behind or at point-blank range.
      if (e.fireTimer > 0 || e.y <= 25 || e.y >= 465) continue;
      if (e.type === 'lancer' && e.state !== 1) continue;
      e.fireTimer += e.fireInterval;
      if (p.y < e.y + 65 || distanceSquared(e, p) < 110 ** 2) continue;
      const aim = Math.atan2(p.y - e.y, p.x - e.x);
      if (e.type === 'hunter') {
        this.fireFan(e, aim, 1, 0, 155, '#ffbd69', 'orb');
      } else if (e.type === 'weaver') {
        this.fireFan(e, Math.PI / 2 + Math.sin(e.age) * 0.16, 5, 0.23, 118, '#e89aff', 'diamond');
      } else if (e.type === 'striker') {
        this.fireFan(e, aim, 2, 0.22, 172, '#ff9779', 'needle');
      } else if (e.type === 'sentinel') {
        this.fireOpenRing(e, aim, 14, 0.46, 106, '#86cfff', e.age * 0.12);
      } else if (e.type === 'lancer') {
        this.spawnBeam({ follow: e, owner: e, oy: 14, angle: aim, warn: 0.85, life: 0.55, width: 12, color: '#c9ff8a' });
      }
    }
  }

  damageEnemy(e, damage) {
    if (e.hp <= 0) return;
    e.hp -= damage;
    e.hitFlash = 0.07;
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e, allowEcho = true) {
    if (e.rewarded) return;
    e.rewarded = true;
    this.stats.kills++;
    this.addScore(e.score);
    this.bumpChain(e.chain);
    this.addFlux(CONFIG.fluxPerKill);
    this.emit('explode', { x: e.x, y: e.y, color: e.color, size: e.r, type: e.type });
    const p = this.player;
    const level = this.difficulty.patternLevel;
    if (allowEcho && e.type === 'bloom' && e.y > 30 && e.y < 470 && distanceSquared(e, p) > 95 ** 2) {
      // The pod's last breath: a slow pinwheel that is safest crossed by drifting.
      const petals = 10 + level * 2;
      const twist = Math.round(e.phase / 1.45) % 2 ? -1 : 1;
      for (let i = 0; i < petals; i++) {
        this.spawnBullet(e.x, e.y, i / petals * TAU + e.age, 74, '#ff8ad8', 'orb', 5, { turn: twist * 0.7, turnFor: 1.3 });
      }
    }
    if (allowEcho && this.difficulty.id === 'extreme' && e.type !== 'scout' && e.type !== 'dart' &&
        this.pendingHazards.length < 6 && this.isSafeEchoSource(e)) {
      this.pendingHazards.push({ x: e.x, y: e.y, delay: 0.6, angle: Math.atan2(p.y - e.y, p.x - e.x) });
      this.emit('ring', { x: e.x, y: e.y, radius: 42, life: 0.6, color: '#ff719f' });
    }
    // Guaranteed rotating drops make practice runs reproducible.
    if (this.stats.kills % 15 === 0) {
      const type = SUPPLY_TYPES[(this.stats.kills / 15 - 1) % SUPPLY_TYPES.length];
      this.spawnPickup(type, e.x, Math.max(24, e.y));
    }
  }

  isSafeEchoSource(source) {
    return source.y > 35 && source.y < 400 && this.player.y >= source.y + 130 &&
      distanceSquared(source, this.player) >= 170 ** 2;
  }

  updateHazards(dt) {
    for (const hazard of this.pendingHazards) {
      hazard.delay -= dt;
      if (hazard.delay > 0 || !this.isSafeEchoSource(hazard)) continue;
      for (const offset of [-0.18, 0, 0.18]) {
        this.spawnBullet(hazard.x, hazard.y + 18, hazard.angle + offset, 110, '#ff719f', 'diamond', 4);
      }
    }
    compact(this.pendingHazards, hazard => hazard.delay > 0);
  }

  // ───────────────────────────── Hostile fire ─────────────────────────────

  spawnBullet(x, y, angle, speed, color, kind = 'orb', r = 5, extra = null) {
    if (this.bullets.length >= CONFIG.bulletLimit) return null;
    const p = this.player;
    const gap = (x - p.x) ** 2 + (y - p.y) ** 2;
    // Nothing ever materializes on top of the pilot.
    if (gap < CONFIG.spawnSafeRadius ** 2) return null;
    // Extra-mode patterns also never appear level with or behind the ship.
    if (this.difficulty.id !== 'normal' && (y > p.y - 35 || gap < 90 ** 2)) return null;
    speed *= this.difficulty.bulletSpeed;
    const bullet = {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, color, kind,
      age: 0, turn: 0, turnFor: 0, accel: 0, vmin: 20, vmax: 420, bounce: 0, stage: null, grazed: false, dead: false,
    };
    if (extra) {
      Object.assign(bullet, extra);
      bullet.accel *= this.difficulty.bulletSpeed;
      bullet.vmax *= this.difficulty.bulletSpeed;
    }
    this.bullets.push(bullet);
    return bullet;
  }

  fireFan(source, angle, count, spacing, speed, color, kind = 'orb', extra = null) {
    const level = this.difficulty.patternLevel;
    if (level < 0 && count > 3) count -= 2;
    if (level > 0) {
      count += level * 2;
      // Limit the total fan width so the added spokes remain readable.
      spacing = spacing || 0.14;
      spacing = Math.min(spacing, 2.7 / Math.max(1, count - 1));
    }
    for (let i = 0; i < count; i++) {
      this.spawnBullet(source.x, source.y + 18, angle + (i - (count - 1) / 2) * spacing, speed, color, kind, 5, extra);
    }
  }

  fireOpenRing(source, gap, count, opening, speed, color, offset = 0) {
    const level = this.difficulty.patternLevel;
    count += level < 0 ? -2 : level * 4;
    opening = level < 0 ? opening + 0.12 : Math.max(0.22, opening - level * 0.035);
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU + offset;
      const fromGap = Math.atan2(Math.sin(angle - gap), Math.cos(angle - gap));
      if (Math.abs(fromGap) < opening) continue;
      this.spawnBullet(source.x, source.y + 18, angle, speed, color, 'diamond');
    }
  }

  updateBullets(dt) {
    const p = this.player;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.age += dt;
      if (b.turn && b.age <= b.turnFor) {
        const cos = Math.cos(b.turn * dt);
        const sin = Math.sin(b.turn * dt);
        const vx = b.vx * cos - b.vy * sin;
        b.vy = b.vx * sin + b.vy * cos;
        b.vx = vx;
      }
      if (b.accel) {
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const next = clamp(speed + b.accel * dt, b.vmin, b.vmax);
        b.vx *= next / speed;
        b.vy *= next / speed;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.bounce > 0 && ((b.x < b.r && b.vx < 0) || (b.x > WIDTH - b.r && b.vx > 0))) {
        b.vx = -b.vx;
        b.bounce--;
        this.emit('bounce', { x: b.x, y: b.y, color: b.color });
      }
      const stage = b.stage;
      if (stage && b.age >= stage.at) {
        b.stage = null;
        if (stage.kind === 'aim') {
          const angle = Math.atan2(p.y - b.y, p.x - b.x);
          const speed = stage.speed * this.difficulty.bulletSpeed;
          b.vx = Math.cos(angle) * speed;
          b.vy = Math.sin(angle) * speed;
          b.accel = 0;
          b.turn = 0;
        } else if (stage.kind === 'split') {
          b.dead = true;
          const heading = Math.atan2(b.vy, b.vx);
          this.emit('ring', { x: b.x, y: b.y, radius: 30, life: 0.3, color: stage.color });
          for (let i = 0; i < stage.count; i++) {
            this.spawnBullet(b.x, b.y, heading + (i + 0.5) / stage.count * TAU, stage.speed, stage.color, stage.bulletKind, 4.5);
          }
        }
      }
    }
  }

  // A beam is a telegraphed line: `warn` seconds of harmless tracer, then `life`
  // seconds of damage. It can follow an emitter and sweep while it burns.
  spawnBeam({ x = 0, y = 0, follow = null, owner = null, ox = 0, oy = 0, angle, length = 1000, width = 14,
    warn = 0.9, life = 0.7, sweep = 0, color = '#ffffff' }) {
    // Faster difficulties shorten the tracer, but never below three quarters.
    const tracer = warn * Math.max(0.75, 1 / Math.max(0.6, this.difficulty.fireRate));
    const beam = { x, y, follow, owner, ox, oy, angle, length, width, warn: tracer, warnTotal: tracer,
      life, lifeTotal: life, sweep, color, dead: false };
    if (follow) { beam.x = follow.x + ox; beam.y = follow.y + oy; }
    this.beams.push(beam);
    this.emit('beamWarn', { x: beam.x, y: beam.y, color });
    return beam;
  }

  updateBeams(dt) {
    for (const beam of this.beams) {
      if (beam.dead) continue;
      const owner = beam.owner;
      if (owner && (owner.hp <= 0 || owner.gone || (owner.phases && owner !== this.boss))) { beam.dead = true; continue; }
      if (beam.follow) { beam.x = beam.follow.x + beam.ox; beam.y = beam.follow.y + beam.oy; }
      if (beam.warn > 0) {
        beam.warn -= dt;
        if (beam.warn <= 0) this.emit('beamFire', { x: beam.x, y: beam.y, color: beam.color });
      } else {
        beam.life -= dt;
        beam.angle += beam.sweep * dt;
        if (beam.life <= 0) beam.dead = true;
      }
    }
    // A lancer stays parked for as long as one of its beams is alive.
    for (const e of this.enemies) if (e.type === 'lancer') e.firing = false;
    for (const beam of this.beams) if (!beam.dead && beam.owner && beam.owner.type === 'lancer') beam.owner.firing = true;
  }

  beamDistance(beam, point) {
    const cos = Math.cos(beam.angle);
    const sin = Math.sin(beam.angle);
    const dx = point.x - beam.x;
    const dy = point.y - beam.y;
    const along = clamp(dx * cos + dy * sin, 0, beam.length);
    return Math.hypot(dx - cos * along, dy - sin * along);
  }

  // ───────────────────────────── Boss ─────────────────────────────

  spawnBoss() {
    this.bossSpawned = true;
    for (const e of this.enemies) e.gone = true;
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.beams.length = 0;
    this.pendingHazards.length = 0;
    const health = Math.ceil(this.sector.bossHealth * this.difficulty.bossHealth);
    this.boss = {
      x: 240, y: -110, r: 51, hp: health, maxHp: health,
      variant: this.sectorIndex, phases: this.sector.phases, name: this.sector.bossName,
      phase: 0, phaseTime: 0, motionTime: 0, entering: true, transition: 0, hitFlash: 0,
      fireTimer: 0.65, volleys: 0, lastCrossfire: 0, pulseCycle: -1,
      spread: this.sectorIndex === 2 ? 54 : 62, parts: [{ x: 240, y: -110 }, { x: 240, y: -110 }],
    };
    placeParts(this.boss);
    this.say('WARNING / {boss}', 'Signal acquired. Hold your line.', 3, 'warn', { boss: this.sector.bossName });
    this.emit('warning', { variant: this.boss.variant });
  }

  updateBoss(dt) {
    const b = this.boss;
    if (!b) return;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    if (b.entering) {
      b.y = Math.min(112, b.y + 95 * dt);
      placeParts(b);
      if (b.y >= 112) { b.entering = false; this.signalPhase(); }
      return;
    }
    if (b.transition > 0) {
      b.transition = Math.max(0, b.transition - dt);
      placeParts(b);
      return;
    }
    b.phaseTime += dt;
    b.motionTime += dt;
    moveBoss(b);
    b.fireTimer -= dt * this.difficulty.fireRate;
    if (b.fireTimer > 0) return;
    const aim = Math.atan2(this.player.y - b.y, this.player.x - b.x);
    if (fireBoss(this, b, aim) === false) return;
    bossCrossfire(this, b);
    b.volleys++;
  }

  signalPhase() {
    const b = this.boss;
    const label = b.phases[b.phase];
    b.transition = 1.8;
    b.phaseTime = 0;
    b.fireTimer = 0.6;
    b.volleys = 0;
    b.lastCrossfire = 0;
    b.pulseCycle = -1;
    this.cancelBullets();
    this.beams.length = 0;
    this.pendingHazards.length = 0;
    this.say('PHASE 0{n} / {name}', label.subtitle, 2.3, 'phase', { n: b.phase + 1, name: label.name });
    this.emit('phase', { x: b.x, y: b.y, color: label.color, phase: b.phase });
  }

  damageBoss(damage) {
    const b = this.boss;
    if (!b || b.entering || b.transition > 0) return;
    const phaseFloor = b.phase < 2 ? b.maxHp * (2 - b.phase) / 3 : 0;
    b.hp = Math.max(phaseFloor, b.hp - damage);
    b.hitFlash = 0.06;
    if (b.hp <= 0) {
      this.emit('bossDown', { x: b.x, y: b.y, variant: b.variant });
      this.addScore(10000 + this.lives * 1500 + this.bombs * 500, false);
      this.boss = null;
      this.cancelBullets();
      this.shots.length = 0;
      this.pickups.length = 0;
      this.beams.length = 0;
      this.pendingHazards.length = 0;
      this.stats.sectorsCleared++;
      if (this.sectorIndex === SECTORS.length - 1) {
        this.finish('victory');
      } else {
        this.intermission = CONFIG.intermissionDuration;
        this.say('{label} CLEAR', 'NEXT / {name}', CONFIG.intermissionDuration, 'clear',
          { label: this.sector.label, name: SECTORS[this.sectorIndex + 1].name });
        this.persistBest();
        this.emit('sectorClear', { sector: this.sectorIndex });
      }
    } else if (b.hp <= phaseFloor) {
      b.phase++;
      this.addScore(1500, false);
      this.signalPhase();
    }
  }

  // Wiped bullets always pay out: they fall to the pilot as score motes.
  cancelBullets() {
    for (const bullet of this.bullets) {
      if (bullet.dead) continue;
      this.spawnMote(bullet.x, bullet.y);
    }
    this.bullets.length = 0;
  }

  // ───────────────────────────── Friendly projectiles ─────────────────────────────

  nearestTarget(x, y, range) {
    let best = null;
    let bestDistance = range * range;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.gone || e.alt < -20 || e.y < 0) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestDistance) { bestDistance = d; best = e; }
    }
    const b = this.boss;
    if (b && !b.entering && b.transition <= 0) {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bestDistance) best = b;
    }
    return best;
  }

  updateShots(dt) {
    for (const shot of this.shots) {
      if (shot.dead) continue;
      if (shot.homing) {
        const target = this.nearestTarget(shot.x, shot.y - 60, 300);
        if (target) {
          const speed = Math.hypot(shot.vx, shot.vy);
          const current = Math.atan2(shot.vy, shot.vx);
          const wanted = Math.atan2(target.y - shot.y, target.x - shot.x);
          const delta = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
          const angle = current + clamp(delta, -shot.homing * dt, shot.homing * dt);
          shot.vx = Math.cos(angle) * speed;
          shot.vy = Math.sin(angle) * speed;
        }
      }
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
    }
  }

  updateShards(dt) {
    for (const shard of this.shards) {
      if (shard.dead) continue;
      shard.age += dt;
      shard.life -= dt;
      if (shard.life <= 0) { shard.dead = true; continue; }
      let target = shard.target;
      if (!target || target.hp <= 0 || target.gone || (target.phases && target !== this.boss)) {
        target = shard.target = this.nearestTarget(shard.x, shard.y, Infinity);
      }
      if (target) {
        const dx = target.x - shard.x;
        const dy = target.y - shard.y;
        const distance = Math.hypot(dx, dy) || 1;
        // Shards flare outwards first, then the pull tightens until they connect.
        const pull = Math.min(1, dt * (2.5 + shard.age * 12));
        shard.vx += (dx / distance * CONFIG.shardSpeed - shard.vx) * pull;
        shard.vy += (dy / distance * CONFIG.shardSpeed - shard.vy) * pull;
        if (distance < target.r + 8) {
          shard.dead = true;
          this.emit('spark', { x: shard.x, y: shard.y, color: shard.color });
          if (target === this.boss) this.damageBoss(this.ship.shardDamage);
          else this.damageEnemy(target, this.ship.shardDamage);
          continue;
        }
      } else {
        shard.vx *= 1 - Math.min(1, dt * 2);
        shard.vy -= 420 * dt;
      }
      shard.x += shard.vx * dt;
      shard.y += shard.vy * dt;
    }
  }

  spawnMote(x, y) {
    if (this.motes.length >= CONFIG.moteLimit) { this.addScore(CONFIG.moteScore * 0.5); return; }
    const angle = this.rand() * TAU;
    const speed = 30 + this.rand() * 90;
    this.motes.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, dead: false });
  }

  updateMotes(dt) {
    const p = this.player;
    for (const mote of this.motes) {
      if (mote.dead) continue;
      mote.age += dt;
      if (mote.age < 0.3) {
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        continue;
      }
      const dx = p.x - mote.x;
      const dy = p.y - mote.y;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = (240 + mote.age * 620) * dt;
      if (distance <= Math.max(reach, 14)) {
        mote.dead = true;
        this.addScore(CONFIG.moteScore);
        this.addFlux(CONFIG.fluxPerMote);
        this.emit('mote', { x: p.x, y: p.y });
        continue;
      }
      mote.x += dx / distance * reach;
      mote.y += dy / distance * reach;
    }
  }

  // ───────────────────────────── Supplies ─────────────────────────────

  spawnPickup(type, x, y) {
    if (!SUPPLY_TYPES.includes(type)) throw new RangeError(`Unknown supply: ${type}`);
    this.pickups.push({ type, x: clamp(x, 20, WIDTH - 20), y, r: 12, age: 0, dead: false });
  }

  updatePickups(dt) {
    const p = this.player;
    for (const pickup of this.pickups) {
      if (pickup.dead) continue;
      pickup.age += dt;
      const distance = Math.sqrt(distanceSquared(pickup, p));
      if (distance < CONFIG.pickupMagnetRadius && distance > 0) {
        const travel = Math.min(distance, 220 * dt);
        pickup.x += (p.x - pickup.x) / distance * travel;
        pickup.y += (p.y - pickup.y) / distance * travel;
      } else {
        pickup.y += CONFIG.pickupSpeed * dt;
      }
    }
  }

  collectPickup(pickup) {
    if (pickup.dead) return;
    pickup.dead = true;
    let title;
    let subtitle;
    let vars = null;
    let full = false;
    if (pickup.type === 'power') {
      full = this.power === CONFIG.maxPower;
      this.power = Math.min(CONFIG.maxPower, this.power + 1);
      title = 'POWER UP';
      subtitle = full ? 'Weapon at maximum · bonus score' : ['', '', 'Wisps online', 'Spread widened', 'Weapon at maximum'][this.power];
    } else if (pickup.type === 'bomb') {
      full = this.bombs === CONFIG.maxBombs;
      this.bombs = Math.min(CONFIG.maxBombs, this.bombs + 1);
      title = 'NOVA STOCK';
      subtitle = full ? 'Stock full · bonus score' : 'One nova added';
    } else if (pickup.type === 'shield') {
      full = this.shield;
      this.shield = true;
      title = 'SHIELD ONLINE';
      subtitle = full ? 'Already shielded · bonus score' : 'One-hit guard';
    } else {
      full = this.overdrive;
      this.addFlux(CONFIG.fluxSegment / this.fluxRate);
      title = 'FLUX CELL';
      subtitle = full ? 'Gauge full · bonus score' : 'One drift charged';
    }
    this.addScore(full ? 750 : 250, false);
    this.emit('pickup', { x: pickup.x, y: pickup.y, type: pickup.type });
    // A supply never hides an active boss warning or phase instruction.
    if (!this.banner) this.say(title, subtitle, 1.35, 'pickup', vars);
  }

  // ───────────────────────────── Collisions ─────────────────────────────

  handleCollisions() {
    const p = this.player;
    for (const shot of this.shots) {
      if (shot.dead) continue;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.alt < -20 || !overlaps(shot, e)) continue;
        shot.dead = true;
        this.emit('spark', { x: shot.x, y: shot.y, color: e.color });
        this.damageEnemy(e, shot.dmg);
        break;
      }
      const b = this.boss;
      if (!shot.dead && b && overlaps(shot, b)) {
        shot.dead = true;
        this.emit('spark', { x: shot.x, y: shot.y, color: '#ffffff' });
        this.damageBoss(shot.dmg);
      }
    }
    if (this.mode !== 'playing' || this.intermission > 0) return;

    for (const pickup of this.pickups) {
      if (!pickup.dead && distanceSquared(p, pickup) < CONFIG.pickupCollectRadius ** 2) this.collectPickup(pickup);
    }
    if (p.invulnerable > 0) return;

    for (const bullet of this.bullets) {
      if (!bullet.dead && overlaps(p, bullet)) {
        bullet.dead = true;
        if (this.hitPlayer()) return;
      }
    }
    let nearBeam = false;
    for (const beam of this.beams) {
      if (beam.dead || beam.warn > 0) continue;
      const distance = this.beamDistance(beam, p);
      if (distance < beam.width * 0.4 + p.r) { if (this.hitPlayer()) return; }
      else if (distance < beam.width * 0.5 + this.ship.grazeRadius) nearBeam = true;
    }
    for (const e of this.enemies) {
      if (e.hp > 0 && e.alt >= -20 && overlaps(p, e) && this.hitPlayer()) return;
    }
    if (this.boss && !this.boss.entering && overlaps(p, this.boss) && this.hitPlayer()) return;

    // Graze: every bullet pays once; riding a live beam pays ten times a second.
    for (const bullet of this.bullets) {
      if (bullet.dead || bullet.grazed) continue;
      if (distanceSquared(p, bullet) < (this.ship.grazeRadius + bullet.r) ** 2) {
        bullet.grazed = true;
        this.graze(CONFIG.grazeScore, CONFIG.fluxPerGraze);
      }
    }
    if (nearBeam) {
      p.beamGraze += this.dt;
      if (p.beamGraze >= 0.1) {
        p.beamGraze -= 0.1;
        this.graze(10, CONFIG.fluxPerBeamTick);
      }
    } else {
      p.beamGraze = 0;
    }
  }

  graze(points, flux) {
    this.stats.grazes++;
    this.bumpChain(CONFIG.chainPerGraze);
    this.addScore(points);
    this.addFlux(flux);
    this.emit('graze', { x: this.player.x, y: this.player.y });
  }

  // Returns true when the hit landed (shield or life), false when it was ignored.
  hitPlayer() {
    const p = this.player;
    if (this.mode !== 'playing' || this.intermission > 0 || p.invulnerable > 0 || this.cheats.god) return false;
    p.invulnerable = CONFIG.hitInvulnerability;
    for (const bullet of this.bullets) {
      if (!bullet.dead && distanceSquared(bullet, p) <= CONFIG.hitClearRadius ** 2) bullet.dead = true;
    }
    if (this.shield) {
      this.shield = false;
      this.emit('shield', { x: p.x, y: p.y });
      return true;
    }
    this.lives--;
    this.stats.hits++;
    this.power = Math.max(1, this.power - 1);
    this.chain = 1;
    this.chainTimer = 0;
    this.emit('hit', { x: p.x, y: p.y });
    if (this.lives <= 0) this.finish('gameover');
    return true;
  }

  useBomb() {
    if (this.mode !== 'playing' || this.intermission > 0 || this.bombs <= 0) return false;
    const p = this.player;
    this.bombs--;
    this.stats.bombsUsed++;
    this.addScore(this.bullets.length * 5, false);
    this.cancelBullets();
    this.beams.length = 0;
    this.pendingHazards.length = 0;
    p.invulnerable = Math.max(p.invulnerable, CONFIG.bombInvulnerability);
    this.emit('bomb', { x: p.x, y: p.y });
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.alt < -20) continue;
      e.hp -= CONFIG.bombDamage;
      e.hitFlash = 0.07;
      if (e.hp <= 0) this.killEnemy(e, false);
    }
    this.damageBoss(CONFIG.bombDamage);
    return true;
  }

  finish(mode) {
    this.mode = mode;
    this.banner = null;
    this.player.drift = null;
    this.persistBest();
    this.emit(mode, { x: this.player.x, y: this.player.y });
  }

  cleanup() {
    const inBounds = p => !p.dead && p.x > -60 && p.x < WIDTH + 60 && p.y > -140 && p.y < HEIGHT + 60;
    compact(this.enemies, e => {
      const keep = e.hp > 0 && !e.gone && e.y < HEIGHT + 50 && e.x > -70 && e.x < WIDTH + 70;
      if (!keep) e.gone = true;
      return keep;
    });
    compact(this.bullets, inBounds);
    compact(this.shots, inBounds);
    compact(this.shards, s => !s.dead && s.y > -200 && s.y < HEIGHT + 200);
    compact(this.motes, m => !m.dead && m.age < 8);
    compact(this.beams, b => !b.dead);
    compact(this.pickups, p => inBounds(p) && p.age < 18);
  }
}
