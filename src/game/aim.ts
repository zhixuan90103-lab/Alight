import { bagMouth, bagOuterPoints, ballInBag } from './bag';
import {
  BAG_RESTITUTION,
  BAGS,
  BAG_SPEC,
  BALL_DAMPING,
  BALL_RESTITUTION,
  BIRD_R,
  CAPSULE,
  ELBOWS,
  GRAVITY,
  MAX_PULL,
  PLANK_RESTITUTION,
  PLANKS,
  ROPE_THICKNESS,
  STEP,
  capsuleOutline,
  launchSpeed,
  type BallColor,
} from './tune';

/** A kink larger than this reads as the ball leaving beside the rope. */
export const AIM_ANGLE = (1.25 * Math.PI) / 180;
/** Share of this shot's speed. A full pull can only lose speed, never gain past full. */
export const AIM_SPEED = 0.035;
const ANGLE_COST = 4;
const SAMPLES = 4;
const HORIZON = 2.4;
const SUBSTEPS = 4;

export type AimBand = { pts: Array<{ x: number; y: number }> };

type Seg = { ax: number; ay: number; bx: number; by: number; e: number };
type Disc = { x: number; y: number; r: number; e: number };

/**
 * Release velocity after a hidden nudge.
 * The input velocity is the player's pull. Equal output means no help.
 * `capsuleAngle` is the capsule's pose at release. It stays still during the search.
 */
export function assistRelease(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  speed: number,
  color: BallColor,
  bands: readonly AimBand[],
  capsuleAngle = CAPSULE?.rest ?? 0,
): { x: number; y: number } {
  const raw = { x: dirX * speed, y: dirY * speed };
  if (speed < 1 || BAGS.length === 0) return raw;
  const maxSpeed = launchSpeed(MAX_PULL);
  let bowls = -1;
  let best = Infinity;
  let pick = raw;
  for (let ia = -SAMPLES; ia <= SAMPLES; ia++) {
    const angle = (ia / SAMPLES) * AIM_ANGLE;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dirX * cos - dirY * sin;
    const ry = dirX * sin + dirY * cos;
    for (let is = -SAMPLES; is <= SAMPLES; is++) {
      const scale = 1 + (is / SAMPLES) * AIM_SPEED;
      const next = speed * scale;
      if (next > maxSpeed + 0.01) continue;
      const hit = fly(originX, originY, rx * next, ry * next, bands, capsuleAngle);
      if (hit < 0 || BAG_SPEC[hit]?.color !== color) continue;
      if (bowls === -1) bowls = hit;
      else if (bowls !== hit) return raw;
      const cost = (scale - 1) ** 2 / AIM_SPEED ** 2 + ANGLE_COST * (angle / AIM_ANGLE) ** 2;
      if (cost < best) {
        best = cost;
        pick = { x: rx * next, y: ry * next };
      }
    }
  }
  return pick;
}

/** Bowl index the ball seals in, or -1 when it misses, is caught, or leaves. */
export function flightBowl(x0: number, y0: number, vx: number, vy: number, bands: readonly AimBand[] = [], capsuleAngle = 0): number {
  return fly(x0, y0, vx, vy, bands, capsuleAngle);
}

function fly(x0: number, y0: number, vx: number, vy: number, bands: readonly AimBand[], capsuleAngle: number): number {
  const segs: Seg[] = [];
  const discs: Disc[] = [];
  const bowlE = Math.max(BALL_RESTITUTION, BAG_RESTITUTION);
  const boardE = Math.max(BALL_RESTITUTION, PLANK_RESTITUTION);
  for (let i = 0; i < BAGS.length; i++) {
    const pts = bagOuterPoints(BAGS[i], i);
    for (let p = 0; p < pts.length - 1; p++) {
      segs.push({ ax: pts[p].x, ay: pts[p].y, bx: pts[p + 1].x, by: pts[p + 1].y, e: bowlE });
    }
  }
  for (const plank of PLANKS) {
    const x0p = plank.x - plank.halfW;
    const x1 = plank.x + plank.halfW;
    const y0p = plank.y - plank.halfH;
    const y1 = plank.y + plank.halfH;
    segs.push(
      { ax: x0p, ay: y0p, bx: x1, by: y0p, e: boardE },
      { ax: x1, ay: y0p, bx: x1, by: y1, e: boardE },
      { ax: x1, ay: y1, bx: x0p, by: y1, e: boardE },
      { ax: x0p, ay: y1, bx: x0p, by: y0p, e: boardE },
    );
    if (plank.vertical) {
      discs.push({ x: plank.x, y: y1, r: plank.halfW, e: boardE }, { x: plank.x, y: y0p, r: plank.halfW, e: boardE });
    } else {
      discs.push({ x: x0p, y: plank.y, r: plank.halfH, e: boardE }, { x: x1, y: plank.y, r: plank.halfH, e: boardE });
    }
  }
  for (const elbow of ELBOWS) {
    const pts = elbow.pts;
    for (let p = 0; p < pts.length - 1; p++) {
      segs.push({ ax: pts[p].x, ay: pts[p].y, bx: pts[p + 1].x, by: pts[p + 1].y, e: boardE });
    }
    const cap = elbow.width / 2;
    discs.push(
      { x: pts[0].x, y: pts[0].y, r: cap, e: boardE },
      { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, r: cap, e: boardE },
    );
  }
  if (CAPSULE) pushCapsule(segs, boardE, capsuleAngle);
  let x = x0;
  let y = y0;
  const dt = STEP / SUBSTEPS;
  const damp = Math.exp(-BALL_DAMPING * dt);
  let out = 0;
  const touch = bands.map(() => false);
  const steps = Math.ceil(HORIZON / dt);
  for (let n = 0; n < steps; n++) {
    vy -= GRAVITY * dt;
    vx *= damp;
    vy *= damp;
    const fromX = x;
    const fromY = y;
    x += vx * dt;
    y += vy * dt;
    const hit = bounce(x, y, vx, vy, segs, discs);
    x = hit.x;
    y = hit.y;
    vx = hit.vx;
    vy = hit.vy;
    for (let i = 0; i < BAGS.length; i++) {
      const mouth = bagMouth(BAGS[i]);
      if (ballInBag(x, y, i) && y < mouth.y - BIRD_R) return i;
    }
    for (let i = 0; i < bands.length; i++) {
      const now = nearBand(x, y, bands[i]);
      const was = touch[i];
      touch[i] = now;
      if (vy < 0 && now && !was && aboveRivet(fromX, fromY, bands[i])) return -1;
    }
    const outside = x < -40 || x > 430 || y < 0;
    out = outside ? out + dt : 0;
    if (out >= 0.3) return -1;
  }
  return -1;
}

function pushCapsule(segs: Seg[], e: number, angle: number): void {
  if (!CAPSULE) return;
  const local = capsuleOutline(CAPSULE.length, CAPSULE.rThin, CAPSULE.rThick);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const world: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < local.length; i += 2) {
    const lx = local[i];
    const ly = local[i + 1];
    world.push({ x: CAPSULE.x + lx * c - ly * s, y: CAPSULE.y + lx * s + ly * c });
  }
  for (let i = 0; i < world.length; i++) {
    const a = world[i];
    const b = world[(i + 1) % world.length];
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, e });
  }
}

function bounce(
  x: number,
  y: number,
  vx: number,
  vy: number,
  segs: readonly Seg[],
  discs: readonly Disc[],
): { x: number; y: number; vx: number; vy: number } {
  let best = 0;
  let nx = 0;
  let ny = 0;
  let e = 0;
  let skin = BIRD_R;
  let qx = x;
  let qy = y;
  for (const seg of segs) {
    const abx = seg.bx - seg.ax;
    const aby = seg.by - seg.ay;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((x - seg.ax) * abx + (y - seg.ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = seg.ax + abx * t;
    const py = seg.ay + aby * t;
    const dx = x - px;
    const dy = y - py;
    const dist = Math.hypot(dx, dy);
    const pen = BIRD_R - dist;
    if (pen > best && dist > 1e-4) {
      best = pen;
      nx = dx / dist;
      ny = dy / dist;
      e = seg.e;
      skin = BIRD_R;
      qx = px;
      qy = py;
    }
  }
  for (const disc of discs) {
    const dx = x - disc.x;
    const dy = y - disc.y;
    const dist = Math.hypot(dx, dy) || 1;
    const limit = BIRD_R + disc.r;
    const pen = limit - dist;
    if (pen > best) {
      best = pen;
      nx = dx / dist;
      ny = dy / dist;
      e = disc.e;
      skin = limit;
      qx = disc.x;
      qy = disc.y;
    }
  }
  if (best <= 0) return { x, y, vx, vy };
  const into = vx * nx + vy * ny;
  if (into < 0) {
    const push = -(1 + e) * into;
    vx += push * nx;
    vy += push * ny;
  }
  return { x: qx + nx * (skin + 0.2), y: qy + ny * (skin + 0.2), vx, vy };
}

function nearBand(x: number, y: number, band: AimBand): boolean {
  const reach = BIRD_R + ROPE_THICKNESS / 2;
  const pts = band.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentDistance(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= reach) return true;
  }
  return false;
}

/** Rest arc opens upward. Above the rivet-to-rivet line has a positive cross. */
function aboveRivet(x: number, y: number, band: AimBand): boolean {
  const a = band.pts[0];
  const b = band.pts[band.pts.length - 1];
  if (!a || !b) return false;
  return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) > 0;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
