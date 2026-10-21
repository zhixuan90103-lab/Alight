import type { Sim, SimSample } from './sim';
import { BALL_QUEUE, LEVEL_BALLS, LEVEL_COUNT, LEVEL_ID } from './tune';
import { hudIcon, mountTunePanel } from './tunePanel';

export type Hud = {
  /** Pips and the bowl score. Both read one sample. */
  sync(sample: SimSample): void;
  showResult(passed: boolean): void;
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

  const verdict = document.createElement('div');
  verdict.id = 'result-verdict';

  const resultActions = document.createElement('div');
  resultActions.id = 'result-actions';
  const resultReplay = iconButton('重玩');
  resultReplay.append(hudIcon('arrow-clockwise'));
  resultReplay.addEventListener('click', replay);

  const next = iconButton('下一关');
  next.append(hudIcon('arrow-right'));
  next.addEventListener('click', nextLevel);

  resultActions.append(resultReplay, next);
  card.append(verdict, resultActions);
  result.append(card);
  uiRoot.append(result);

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
    },
    showResult(passed: boolean) {
      verdict.textContent = passed ? '过关' : '失败';
      next.hidden = !passed || LEVEL_ID >= LEVEL_COUNT;
      actions.hidden = true;
      result.hidden = false;
    },
    hideResult() {
      actions.hidden = false;
      result.hidden = true;
    },
  };
}
