import RAPIER from '@dimforge/rapier2d-compat';
import { bagOuterPoints, ballInBag } from './bag';
import { Band } from './band';
import { applyBall, applyFixture } from './material';
import {
  BAGS,
  ballMaterial,
  woodMaterial,
  BAND_ZETA,
  BIRD_R,
  DEAD_PULL,
  GRAVITY,
  MASS,
  MAX_CATCHUP,
  MAX_PULL,
  SHOW_BAG,
  ROPE_MASS,
  ROPE_THICKNESS,
  SLINGS,
  STEP,
  STIFFNESS,
  type Sling,
  meetBallY,
  slipBallY,
} from './tune';

export type Phase = 'ready' | 'pulling' | 'launching' | 'flying' | 'catching' | 'settling' | 'asleep' | 'returning' | 'gone';

export type Feel = 'pull' | 'slip' | 'launch' | 'catch' | 'asleep' | 'miss' | 'gone' | 'knock';

export type ShotSample = {
  phase: Phase;
  birdX: number;
  birdY: number;
  band: ReadonlyArray<{ x: number; y: number }>;
  strain: number;
  aimX: number;
  aimY: number;
};

export type BagSample = {
  /** Ball centers currently inside this U. Not a rule cap. */
  count: number;
  /** Reserved. Nothing in this level sets it. Hides the label and the stroke. */
  gone: boolean;
};

export type SimSample = {
  hearts: number;
  shots: ShotSample[];
  bags: BagSample[];
};

type Shot = {
  sling: Sling;
  bird: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  band: Band;
  phase: Phase;
  prevX: number;
  prevY: number;
  /** Which bands this ball was already touching. A catch needs a new contact. */
  bandTouch: boolean[];
  catchVx: number;
  catchVy: number;
  returnIn: number;
  drawn: number;
  dirX: number;
  dirY: number;
  ropeX: number;
  ropeY: number;
  ropeVx: number;
  ropeVy: number;
  /** Band index this ball is settling onto. -1 when it is not being caught. */
  catchOn: number;
};

let ready: Promise<void> | null = null;

function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

const ANIMATION: ReadonlySet<Phase> = new Set(['launching', 'flying', 'catching', 'returning']);

/**
 * Three balls, three bands, three bags. A bag holds as many as the shape allows.
 * A sling with a ball can be pulled while another ball is in the air.
 */
export class Sim {
  readonly world: RAPIER.World;
  private bagColliders: RAPIER.Collider[] = [];
  private readonly shots: Shot[];
  private readonly gone: boolean[];
  hearts = 3;
  private accumulator = 0;
  private active: number | null = null;
  private feel: Feel[] = [];
  /** Flyer index + seated index, so one overlap only knocks once. */
  private knocks = new Set<string>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY });
    this.world.integrationParameters.lengthUnit = 80;
    this.syncBags();
    this.gone = BAGS.map(() => false);
    this.shots = SLINGS.map((sling) => this.makeShot(sling));
  }

  private makeShot(sling: Sling): Shot {
    const bird = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(sling.pouch.x, sling.pouch.y)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BIRD_R).setMass(MASS),
      bird,
    );
    applyBall(bird, collider, ballMaterial());
    return {
      sling,
      bird,
      collider,
      band: new Band(sling),
      phase: 'ready',
      prevX: sling.pouch.x,
      prevY: sling.pouch.y,
      bandTouch: SLINGS.map(() => false),
      catchVx: 0,
      catchVy: 0,
      returnIn: 0,
      drawn: 0,
      dirX: 0,
      dirY: 1,
      ropeX: sling.pouch.x,
      ropeY: sling.pouch.y,
      ropeVx: 0,
      ropeVy: 0,
      catchOn: -1,
    };
  }

  applyTune(): void {
    this.world.gravity = { x: 0, y: -GRAVITY };
    for (const shot of this.shots) {
      shot.collider.setMass(MASS);
      shot.collider.setRadius(BIRD_R);
      applyBall(shot.bird, shot.collider, ballMaterial());
    }
    this.syncBags();
  }

  /** Open U as a static polyline. Only its restitution is special. */
  private syncBags(): void {
    for (const collider of this.bagColliders) this.world.removeCollider(collider, true);
    this.bagColliders = [];
    if (!SHOW_BAG) return;
    for (const at of BAGS) {
      const pts = bagOuterPoints(at);
      const vertices = new Float32Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) {
        vertices[i * 2] = pts[i].x;
        vertices[i * 2 + 1] = pts[i].y;
      }
      const desc = RAPIER.ColliderDesc.polyline(vertices);
      applyFixture(desc, woodMaterial());
      this.bagColliders.push(this.world.createCollider(desc));
    }
  }

  static async create(): Promise<Sim> {
    await initRapier();
    return new Sim();
  }

  /** One-shot cues for the frame. Cleared on read. */
  takeFeel(): Feel[] {
    const out = this.feel;
    this.feel = [];
    return out;
  }

  sample(): SimSample {
    const bags: BagSample[] = BAGS.map((_, i) => ({
      count: this.shots.reduce((n, shot) => {
        if (shot.phase === 'ready' || shot.phase === 'pulling' || shot.phase === 'launching' || shot.phase === 'gone') return n;
        const p = shot.bird.translation();
        return n + (ballInBag(p.x, p.y, BAGS[i]) ? 1 : 0);
      }, 0),
      gone: this.gone[i],
    }));
    return {
      hearts: this.hearts,
      shots: this.shots.map((shot) => this.sampleShot(shot)),
      bags,
    };
  }

  private sampleShot(shot: Shot): ShotSample {
    const p = shot.bird.translation();
    const pouch = shot.sling.pouch;
    const dx = pouch.x - p.x;
    const dy = pouch.y - p.y;
    const pull = len(dx, dy);
    const loaded = shot.phase === 'pulling' || shot.phase === 'launching';
    return {
      phase: shot.phase,
      birdX: p.x,
      birdY: p.y,
      band: shot.band.points(),
      strain: loaded ? Math.min(1, pull / MAX_PULL) : 0,
      aimX: pull > 1 ? dx / pull : 0,
      aimY: pull > 1 ? dy / pull : 1,
    };
  }

  pointerDown(worldX: number, worldY: number): void {
    if (this.active !== null) return;
    let best = -1;
    let bestD = 90;
    for (let i = 0; i < this.shots.length; i++) {
      const shot = this.shots[i];
      if (!this.bandCarries(shot)) continue;
      const grab = shot.bird.translation();
      const d = len(worldX - grab.x, worldY - grab.y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) return;
    const shot = this.shots[best];
    if (shot.phase === 'catching') this.claimSling(shot);
    else if (ANIMATION.has(shot.phase)) this.restOnPouch(shot);
    shot.phase = 'pulling';
    this.active = best;
    this.feel.push('pull');
    this.movePull(shot, worldX, worldY);
  }

  pointerMove(worldX: number, worldY: number): void {
    if (this.active === null) return;
    const shot = this.shots[this.active];
    if (shot.phase !== 'pulling') return;
    this.movePull(shot, worldX, worldY);
  }

  cancelPull(): void {
    if (this.active === null) return;
    const shot = this.shots[this.active];
    this.active = null;
    if (shot.phase === 'pulling') this.restOnPouch(shot);
  }

  pointerUp(): void {
    if (this.active === null) return;
    const shot = this.shots[this.active];
    this.active = null;
    if (shot.phase !== 'pulling') return;
    const p = shot.bird.translation();
    const pouch = shot.sling.pouch;
    const dx = pouch.x - p.x;
    const dy = pouch.y - p.y;
    const pull = len(dx, dy);
    if (pull < DEAD_PULL) {
      this.restOnPouch(shot);
      return;
    }
    shot.drawn = pull;
    shot.dirX = dx / pull;
    shot.dirY = dy / pull;
    shot.ropeX = p.x;
    shot.ropeY = p.y;
    shot.ropeVx = 0;
    shot.ropeVy = 0;
    shot.band.holdTaut(p.x, p.y);
    shot.phase = 'launching';
    this.feel.push('launch');
  }

  /** Test hook: fire one sling from its pouch. Index 1 is the middle. */
  launch(vx: number, vy: number, index = 1): void {
    const shot = this.shots[index];
    this.restOnPouch(shot);
    shot.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    shot.bird.setGravityScale(1, true);
    shot.bird.setLinvel({ x: vx, y: vy }, true);
    shot.prevX = shot.sling.pouch.x;
    shot.prevY = shot.sling.pouch.y;
    shot.bandTouch = SLINGS.map(() => false);
    shot.phase = 'flying';
  }

  advance(frameDt: number): void {
    this.accumulator += Math.min(frameDt, MAX_CATCHUP);
    while (this.accumulator >= STEP) {
      this.fixedStep();
      this.accumulator -= STEP;
    }
  }

  private movePull(shot: Shot, worldX: number, worldY: number): void {
    const pouch = shot.sling.pouch;
    let dx = worldX - pouch.x;
    let dy = worldY - pouch.y;
    const pull = len(dx, dy);
    if (pull > MAX_PULL && pull > 0) {
      const s = MAX_PULL / pull;
      dx *= s;
      dy *= s;
    }
    let x = pouch.x + dx;
    let y = pouch.y + dy;
    x = Math.min(366, Math.max(24, x));
    y = Math.min(800, Math.max(BIRD_R, y));
    const meet = meetBallY(x, shot.sling);
    const slip = slipBallY(x, shot.sling);
    if (y > slip) {
      const here = shot.bird.translation();
      if (here.y >= slip - 0.5) {
        this.slipOff(shot, here.x, Math.min(here.y, slip));
        return;
      }
      y = slip;
    }
    shot.bird.setNextKinematicTranslation({ x, y });
    shot.ropeX = x;
    shot.ropeY = y;
    shot.ropeVx = 0;
    shot.ropeVy = 0;
    if (y > meet) shot.band.holdAtRest();
    else shot.band.holdTaut(x, y);
  }

  private slipOff(shot: Shot, x: number, y: number): void {
    shot.bird.setTranslation({ x, y }, true);
    shot.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    shot.bird.setGravityScale(1, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.band.holdAtRest();
    shot.prevX = x;
    shot.prevY = y;
    shot.bandTouch = SLINGS.map(() => false);
    shot.phase = 'flying';
    if (this.active !== null && this.shots[this.active] === shot) this.active = null;
    this.feel.push('slip');
  }

  private stepLaunch(shot: Shot): void {
    const pouch = shot.sling.pouch;
    const ux = shot.ropeX - pouch.x;
    const uy = shot.ropeY - pouch.y;
    const omega2 = STIFFNESS / ROPE_MASS;
    const nvx = shot.ropeVx + -omega2 * ux * STEP;
    const nvy = shot.ropeVy + -omega2 * uy * STEP;
    let nx = shot.ropeX + nvx * STEP;
    let ny = shot.ropeY + nvy * STEP;
    const crossed = ux * (nx - pouch.x) + uy * (ny - pouch.y) <= 0;
    shot.ropeVx = nvx;
    shot.ropeVy = nvy;
    if (crossed) {
      this.detach(shot, nvx, nvy);
      return;
    }
    shot.ropeX = nx;
    shot.ropeY = ny;
    shot.band.holdTaut(nx, ny);
    shot.bird.setNextKinematicTranslation({ x: nx, y: ny });
  }

  private detach(shot: Shot, bandVx: number, bandVy: number): void {
    const pouch = shot.sling.pouch;
    const speed = shot.drawn * Math.sqrt(STIFFNESS / MASS);
    shot.bird.setTranslation({ x: pouch.x, y: pouch.y }, true);
    shot.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    shot.bird.setGravityScale(1, true);
    shot.bird.setLinvel({ x: shot.dirX * speed, y: shot.dirY * speed }, true);
    shot.ropeX = pouch.x;
    shot.ropeY = pouch.y;
    shot.band.release(bandVx, bandVy, STEP);
    shot.prevX = pouch.x;
    shot.prevY = pouch.y;
    shot.bandTouch = SLINGS.map(() => false);
    shot.phase = 'flying';
  }

  private restOnPouch(shot: Shot): void {
    const pouch = shot.sling.pouch;
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setAngvel(0, true);
    shot.bird.setTranslation({ x: pouch.x, y: pouch.y }, true);
    shot.bird.setNextKinematicTranslation({ x: pouch.x, y: pouch.y });
    shot.ropeX = pouch.x;
    shot.ropeY = pouch.y;
    shot.ropeVx = 0;
    shot.ropeVy = 0;
    shot.band.holdSeated();
    shot.catchOn = -1;
    shot.phase = 'ready';
  }

  private beginCatch(shot: Shot, on: number): void {
    const v = shot.bird.linvel();
    shot.catchVx = v.x;
    shot.catchVy = v.y;
    shot.catchOn = on;
    shot.phase = 'catching';
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setGravityScale(0, true);
    this.feel.push('catch');
  }

  private stepCatch(shot: Shot): void {
    const pouch = this.shots[shot.catchOn].sling.pouch;
    const p = shot.bird.translation();
    const ux = p.x - pouch.x;
    const uy = p.y - pouch.y;
    const omega = Math.sqrt(STIFFNESS / MASS);
    const ax = -omega * omega * ux - 2 * BAND_ZETA * omega * shot.catchVx;
    const ay = -omega * omega * uy - 2 * BAND_ZETA * omega * shot.catchVy;
    shot.catchVx += ax * STEP;
    shot.catchVy += ay * STEP;
    const x = p.x + shot.catchVx * STEP;
    const y = p.y + shot.catchVy * STEP;
    shot.bird.setNextKinematicTranslation({ x, y });
    this.shots[shot.catchOn].band.holdUnder(x, y);
    if (len(x - pouch.x, y - pouch.y) < 0.4 && len(shot.catchVx, shot.catchVy) < 2) {
      this.claimSling(shot);
      this.restOnPouch(shot);
    }
  }

  /** The ball sits on the band that caught it. That band's old ball keeps the emptied sling. */
  private claimSling(shot: Shot): void {
    const self = this.shots.indexOf(shot);
    const hostIndex = shot.catchOn;
    if (hostIndex === self || hostIndex < 0) return;
    const host = this.shots[hostIndex];
    const sling = shot.sling;
    const band = shot.band;
    shot.sling = host.sling;
    shot.band = host.band;
    host.sling = sling;
    host.band = band;
    const pouch = host.sling.pouch;
    host.ropeX = pouch.x;
    host.ropeY = pouch.y;
    host.ropeVx = 0;
    host.ropeVy = 0;
    host.band.holdAtRest();
  }

  /** A band holds one ball. Empty bands catch. They are not pulled. */
  private bandCarries(shot: Shot): boolean {
    return shot.phase === 'ready' || shot.phase === 'pulling' || shot.phase === 'launching' || shot.phase === 'catching';
  }

  /** Above this band's rivet line. On the line and below do not count. */
  private onUpperSide(x: number, y: number, sling: Sling): boolean {
    const ax = sling.right.x - sling.left.x;
    const ay = sling.right.y - sling.left.y;
    const cross = ax * (y - sling.left.y) - ay * (x - sling.left.x);
    return cross > 0;
  }

  /**
   * An empty band catches only a new contact that starts above its rivet line.
   * Contact that continues through the launch is not an arrival.
   */
  private catchArrival(shot: Shot, fromX: number, fromY: number, x: number, y: number): boolean {
    const was = shot.bandTouch;
    const now = this.shots.map((host) => this.bandTouches(host, fromX, fromY, x, y));
    shot.bandTouch = now;
    const self = this.shots.indexOf(shot);
    const arrived = (index: number) =>
      now[index] &&
      !was[index] &&
      this.canCatchOn(index) &&
      this.onUpperSide(fromX, fromY, this.shots[index].sling);
    if (arrived(self)) {
      this.beginCatch(shot, self);
      return true;
    }
    for (let other = 0; other < this.shots.length; other++) {
      if (other === self || !arrived(other)) continue;
      this.beginCatch(shot, other);
      return true;
    }
    return false;
  }

  /** Empty bands catch. A band already carrying its one ball cannot. */
  private canCatchOn(index: number): boolean {
    const phase = this.shots[index].phase;
    if (phase !== 'flying' && phase !== 'asleep' && phase !== 'gone') return false;
    return !this.bandHeld(index);
  }

  /**
   * A flying ball hitting a ball on a rope starts a catch-spring wobble.
   * Speed along the contact normal sets how far that ball and its rope swing.
   */
  private knockSeated(flyer: Shot): void {
    const p = flyer.bird.translation();
    const v = flyer.bird.linvel();
    const flyerIndex = this.shots.indexOf(flyer);
    for (let i = 0; i < this.shots.length; i++) {
      const seat = this.shots[i];
      const key = `${flyerIndex}:${i}`;
      if (seat === flyer || (seat.phase !== 'ready' && seat.phase !== 'catching')) {
        this.knocks.delete(key);
        continue;
      }
      if (seat.phase === 'catching' && seat.catchOn !== i) continue;
      const q = seat.bird.translation();
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = BIRD_R * 2 + 2;
      if (dist > reach + 10) {
        this.knocks.delete(key);
        continue;
      }
      if (dist > reach || this.knocks.has(key)) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const approach = v.x * nx + v.y * ny;
      if (approach < 80) continue;
      this.knocks.add(key);
      const kick = Math.min(approach, 1600) * 0.7;
      if (seat.phase === 'ready') {
        seat.catchVx = nx * kick;
        seat.catchVy = ny * kick;
        seat.catchOn = i;
        seat.phase = 'catching';
        seat.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        seat.bird.setLinvel({ x: 0, y: 0 }, true);
        seat.bird.setGravityScale(0, true);
      } else {
        seat.catchVx += nx * kick;
        seat.catchVy += ny * kick;
      }
      this.feel.push('knock');
    }
  }

  private bandHeld(index: number): boolean {
    return this.shots.some((shot) => shot.phase === 'catching' && shot.catchOn === index);
  }

  private bandTouches(shot: Shot, x0: number, y0: number, x1: number, y1: number): boolean {
    const reach = BIRD_R + ROPE_THICKNESS / 2;
    const pts = shot.band.points();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (segmentDistance(x0, y0, x1, y1, a.x, a.y, b.x, b.y) <= reach) return true;
    }
    return false;
  }

  private fixedStep(): void {
    for (const shot of this.shots) {
      if (shot.phase === 'launching') this.stepLaunch(shot);
      else if (shot.phase === 'catching') this.stepCatch(shot);
      else if (shot.phase !== 'pulling' && shot.phase !== 'settling' && !this.bandHeld(this.shots.indexOf(shot))) shot.band.step(STEP);
    }
    this.world.step();
    for (const shot of this.shots) {
      this.afterFly(shot);
    }
  }

  private afterFly(shot: Shot): void {
    if (shot.phase === 'returning') {
      shot.returnIn -= STEP;
      if (shot.returnIn <= 0) this.restOnPouch(shot);
      return;
    }
    if (shot.phase !== 'flying') return;
    this.knockSeated(shot);
    const p = shot.bird.translation();
    const fromX = shot.prevX;
    const fromY = shot.prevY;
    shot.prevX = p.x;
    shot.prevY = p.y;
    if (this.catchArrival(shot, fromX, fromY, p.x, p.y)) return;
    const out = p.x < -40 || p.x > 430 || p.y < -40 || p.y > 900;
    if (out) this.miss(shot);
  }

  private miss(shot: Shot): void {
    this.hearts -= 1;
    if (this.hearts <= 0) {
      shot.phase = 'gone';
      shot.bird.setLinvel({ x: 0, y: 0 }, true);
      shot.bird.setGravityScale(0, true);
      this.feel.push('gone');
      return;
    }
    shot.phase = 'returning';
    shot.returnIn = 0.35;
    this.feel.push('miss');
  }
}

function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = dx - cx;
  const vy = dy - cy;
  const wx = ax - cx;
  const wy = ay - cy;
  const a = ux * ux + uy * uy || 1e-8;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy || 1e-8;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const denom = a * c - b * b;
  let s = denom !== 0 ? (b * e - c * d) / denom : 0;
  let t = (b * s + e) / c;
  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));
  if (t === 0 || t === 1) s = Math.max(0, Math.min(1, (b * t - d) / a));
  const px = ax + s * ux - (cx + t * vx);
  const py = ay + s * uy - (cy + t * vy);
  return Math.hypot(px, py);
}
