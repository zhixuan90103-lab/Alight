/**
 * Pull bed, same numbers as Rubberband's monkey pull.
 * Continuous tension follows stretch / max pull. Grain starts at 0.6.
 */

import { haptics } from '../utils/haptics';

const tensionMinI = 0.1;
const tensionMaxI = 0.4;
const tensionMinS = 0.1;
const tensionMaxS = 0.2;
const grainAt = 0.6;
const grainI = 0.3;
const grainS = 0;
const grainHz = 25;

let charging = false;
let ready = false;
let grain = false;
let sent = -1;
let lastRatio = 0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tension(ratio: number): { intensity: number; sharpness: number } {
  const r = clamp01(ratio);
  return {
    intensity: tensionMinI + r * (tensionMaxI - tensionMinI),
    sharpness: tensionMinS + r * (tensionMaxS - tensionMinS),
  };
}

function pushTension(ratio: number): void {
  if (!ready) return;
  if (sent >= 0 && Math.abs(ratio - sent) < 0.02) return;
  sent = ratio;
  const level = tension(ratio);
  void haptics.updateContinuous(level.intensity, level.sharpness);
}

function setGrain(on: boolean): void {
  if (on === grain) return;
  grain = on;
  if (on) void haptics.startGrain({ intensity: grainI, sharpness: grainS, frequency: grainHz });
  else void haptics.stopGrain();
}

/** Start the pull bed. `ratio` is stretch over max pull. */
export function beginCharge(ratio: number): void {
  charging = true;
  ready = false;
  sent = -1;
  grain = false;
  lastRatio = clamp01(ratio);
  const level = tension(0);
  void haptics.startContinuous({ ...level, duration: 30 }).then((result) => {
    if (!charging) {
      void haptics.stopContinuous();
      return;
    }
    ready = result.ok;
    if (ready) pushTension(lastRatio);
    setGrain(lastRatio >= grainAt);
  });
}

/** Follow the finger. Skips the bridge until the pull fraction moves. */
export function updateCharge(ratio: number): void {
  if (!charging) return;
  const r = clamp01(ratio);
  lastRatio = r;
  pushTension(r);
  setGrain(r >= grainAt);
}

export function endCharge(): void {
  if (!charging && !grain) return;
  charging = false;
  ready = false;
  sent = -1;
  setGrain(false);
  void haptics.stopContinuous();
}
