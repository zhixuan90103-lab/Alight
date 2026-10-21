import { bagMouth } from './bag';
import { worldToDesign } from './frame';
import type { Sim, SimSample } from './sim';
import { BAGS, BAG_SPEC, BALL_QUEUE, COLOR_SCORE, LEVEL_BALLS, LEVEL_COUNT, LEVEL_ID, SHOW_BAG } from './tune';
import { hudIcon, mountTunePanel } from './tunePanel';

/** Design pixels from the bowl lip down to the score. */
const BAG_COUNT_DROP = 28;

/**
 * Level 1: 5 in the bowl is 3 stars, 3–4 is 2, 1–2 is 1.
 * Level 2: every ball in its own color is 3. One or more right, and at most two wrong, is 2.
 * One or more right and three or more wrong is 1. None right is 0.
 */
export function starsFor(outcome: { inBag: number; matched: number }): number {
  if (!COLOR_SCORE) {
    if (outcome.inBag >= LEVEL_BALLS) return 3;
    if (outcome.inBag >= 3) return 2;
    if (outcome.inBag >= 1) return 1;
    return 0;
  }
  const wrong = LEVEL_BALLS - outcome.matched;
  if (outcome.matched >= LEVEL_BALLS) return 3;
  if (outcome.matched >= 1 && wrong <= 2) return 2;
  if (outcome.matched >= 1) return 1;
  return 0;
}

export type Hud = {
  /** Pips and the bowl score. Both read one sample. */
  sync(sample: SimSample): void;
  showResult(stars: number): void;
  hideResult(): void;
};

function iconButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-icon-btn';
  button.setAttribute('aria-label', label);
  return button;
}

/** Ball pips, bowl score, settings, replay, and the result card. */
export function mountHud(uiRoot: HTMLElement, sim: Sim, replay: () => void, nextLevel: () => void, jumpLevel: () => void): Hud {
  const hud = document.createElement('div');
  hud.id = 'hud';

  const top = document.createElement('div');
  top.id = 'hud-top';

  const balls = document.createElement('div');
  balls.id = 'balls';
  balls.setAttribute('aria-label', `本关 ${LEVEL_BALLS} 颗球`);
  const pips: HTMLElement[] = [];
  for (let i = 0; i < LEVEL_BALLS; i++) {
    const dot = document.createElement('span');
    dot.className = 'ball-pip';
    balls.append(dot);
    pips.push(dot);
  }

  const actions = document.createElement('div');
  actions.id = 'hud-actions';
  const again = iconButton('重玩');
  again.append(hudIcon('arrow-clockwise'));
  again.addEventListener('click', replay);
  const jump = iconButton('跳关');
  jump.append(hudIcon('arrow-right'));
  jump.addEventListener('click', jumpLevel);

  top.append(balls, actions);
  hud.append(top);
  uiRoot.prepend(hud);
  actions.append(again, jump);
  mountTunePanel(uiRoot, actions, sim);

  const result = document.createElement('div');
  result.id = 'result';
  result.hidden = true;

  const card = document.createElement('div');
  card.className = 'result-card';

  const stars = document.createElement('div');
  stars.id = 'result-stars';
  const starEls: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const star = document.createElement('span');
    star.className = 'result-star';
    star.append(hudIcon('star'));
    stars.append(star);
    starEls.push(star);
  }

  const resultActions = document.createElement('div');
  resultActions.id = 'result-actions';
  const resultReplay = iconButton('重玩');
  resultReplay.append(hudIcon('arrow-clockwise'));
  resultReplay.addEventListener('click', replay);

  const next = iconButton('下一关');
  next.append(hudIcon('arrow-right'));
  next.addEventListener('click', nextLevel);

  resultActions.append(resultReplay, next);
  card.append(stars, resultActions);
  result.append(card);
  uiRoot.append(result);

  const bagCounts = [0, 1].map(() => {
    const el = document.createElement('div');
    el.className = 'bag-count';
    el.textContent = '0/0';
    uiRoot.append(el);
    return el;
  });

  const stop = (event: Event) => event.stopPropagation();
  hud.addEventListener('pointerdown', stop);
  result.addEventListener('pointerdown', stop);

  return {
    sync(sample: SimSample) {
      while (pips.length < LEVEL_BALLS) {
        const dot = document.createElement('span');
        dot.className = 'ball-pip';
        balls.append(dot);
        pips.push(dot);
      }
      balls.setAttribute('aria-label', `本关 ${LEVEL_BALLS} 颗球`);
      const sent = { gold: 0, blue: 0 };
      for (const color of sample.issuedColors) sent[color] += 1;
      const seen = { gold: 0, blue: 0 };
      pips.forEach((pip, i) => {
        const live = i < LEVEL_BALLS;
        pip.hidden = !live;
        if (!live) return;
        const color = BALL_QUEUE[i] ?? 'gold';
        seen[color] += 1;
        pip.classList.toggle('is-empty', sent[color] >= seen[color]);
        pip.classList.toggle('is-blue', color === 'blue');
      });
      for (let i = 0; i < bagCounts.length; i++) {
        const el = bagCounts[i];
        const bag = sample.bags[i];
        const show = Boolean(bag) && SHOW_BAG && !bag.gone && Boolean(BAGS[i]);
        el.style.display = show ? 'block' : 'none';
        if (!show || !BAGS[i]) continue;
        const mouth = bagMouth(BAGS[i]);
        const design = worldToDesign(mouth.x - sample.look.x, mouth.y - sample.look.y);
        el.style.left = `${design.x}px`;
        el.style.top = `${design.y + BAG_COUNT_DROP}px`;
        el.classList.toggle('is-blue', BAG_SPEC[i]?.color === 'blue');
        const text = `${bag.count}/${BAG_SPEC[i]?.quota ?? LEVEL_BALLS}`;
        if (el.textContent !== text) el.textContent = text;
      }
    },
    showResult(count: number) {
      starEls.forEach((el, i) => {
        const img = el.querySelector('img');
        if (img) img.src = `./icons/${i < count ? 'star-fill' : 'star'}.svg`;
      });
      next.hidden = count <= 0 || LEVEL_ID >= LEVEL_COUNT;
      actions.hidden = true;
      result.hidden = false;
    },
    hideResult() {
      actions.hidden = false;
      result.hidden = true;
    },
  };
}
