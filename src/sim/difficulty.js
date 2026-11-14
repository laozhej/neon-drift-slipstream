// Shared by the launch selector and the fixed-step simulation. Normal keeps the
// reference tuning; the other classes reshape patterns rather than only speed.
export const DIFFICULTIES = Object.freeze([
  { id: 'easy', color: '#7af5d6', startingLives: 5, startingBombs: 3, startingShield: true,
    bulletSpeed: 0.78, fireRate: 0.8, scoreMultiplier: 0.75, patternLevel: -1,
    enemyHealth: 0.8, bossHealth: 0.84, fluxGain: 1.35 },
  { id: 'normal', color: '#7ccfff', startingLives: 3, startingBombs: 2, startingShield: false,
    bulletSpeed: 1, fireRate: 1, scoreMultiplier: 1, patternLevel: 0,
    enemyHealth: 1, bossHealth: 1, fluxGain: 1 },
  { id: 'hard', color: '#ffd17a', startingLives: 3, startingBombs: 2, startingShield: false,
    bulletSpeed: 1.18, fireRate: 1.16, scoreMultiplier: 1.5, patternLevel: 1,
    enemyHealth: 1, bossHealth: 1, fluxGain: 0.9 },
  { id: 'lunatic', color: '#d5a2ff', startingLives: 2, startingBombs: 2, startingShield: false,
    bulletSpeed: 1.35, fireRate: 1.35, scoreMultiplier: 2, patternLevel: 2,
    enemyHealth: 1, bossHealth: 1, fluxGain: 0.8 },
  { id: 'extreme', color: '#ff719f', startingLives: 2, startingBombs: 1, startingShield: false,
    bulletSpeed: 1.52, fireRate: 1.5, scoreMultiplier: 3, patternLevel: 3,
    enemyHealth: 1, bossHealth: 1, fluxGain: 0.7 },
].map(profile => Object.freeze(profile)));

export function getDifficulty(id) {
  return DIFFICULTIES.find(profile => profile.id === id) ?? DIFFICULTIES[1];
}
