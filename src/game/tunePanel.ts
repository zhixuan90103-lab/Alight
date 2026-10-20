import type { Sim } from './sim';
import {
  BAG_ZETA,
  BAND_PULL_THIN,
  BAND_ZETA,
  BIRD_R,
  DEAD_PULL,
  GRAVITY,
  MASS,
  MAX_PULL,
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
  { key: 'bagZeta', label: '口袋阻尼', min: 0.05, max: 2.5, step: 0.05, value: BAG_ZETA },
  { key: 'maxPull', label: '最大拉动', min: 40, max: 240, step: 1, value: MAX_PULL },
  { key: 'slipLift', label: '向上脱手', min: 0, max: 80, step: 1, value: SLIP_LIFT },
  { key: 'deadPull', label: '死区', min: 0, max: 80, step: 1, value: DEAD_PULL },
  { key: 'birdR', label: '球半径', min: 14, max: 40, step: 1, value: BIRD_R },
  { key: 'ropeThickness', label: '皮筋粗细', min: 2, max: 16, step: 0.5, value: ROPE_THICKNESS },
  { key: 'pullThin', label: '拉满变细', min: 0, max: 0.7, step: 0.02, value: BAND_PULL_THIN },
];

function format(value: number, step: number): string {
  const digits = step < 1 ? 2 : 0;
  return value.toFixed(digits);
}

/** On-stage sliders. They write the live tune and push it into the physics bodies. */
export function mountTunePanel(parent: HTMLElement, sim: Sim): void {
  const root = document.createElement('section');
  root.id = 'tune';
  root.addEventListener('pointerdown', (event) => event.stopPropagation());

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'tune-head';
  head.textContent = '参数';
  root.append(head);

  const body = document.createElement('div');
  body.className = 'tune-body';
  root.append(body);

  let open = false;
  const paintOpen = () => {
    body.hidden = !open;
    root.classList.toggle('is-open', open);
    head.textContent = open ? '关闭' : '参数';
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

  parent.append(root);
}
