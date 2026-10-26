import {
  BAND_ZETA,
  bandWidth,
  BIRD_R,
  emptyBandY,
  MAX_PULL,
  ROPE_MASS,
  STIFFNESS,
  type Sling,
} from './tune';

/**
 * Two rubber bands joined at one pouch.
 * While the ball is held, the points sit on the taut cradle.
 * After release the whole band is one tight bow: it snaps past the sag, then settles.
 * A loose chain would fold, and a rubber band stays smooth.
 */

const SIDE = 4;
const ARC = 20;
export const BAND_COUNT = 2 * SIDE + ARC + 1;

type Node = {
  x: number;
  y: number;
  px: number;
  py: number;
  rx: number;
  ry: number;
};

/** Centerline radius. The drawn inner edge lands on the ball, with a pixel of overlap so no seam shows. */
function seatFor(ballX: number, ballY: number, sling: Sling): number {
  const pull = Math.hypot(ballX - sling.pouch.x, ballY - sling.pouch.y);
  const strain = Math.min(1, pull / MAX_PULL);
  return BIRD_R + bandWidth(strain) / 2 - 1;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function tangents(
  anchorX: number,
  anchorY: number,
  ballX: number,
  ballY: number,
  seat: number,
): Array<{ x: number; y: number; angle: number }> | null {
  const dx = anchorX - ballX;
  const dy = anchorY - ballY;
  const reach = Math.hypot(dx, dy);
  if (reach <= seat + 0.5) return null;
  const beta = Math.atan2(dy, dx);
  const theta = Math.acos(Math.min(1, seat / reach));
  return [beta + theta, beta - theta].map((angle) => ({
    x: ballX + Math.cos(angle) * seat,
    y: ballY + Math.sin(angle) * seat,
    angle,
  }));
}

function angDist(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function sweepThrough(left: number, right: number, target: number): { start: number; span: number } {
  const turn = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const span = turn(right - left);
  if (turn(target - left) <= span + 1e-4) return { start: left, span };
  return { start: left, span: span - Math.PI * 2 };
}

/**
 * Both arms are straight tangents. The arc is only the part of the ball that faces the cup,
 * and it must be the short way, so the strap does not hook over the ball.
 */
function tangentCup(
  ballX: number,
  ballY: number,
  seat: number,
  cup: number,
  sling: Sling,
): Array<{ x: number; y: number }> | null {
  const lefts = tangents(sling.left.x, sling.left.y, ballX, ballY, seat);
  const rights = tangents(sling.right.x, sling.right.y, ballX, ballY, seat);
  if (!lefts || !rights) return null;
  let best: Array<{ x: number; y: number }> | null = null;
  let bestD = Infinity;
  for (const left of lefts) {
    for (const right of rights) {
      if (lineHitsBall(sling.left.x, sling.left.y, left.x, left.y, ballX, ballY, seat)) continue;
      if (lineHitsBall(sling.right.x, sling.right.y, right.x, right.y, ballX, ballY, seat)) continue;
      if (linesCross(sling.left.x, sling.left.y, left.x, left.y, sling.right.x, sling.right.y, right.x, right.y)) continue;
      const sweep = sweepThrough(left.angle, right.angle, cup);
      if (Math.abs(sweep.span) > Math.PI) continue;
      const mid = sweep.start + sweep.span / 2;
      const d = angDist(mid, cup);
      if (d > Math.PI / 2 || d >= bestD) continue;
      const pose = poseFrom(ballX, ballY, seat, left, right, sweep, sling);
      if (polylineCross(pose)) continue;
      bestD = d;
      best = pose;
    }
  }
  return best;
}

function lineHitsBall(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ballX: number,
  ballY: number,
  seat: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((ballX - ax) * dx + (ballY - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ballX - (ax + t * dx), ballY - (ay + t * dy)) < seat - 0.6;
}

function polylineCross(pts: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      const share = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
    if (share(pts[i], pts[j]) || share(pts[i], pts[j + 1]) || share(pts[i + 1], pts[j]) || share(pts[i + 1], pts[j + 1])) continue;
    if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) < 1) continue;
    if (Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y) < 1) continue;
    if (linesCross(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y)) {
        return true;
      }
    }
  }
  return false;
}

function linesCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d2 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  const d3 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d4 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function poseFrom(
  ballX: number,
  ballY: number,
  seat: number,
  left: { x: number; y: number; angle: number },
  right: { x: number; y: number; angle: number },
  sweep: { start: number; span: number },
  sling: Sling,
): Array<{ x: number; y: number }> {
  const pose: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= SIDE; i++) {
    const t = i / SIDE;
    pose.push({
      x: sling.left.x + (left.x - sling.left.x) * t,
      y: sling.left.y + (left.y - sling.left.y) * t,
    });
  }
  for (let i = 1; i < ARC; i++) {
    const angle = sweep.start + sweep.span * (i / ARC);
    pose.push({ x: ballX + Math.cos(angle) * seat, y: ballY + Math.sin(angle) * seat });
  }
  for (let i = 0; i <= SIDE; i++) {
    const t = i / SIDE;
    pose.push({
      x: right.x + (sling.right.x - right.x) * t,
      y: right.y + (sling.right.y - right.y) * t,
    });
  }
  return pose;
}

/** Straight arm to the tangent nearest the cup. A post inside the ball has none. */
function attach(
  anchorX: number,
  anchorY: number,
  ballX: number,
  ballY: number,
  seat: number,
  cup: number,
): { x: number; y: number; angle: number } | null {
  const pair = tangents(anchorX, anchorY, ballX, ballY, seat);
  if (!pair) return null;
  let best: { x: number; y: number; angle: number } | null = null;
  let bestD = Infinity;
  for (const hit of pair) {
    if (lineHitsBall(anchorX, anchorY, hit.x, hit.y, ballX, ballY, seat)) continue;
    const d = angDist(hit.angle, cup);
    if (d < bestD) {
      best = hit;
      bestD = d;
    }
  }
  return best;
}

/**
 * The paired cradle did not fit. Each arm is still a straight tangent.
 * The arc is the short side facing the cup, and it ends on those same tangent points.
 */
function roundCup(
  ballX: number,
  ballY: number,
  seat: number,
  cup: number,
  sling: Sling,
): Array<{ x: number; y: number }> {
  const left = attach(sling.left.x, sling.left.y, ballX, ballY, seat, cup);
  const right = attach(sling.right.x, sling.right.y, ballX, ballY, seat, cup);
  if (left && right && !linesCross(sling.left.x, sling.left.y, left.x, left.y, sling.right.x, sling.right.y, right.x, right.y)) {
    const sweep = sweepThrough(left.angle, right.angle, cup);
    if (Math.abs(sweep.span) <= Math.PI) {
      const mid = sweep.start + sweep.span / 2;
      if (angDist(mid, cup) <= Math.PI / 2) return poseFrom(ballX, ballY, seat, left, right, sweep, sling);
    }
  }
  const pose: Array<{ x: number; y: number }> = [];
  const pushLine = (anchorX: number, anchorY: number, tip: { x: number; y: number }, towardTip: boolean) => {
    for (let i = 0; i <= SIDE; i++) {
      const t = towardTip ? i / SIDE : 1 - i / SIDE;
      if (!towardTip && i === 0) continue;
      if (towardTip && i === SIDE) continue;
      pose.push({
        x: anchorX + (tip.x - anchorX) * t,
        y: anchorY + (tip.y - anchorY) * t,
      });
    }
  };
  if (left) pushLine(sling.left.x, sling.left.y, left, true);
  if (left && right) {
    const sweep = sweepThrough(left.angle, right.angle, cup);
    const span = Math.abs(sweep.span) <= Math.PI ? sweep.span : sweep.span - Math.sign(sweep.span) * Math.PI * 2;
    if (Math.abs(span) > 0.15) {
      for (let i = 0; i <= ARC; i++) {
        const t = sweep.start + span * (i / ARC);
        pose.push({ x: ballX + Math.cos(t) * seat, y: ballY + Math.sin(t) * seat });
      }
    }
  } else if (left || right) {
    const tip = (left ?? right)!;
    pose.push({ x: tip.x, y: tip.y });
  }
  if (right) pushLine(sling.right.x, sling.right.y, right, false);
  if (pose.length < 2) {
    return [
      { x: sling.left.x, y: sling.left.y },
      { x: ballX, y: ballY },
      { x: sling.right.x, y: sling.right.y },
    ];
  }
  return resample(pose, BAND_COUNT);
}

function resample(pts: Array<{ x: number; y: number }>, count: number): Array<{ x: number; y: number }> {
  const usable: Array<{ x: number; y: number }> = [];
  for (const p of pts) {
    const last = usable[usable.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.2) continue;
    usable.push(p);
  }
  if (usable.length === 0) return pts;
  if (usable.length === 1) return Array.from({ length: count }, () => ({ x: usable[0].x, y: usable[0].y }));
  const mark: number[] = [0];
  for (let i = 1; i < usable.length; i++) {
    mark.push(mark[i - 1] + Math.hypot(usable[i].x - usable[i - 1].x, usable[i].y - usable[i - 1].y));
  }
  const total = mark[mark.length - 1] || 1;
  const out: Array<{ x: number; y: number }> = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const dist = (total * i) / (count - 1);
    while (seg < mark.length - 2 && mark[seg + 1] < dist) seg += 1;
    const span = mark[seg + 1] - mark[seg] || 1;
    const t = (dist - mark[seg]) / span;
    const a = usable[seg];
    const b = usable[seg + 1];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function restAt(t: number, sling: Sling): { x: number; y: number } {
  const x = sling.left.x + (sling.right.x - sling.left.x) * t;
  return { x, y: emptyBandY(x, sling) };
}

export class Band {
  readonly nodes: Node[];
  /** How far the middle sits past the resting sag, along the release direction. */
  private amp = 0;
  private ampV = 0;
  private dirX = 0;
  private dirY = 1;
  /** Where the cup faces. Gravity at rest. Follows the pull while drawn. */
  private cupAngle = -Math.PI / 2;
  live = false;

  constructor(private readonly sling: Sling) {
    this.nodes = [];
    for (let i = 0; i < BAND_COUNT; i++) {
      const empty = restAt(i / (BAND_COUNT - 1), sling);
      this.nodes.push({ x: empty.x, y: empty.y, px: empty.x, py: empty.y, rx: empty.x, ry: empty.y });
    }
    this.holdSeated();
  }

  /** Write the current nodes into `out`. Callers keep their own arrays so a sample is not overwritten by the next touch test. */
  copyPoints(out: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const n = this.nodes.length;
    while (out.length < n) out.push({ x: 0, y: 0 });
    out.length = n;
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      const p = out[i];
      p.x = node.x;
      p.y = node.y;
    }
    return out;
  }

  /** Rebuild the empty arc from the sling's current anchors. */
  placeAtRest(): void {
    this.live = false;
    this.amp = 0;
    this.ampV = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const empty = restAt(i / (BAND_COUNT - 1), this.sling);
      const n = this.nodes[i];
      n.rx = empty.x;
      n.ry = empty.y;
      n.x = empty.x;
      n.y = empty.y;
      n.px = empty.x;
      n.py = empty.y;
    }
  }

  /** Ball left. The band hangs on its own mass. */
  holdAtRest(): void {
    this.live = false;
    for (const n of this.nodes) {
      n.x = n.rx;
      n.y = n.ry;
      n.px = n.rx;
      n.py = n.ry;
    }
  }

  /**
   * Ball sitting in the pouch. The weight is on the contact patch,
   * so each free side is a straight line into the ball. Only the bottom follows the surface.
   */
  holdSeated(): void {
    this.live = false;
    this.cupAngle = -Math.PI / 2;
    this.writePose(this.cradle(this.sling.pouch.x, this.sling.pouch.y, false));
  }

  /** Catch. The cup turns with the ball, a little at a time, so the arc does not flip. */
  holdUnder(ballX: number, ballY: number): void {
    this.live = false;
    this.writePose(this.cradle(ballX, ballY, true));
  }

  /** Pulled cradle. The cup faces the pull. At rest it faces gravity. */
  holdTaut(ballX: number, ballY: number): boolean {
    this.writePose(this.cradle(ballX, ballY, false));
    this.live = false;
    return true;
  }

  /**
   * Bottom follows the pull. Near the pouch, with no real pull, it eases back to gravity.
   * `ease` limits how fast the cup can rotate, used while a catch is settling.
   */
  private cradle(ballX: number, ballY: number, ease: boolean): Array<{ x: number; y: number }> {
    const dx = ballX - this.sling.mid.x;
    const dy = ballY - this.sling.mid.y;
    const dist = Math.hypot(dx, dy);
    const pull = Math.min(1, Math.max(0, (dist - 10) / 36));
    const px = dist > 1 ? dx / dist : 0;
    const py = dist > 1 ? dy / dist : -1;
    const tx = px * pull;
    const ty = py * pull + -1 * (1 - pull);
    let target = Math.atan2(ty, tx);
    // Between the anchors, a catch keeps the cradle under the ball.
    // Easing the old pull angle leaves one frame where the arc hooks over the crown.
    const between = ballX > this.sling.left.x && ballX < this.sling.right.x;
    if (between && (ease || ballY > this.sling.pouch.y)) target = -Math.PI / 2;
    let delta = target - this.cupAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.cupAngle = ease && between ? target : this.cupAngle + (ease ? delta * 0.28 : delta);
    const seat = seatFor(ballX, ballY, this.sling);
    return tangentCup(ballX, ballY, seat, this.cupAngle, this.sling) ?? roundCup(ballX, ballY, seat, this.cupAngle, this.sling);
  }

  private writePose(pose: Array<{ x: number; y: number }>): void {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const p = pose[i] ?? pose[pose.length - 1];
      n.x = p.x;
      n.y = p.y;
      n.px = p.x;
      n.py = p.y;
    }
  }

  /**
   * The empty band is one tight bow, not a slack chain.
   * Rubber only pulls, so every point stays on a smooth curve back to the sag.
   */
  release(vx: number, vy: number, _dt: number): void {
    this.live = true;
    const mid = this.nodes[Math.floor((this.nodes.length - 1) / 2)];
    const dx = mid.x - mid.rx;
    const dy = mid.y - mid.ry;
    const pull = Math.hypot(dx, dy);
    const speed = Math.hypot(vx, vy);
    if (pull > 1) {
      this.dirX = dx / pull;
      this.dirY = dy / pull;
    } else if (speed > 1) {
      this.dirX = vx / speed;
      this.dirY = vy / speed;
    }
    this.amp = dx * this.dirX + dy * this.dirY;
    this.ampV = vx * this.dirX + vy * this.dirY;
    this.applyBow();
  }

  step(dt: number): void {
    if (!this.live) return;
    const omega = Math.sqrt(STIFFNESS / ROPE_MASS);
    const accel = -omega * omega * this.amp - 2 * BAND_ZETA * omega * this.ampV;
    this.ampV += accel * dt;
    this.amp += this.ampV * dt;
    this.applyBow();
    if (Math.abs(this.amp) < 1.2 && Math.abs(this.ampV) < 12) {
      this.amp = 0;
      this.ampV = 0;
      this.holdAtRest();
    }
  }

  /** One arch from anchor to anchor. Ends stay pinned, so the band cannot fold. */
  private applyBow(): void {
    const last = this.nodes.length - 1;
    for (let i = 0; i <= last; i++) {
      const t = i / last;
      const bow = Math.sin(Math.PI * t);
      const n = this.nodes[i];
      n.x = n.rx + this.dirX * this.amp * bow;
      n.y = n.ry + this.dirY * this.amp * bow;
      n.px = n.x;
      n.py = n.y;
    }
  }
}

