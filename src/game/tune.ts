import { designToWorld } from './frame';
import { fixtureMaterial, type Material } from './material';

/** Pixel-space tune for three light balls, three bands, and three bags. */
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
/** Ball contact. The panel edits these live. Air damping is linearDamping. */
export let BALL_RESTITUTION = 0.05;
export let BALL_FRICTION = 0.5;
export let BALL_DAMPING = 0;
/** Wooden bowl restitution. The panel edits this live. */
export let BAG_RESTITUTION = 0.1;
/** Wooden bowl friction. Also its fixture damping. The panel edits this live. */
export let BAG_FRICTION = 0.6;
export let DEAD_PULL = 28;
export let BIRD_R = 18;
export let ROPE_THICKNESS = 7;
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
/** Drawn rivet radius. Rivets do not block the ball. */
export const RIVET_R = 5;

export const POUCH = designToWorld(195, 612);

export type Sling = {
  pouch: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
  mid: { x: number; y: number };
};

/** Three pouches in a row. Each cradle is narrow enough that the neighbors do not overlap. */
export const LANE_X = [78, 195, 312];
/** Short enough that the gap between neighboring bands is wider than the ball. */
const LANE_REACH = 32;

export function slingAt(x: number): Sling {
  const pouch = { x, y: POUCH.y };
  const left = { x: x - LANE_REACH, y: pouch.y + CRADLE_RISE };
  const right = { x: x + LANE_REACH, y: pouch.y + CRADLE_RISE };
  return {
    pouch,
    left,
    right,
    mid: { x, y: (left.y + right.y) / 2 },
  };
}

export const SLINGS = LANE_X.map(slingAt);
/** Three bags, one above each pouch. The middle mouth sits lower. How many balls fit is the shape. */
export const BAG_Y = [268, 428, 268];
export const BAGS = LANE_X.map((x, i) => designToWorld(x, BAG_Y[i]));

export const ANCHOR_L = SLINGS[1].left;
export const ANCHOR_R = SLINGS[1].right;
export const SLING_MID = SLINGS[1].mid;

export function restSag(mass: number): number {
  return (mass * GRAVITY) / STIFFNESS;
}

export let REST_SAG = restSag(MASS);
/** Empty band. Same rule, using the band's own mass, so it hangs tighter than it does under the ball. */
export let EMPTY_SAG = restSag(ROPE_MASS);
export const STEP = 1 / 60;
export const MAX_CATCHUP = 0.25;

/** Design point of the middle bag. The row lives in BAGS. */
export const BAG_AT = BAGS[1];
/** Turn the blue bag off to shoot with no target. On by default. */
export let SHOW_BAG = true;

/** The band's maximum stretch, from the pouch straight down to the bottom of the screen. */
export let MAX_PULL = POUCH.y - BIRD_R;

/** How far the ball may rise past the empty band before the finger loses it. */
export let SLIP_LIFT = 18;

export type TunePatch = {
  gravity?: number;
  mass?: number;
  stiffness?: number;
  zeta?: number;
  ballRestitution?: number;
  ballFriction?: number;
  ballDamping?: number;
  bagRestitution?: number;
  bagFriction?: number;
  deadPull?: number;
  birdR?: number;
  ropeThickness?: number;
  pullThin?: number;
  maxPull?: number;
  slipLift?: number;
  showBag?: boolean;
};

function refreshDerived(): void {
  ROPE_MASS = MASS / 9;
  REST_SAG = restSag(MASS);
  EMPTY_SAG = restSag(ROPE_MASS);
}

/** Live tune used by the on-screen panel. Derived sag and rope mass follow mass, gravity, and stiffness. */
export function writeTune(patch: TunePatch): void {
  if (patch.gravity !== undefined) GRAVITY = patch.gravity;
  if (patch.mass !== undefined) MASS = patch.mass;
  if (patch.stiffness !== undefined) STIFFNESS = patch.stiffness;
  if (patch.zeta !== undefined) BAND_ZETA = patch.zeta;
  if (patch.ballRestitution !== undefined) BALL_RESTITUTION = patch.ballRestitution;
  if (patch.ballFriction !== undefined) BALL_FRICTION = patch.ballFriction;
  if (patch.ballDamping !== undefined) BALL_DAMPING = patch.ballDamping;
  if (patch.bagRestitution !== undefined) BAG_RESTITUTION = patch.bagRestitution;
  if (patch.bagFriction !== undefined) BAG_FRICTION = patch.bagFriction;
  if (patch.deadPull !== undefined) DEAD_PULL = patch.deadPull;
  if (patch.birdR !== undefined) BIRD_R = patch.birdR;
  if (patch.ropeThickness !== undefined) ROPE_THICKNESS = patch.ropeThickness;
  if (patch.pullThin !== undefined) BAND_PULL_THIN = patch.pullThin;
  if (patch.maxPull !== undefined) MAX_PULL = patch.maxPull;
  if (patch.slipLift !== undefined) SLIP_LIFT = patch.slipLift;
  if (patch.showBag !== undefined) SHOW_BAG = patch.showBag;
  refreshDerived();
}

export function ballMaterial(): Material {
  return { restitution: BALL_RESTITUTION, friction: BALL_FRICTION, damping: BALL_DAMPING };
}

export function woodMaterial(): Material {
  return fixtureMaterial(BAG_RESTITUTION, BAG_FRICTION);
}

/** Empty-band height at this x. Outside the anchors the curve is the anchor height. */
export function emptyBandY(x: number, sling: Sling = SLINGS[1]): number {
  const span = sling.right.x - sling.left.x;
  const t = Math.min(1, Math.max(0, (x - sling.left.x) / span));
  return sling.mid.y - EMPTY_SAG * 4 * t * (1 - t);
}

function seatAt(x: number, y: number, sling: Sling): number {
  const pull = Math.hypot(x - sling.pouch.x, y - sling.pouch.y);
  const strain = Math.min(1, pull / MAX_PULL);
  return BIRD_R + bandWidth(strain) / 2 - 1;
}

/** Ball center when it is just sitting on the empty band. */
export function meetBallY(x: number, sling: Sling = SLINGS[1]): number {
  const y = emptyBandY(x, sling) + BIRD_R;
  return emptyBandY(x, sling) + seatAt(x, y, sling);
}

/** Ball center where an upward drag lets go. A little above the empty band. */
export function slipBallY(x: number, sling: Sling = SLINGS[1]): number {
  return meetBallY(x, sling) + SLIP_LIFT;
}
