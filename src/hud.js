import { CONFIG } from './sim/config.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);
const clamp01 = v => Math.max(0, Math.min(1, v));
export const formatScore = value => String(Math.max(0, Math.floor(value))).padStart(6, '0');
export const formatClock = seconds => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

// The in-flight interface. It only touches the DOM when a displayed value has
// actually changed, so sixty updates a second cost next to nothing.
export class Hud {
  constructor() {
    this.root = $('hud');
    this.score = $('score');
    this.best = $('best');
    this.chain = $('chain');
    this.chainValue = $('chain-value');
    this.chainMeter = $('chain-meter');
    this.flux = $('flux');
    this.fluxState = $('flux-state');
    this.fluxCells = [...this.flux.querySelectorAll('.flux-cells i')];
    this.lives = this.pips($('lives'), CONFIG.maxLives);
    this.bombs = this.pips($('bombs'), CONFIG.maxBombs);
    this.power = this.pips($('power'), CONFIG.maxPower);
    this.shield = $('shield');
    this.graze = $('graze');
    this.runClass = $('run-class');
    this.progress = $('progress');
    this.stageLabel = $('stage-label');
    this.stageMeter = $('stage-meter');
    this.stageClock = $('stage-clock');
    this.bossbar = $('bossbar');
    this.bossName = $('boss-name');
    this.bossPhase = $('boss-phase');
    this.bossCells = [...this.bossbar.querySelectorAll('.boss-cells b')];
    this.banner = $('banner');
    this.bannerTitle = $('banner-title');
    this.bannerSub = $('banner-sub');
    this.toastElement = $('toast');
    this.floaters = $('floaters');
    this.cache = new Map();
    this.shownBanner = null;
    this.toastLeft = 0;
  }

  pips(host, count) {
    const items = Array.from({ length: count }, () => document.createElement('i'));
    host.replaceChildren(...items);
    return { host, items };
  }

  // Runs `apply` only when `value` differs from what is already on screen.
  put(key, value, apply) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value);
  }

  text(key, element, value) {
    this.put(key, value, v => { element.textContent = v; });
  }

  count(key, group, value, label) {
    this.put(key, value, v => {
      group.items.forEach((pip, index) => pip.classList.toggle('on', index < v));
      group.host.setAttribute('aria-label', label);
    });
  }

  // Forget everything: the next update repaints the lot (new run, new language).
  refresh() {
    this.cache.clear();
    this.shownBanner = null;
    this.banner.hidden = true;
  }

  reset() {
    this.refresh();
    this.clearToast();
    this.floaters.replaceChildren();
  }

  // Pins the blocks to the projected corners of the playfield.
  layout(rect, width) {
    const style = document.documentElement.style;
    const px = value => `${value.toFixed(1)}px`;
    style.setProperty('--f-tl', px(rect.topLeft.x));
    style.setProperty('--f-tr', px(rect.topRight.x));
    style.setProperty('--f-bl', px(rect.bottomLeft.x));
    style.setProperty('--f-br', px(rect.bottomRight.x));
    style.setProperty('--f-top', px(rect.topLeft.y));
    style.setProperty('--f-bottom', px(rect.bottomLeft.y));
    style.setProperty('--f-cx', px((rect.topLeft.x + rect.topRight.x) / 2));
    style.setProperty('--f-top-w', px(rect.topRight.x - rect.topLeft.x));
    // Without room beside the field, the interface moves inside it.
    const compact = rect.bottomLeft.x < 214 || width - rect.bottomRight.x < 214;
    document.body.classList.toggle('compact', compact);
    // The pause and sound buttons own the top right corner: whatever would sit under them moves down.
    const barLeft = width - 262;
    const blockRight = compact ? rect.topRight.x - 12 : rect.topRight.x + 38 + 118;
    document.body.classList.toggle('drop-right', blockRight > barLeft);
    document.body.classList.toggle('drop-top', rect.topRight.x - 20 > barLeft);
  }

  update(game, { driftKey }) {
    this.text('score', this.score, formatScore(game.score));
    this.text('best', this.best, formatScore(game.best));

    const chain = game.chain;
    this.text('chain', this.chainValue, `×${chain.toFixed(1)}`);
    this.put('chainTone', chain >= CONFIG.chainMax - 0.005 ? 'max' : chain >= 4 ? 'hot' : chain >= 1.05 ? 'live' : '',
      tone => { this.chain.className = `chain ${tone}`.trim(); });
    this.put('chainHold', chain > 1.001 ? Math.round(clamp01(game.chainTimer / CONFIG.chainHold) * 66) : 0,
      v => { this.chainMeter.style.transform = `scaleX(${v / 66})`; });

    const segments = game.fluxSegments;
    this.fluxCells.forEach((cell, index) => {
      const fill = clamp01((game.flux - index * CONFIG.fluxSegment) / CONFIG.fluxSegment);
      this.put(`flux${index}`, Math.round(fill * 50), v => {
        cell.firstElementChild.style.transform = `scaleX(${v / 50})`;
        cell.classList.toggle('full', v === 50);
      });
    });
    this.put('fluxState', game.overdrive ? 'overdrive' : segments > 0 ? `ready:${driftKey}` : '', state => {
      this.flux.classList.toggle('overdrive', state === 'overdrive');
      this.flux.classList.toggle('ready', state.startsWith('ready'));
      this.fluxState.textContent = state === 'overdrive' ? t('OVERDRIVE') : state ? t('DRIFT {key}', { key: driftKey }) : '';
    });

    this.count('lives', this.lives, game.lives, t('{count} lives', { count: game.lives }));
    this.count('bombs', this.bombs, game.bombs, t('{count} novas', { count: game.bombs }));
    this.count('power', this.power, game.power, `${game.power} / ${CONFIG.maxPower}`);
    this.put('shield', game.shield, on => {
      this.shield.textContent = t(on ? 'READY' : 'NONE');
      this.shield.classList.toggle('on', on);
    });
    this.text('graze', this.graze, String(game.stats.grazes));
    this.put('class', `${game.ship.id}:${game.difficulty.id}`, () => {
      this.runClass.textContent = `${t(game.ship.id.toUpperCase())} · ${t(game.difficulty.id.toUpperCase())}`;
      this.runClass.style.setProperty('--class', game.difficulty.color);
    });

    const boss = game.boss;
    this.put('bossShown', Boolean(boss), shown => {
      this.bossbar.hidden = !shown;
      this.progress.hidden = shown;
    });
    if (boss) {
      const phase = boss.phases[boss.phase];
      this.put('bossColor', phase.color, color => this.root.style.setProperty('--boss', color));
      this.text('bossName', this.bossName, t(boss.name));
      this.text('bossPhase', this.bossPhase, t(phase.name));
      // Three cells, one per phase; the rightmost drains first.
      const third = boss.maxHp / 3;
      this.bossCells.forEach((cell, index) => {
        this.put(`boss${index}`, Math.round(clamp01((boss.hp - index * third) / third) * 240),
          v => { cell.style.transform = `scaleX(${v / 240})`; });
      });
    } else if (game.intermission > 0) {
      this.text('stageLabel', this.stageLabel, t('NEXT SECTOR'));
      this.text('stageClock', this.stageClock, '');
      this.put('stageMeter', Math.round((1 - game.intermission / CONFIG.intermissionDuration) * 300),
        v => { this.stageMeter.style.transform = `scaleX(${v / 300})`; });
    } else {
      const { label, duration } = game.sector;
      this.text('stageLabel', this.stageLabel, t(label));
      this.text('stageClock', this.stageClock, formatClock(duration - game.stageTime));
      this.put('stageMeter', Math.round(clamp01(game.stageTime / duration) * 300),
        v => { this.stageMeter.style.transform = `scaleX(${v / 300})`; });
    }

    const banner = game.banner;
    if (banner !== this.shownBanner) {
      this.shownBanner = banner;
      // Hiding and re-showing restarts the entrance animation.
      this.banner.hidden = true;
      if (banner) {
        this.bannerTitle.textContent = t(banner.title, banner.vars);
        this.bannerSub.textContent = t(banner.subtitle, banner.vars);
        this.banner.dataset.tone = banner.tone;
        void this.banner.offsetWidth;
        this.banner.hidden = false;
      }
    }
    if (banner) {
      this.put('bannerFade', Math.round(clamp01(banner.remaining / 0.35) * 20), v => { this.banner.style.opacity = String(v / 20); });
    }
  }

  // Only counts down while the flight is live, so a hint survives a pause.
  tick(dt) {
    if (this.toastLeft <= 0) return;
    this.toastLeft -= dt;
    if (this.toastLeft <= 0) this.toastElement.hidden = true;
  }

  toast(text, seconds = 5) {
    this.toastElement.hidden = true;
    this.toastElement.textContent = text;
    void this.toastElement.offsetWidth;
    this.toastElement.hidden = false;
    this.toastLeft = seconds;
  }

  clearToast() {
    this.toastLeft = 0;
    this.toastElement.hidden = true;
  }

  // A short-lived label at a screen position, e.g. the size of a slipstream.
  floater(text, x, y, color = '') {
    const node = document.createElement('div');
    node.className = 'floater';
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (color) node.style.color = color;
    this.floaters.append(node);
    node.addEventListener('animationend', () => node.remove());
    setTimeout(() => node.remove(), 1600);
  }
}
