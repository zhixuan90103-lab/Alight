import { BIRD_R, ROPE_THICKNESS, BAG_AT } from './tune';

/** Same rest width as the band. A full pull thins only the band. */
export function bagStroke(): number {
  return ROPE_THICKNESS;
}

/** Inner half-width. The bottom is a semicircle of this radius. */
export function bagMouthHalf(): number {
  return BIRD_R * 1.7;
}

/** Straight wall above the semicircle, so the pocket reads as a tall U. */
export function bagLeg(): number {
  return BIRD_R * 3.2;
}

/** Mouth down to the ball's rest point on the round bottom. */
export function bagDepth(): number {
  return bagLeg() + bagMouthHalf() - BIRD_R;
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

/** Open U. Vertical sides, semicircular bottom. `outset` grows a parallel centerline. */
function bowl(at: { x: number; y: number }, outset: number): Array<{ x: number; y: number }> {
  const mouth = bagMouth(at);
  const half = bagMouthHalf() + outset;
  const leg = bagLeg();
  const seat = { x: mouth.x, y: mouth.y - leg };
  const left = { x: mouth.x - half, y: mouth.y };
  const right = { x: mouth.x + half, y: mouth.y };
  const points: Array<{ x: number; y: number }> = [left, { x: left.x, y: seat.y }];
  const steps = 18;
  for (let i = 1; i < steps; i++) {
    const a = Math.PI + (Math.PI * i) / steps;
    points.push({ x: seat.x + Math.cos(a) * half, y: seat.y + Math.sin(a) * half });
  }
  points.push({ x: right.x, y: seat.y }, right);
  return points;
}

/** Inner edge. The lip is the mouth. The bottom is wider than the ball. */
export function bagOuterPoints(at: { x: number; y: number } = BAG_AT): Array<{ x: number; y: number }> {
  return bowl(at, 0);
}

/** Stroke centerline, one half-width outside the inner edge. */
export function bagStrokePoints(at: { x: number; y: number } = BAG_AT): Array<{ x: number; y: number }> {
  return bowl(at, bagStroke() / 2);
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

/** Ball center is inside the open U. The mouth is the closing edge of the outline. */
export function ballInBag(x: number, y: number, at: { x: number; y: number } = BAG_AT): boolean {
  return pointInBag(x, y, bagOuterPoints(at));
}
