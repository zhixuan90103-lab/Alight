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
export let STIFFNESS = 200;
/**
 * The band itself is light, so it retracts faster than the ball's flight.
 * After the ball leaves, internal friction (zeta) lets it overshoot once, then stop.
 * Same stiffness. The ball's exit speed still uses MASS, not ROPE_MASS.
 */
export let ROPE_MASS = MASS / 9;
export let BAND_ZETA = 0.3;
/** Ball contact. The panel edits these live. Air damping is linearDamping. */
export let BALL_RESTITUTION = 0.05;
export let BALL_FRICTION = 1;
export let BALL_DAMPING = 0;
/** Wooden bowl restitution. The panel edits this live. */
export let BAG_RESTITUTION = 0.25;
/** Wooden bowl friction. Also its fixture damping. The panel edits this live. */
export let BAG_FRICTION = 2;
/** Vertical board. Its own bounce, not the bowl's. The panel edits these live. */
export let PLANK_RESTITUTION = 0.4;
export let PLANK_FRICTION = 0.4;
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

/** Rest length between the rivets. The ball sits on the midpoint. */
export let BAND_LENGTH = 100;
/** How far a pull may go, in band lengths. Longer bands still pull farther. */
const BAND_PULL_SPAN = 1.6;

export function slingAt(x: number): Sling {
  const pouch = { x, y: POUCH.y };
  const half = BAND_LENGTH / 2;
  const left = { x: x - half, y: pouch.y + CRADLE_RISE };
  const right = { x: x + half, y: pouch.y + CRADLE_RISE };
  return {
    pouch,
    left,
    right,
    mid: { x, y: (left.y + right.y) / 2 },
  };
}

export type BallColor = 'gold' | 'blue';

/** Flat colors. Gold is the level-1 ball. Blue is darker than the field so it stays readable. */
export const BALL_HEX: Record<BallColor, number> = {
  gold: 0xecbf77,
  blue: 0x4d95dc,
};

export type BagSpec = {
  color: BallColor;
  /** Mouth half-width, in ball radii. */
  mouthScale: number;
  /** Straight wall, in ball radii. */
  legScale: number;
};

/**
 * `each-band` refills the band that just lost its ball.
 * `same-color` waits until that color has died or landed in a bowl, then refills its own band.
 */
export type RefillMode = 'each-band' | 'same-color';

/** Which level is on screen. 1 is the single gold U. 2 is the two-color pair. 3 adds a fixed board. */
export let LEVEL_ID = 1;
export const LEVEL_COUNT = 4;
export let REFILL_MODE: RefillMode = 'each-band';
/** Issue order shown by the pips. Level 2 is three blue, then three gold. */
export const BALL_QUEUE: BallColor[] = [];
/** Home color of each band, parallel to `SLINGS`. */
export const SLING_COLOR: BallColor[] = [];
/** Balls this level will issue. */
export let LEVEL_BALLS = 5;

/** One band. `loadLevelLayout` moves it. */
export const SLINGS: Sling[] = [slingAt(312 - BIRD_R)];
/** Lip anchors, world space. Parallel to `BAG_SPEC`. */
export const BAGS: Array<{ x: number; y: number }> = [];
export const BAG_SPEC: BagSpec[] = [];
/** Fixed boards. Center and half-size are world pixels. `vertical` stands the board up and rounds both ends. */
export type Plank = { x: number; y: number; halfW: number; halfH: number; vertical: boolean; color: BallColor };
export const PLANKS: Plank[] = [];
/**
 * Where the next ball appears. Design y is down.
 * Measured from the marked point directly above the pouch.
 */
export const EXIT = { x: 0, y: 0 };

export const ANCHOR_L = SLINGS[0].left;
export const ANCHOR_R = SLINGS[0].right;
export const SLING_MID = SLINGS[0].mid;

/** Design y of the pouch. Both levels keep this height. */
const POUCH_DESIGN_Y = 612;
/** Design y of the exit, above the pouch. */
const EXIT_DESIGN_Y = 472;

function addBag(x: number, yDown: number, spec: BagSpec): void {
  BAGS.push(designToWorld(x, yDown));
  BAG_SPEC.push(spec);
}

/** Move the bands and the bowls. Does not reset the simulation. */
export function loadLevelLayout(id: number): void {
  const level = id === 4 ? 4 : id === 3 ? 3 : id === 2 ? 2 : 1;
  LEVEL_ID = level;
  BAGS.length = 0;
  BAG_SPEC.length = 0;
  BALL_QUEUE.length = 0;
  SLING_COLOR.length = 0;
  PLANKS.length = 0;
  const bowlX = 78 + BIRD_R * 2.2;
  const slingX = level === 2 ? [124, 266] : level === 4 ? [135, 255] : level === 3 ? [bowlX] : [312 - BIRD_R];
  while (SLINGS.length < slingX.length) SLINGS.push(slingAt(slingX[SLINGS.length]));
  SLINGS.length = slingX.length;
  for (let i = 0; i < slingX.length; i++) {
    const pouch = designToWorld(slingX[i], POUCH_DESIGN_Y);
    SLINGS[i].pouch.x = pouch.x;
    SLINGS[i].pouch.y = pouch.y;
  }
  const exit = designToWorld(slingX[0], EXIT_DESIGN_Y);
  EXIT.x = exit.x;
  EXIT.y = exit.y;
  if (level === 2 || level === 4) {
    REFILL_MODE = 'same-color';
    LEVEL_BALLS = 6;
    const small: Omit<BagSpec, 'color'> = { mouthScale: 2.5, legScale: 2.4 };
    if (level === 4) {
      BALL_QUEUE.push('gold', 'gold', 'gold', 'blue', 'blue', 'blue');
      SLING_COLOR.push('gold', 'blue');
      addBag(135, 300, { color: 'gold', ...small });
      addBag(255, 300, { color: 'blue', ...small });
      const boards: Array<[number, BallColor]> = [[18, 'gold'], [372, 'blue']];
      for (const [x, color] of boards) {
        const center = designToWorld(x, 322);
        PLANKS.push({ x: center.x, y: center.y, halfW: 6, halfH: 56, vertical: true, color });
      }
    } else {
      BALL_QUEUE.push('blue', 'blue', 'blue', 'gold', 'gold', 'gold');
      SLING_COLOR.push('blue', 'gold');
      addBag(84, 248, { color: 'gold', ...small });
      addBag(306, 248, { color: 'blue', ...small });
    }
  } else {
    REFILL_MODE = 'each-band';
    LEVEL_BALLS = 5;
    BALL_QUEUE.push('gold', 'gold', 'gold', 'gold', 'gold');
    SLING_COLOR.push('gold');
    const bowlY = level === 3 ? 308 : 268;
    addBag(bowlX, bowlY, { color: 'gold', mouthScale: 3.2, legScale: 4.6 });
    if (level === 3) {
      const center = designToWorld(336, 350);
      PLANKS.push({ x: center.x, y: center.y, halfW: 6, halfH: 108, vertical: true, color: 'gold' });
    }
  }
  refreshDerived();
}

export function restSag(mass: number): number {
  return (mass * GRAVITY) / STIFFNESS;
}

export let REST_SAG = restSag(MASS);
/** Empty band. Same rule, using the band's own mass, so it hangs tighter than it does under the ball. */
export let EMPTY_SAG = restSag(ROPE_MASS);
export const STEP = 1 / 60;
export const MAX_CATCHUP = 0.25;

/** Design point of the first bag. Call `loadLevelLayout` before reading this. */
export const BAG_AT = { x: 0, y: 0 };
/** Turn the blue bag off to shoot with no target. On by default. */
export let SHOW_BAG = true;

/** How far the band may be drawn. 1.6 times its length, 160 pixels at the default. */
export let MAX_PULL = BAND_LENGTH * BAND_PULL_SPAN;

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
  plankRestitution?: number;
  plankFriction?: number;
  deadPull?: number;
  birdR?: number;
  ropeThickness?: number;
  pullThin?: number;
  bandLength?: number;
  slipLift?: number;
  showBag?: boolean;
};

function refreshDerived(): void {
  ROPE_MASS = MASS / 9;
  REST_SAG = restSag(MASS);
  EMPTY_SAG = restSag(ROPE_MASS);
  MAX_PULL = BAND_LENGTH * BAND_PULL_SPAN;
  for (const sling of SLINGS) {
    const half = BAND_LENGTH / 2;
    sling.left.x = sling.pouch.x - half;
    sling.right.x = sling.pouch.x + half;
    sling.left.y = sling.pouch.y + CRADLE_RISE;
    sling.right.y = sling.pouch.y + CRADLE_RISE;
    sling.mid.x = sling.pouch.x;
    sling.mid.y = (sling.left.y + sling.right.y) / 2;
  }
  if (BAGS[0]) {
    BAG_AT.x = BAGS[0].x;
    BAG_AT.y = BAGS[0].y;
  }
}

loadLevelLayout(1);

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
  if (patch.plankRestitution !== undefined) PLANK_RESTITUTION = patch.plankRestitution;
  if (patch.plankFriction !== undefined) PLANK_FRICTION = patch.plankFriction;
  if (patch.deadPull !== undefined) DEAD_PULL = patch.deadPull;
  if (patch.birdR !== undefined) BIRD_R = patch.birdR;
  if (patch.ropeThickness !== undefined) ROPE_THICKNESS = patch.ropeThickness;
  if (patch.pullThin !== undefined) BAND_PULL_THIN = patch.pullThin;
  if (patch.bandLength !== undefined) BAND_LENGTH = patch.bandLength;
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

/** The vertical board. Not the bowl. */
export function plankMaterial(): Material {
  return fixtureMaterial(PLANK_RESTITUTION, PLANK_FRICTION);
}

/** Empty-band height at this x. Outside the anchors the curve is the anchor height. */
export function emptyBandY(x: number, sling: Sling = SLINGS[0]): number {
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
export function meetBallY(x: number, sling: Sling = SLINGS[0]): number {
  const y = emptyBandY(x, sling) + BIRD_R;
  return emptyBandY(x, sling) + seatAt(x, y, sling);
}

/** Ball center where an upward drag lets go. A little above the empty band. */
export function slipBallY(x: number, sling: Sling = SLINGS[0]): number {
  return meetBallY(x, sling) + SLIP_LIFT;
}
