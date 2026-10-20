import { designToWorld } from './frame';

/** Pixel-space tune for one light bird and one nest above the sling. */
/** World gravity, in design pixels per second squared. Not 9.8. */
export let GRAVITY = 3800;
/** Base mass. The light ball is 1. Heavier balls are multiples of this. */
export let MASS = 1;
/**
 * Rubber-band stiffness.
 * Rest: sag = mass × gravity / stiffness.
 * Release: speed = pull length × √(stiffness / mass). Finger speed is ignored.
 */
export let STIFFNESS = 150;
/**
 * The band itself is light, so it retracts faster than the ball's flight.
 * After the ball leaves, internal friction (zeta) lets it overshoot once, then stop.
 * Same stiffness. The ball's exit speed still uses MASS, not ROPE_MASS.
 */
export let ROPE_MASS = MASS / 9;
export let BAND_ZETA = 0.3;
export let DEAD_PULL = 28;
export let BIRD_R = 26;
export let ROPE_THICKNESS = 9;
/** Share of thickness a full pull removes. The inner edge stays on the ball. */
export let BAND_PULL_THIN = 0.28;

export function bandWidth(strain: number): number {
  const t = Math.min(1, Math.max(0, strain));
  return ROPE_THICKNESS * (1 - BAND_PULL_THIN * t);
}

/**
 * Light-ball cradle from the rest reference: anchors sit just above the sides,
 * and the rope dips under the ball. Heavier balls use the same rope and hang lower.
 */
const CRADLE_RISE = 12;
const CRADLE_REACH = 54;

export const POUCH = designToWorld(195, 612);
export const ANCHOR_L = { x: POUCH.x - CRADLE_REACH, y: POUCH.y + CRADLE_RISE };
export const ANCHOR_R = { x: POUCH.x + CRADLE_REACH, y: POUCH.y + CRADLE_RISE };
export const SLING_MID = {
  x: (ANCHOR_L.x + ANCHOR_R.x) / 2,
  y: (ANCHOR_L.y + ANCHOR_R.y) / 2,
};

export function restSag(mass: number): number {
  return (mass * GRAVITY) / STIFFNESS;
}

export let REST_SAG = restSag(MASS);
/** Empty band. Same rule, using the band's own mass, so it hangs tighter than it does under the ball. */
export let EMPTY_SAG = restSag(ROPE_MASS);
/** Catch when the ball center reaches the semicircle, then settle on its center. */
export let NEST_R = BIRD_R + 12;
export const STEP = 1 / 60;
export const MAX_CATCHUP = 0.25;


export const NEST = designToWorld(195, 250);
/** The upper semicircle is hidden for now. Turn this on to draw it and let it catch the ball. */
export let SHOW_NEST = false;
/** Top surface of the ground, in world y. A full downward pull stays above it. */
export const GROUND_Y = 36;
/**
 * The band's maximum stretch. It is the pull available now: from the pouch
 * straight down until the ball stops above the ground.
 */
export let MAX_PULL = POUCH.y - (GROUND_Y + BIRD_R + 12);

/** How far the ball may rise past the empty band before the finger loses it. */
export let SLIP_LIFT = 18;

export type TunePatch = {
  gravity?: number;
  mass?: number;
  stiffness?: number;
  zeta?: number;
  deadPull?: number;
  birdR?: number;
  ropeThickness?: number;
  pullThin?: number;
  maxPull?: number;
  slipLift?: number;
  showNest?: boolean;
};

function refreshDerived(): void {
  ROPE_MASS = MASS / 9;
  REST_SAG = restSag(MASS);
  EMPTY_SAG = restSag(ROPE_MASS);
  NEST_R = BIRD_R + 12;
}

/** Live tune used by the on-screen panel. Derived sag and rope mass follow mass, gravity, and stiffness. */
export function writeTune(patch: TunePatch): void {
  if (patch.gravity !== undefined) GRAVITY = patch.gravity;
  if (patch.mass !== undefined) MASS = patch.mass;
  if (patch.stiffness !== undefined) STIFFNESS = patch.stiffness;
  if (patch.zeta !== undefined) BAND_ZETA = patch.zeta;
  if (patch.deadPull !== undefined) DEAD_PULL = patch.deadPull;
  if (patch.birdR !== undefined) BIRD_R = patch.birdR;
  if (patch.ropeThickness !== undefined) ROPE_THICKNESS = patch.ropeThickness;
  if (patch.pullThin !== undefined) BAND_PULL_THIN = patch.pullThin;
  if (patch.maxPull !== undefined) MAX_PULL = patch.maxPull;
  if (patch.slipLift !== undefined) SLIP_LIFT = patch.slipLift;
  if (patch.showNest !== undefined) SHOW_NEST = patch.showNest;
  refreshDerived();
}

/** Empty-band height at this x. Outside the anchors the curve is the anchor height. */
export function emptyBandY(x: number): number {
  const span = ANCHOR_R.x - ANCHOR_L.x;
  const t = Math.min(1, Math.max(0, (x - ANCHOR_L.x) / span));
  return SLING_MID.y - EMPTY_SAG * 4 * t * (1 - t);
}

function seatAt(x: number, y: number): number {
  const pull = Math.hypot(x - POUCH.x, y - POUCH.y);
  const strain = Math.min(1, pull / MAX_PULL);
  return BIRD_R + bandWidth(strain) / 2 - 1;
}

/** Ball center when it is just sitting on the empty band. */
export function meetBallY(x: number): number {
  const y = emptyBandY(x) + BIRD_R;
  return emptyBandY(x) + seatAt(x, y);
}

/** Ball center where an upward drag lets go. A little above the empty band. */
export function slipBallY(x: number): number {
  return meetBallY(x) + SLIP_LIFT;
}
