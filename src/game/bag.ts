import { BIRD_R, ROPE_THICKNESS, BAG_AT } from './tune';

/** Same rest width as the band. A full pull thins only the band. */
export function bagStroke(): number {
  return ROPE_THICKNESS;
}

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

/** Inner half-width of the lip. Wider than the ball, with a short rim. */
export function bagMouthHalf(): number {
  return BIRD_R * 1.45;
}

/** How far the round seat sits below the lip. */
export function bagDepth(): number {
  return BIRD_R * 1.15;
}

/** Lip center. The opening faces up. */
export function bagMouth(at: { x: number; y: number } = BAG_AT): { x: number; y: number } {
  return { x: at.x, y: at.y + BIRD_R + 10 };
}

/** Ball center, in the round bottom. */
export function bagSeat(at: { x: number; y: number } = BAG_AT): { x: number; y: number } {
  const mouth = bagMouth(at);
  return { x: mouth.x, y: mouth.y - bagDepth() };
}

/** Lower touch point of the line from the lip onto the seat circle. */
function lowerTangent(
  seat: { x: number; y: number },
  radius: number,
  from: { x: number; y: number },
): { x: number; y: number } {
  const dx = from.x - seat.x;
  const dy = from.y - seat.y;
  const d2 = dx * dx + dy * dy;
  const reach = Math.sqrt(Math.max(0, d2 - radius * radius));
  const a = {
    x: seat.x + (radius * radius * dx - radius * reach * dy) / d2,
    y: seat.y + (radius * radius * dy + radius * reach * dx) / d2,
  };
  const b = {
    x: seat.x + (radius * radius * dx + radius * reach * dy) / d2,
    y: seat.y + (radius * radius * dy - radius * reach * dx) / d2,
  };
  return a.y < b.y ? a : b;
}

/** Short straight rim, then the round seat. The rim meets the seat on its tangent. */
function bowl(at: { x: number; y: number }, seatR: number, mouthHalf: number): Array<{ x: number; y: number }> {
  const mouth = bagMouth(at);
  const seat = bagSeat(at);
  const left = { x: mouth.x - mouthHalf, y: mouth.y };
  const right = { x: mouth.x + mouthHalf, y: mouth.y };
  const tl = lowerTangent(seat, seatR, left);
  const tr = lowerTangent(seat, seatR, right);
  let a0 = Math.atan2(tl.y - seat.y, tl.x - seat.x);
  let a1 = Math.atan2(tr.y - seat.y, tr.x - seat.x);
  if (a1 < a0) a1 += Math.PI * 2;
  const points: Array<{ x: number; y: number }> = [left];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    points.push({ x: seat.x + Math.cos(a) * seatR, y: seat.y + Math.sin(a) * seatR });
  }
  points.push(right);
  return points;
}

/** Inner edge. The lip is the mouth. The seat matches the ball. */
export function bagOuterPoints(at: { x: number; y: number } = BAG_AT): Array<{ x: number; y: number }> {
  return bowl(at, BIRD_R, bagMouthHalf());
}

/** Stroke centerline, one half-width outside the inner edge. */
export function bagStrokePoints(at: { x: number; y: number } = BAG_AT): Array<{ x: number; y: number }> {
  const half = bagStroke() / 2;
  return bowl(at, BIRD_R + half, bagMouthHalf() + half);
}

export function aboveOpenMouth(x: number, y: number, at: { x: number; y: number } = BAG_AT): boolean {
  const pts = bagOuterPoints(at);
  const left = pts[0];
  const right = pts[pts.length - 1];
  return y >= left.y && x > left.x && x < right.x;
}

/** Where the center crosses the lip, or null if it does not enter. */
export function mouthEntry(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  at: { x: number; y: number } = BAG_AT,
): { x: number; y: number } | null {
  const pts = bagOuterPoints(at);
  const left = pts[0];
  const right = pts[pts.length - 1];
  const mouthY = left.y;
  if (y0 < mouthY || y1 > mouthY) return null;
  const dy = y1 - y0;
  if (dy === 0) return null;
  const t = (mouthY - y0) / dy;
  if (t < 0 || t > 1) return null;
  const x = x0 + (x1 - x0) * t;
  if (x <= left.x + 2 || x >= right.x - 2) return null;
  return { x, y: mouthY };
}

/** Center fell across the opening. The side walls stay solid. */
export function enteredMouth(x0: number, y0: number, x1: number, y1: number, at: { x: number; y: number } = BAG_AT): boolean {
  return mouthEntry(x0, y0, x1, y1, at) !== null;
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

/** Hard bowl. Outside hits bounce a little. Inside, the ball slides and stays in the cup. */
export function resolveBowl(
  x: number,
  y: number,
  vx: number,
  vy: number,
  sealed: boolean,
  at: { x: number; y: number } = BAG_AT,
): { x: number; y: number; vx: number; vy: number; hit: boolean; impact: number } {
  const pts = bagOuterPoints(at);
  const inside = pointInBag(x, y, pts);
  const edges = sealed ? pts.length : pts.length - 1;
  let best: { dist: number; nx: number; ny: number } | null = null;
  let areaX = 0;
  let areaY = 0;
  for (const p of pts) {
    areaX += p.x;
    areaY += p.y;
  }
  areaX /= pts.length;
  areaY /= pts.length;
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const evx = b.x - a.x;
    const evy = b.y - a.y;
    const l2 = evx * evx + evy * evy || 1e-8;
    let t = ((x - a.x) * evx + (y - a.y) * evy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + evx * t;
    const cy = a.y + evy * t;
    const dist = Math.hypot(x - cx, y - cy);
    const nlen = Math.hypot(evy, -evx) || 1;
    let nx = evy / nlen;
    let ny = -evx / nlen;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((areaX - mx) * nx + (areaY - my) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    if (!best || dist < best.dist) best = { dist, nx, ny };
  }
  if (!best || best.dist >= BIRD_R) return { x, y, vx, vy, hit: false, impact: 0 };
  const pen = BIRD_R - best.dist;
  const nx = best.nx;
  const ny = best.ny;
  const vn = vx * nx + vy * ny;
  if (inside) {
    x -= nx * pen;
    y -= ny * pen;
    if (vn > 0) {
      vx -= nx * vn * 1.4;
      vy -= ny * vn * 1.4;
    }
    const vn2 = vx * nx + vy * ny;
    const tx = vx - vn2 * nx;
    const ty = vy - vn2 * ny;
    vx = vn2 * nx + tx * 0.96;
    vy = vn2 * ny + ty * 0.96;
    return { x, y, vx, vy, hit: true, impact: Math.max(0, vn) };
  }
  x += nx * pen;
  y += ny * pen;
  if (vn < 0) {
    vx -= nx * vn * 1.22;
    vy -= ny * vn * 1.22;
  }
  return { x, y, vx, vy, hit: true, impact: Math.max(0, -vn) };
}
