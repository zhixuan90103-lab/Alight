import type { Sim } from './sim';
import {
  BAG_FRICTION,
  BAG_RESTITUTION,
  BALL_DAMPING,
  BALL_FRICTION,
  BALL_RESTITUTION,
  BAND_PULL_THIN,
  BAND_ZETA,
  BIRD_R,
  DEAD_PULL,
  GRAVITY,
  MASS,
  BAND_LENGTH,
  ROPE_THICKNESS,
  SHOW_BAG,
  SLIP_LIFT,
  STIFFNESS,
  writeTune,
  type TunePatch,
} from './tune';

type Row = {
  key: keyof TunePatch;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
};

const ROWS: Row[] = [
  { key: 'gravity', label: '重力', min: 400, max: 4000, step: 10, value: GRAVITY },
  { key: 'mass', label: '质量', min: 0.3, max: 2, step: 0.05, value: MASS },
  { key: 'stiffness', label: '劲度', min: 10, max: 160, step: 1, value: STIFFNESS },
  { key: 'zeta', label: '阻尼', min: 0.05, max: 1.2, step: 0.05, value: BAND_ZETA },
  { key: 'bagRestitution', label: '口袋弹性', min: 0, max: 1, step: 0.05, value: BAG_RESTITUTION },
  { key: 'bagFriction', label: '口袋摩擦', min: 0, max: 2, step: 0.05, value: BAG_FRICTION },
  { key: 'bandLength', label: '皮筋长度', min: 40, max: 240, step: 1, value: BAND_LENGTH },
  { key: 'slipLift', label: '向上脱手', min: 0, max: 80, step: 1, value: SLIP_LIFT },
  { key: 'deadPull', label: '死区', min: 0, max: 80, step: 1, value: DEAD_PULL },
  { key: 'birdR', label: '球半径', min: 14, max: 40, step: 1, value: BIRD_R },
  { key: 'ballRestitution', label: '球弹性', min: 0, max: 1, step: 0.05, value: BALL_RESTITUTION },
  { key: 'ballFriction', label: '球摩擦', min: 0, max: 2, step: 0.05, value: BALL_FRICTION },
  { key: 'ballDamping', label: '球阻尼', min: 0, max: 2, step: 0.05, value: BALL_DAMPING },
  { key: 'ropeThickness', label: '皮筋粗细', min: 2, max: 16, step: 0.5, value: ROPE_THICKNESS },
  { key: 'pullThin', label: '拉满变细', min: 0, max: 0.7, step: 0.02, value: BAND_PULL_THIN },
];

function format(value: number, step: number): string {
  const digits = step < 1 ? 2 : 0;
  return value.toFixed(digits);
}

export function hudIcon(kind: 'tune' | 'replay'): string {
  const mark =
    kind === 'tune'
      ? '<path d="M4 7h10M4 12h16M4 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="12" r="2.2"/><circle cx="16" cy="17" r="2.2"/>'
      : '<path d="M12 6V3L7 8l5 5V10a5 5 0 1 1-4.3 2.5"/>';
  return `<svg class="hud-icon" viewBox="0 0 24 24" aria-hidden="true">
    <g class="hud-icon-shade" transform="translate(1.4 1.8)">${mark}</g>
    <g class="hud-icon-face">${mark}</g>
  </svg>`;
}

/** On-stage sliders. The gear pill opens them. Values write the live tune. */
export function mountTunePanel(uiRoot: HTMLElement, actions: HTMLElement, sim: Sim): void {
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'hud-pill';
  head.setAttribute('aria-label', '设置');
  head.innerHTML = hudIcon('tune');
  actions.append(head);

  const root = document.createElement('section');
  root.id = 'tune';
  root.addEventListener('pointerdown', (event) => event.stopPropagation());

  const body = document.createElement('div');
  body.className = 'tune-body';
  root.append(body);

  let open = false;
  const paintOpen = () => {
    body.hidden = !open;
    root.classList.toggle('is-open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  head.addEventListener('click', () => {
    open = !open;
    paintOpen();
  });
  paintOpen();

  for (const row of ROWS) {
    const line = document.createElement('label');
    line.className = 'tune-row';
    const name = document.createElement('span');
    name.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'tune-value';
    value.textContent = format(row.value, row.step);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    input.value = String(row.value);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      value.textContent = format(next, row.step);
      writeTune({ [row.key]: next });
      sim.applyTune();
    });
    line.append(name, value, input);
    body.append(line);
  }

  const nest = document.createElement('label');
  nest.className = 'tune-row tune-check';
  const nestName = document.createElement('span');
  nestName.textContent = '蓝色袋子';
  const nestInput = document.createElement('input');
  nestInput.type = 'checkbox';
  nestInput.checked = SHOW_BAG;
  nestInput.addEventListener('change', () => {
    writeTune({ showBag: nestInput.checked });
    sim.applyTune();
  });
  nest.append(nestName, nestInput);
  body.append(nest);
  uiRoot.append(root);
}
