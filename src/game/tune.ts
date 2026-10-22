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
 * Release speed uses launchSpeed. A full draw counts as LAUNCH_PULL, not the visible stretch.
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
export let BAG_RESTITUTION = 0.4;
/** Wooden bowl friction. Also its fixture damping. The panel edits this live. */
export let BAG_FRICTION = 2;
/** Vertical board. Its own bounce, not the bowl's. The panel edits these live. */
export let PLANK_RESTITUTION = 0.4;
export let PLANK_FRICTION = 0.4;
export let DEAD_PULL = 28;
export let BIRD_R = 18;
export let ROPE_THICKNESS = 7;
/** Share of thickness a full pull removes. The inner edge stays on the ball. */
export let BAND_PULL_THIN = 0.6;

export function bandWidth(strain: number): number {
  const t = Math.min(1, Math.max(0, strain));
  return ROPE_THICKNESS * (1 - BAND_PULL_THIN * t);
}

/**
 * Light-ball cradle: anchors sit above the pouch, and the rope wraps the outside of the ball.
 */
const CRADLE_RISE = 12;
/** Catch spring compared with the pull. The ball still compresses and rebounds. */
export const CATCH_SPAN = 2;
/** Settled ball center above the pouch. The rope is drawn around that point. */
export const SEAT_LIFT = 5;

/** World height of a ball that has settled on the rope. World y is up. */
export function seatY(pouchY: number): number {
  return pouchY + SEAT_LIFT;
}
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
const BAND_PULL_SPAN = 1.1;
/** Length used for a full-power shot, in band lengths. The ball is not drawn this far. */
const LAUNCH_SPAN = 1.6;

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

export type BallColor = 'gold' | 'blue' | 'red';

/** Flat colors. Gold is the level-1 ball. Blue and red stay readable on the blue field. */
export const BALL_HEX: Record<BallColor, number> = {
  gold: 0xecbf77,
  blue: 0x4d95dc,
  red: 0xe25b4a,
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
export const LEVEL_COUNT = 5;
export let REFILL_MODE: RefillMode = 'each-band';
/** Home color of each band, parallel to `SLINGS`. Colors share `LEVEL_BALLS`. */
export const SLING_COLOR: BallColor[] = [];
/** Shared ball pool for the level. White pips. Not split by color. */
export let LEVEL_BALLS = 5;

/** One band. `loadLevelLayout` moves it. */
export const SLINGS: Sling[] = [slingAt(312 - BIRD_R)];
/** Lip anchors, world space. Parallel to `BAG_SPEC`. */
export const BAGS: Array<{ x: number; y: number }> = [];
export const BAG_SPEC: BagSpec[] = [];
/** This bowl lifts off the top once a ball of its own color has settled inside. */
export const BAG_RISE: boolean[] = [];
/** Fixed boards. Center and half-size are world pixels. `vertical` stands the board up and rounds both ends. */
export type Plank = { x: number; y: number; halfW: number; halfH: number; vertical: boolean; color: BallColor };
export const PLANKS: Plank[] = [];
/** One upright rail the rising bowl slides along. Visual only. */
export type Rail = { x: number; y: number; halfW: number; halfH: number };
export let RAIL: Rail | null = null;
/** Tapered capsule. The pivot is the center of the thick end. `rest` and `swing` are world radians. */
export type Capsule = {
  x: number;
  y: number;
  length: number;
  rThin: number;
  rThick: number;
  rest: number;
  swing: number;
};
export let CAPSULE: Capsule | null = null;
/** Bent board. Centerline in world space, round ends. */
export type Elbow = { pts: Array<{ x: number; y: number }>; width: number; color: BallColor };
export const ELBOWS: Elbow[] = [];

/** Local outline. Thick-end center at the origin, thin end along -x. Closed, convex. */
export function capsuleOutline(length: number, rThin: number, rThick: number, steps = 8): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / steps;
    pts.push(Math.cos(a) * rThick, Math.sin(a) * rThick);
  }
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / steps;
    pts.push(-length + Math.cos(a) * rThin, Math.sin(a) * rThin);
  }
  return new Float32Array(pts);
}
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
/** Design y of the exit, above the pouch. 1.5 ball diameters below the old mark. */
const EXIT_DESIGN_Y = 472 + BIRD_R * 3;

function addBag(x: number, yDown: number, spec: BagSpec, rise = false): void {
  BAGS.push(designToWorld(x, yDown));
  BAG_SPEC.push(spec);
  BAG_RISE.push(rise);
}

/** Move the bands and the bowls. Does not reset the simulation. */
export function loadLevelLayout(id: number): void {
  const level = id >= 1 && id <= 5 ? id : 1;
  LEVEL_ID = level;
  BAGS.length = 0;
  BAG_SPEC.length = 0;
  BAG_RISE.length = 0;
  SLING_COLOR.length = 0;
  PLANKS.length = 0;
  RAIL = null;
  CAPSULE = null;
  ELBOWS.length = 0;
  const bowlX = 78 + BIRD_R * 2.2;
  const slingX =
    level === 5 ? [290] : level === 2 ? [124, 266] : level === 4 ? [107, 283] : level === 3 ? [bowlX + BIRD_R] : [312 - BIRD_R];
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
  if (level === 5) {
    REFILL_MODE = 'each-band';
    LEVEL_BALLS = 6;
    SLING_COLOR.push('gold');
    const bowl: Omit<BagSpec, 'color'> = { mouthScale: 2.5, legScale: 2.4 };
    addBag(291, 248 + BIRD_R * 2, { color: 'gold', ...bowl });
    const pivot = designToWorld(68, 368);
    CAPSULE = {
      x: pivot.x,
      y: pivot.y,
      length: 75.6,
      rThin: 8.4,
      rThick: 19.6,
      rest: (-48.4 * Math.PI) / 180 - Math.PI,
      swing: (100 * Math.PI) / 180,
    };
    const x0 = 49;
    const yTop = 140;
    const yBot = 340;
    const xEnd = 149 - BIRD_R * 2;
    const rad = 80;
    const cx = x0 + rad;
    const cy = yTop + rad;
    const elbow: Array<{ x: number; y: number }> = [designToWorld(x0, yBot)];
    const steps = 8;
    let reached = false;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI + (Math.PI / 2) * (i / steps);
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (x >= xEnd) {
        const aEnd = Math.PI + Math.acos((cx - xEnd) / rad);
        elbow.push(designToWorld(xEnd, cy + Math.sin(aEnd) * rad));
        reached = true;
        break;
      }
      elbow.push(designToWorld(x, y));
    }
    if (!reached) elbow.push(designToWorld(xEnd, yTop));
    ELBOWS.push({ pts: elbow, width: 10, color: 'gold' });
    const aEnd = Math.PI + Math.acos((cx - xEnd) / rad);
    const leftTipY = cy + Math.sin(aEnd) * rad;
    const lipX = 291 + BIRD_R * 2.5 + ROPE_THICKNESS / 2;
    const yBotR = 248 + BIRD_R * 2 - BIRD_R - 10 - 18 - BIRD_R * 2;
    const radR = yBotR - leftTipY - 12;
    const crx = lipX - radR;
    const cry = leftTipY + radR;
    const right: Array<{ x: number; y: number }> = [designToWorld(lipX, yBotR)];
    for (let i = 0; i <= steps; i++) {
      const a = (-Math.PI / 2) * (i / steps);
      right.push(designToWorld(crx + Math.cos(a) * radR, cry + Math.sin(a) * radR));
    }
    ELBOWS.push({ pts: right, width: 10, color: 'gold' });
  } else if (level === 2 || level === 4) {
    REFILL_MODE = 'same-color';
    LEVEL_BALLS = 6;
    const small: Omit<BagSpec, 'color'> = { mouthScale: 2.5, legScale: 2.4 };
    if (level === 4) {
      SLING_COLOR.push('gold', 'blue');
      const taller: Omit<BagSpec, 'color'> = { mouthScale: 2.5, legScale: 3.4 };
      addBag(107, 300, { color: 'gold', ...taller });
      addBag(283, 300, { color: 'blue', ...taller });
    } else {
      SLING_COLOR.push('blue', 'gold');
      addBag(84, 248, { color: 'gold', ...small });
      addBag(306, 248, { color: 'blue', ...small });
    }
  } else {
    REFILL_MODE = 'each-band';
    LEVEL_BALLS = 5;
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
/** Hint button. While on, a pull past the dead zone draws the free-flight arc. */
export let SHOW_HINT = false;

export function setShowHint(on: boolean): void {
  SHOW_HINT = on;
}

/** How far the band may be drawn. 1.1 times its length, 110 pixels at the default. */
export let MAX_PULL = BAND_LENGTH * BAND_PULL_SPAN;
/** Stretch that a full draw counts as for launch speed. 1.6 times the band, 160 pixels at the default. */
export let LAUNCH_PULL = BAND_LENGTH * LAUNCH_SPAN;

/** Release speed from how far the ball has left the pouch. A full draw matches a 1.6-length pull. */
export function launchSpeed(drawn: number): number {
  if (drawn <= 0 || MAX_PULL <= 0) return 0;
  const reach = (Math.min(drawn, MAX_PULL) / MAX_PULL) * LAUNCH_PULL;
  return reach * Math.sqrt(STIFFNESS / MASS);
}

/** Finger travel that fills the band. Shorter than the pouch-to-bottom gap, so a full pull stays on screen. */
export const FINGER_PULL_CAP = 200;

/** Finger travel that fills the band. */
export function fingerPullCap(): number {
  return FINGER_PULL_CAP;
}

/**
 * Scale of the follow curve. Slope at the pouch is 1, and the ball reaches MAX_PULL at the finger cap.
 * Returns 0 when the cap is not longer than the full pull, so the ball stays on the finger until MAX_PULL.
 */
function followScale(cap: number, maxPull: number): number {
  const ratio = maxPull / cap;
  let u = 1.7;
  for (let i = 0; i < 8; i++) {
    const e = Math.exp(-u);
    const gap = (1 - e) / u - ratio;
    const slope = (u * e - (1 - e)) / (u * u);
    u -= gap / slope;
  }
  return cap / u;
}

/**
 * Ball stretch while a finger is `finger` pixels from the pouch.
 * Starts one-to-one. At the finger cap the ball is at MAX_PULL. Past the cap it stays there.
 */
export function followPull(finger: number): number {
  if (finger <= 0 || MAX_PULL <= 0) return 0;
  const cap = fingerPullCap();
  if (cap <= MAX_PULL) return Math.min(finger, MAX_PULL);
  const f = Math.min(finger, cap);
  if (f >= cap) return MAX_PULL;
  const scale = followScale(cap, MAX_PULL);
  const end = 1 - Math.exp(-cap / scale);
  return (MAX_PULL * (1 - Math.exp(-f / scale))) / end;
}

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
  LAUNCH_PULL = BAND_LENGTH * LAUNCH_SPAN;
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
