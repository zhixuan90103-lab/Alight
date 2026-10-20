import RAPIER from '@dimforge/rapier2d-compat';
import { aboveOpenMouth, bagContact, bagSeat, bagSpring, clearCloth, enteredMouth, pushCloth, touchCloth, type Cloth } from './bag';
import { Band } from './band';
import {
  BAGS,
  BAND_ZETA,
  BIRD_R,
  DEAD_PULL,
  GRAVITY,
  GROUND_Y,
  MASS,
  MAX_CATCHUP,
  MAX_PULL,
  SHOW_BAG,
  RIVET_BOUNCE,
  RIVET_R,
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

export type Feel = 'pull' | 'slip' | 'launch' | 'catch' | 'asleep' | 'miss' | 'gone' | 'give' | 'knock';

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
  sealed: boolean;
  /** Ball has settled. The bag and the ball leave the playfield. */
  gone: boolean;
  give: number;
  pressX: number;
  pressY: number;
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
  cloth: Cloth;
  /** Bag this shot is pushing or settling into. -1 when none. */
  bag: number;
  clearOfBand: boolean;
  prevX: number;
  prevY: number;
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
 * Three balls, three bands, three bags. Each bag holds one ball.
 * A sling with a ball can be pulled while another ball is in the air.
 */
export class Sim {
  readonly world: RAPIER.World;
  private groundCollider: RAPIER.Collider;
  private readonly shots: Shot[];
  private readonly sealed: boolean[];
  private readonly gone: boolean[];
  hearts = 3;
  private accumulator = 0;
  private active: number | null = null;
  private feel: Feel[] = [];
  /** Flyer index + seated index, so one overlap only knocks once. */
  private knocks = new Set<string>();
  /** Rivet collider handle → the band it belongs to. */
  private readonly rivetOf = new Map<number, Sling>();
  private readonly hooks: RAPIER.PhysicsHooks;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY });
    this.world.integrationParameters.lengthUnit = 80;
    const ground = RAPIER.ColliderDesc.cuboid(240, 16).setTranslation(195, GROUND_Y - 16);
    ground.setRestitution(0.05);
    this.groundCollider = this.world.createCollider(ground);
    for (const sling of SLINGS) {
      for (const rivet of [sling.left, sling.right]) {
        const desc = RAPIER.ColliderDesc.ball(RIVET_R)
          .setTranslation(rivet.x, rivet.y)
          .setRestitution(RIVET_BOUNCE)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setFriction(0.2)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
        const collider = this.world.createCollider(desc);
        this.rivetOf.set(collider.handle, sling);
      }
    }
    this.hooks = {
      filterContactPair: (a, b) => {
        const sling = this.rivetOf.get(a) ?? this.rivetOf.get(b);
        if (!sling) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        const ball = this.world.getCollider(this.rivetOf.has(a) ? b : a);
        const at = ball.translation();
        if (betweenRivets(at.x, at.y, sling)) return RAPIER.SolverFlags.EMPTY;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
    this.sealed = BAGS.map(() => false);
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
      RAPIER.ColliderDesc.ball(BIRD_R).setMass(MASS).setRestitution(0.05),
      bird,
    );
    return {
      sling,
      bird,
      collider,
      band: new Band(sling),
      phase: 'ready',
      cloth: clearCloth(),
      bag: -1,
      clearOfBand: false,
      prevX: sling.pouch.x,
      prevY: sling.pouch.y,
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
    }
    this.groundCollider.setTranslation({ x: 195, y: GROUND_Y - 16 });
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
      sealed: this.sealed[i],
      gone: this.gone[i],
      give: 0,
      pressX: 0,
      pressY: 0,
    }));
    for (const shot of this.shots) {
      if (shot.bag < 0 || shot.cloth.give <= bags[shot.bag].give) continue;
      bags[shot.bag].give = shot.cloth.give;
      bags[shot.bag].pressX = shot.cloth.nx;
      bags[shot.bag].pressY = shot.cloth.ny;
    }
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
      if (shot.phase !== 'ready' && !ANIMATION.has(shot.phase)) continue;
      const grab = shot.phase === 'catching' ? shot.bird.translation() : ANIMATION.has(shot.phase) ? shot.sling.pouch : shot.bird.translation();
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
    shot.clearOfBand = false;
    shot.prevX = shot.sling.pouch.x;
    shot.prevY = shot.sling.pouch.y;
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
    const minY = GROUND_Y + BIRD_R + 12;
    x = Math.min(366, Math.max(24, x));
    y = Math.min(800, Math.max(minY, y));
    const blocked = this.blockRivets(x, y, 0, 0);
    x = blocked.x;
    y = blocked.y;
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
    shot.clearOfBand = false;
    shot.prevX = x;
    shot.prevY = y;
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
    const blocked = this.blockRivets(nx, ny, nvx, nvy);
    nx = blocked.x;
    ny = blocked.y;
    const crossed = ux * (nx - pouch.x) + uy * (ny - pouch.y) <= 0;
    shot.ropeVx = blocked.vx;
    shot.ropeVy = blocked.vy;
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
    shot.clearOfBand = false;
    shot.prevX = pouch.x;
    shot.prevY = pouch.y;
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
    shot.clearOfBand = false;
    shot.cloth = clearCloth();
    shot.bag = -1;
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

  private stepBag(shot: Shot): void {
    const at = BAGS[shot.bag];
    const p = shot.bird.translation();
    const next = bagSpring(p.x, p.y, shot.catchVx, shot.catchVy, at);
    shot.catchVx = next.vx;
    shot.catchVy = next.vy;
    shot.bird.setNextKinematicTranslation({ x: next.x, y: next.y });
    if (!next.rested) return;
    const seat = bagSeat(at);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setTranslation({ x: seat.x, y: seat.y }, true);
    shot.bird.setNextKinematicTranslation({ x: seat.x, y: seat.y });
    shot.bird.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    shot.collider.setEnabled(false);
    shot.phase = 'asleep';
    this.gone[shot.bag] = true;
    this.feel.push('asleep');
  }

  private beginBag(shot: Shot, bag: number): void {
    const v = shot.bird.linvel();
    shot.catchVx = v.x;
    shot.catchVy = v.y;
    shot.bag = bag;
    shot.cloth = clearCloth();
    this.sealed[bag] = true;
    shot.phase = 'settling';
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setGravityScale(0, true);
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
    let x = p.x + shot.catchVx * STEP;
    let y = p.y + shot.catchVy * STEP;
    const floor = GROUND_Y + BIRD_R;
    if (y < floor) {
      y = floor;
      shot.catchVy = 0;
    }
    const blocked = this.blockRivets(x, y, shot.catchVx, shot.catchVy);
    x = blocked.x;
    y = blocked.y;
    shot.catchVx = blocked.vx;
    shot.catchVy = blocked.vy;
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

  /** A free band can take a ball. A band with a ball still on it, or in the hand, cannot. */
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

  /** Keep the ball outside every rivet. A closing speed bounces. A held pull only stops. */
  private blockRivets(x: number, y: number, vx: number, vy: number): { x: number; y: number; vx: number; vy: number } {
    let px = x;
    let py = y;
    let pvx = vx;
    let pvy = vy;
    for (const sling of SLINGS) {
      if (betweenRivets(px, py, sling)) continue;
      for (const rivet of [sling.left, sling.right]) {
        let dx = px - rivet.x;
        let dy = py - rivet.y;
        let dist = Math.hypot(dx, dy);
        const min = BIRD_R + RIVET_R;
        if (dist >= min) continue;
        if (dist < 1e-4) {
          dx = 0;
          dy = 1;
          dist = 1;
        }
        const nx = dx / dist;
        const ny = dy / dist;
        px = rivet.x + nx * min;
        py = rivet.y + ny * min;
        const approach = pvx * nx + pvy * ny;
        if (approach < 0) {
          pvx -= (1 + RIVET_BOUNCE) * approach * nx;
          pvy -= (1 + RIVET_BOUNCE) * approach * ny;
          if (-approach > 80) this.feel.push('knock');
        }
      }
    }
    return { x: px, y: py, vx: pvx, vy: pvy };
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
      else if (shot.phase === 'settling') this.stepBag(shot);
      else if (shot.phase !== 'pulling' && !this.bandHeld(this.shots.indexOf(shot))) shot.band.step(STEP);
    }
    this.world.step(undefined, this.hooks);
    for (const shot of this.shots) this.afterFly(shot);
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
    const v = shot.bird.linvel();
    const fromX = shot.prevX;
    const fromY = shot.prevY;
    const touched = this.bandTouches(shot, fromX, fromY, p.x, p.y);
    shot.prevX = p.x;
    shot.prevY = p.y;
    const pouch = shot.sling.pouch;
    const outward = (p.x - pouch.x) * v.x + (p.y - pouch.y) * v.y;
    if (!touched && outward <= 0) shot.clearOfBand = true;
    const self = this.shots.indexOf(shot);
    if (shot.clearOfBand && touched) {
      this.beginCatch(shot, self);
      return;
    }
    for (let other = 0; other < this.shots.length; other++) {
      if (other === self || !this.canCatchOn(other)) continue;
      if (!this.bandTouches(this.shots[other], fromX, fromY, p.x, p.y)) continue;
      this.beginCatch(shot, other);
      return;
    }
    if (SHOW_BAG && this.meetBag(shot, fromX, fromY, p.x, p.y)) return;
    const hitGround = p.y - BIRD_R <= GROUND_Y + 2 && v.y <= 0;
    const out = p.x < -40 || p.x > 430 || p.y > 900;
    if (hitGround || out) this.miss(shot);
  }

  /**
   * Same plane as the ball. Open bags are checked left to right.
   * The first center to cross a mouth seals that bag.
   */
  private meetBag(shot: Shot, x0: number, y0: number, x1: number, y1: number): boolean {
    if (shot.cloth.on) {
      const p = shot.bird.translation();
      const v = shot.bird.linvel();
      const moved = pushCloth(shot.cloth, p.x, p.y, v.x, v.y);
      this.applyCloth(shot, moved);
      if (moved.held) return true;
    }
    const travel = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(travel / 4));
    let ax = x0;
    let ay = y0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const bx = x0 + (x1 - x0) * t;
      const by = y0 + (y1 - y0) * t;
      for (let bag = 0; bag < BAGS.length; bag++) {
        if (this.gone[bag]) continue;
        const at = BAGS[bag];
        if (!this.sealed[bag] && enteredMouth(ax, ay, bx, by, at)) {
          this.beginBag(shot, bag);
          return true;
        }
      }
      let hitAt = -1;
      let hit: ReturnType<typeof bagContact> = null;
      for (let bag = 0; bag < BAGS.length; bag++) {
        if (this.gone[bag]) continue;
        const at = BAGS[bag];
        if (!this.sealed[bag] && aboveOpenMouth(bx, by, at)) continue;
        const found = bagContact(bx, by, this.sealed[bag], at);
        if (!found) continue;
        hitAt = bag;
        hit = found;
        break;
      }
      if (hit && hitAt >= 0) {
        const was = shot.cloth.give;
        const p = shot.bird.translation();
        const v = shot.bird.linvel();
        shot.bag = hitAt;
        const moved = touchCloth(shot.cloth, hit, p.x, p.y, v.x, v.y);
        this.applyCloth(shot, moved);
        if (was === 0 && shot.cloth.give > 0) this.feel.push('give');
        return true;
      }
      ax = bx;
      ay = by;
    }
    return false;
  }

  private applyCloth(shot: Shot, moved: { cloth: Cloth; x: number; y: number; vx: number; vy: number }): void {
    shot.cloth = moved.cloth;
    if (!moved.cloth.on) shot.bag = -1;
    shot.bird.setTranslation({ x: moved.x, y: moved.y }, true);
    shot.bird.setLinvel({ x: moved.vx, y: moved.vy }, true);
    shot.prevX = moved.x;
    shot.prevY = moved.y;
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

/** Ball center is in the opening between this band's two rivets, so they must not pinch it. */
function betweenRivets(x: number, y: number, sling: Sling): boolean {
  const ax = sling.right.x - sling.left.x;
  const ay = sling.right.y - sling.left.y;
  const span = ax * ax + ay * ay || 1;
  const t = ((x - sling.left.x) * ax + (y - sling.left.y) * ay) / span;
  return t > 0 && t < 1;
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
