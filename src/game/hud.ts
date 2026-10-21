import type { Sim } from './sim';
import { LEVEL_BALLS } from './tune';
import { hudIcon, mountTunePanel } from './tunePanel';

/** Level strip: level number, one pip per ball, settings, and replay. */
export function mountHud(uiRoot: HTMLElement, sim: Sim, replay: () => void): void {
  const hud = document.createElement('div');
  hud.id = 'hud';

  const level = document.createElement('div');
  level.id = 'level-id';
  level.textContent = '1';
  level.setAttribute('aria-label', '关卡 1');

  const balls = document.createElement('div');
  balls.id = 'balls';
  balls.setAttribute('aria-label', `本关 ${LEVEL_BALLS} 颗球`);
  for (let i = 0; i < LEVEL_BALLS; i++) {
    const dot = document.createElement('span');
    dot.className = 'ball-pip is-full';
    balls.append(dot);
  }

  const actions = document.createElement('div');
  actions.id = 'hud-actions';
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'hud-pill';
  again.setAttribute('aria-label', '重玩');
  again.innerHTML = hudIcon('replay');
  again.addEventListener('click', replay);

  hud.append(level, balls, actions);
  uiRoot.prepend(hud);
  mountTunePanel(uiRoot, actions, sim);
  actions.append(again);
  hud.addEventListener('pointerdown', (event) => event.stopPropagation());
}
