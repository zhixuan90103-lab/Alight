import { bagMouth } from './bag';
import { worldToDesign } from './frame';
import type { Sim, SimSample } from './sim';
import { BAGS, LEVEL_BALLS, SHOW_BAG } from './tune';
import { hudIcon, mountTunePanel } from './tunePanel';

/** Design pixels from the bowl lip down to the score. */
const BAG_COUNT_DROP = 28;

/** 5 in the bowl is 3 stars, 3–4 is 2, 1–2 is 1, none is a miss. */
export function starsFor(inBag: number): number {
  if (inBag >= LEVEL_BALLS) return 3;
  if (inBag >= 3) return 2;
  if (inBag >= 1) return 1;
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
export function mountHud(uiRoot: HTMLElement, sim: Sim, replay: () => void): Hud {
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

  top.append(balls, actions);
  hud.append(top);
  uiRoot.prepend(hud);
  actions.append(again);
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

  resultActions.append(resultReplay, next);
  card.append(stars, resultActions);
  result.append(card);
  uiRoot.append(result);

  const mouths = BAGS.map((bag) => bagMouth(bag));
  const bagCounts = mouths.map(() => {
    const el = document.createElement('div');
    el.className = 'bag-count';
    el.textContent = `0/${LEVEL_BALLS}`;
    uiRoot.append(el);
    return el;
  });

  const stop = (event: Event) => event.stopPropagation();
  hud.addEventListener('pointerdown', stop);
  result.addEventListener('pointerdown', stop);

  return {
    sync(sample: SimSample) {
      const gone = Math.min(LEVEL_BALLS, Math.max(0, sample.issued));
      pips.forEach((pip, i) => pip.classList.toggle('is-empty', i < gone));
      for (let i = 0; i < bagCounts.length; i++) {
        const el = bagCounts[i];
        const show = SHOW_BAG && !sample.bags[i].gone;
        el.style.display = show ? 'block' : 'none';
        const design = worldToDesign(mouths[i].x - sample.look.x, mouths[i].y - sample.look.y);
        el.style.left = `${design.x}px`;
        el.style.top = `${design.y + BAG_COUNT_DROP}px`;
        const text = `${sample.bags[i].count}/${LEVEL_BALLS}`;
        if (el.textContent !== text) el.textContent = text;
      }
    },
    showResult(count: number) {
      starEls.forEach((el, i) => {
        const img = el.querySelector('img');
        if (img) img.src = `./icons/${i < count ? 'star-fill' : 'star'}.svg`;
      });
      next.hidden = count <= 0;
      actions.hidden = true;
      result.hidden = false;
    },
    hideResult() {
      actions.hidden = false;
      result.hidden = true;
    },
  };
}
