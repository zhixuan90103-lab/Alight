import RAPIER from '@dimforge/rapier2d-compat';
import { Band } from './band';
import {
  ANCHOR_L,
  ANCHOR_R,
  BAND_ZETA,
  BIRD_R,
  DEAD_PULL,
  GRAVITY,
  GROUND_Y,
  MASS,
  MAX_CATCHUP,
  MAX_PULL,
  NEST,
  NEST_R,
  POUCH,
  ROPE_MASS,
  ROPE_THICKNESS,
  SLING_MID,
  STEP,
  STIFFNESS,
  meetBallY,
  slipBallY,
} from './tune';

export type Phase = 'ready' | 'pulling' | 'launching' | 'flying' | 'catching' | 'settling' | 'asleep' | 'returning' | 'gone';

export type SimSample = {
  phase: Phase;
  hearts: number;
  birdX: number;
  birdY: number;
  ropeX: number;
  ropeY: number;
  band: ReadonlyArray<{ x: number; y: number }>;
  /** 0 at rest, 1 at a full pull. Visual tension only. */
  strain: number;
  aimX: number;
  aimY: number;
  showBand: boolean;
  nestAsleep: boolean;
};

let ready: Promise<void> | null = null;

function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

/**
 * Level 1: one light bird, one soft nest.
 * Nest capture damps velocity and draws the body to the nest center until it stops.
 */
export class Sim {
  readonly world: RAPIER.World;
  readonly bird: RAPIER.RigidBody;
  phase: Phase = 'ready';
  hearts = 3;
  nestAsleep = false;
  private fouled = false;
  /** Stays false until the ball has left the band, so the launch itself is not a catch. */
  private clearOfBand = false;
  private prevX = POUCH.x;
  private prevY = POUCH.y;
  private catchVx = 0;
  private catchVy = 0;
  private accumulator = 0;
  private returnIn = 0;
  private drawn = 0;
  private dirX = 0;
  private dirY = 1;
  ropeX = POUCH.x;
  ropeY = POUCH.y;
  private ropeVx = 0;
  private ropeVy = 0;
  readonly band = new Band();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY });
    // Pixel coordinates. The default length unit (1) clamps speeds that cross many pixels in one step.
    this.world.integrationParameters.lengthUnit = 80;
    const ground = RAPIER.ColliderDesc.cuboid(240, 16).setTranslation(195, GROUND_Y - 16);
    ground.setRestitution(0.05);
    this.world.createCollider(ground);

    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(POUCH.x, POUCH.y)
      .setCcdEnabled(true);
    this.bird = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(BIRD_R).setMass(MASS).setRestitution(0.05),
      this.bird,
    );
  }

  static async create(): Promise<Sim> {
    await initRapier();
    return new Sim();
  }

  sample(): SimSample {
    const p = this.bird.translation();
    const dx = POUCH.x - p.x;
    const dy = POUCH.y - p.y;
    const pull = len(dx, dy);
    const loaded = this.phase === 'pulling' || this.phase === 'launching';
    return {
      phase: this.phase,
      hearts: this.hearts,
      birdX: p.x,
      birdY: p.y,
      ropeX: this.ropeX,
      ropeY: this.ropeY,
      band: this.band.points(),
      strain: loaded ? Math.min(1, pull / MAX_PULL) : 0,
      aimX: pull > 1 ? dx / pull : 0,
      aimY: pull > 1 ? dy / pull : 1,
      showBand: true,
      nestAsleep: this.nestAsleep,
    };
  }

  pointerDown(worldX: number, worldY: number): void {
    if (this.phase !== 'ready') return;
    const p = this.bird.translation();
    if (len(worldX - p.x, worldY - p.y) > 90) return;
    this.phase = 'pulling';
    this.movePull(worldX, worldY);
  }

  pointerMove(worldX: number, worldY: number): void {
    if (this.phase !== 'pulling') return;
    this.movePull(worldX, worldY);
  }

  cancelPull(): void {
    if (this.phase === 'pulling') this.restOnPouch();
  }

  pointerUp(): void {
    if (this.phase !== 'pulling') return;
    const p = this.bird.translation();
    const dx = POUCH.x - p.x;
    const dy = POUCH.y - p.y;
    const pull = len(dx, dy);
    if (pull < DEAD_PULL) {
      this.restOnPouch();
      return;
    }
    this.drawn = pull;
    this.dirX = dx / pull;
    this.dirY = dy / pull;
    this.ropeX = p.x;
    this.ropeY = p.y;
    this.ropeVx = 0;
    this.ropeVy = 0;
    this.band.holdTaut(p.x, p.y);
    this.fouled = false;
    this.phase = 'launching';
  }

  /** Test hook: fire from the pouch along a world-space velocity. */
  launch(vx: number, vy: number): void {
    this.restOnPouch();
    this.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.bird.setGravityScale(1, true);
    this.bird.setLinvel({ x: vx, y: vy }, true);
    this.fouled = false;
    this.clearOfBand = false;
    this.prevX = POUCH.x;
    this.prevY = POUCH.y;
    this.phase = 'flying';
  }

  advance(frameDt: number): void {
    this.accumulator += Math.min(frameDt, MAX_CATCHUP);
    while (this.accumulator >= STEP) {
      this.fixedStep();
      this.accumulator -= STEP;
    }
  }

  private movePull(worldX: number, worldY: number): void {
    let dx = worldX - POUCH.x;
    let dy = worldY - POUCH.y;
    const pull = len(dx, dy);
    if (pull > MAX_PULL && pull > 0) {
      const s = MAX_PULL / pull;
      dx *= s;
      dy *= s;
    }
    let x = POUCH.x + dx;
    let y = POUCH.y + dy;
    const minY = GROUND_Y + BIRD_R + 12;
    x = Math.min(360, Math.max(30, x));
    y = Math.min(800, Math.max(minY, y));
    const meet = meetBallY(x);
    const slip = slipBallY(x);
    if (y > slip) {
      const here = this.bird.translation();
      if (here.y >= slip - 0.5) {
        this.slipOff(here.x, Math.min(here.y, slip));
        return;
      }
      y = slip;
    }
    this.bird.setNextKinematicTranslation({ x, y });
    this.ropeX = x;
    this.ropeY = y;
    this.ropeVx = 0;
    this.ropeVy = 0;
    // Past the empty band the band stays there. The ball may still rise a little in the hand.
    if (y > meet) this.band.holdAtRest();
    else this.band.holdTaut(x, y);
    this.world.step();
  }

  /**
   * The finger kept going after the band was already straight.
   * The ball drops from where it is. It is not a shot, and the finger cannot steer it.
   */
  private slipOff(x: number, y: number): void {
    this.bird.setTranslation({ x, y }, true);
    this.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.bird.setGravityScale(1, true);
    this.bird.setLinvel({ x: 0, y: 0 }, true);
    this.band.holdAtRest();
    this.clearOfBand = false;
    this.prevX = x;
    this.prevY = y;
    this.fouled = false;
    this.phase = 'flying';
  }

  /**
   * The pouch retracts on the band's small mass, with the ball still in it.
   * At rest length the ball leaves at the locked draw speed.
   * The band points keep that speed and whip back on their rest lengths.
   */
  private stepLaunch(): void {
    const ux = this.ropeX - POUCH.x;
    const uy = this.ropeY - POUCH.y;
    const omega2 = STIFFNESS / ROPE_MASS;
    const nvx = this.ropeVx + -omega2 * ux * STEP;
    const nvy = this.ropeVy + -omega2 * uy * STEP;
    const nx = this.ropeX + nvx * STEP;
    const ny = this.ropeY + nvy * STEP;
    const crossed = ux * (nx - POUCH.x) + uy * (ny - POUCH.y) <= 0;
    this.ropeVx = nvx;
    this.ropeVy = nvy;
    if (crossed) {
      this.detach(nvx, nvy);
      return;
    }
    this.ropeX = nx;
    this.ropeY = ny;
    this.band.holdTaut(nx, ny);
    this.bird.setNextKinematicTranslation({ x: nx, y: ny });
    this.world.step();
  }

  private detach(bandVx: number, bandVy: number): void {
    const speed = this.drawn * Math.sqrt(STIFFNESS / MASS);
    this.bird.setTranslation({ x: POUCH.x, y: POUCH.y }, true);
    this.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.bird.setGravityScale(1, true);
    this.bird.setLinvel({ x: this.dirX * speed, y: this.dirY * speed }, true);
    this.ropeX = POUCH.x;
    this.ropeY = POUCH.y;
    this.band.release(bandVx, bandVy, STEP);
    this.clearOfBand = false;
    this.prevX = POUCH.x;
    this.prevY = POUCH.y;
    this.phase = 'flying';
  }

  private restOnPouch(): void {
    this.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.bird.setLinvel({ x: 0, y: 0 }, true);
    this.bird.setAngvel(0, true);
    this.bird.setNextKinematicTranslation({ x: POUCH.x, y: POUCH.y });
    this.ropeX = POUCH.x;
    this.ropeY = POUCH.y;
    this.ropeVx = 0;
    this.ropeVy = 0;
    this.band.holdSeated();
    this.clearOfBand = false;
    this.world.step();
    this.phase = 'ready';
  }

  /**
   * The ball stays on the band and keeps the speed it had at contact.
   * The same stiffness pulls it into the pouch, so the band gives once and then holds.
   */
  private beginCatch(): void {
    const v = this.bird.linvel();
    this.catchVx = v.x;
    this.catchVy = v.y;
    this.phase = 'catching';
    this.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.bird.setLinvel({ x: 0, y: 0 }, true);
    this.bird.setGravityScale(0, true);
  }

  private stepCatch(): void {
    const p = this.bird.translation();
    const ux = p.x - POUCH.x;
    const uy = p.y - POUCH.y;
    const omega = Math.sqrt(STIFFNESS / MASS);
    const ax = -omega * omega * ux - 2 * BAND_ZETA * omega * this.catchVx;
    const ay = -omega * omega * uy - 2 * BAND_ZETA * omega * this.catchVy;
    this.catchVx += ax * STEP;
    this.catchVy += ay * STEP;
    let x = p.x + this.catchVx * STEP;
    let y = p.y + this.catchVy * STEP;
    const floor = GROUND_Y + BIRD_R;
    if (y < floor) {
      y = floor;
      this.catchVy = 0;
    }
    this.bird.setNextKinematicTranslation({ x, y });
    this.band.holdUnder(x, y);
    this.world.step();
    // Only sit once the swing is already too small to see. A wider cutoff chops the last bounce.
    if (len(x - POUCH.x, y - POUCH.y) < 0.4 && len(this.catchVx, this.catchVy) < 2) {
      this.restOnPouch();
    }
  }

  private bandTouches(x0: number, y0: number, x1: number, y1: number): boolean {
    const reach = BIRD_R + ROPE_THICKNESS / 2;
    const pts = this.band.points();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (segmentDistance(x0, y0, x1, y1, a.x, a.y, b.x, b.y) <= reach) return true;
    }
    return false;
  }

  private fixedStep(): void {
    if (this.phase === 'launching') {
      this.stepLaunch();
      return;
    }
    if (this.phase === 'catching') {
      this.stepCatch();
      return;
    }
    this.band.step(STEP);

    if (this.phase === 'pulling' || this.phase === 'ready' || this.phase === 'asleep' || this.phase === 'gone') {
      return;
    }

    if (this.phase === 'returning') {
      this.returnIn -= STEP;
      if (this.returnIn <= 0) this.restOnPouch();
      return;
    }

    this.world.step();
    const p = this.bird.translation();
    const v = this.bird.linvel();
    const speed = len(v.x, v.y);
    const toNest = len(p.x - NEST.x, p.y - NEST.y);

    if (this.phase === 'flying' && !this.fouled && toNest < NEST_R) {
      this.phase = 'settling';
      this.bird.setGravityScale(0, true);
    }

    if (this.phase === 'settling') {
      const nx = NEST.x - p.x;
      const ny = NEST.y - p.y;
      this.bird.setLinvel({ x: v.x * 0.72, y: v.y * 0.72 }, true);
      this.bird.setTranslation({ x: p.x + nx * 0.18, y: p.y + ny * 0.18 }, true);
      const after = this.bird.linvel();
      const left = len(after.x, after.y);
      const dist = len(NEST.x - this.bird.translation().x, NEST.y - this.bird.translation().y);
      if (left < 18 && dist < 10) {
        this.bird.setLinvel({ x: 0, y: 0 }, true);
        this.bird.setTranslation({ x: NEST.x, y: NEST.y }, true);
        this.bird.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        this.phase = 'asleep';
        this.nestAsleep = true;
      }
      return;
    }

    if (this.phase === 'flying') {
      const touched = this.bandTouches(this.prevX, this.prevY, p.x, p.y);
      this.prevX = p.x;
      this.prevY = p.y;
      if (!touched) this.clearOfBand = true;
      else if (this.clearOfBand) {
        this.beginCatch();
        return;
      }
      const hitGround = p.y - BIRD_R <= GROUND_Y + 2 && v.y <= 0;
      const out = p.x < -40 || p.x > 430 || p.y > 900;
      if (hitGround || out) {
        this.fouled = true;
        this.hearts -= 1;
        if (this.hearts <= 0) {
          this.phase = 'gone';
          this.bird.setLinvel({ x: 0, y: 0 }, true);
          return;
        }
        this.phase = 'returning';
        this.returnIn = 0.35;
      } else if (speed < 30 && p.y < NEST.y - 40) {
        this.fouled = true;
      }
    }
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

export const SLING_ANCHORS = { left: ANCHOR_L, right: ANCHOR_R, mid: SLING_MID };
