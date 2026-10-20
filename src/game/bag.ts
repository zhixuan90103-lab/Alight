import {
  BAG_GIVE,
  BAG_ZETA,
  BIRD_R,
  MASS,
  STEP,
  STIFFNESS,
  BAG_AT,
} from './tune';

const MOUTH_CLEAR = 14;
const SIDE_BULGE = 8;
const SEAT_PAD = 10;

export type BagHit = { nx: number; ny: number; signed: number; cx: number; cy: number };

/** Cloth contact. The normal stays the one from the first touch. */
export type Cloth = {
  on: boolean;
  nx: number;
  ny: number;
  cx: number;
  cy: number;
  give: number;
};

export function clearCloth(): Cloth {
  return { on: false, nx: 0, ny: 1, cx: 0, cy: 0, give: 0 };
}

export function bagMouthHalf(): number {
  return BIRD_R + MOUTH_CLEAR;
}

export function bagDepth(): number {
  return BIRD_R * 2 + 36;
}

/** Mouth center. The opening faces up. */
export function bagMouth(at: { x: number; y: number } = BAG_AT): { x: number; y: number } {
  return { x: at.x, y: at.y + BIRD_R + 10 };
}

/** Rest point, one radius above the inner bottom. */
export function bagSeat(at: { x: number; y: number } = BAG_AT): { x: number; y: number } {
  const mouth = bagMouth(at);
  return { x: mouth.x, y: mouth.y - (bagDepth() - BIRD_R - SEAT_PAD) };
}

/**
 * U-shaped outline, mouth open between the first point and the last.
 * The view fills this same line. There is no extra lip.
 */
export function bagOuterPoints(at: { x: number; y: number } = BAG_AT): Array<{ x: number; y: number }> {
  const mouth = bagMouth(at);
  const bulge = bagMouthHalf() + SIDE_BULGE;
  const side = Math.max(8, bagDepth() - bulge);
  const points: Array<{ x: number; y: number }> = [];
  const add = (lx: number, ly: number) => {
    points.push({ x: mouth.x + lx, y: mouth.y + ly });
  };
  add(-bulge, 0);
  add(-bulge, -side);
  const arc = 8;
  for (let i = 0; i <= arc; i++) {
    const a = Math.PI + (i / arc) * Math.PI;
    add(Math.cos(a) * bulge, -side + Math.sin(a) * bulge);
  }
  add(bulge, 0);
  return points;
}

export function aboveOpenMouth(x: number, y: number, at: { x: number; y: number } = BAG_AT): boolean {
  const pts = bagOuterPoints(at);
  const left = pts[0];
  const right = pts[pts.length - 1];
  return y >= left.y && x > left.x && x < right.x;
}

/** Center fell across the opening. The side walls stay solid. */
export function enteredMouth(x0: number, y0: number, x1: number, y1: number, at: { x: number; y: number } = BAG_AT): boolean {
  const pts = bagOuterPoints(at);
  const left = pts[0];
  const right = pts[pts.length - 1];
  const mouthY = left.y;
  if (y0 < mouthY || y1 > mouthY) return false;
  const dy = y1 - y0;
  if (dy === 0) return false;
  const t = (mouthY - y0) / dy;
  if (t < 0 || t > 1) return false;
  const x = x0 + (x1 - x0) * t;
  return x > left.x + 2 && x < right.x - 2;
}

function pointInBag(px: number, py: number, pts: ReadonlyArray<{ x: number; y: number }>): boolean {
  let crossings = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if ((a.y > py) === (b.y > py)) continue;
    const x = a.x + ((b.x - a.x) * (py - a.y)) / (b.y - a.y);
    if (x > px) crossings += 1;
  }
  return crossings % 2 === 1;
}

/** Nearest overlap with the outline. The mouth edge exists only after the bag is sealed. */
export function bagContact(px: number, py: number, sealed: boolean, at: { x: number; y: number } = BAG_AT): BagHit | null {
  const pts = bagOuterPoints(at);
  const inside = pointInBag(px, py, pts);
  const edges = sealed ? pts.length : pts.length - 1;
  let best: BagHit | null = null;
  const r = BIRD_R;
  for (let i = 0; i < edges; i++) {
    const a = pts[i % pts.length];
    const b = pts[(i + 1) % pts.length];
    const evx = b.x - a.x;
    const evy = b.y - a.y;
    const l2 = evx * evx + evy * evy || 1e-8;
    let t = ((px - a.x) * evx + (py - a.y) * evy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + evx * t;
    const cy = a.y + evy * t;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy) || 1e-8;
    const nlen = Math.hypot(evy, -evx) || 1;
    const ox = evy / nlen;
    const oy = -evx / nlen;
    if (inside) {
      if (!best || dist < -best.signed) best = { nx: ox, ny: oy, signed: -dist, cx, cy };
      continue;
    }
    if (dist >= r) continue;
    if (!best || dist < best.signed) best = { nx: dx / dist, ny: dy / dist, signed: dist, cx, cy };
  }
  return best;
}

export type ClothMove = { cloth: Cloth; x: number; y: number; vx: number; vy: number; held: boolean };

/** Start or continue a one-sided push. The spring never pulls the ball back onto the cloth. */
export function touchCloth(cloth: Cloth, hit: BagHit, x: number, y: number, vx: number, vy: number): ClothMove {
  const next = cloth.on
    ? cloth
    : { on: true, nx: hit.nx, ny: hit.ny, cx: hit.cx, cy: hit.cy, give: 0 };
  return pushCloth(next, x, y, vx, vy);
}

export function pushCloth(cloth: Cloth, x: number, y: number, vx: number, vy: number): ClothMove {
  const relX = x - cloth.cx;
  const relY = y - cloth.cy;
  const tangent = relX * -cloth.ny + relY * cloth.nx;
  if (Math.abs(tangent) > BIRD_R + 4) {
    return { cloth: clearCloth(), x, y, vx, vy, held: false };
  }
  const signed = relX * cloth.nx + relY * cloth.ny;
  let pen = BIRD_R - signed;
  if (pen <= 0) return leaveCloth(cloth, x, y, vx, vy);
  if (pen > BAG_GIVE) {
    const fix = pen - BAG_GIVE;
    x += cloth.nx * fix;
    y += cloth.ny * fix;
    pen = BAG_GIVE;
  }
  const vn0 = vx * cloth.nx + vy * cloth.ny;
  let vn = vn0;
  if (pen >= BAG_GIVE && vn < 0) vn = 0;
  const omega = Math.sqrt(STIFFNESS / MASS);
  const an = omega * omega * pen - 2 * BAG_ZETA * omega * vn;
  vn += an * STEP;
  vx += (vn - vn0) * cloth.nx;
  vy += (vn - vn0) * cloth.ny;
  return { cloth: { ...cloth, give: pen }, x, y, vx, vy, held: true };
}

function leaveCloth(cloth: Cloth, x: number, y: number, vx: number, vy: number): ClothMove {
  const vn = vx * cloth.nx + vy * cloth.ny;
  if (vn < 0) {
    const out = -0.1 * vn;
    vx += (out - vn) * cloth.nx;
    vy += (out - vn) * cloth.ny;
  }
  return { cloth: clearCloth(), x, y, vx, vy, held: false };
}

/** Seat spring. Same stiffness as the band, bag damping instead of band damping. */
export function bagSpring(x: number, y: number, vx: number, vy: number, at: { x: number; y: number } = BAG_AT): { x: number; y: number; vx: number; vy: number; rested: boolean } {
  const seat = bagSeat(at);
  const ux = x - seat.x;
  const uy = y - seat.y;
  const omega = Math.sqrt(STIFFNESS / MASS);
  const ax = -omega * omega * ux - 2 * BAG_ZETA * omega * vx;
  const ay = -omega * omega * uy - 2 * BAG_ZETA * omega * vy;
  vx += ax * STEP;
  vy += ay * STEP;
  x += vx * STEP;
  y += vy * STEP;
  const rested = Math.hypot(x - seat.x, y - seat.y) < 0.4 && Math.hypot(vx, vy) < 2;
  if (rested) return { x: seat.x, y: seat.y, vx: 0, vy: 0, rested: true };
  return { x, y, vx, vy, rested: false };
}
