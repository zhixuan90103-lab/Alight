import { DESIGN_HEIGHT } from '../adapt/design';

/** Seconds to blend between the home frame and the high frame. Same both ways. */
const DAMP = 0.6;
/**
 * Fixed high composition. Small enough that the bowl and the band stay on screen.
 * Not a follow offset, and well under a third of the design screen.
 */
const HIGH = 96;

/**
 * Two compositions. Offset 0 is the home frame and the lowest the view may sit.
 * The camera blends to the high frame only after the ball leaves the top of the
 * home frame, and blends back once the ball is inside that frame again.
 */
export function createFramingCamera() {
  let y = 0;
  let vy = 0;

  const step = (birdY: number | null, dt: number) => {
    const goal = birdY !== null && birdY > DESIGN_HEIGHT ? HIGH : 0;
    const sy = smoothDamp(y, goal, vy, DAMP, dt);
    y = clamp(sy.value, 0, HIGH);
    vy = y === sy.value ? sy.vel : 0;
  };

  return {
    get x() {
      return 0;
    },
    get y() {
      return y;
    },
    step,
    reset() {
      y = 0;
      vy = 0;
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Unity SmoothDamp. `smoothTime` is how long the follow takes to settle. */
function smoothDamp(
  current: number,
  target: number,
  vel: number,
  smoothTime: number,
  dt: number,
): { value: number; vel: number } {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel + omega * change) * dt;
  vel = (vel - omega * temp) * exp;
  return { value: target + (change + temp) * exp, vel };
}
