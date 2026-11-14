import { CONFIG, WIDTH } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Each boss keeps two satellite parts (wing cannons, mirrors, orbiters). Patterns
// fire from them and the renderer draws them, so they live in the simulation.
export function moveBoss(b) {
  const t = b.motionTime;
  if (b.variant === 1) {
    b.x = 240 + Math.sin(t * 0.5) * 120;
    b.y = 112 + Math.sin(t) * 12;
  } else if (b.variant === 2) {
    b.x = 240 + Math.sin(t * 0.6) * 100;
    b.y = 112 + Math.sin(t * 1.2) * 20;
  } else {
    b.x = 240 + Math.sin(t * 0.65) * 105;
    b.y = 112 + Math.sin(t * 0.85) * 16;
  }
  placeParts(b);
}

export function placeParts(b) {
  const [left, right] = b.parts;
  if (b.variant === 1) {
    // The mirrors open wider once the fans give way to the curtain.
    const target = b.phase === 0 ? 62 : 92;
    b.spread += (target - b.spread) * 0.02;
    left.x = b.x - b.spread; right.x = b.x + b.spread;
    left.y = right.y = b.y + 4;
  } else if (b.variant === 2) {
    const angle = b.motionTime * 0.7;
    const target = b.phase === 1 ? 74 : 54;
    b.spread += (target - b.spread) * 0.02;
    left.x = b.x - Math.cos(angle) * b.spread; left.y = b.y - Math.sin(angle) * b.spread * 0.4;
    right.x = b.x + Math.cos(angle) * b.spread; right.y = b.y + Math.sin(angle) * b.spread * 0.4;
  } else {
    left.x = b.x - 74; right.x = b.x + 74;
    left.y = right.y = b.y + 6;
  }
}

// Returns false while the boss is deliberately resting, so no volley is counted.
export function fireBoss(game, b, aim) {
  return SCRIPTS[b.variant](game, b, aim, CONFIG.bossBulletSpeed);
}

// Sector 01. Aimed fans, opening rings and a spiral, as in the original fight,
// now bracketed by wing rails, heavy orbs and arms that curve.
function dreadnought(g, b, aim, speed) {
  const level = g.difficulty.patternLevel;
  if (b.phase === 0) {
    b.fireTimer += 1.05;
    g.fireFan(b, aim, 7, 0.165, speed + 12, '#ff7397');
    if (b.volleys % 3 === 2) g.fireFan(b, aim + 0.0825, 6, 0.165, speed - 23, '#ffb17f');
    if (b.volleys % 5 === 3) {
      for (const part of b.parts) {
        g.spawnBeam({ follow: part, owner: b, oy: 12, angle: Math.PI / 2, warn: 1.05, life: 0.85, width: 16, color: '#ff7397' });
      }
    }
  } else if (b.phase === 1) {
    b.fireTimer += 1.24;
    // A broad opening follows the pilot's direction at the moment of emission.
    g.fireOpenRing(b, aim, 24, 0.30, speed - 20, '#ffd477', b.volleys * 0.19);
    if (b.volleys % 3 === 1) {
      const count = 8 + Math.max(0, level) * 2;
      for (let i = 0; i < count; i++) {
        g.spawnBullet(b.x, b.y + 18, aim + (i + 0.5) / count * TAU, 46, '#ff9be0', 'heavy', 8, { accel: 55, vmax: 175 });
      }
    }
  } else {
    // Seven seconds of interleaving arms, then a clear 1.8-second breath. The
    // curl reverses every cycle, so the gaps never settle into one direction.
    if (b.phaseTime % 8.8 > 7) { b.fireTimer = 0.12; return false; }
    b.fireTimer += 0.14;
    const arms = 3 + level;
    const curl = Math.floor(b.phaseTime / 8.8) % 2 ? -1 : 1;
    for (let arm = 0; arm < arms; arm++) {
      g.spawnBullet(b.x, b.y + 18, curl * b.phaseTime * 1.12 + arm * TAU / arms, speed - 8, '#dd99ff', 'orb', 4.5,
        { turn: curl * 0.24, turnFor: 1.5 });
    }
  }
  return true;
}

// Sector 02. The mirrors rebound their fans off the walls, cross their beams
// over the curtain, and the last phase throws prisms that split in flight.
function mirrorWarden(g, b, aim, speed) {
  const level = g.difficulty.patternLevel;
  const p = g.player;
  if (b.phase === 0) {
    b.fireTimer += 1.3;
    for (const part of b.parts) {
      const direction = Math.atan2(p.y - part.y, p.x - part.x);
      g.fireFan(part, direction, 5, 0.21, speed - 11, '#86cfff', 'diamond', { bounce: 1 });
    }
  } else if (b.phase === 1) {
    b.fireTimer += 1.05;
    const openingX = WIDTH / 2 + Math.sin(b.volleys * 0.45) * 135;
    // A visible, gently moving corridor spans at least one entire column.
    for (let x = 40; x <= WIDTH - 40; x += 50 - level * 6) {
      if (Math.abs(x - openingX) < 68 - level * 7) continue;
      g.spawnBullet(x, b.y + 28, Math.PI / 2, speed - 9, '#b5a3ff', 'diamond', 5);
    }
    if (b.volleys % 6 === 4) {
      for (const part of b.parts) {
        g.spawnBeam({ follow: part, owner: b, angle: Math.atan2(p.y - part.y, p.x - part.x),
          warn: 1.15, life: 0.6, width: 13, color: '#b5a3ff' });
      }
    }
  } else {
    b.fireTimer += 1.12;
    g.fireOpenRing(b, aim, 22, 0.38, speed - 17, '#82f6e9', b.volleys * -0.23);
    if (b.volleys % 3 === 2) {
      const shards = 6 + Math.max(0, level) * 2;
      for (const offset of [-0.5, 0, 0.5]) {
        g.spawnBullet(b.x, b.y + 18, aim + offset, speed - 30, '#d8f6ff', 'heavy', 8,
          { stage: { at: 1, kind: 'split', count: shards, speed: speed - 25, color: '#82f6e9', bulletKind: 'diamond' } });
      }
    }
  }
  return true;
}

// Sector 03. Sweeping arcs, orbiting emitters and counter-rotating spirals,
// joined by a flare beam, needle bursts and orbs that hang before they strike.
function helixCrown(g, b, aim, speed) {
  const level = g.difficulty.patternLevel;
  const p = g.player;
  if (b.phase === 0) {
    b.fireTimer += 1.08;
    g.fireFan(b, Math.PI / 2 + Math.sin(b.phaseTime * 0.75) * 0.42, 9, 0.19, speed - 3, '#ffb978', 'diamond');
    if (b.volleys % 6 === 4) {
      // The flare starts outside the pilot's half and stops short of the middle,
      // so crossing to the other half is always a way out.
      const side = p.x < b.x ? -1 : 1;
      g.spawnBeam({ follow: b, owner: b, oy: 18, angle: Math.PI / 2 - side * 0.62, sweep: side * 0.29,
        warn: 1.1, life: 2.3, width: 18, color: '#ffd27a' });
    }
  } else if (b.phase === 1) {
    b.fireTimer += 1.48;
    b.parts.forEach((part, index) => {
      const side = index ? 1 : -1;
      const direction = Math.atan2(p.y - part.y, p.x - part.x);
      g.fireOpenRing(part, direction, 16, 0.48, speed - 23, '#ff819b', side * b.volleys * 0.16);
    });
    if (b.volleys % 2 === 1) g.fireFan(b, aim, 3, 0.12, speed + 70, '#fff0c0', 'needle');
  } else {
    // Counter-rotating pairs pause for two seconds after every five-second pulse.
    if (b.phaseTime % 7 > 5) { b.fireTimer = 0.12; return false; }
    const cycle = Math.floor(b.phaseTime / 7);
    if (b.pulseCycle !== cycle) {
      b.pulseCycle = cycle;
      if (cycle > 0) {
        const count = 8 + Math.max(0, level) * 2;
        for (let i = 0; i < count; i++) {
          g.spawnBullet(b.x, b.y + 18, i / count * TAU, 120, '#fff0c0', 'heavy', 8,
            { accel: -95, vmin: 6, stage: { at: 1.6, kind: 'aim', speed: speed + 20 } });
        }
      }
    }
    b.fireTimer += 0.19;
    for (const side of [-1, 1]) {
      const arms = level < 0 ? 1 : 2 + level;
      for (let arm = 0; arm < arms; arm++) {
        g.spawnBullet(b.x + side * 28, b.y + 18, Math.PI / 2 + side * b.phaseTime * 0.85 + arm * TAU / arms,
          speed - 45, side < 0 ? '#f8d989' : '#ff997e', 'orb', 4.5, { accel: 45, vmax: speed + 5 });
      }
    }
  }
  return true;
}

const SCRIPTS = [dreadnought, mirrorWarden, helixCrown];

// Lunatic and Extreme add paired shots from the flanks. They bracket the aim
// instead of closing its central escape lane, and respect the rest windows.
export function bossCrossfire(g, b) {
  const level = g.difficulty.patternLevel;
  if (level < 2 || b.phaseTime - b.lastCrossfire < (level === 3 ? 2.15 : 2.9)) return;
  if (b.phase === 2 && ((b.variant === 0 && b.phaseTime % 8.8 > 7) || (b.variant === 2 && b.phaseTime % 7 > 5))) return;
  b.lastCrossfire = b.phaseTime;
  const speed = CONFIG.bossBulletSpeed;
  for (const side of [-1, 1]) {
    const source = { x: clamp(b.x + side * 96, 28, WIDTH - 28), y: b.y - 12 };
    const angle = Math.atan2(g.player.y - source.y, g.player.x - source.x);
    for (const offset of [-0.26, 0.26]) g.spawnBullet(source.x, source.y, angle + offset, speed - 32, '#f7a8ed', 'diamond', 4);
    g.emit('ring', { x: source.x, y: source.y, radius: 35, life: 0.38, color: '#f7a8ed' });
  }
}
