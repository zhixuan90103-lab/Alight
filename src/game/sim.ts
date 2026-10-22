import RAPIER from '@dimforge/rapier2d-compat';
import { bagMouth, bagOuterPoints, ballInBag } from './bag';
import { levelMatched, mayIssue, type HeldBall } from './outcome';
import { Band } from './band';
import { createFramingCamera } from './camera';
import { applyBall, applyFixture } from './material';
import {
  BAGS,
  BAG_SPEC,
  CAPSULE,
  ELBOWS,
  capsuleOutline,
  ballMaterial,
  plankMaterial,
  woodMaterial,
  loadLevelLayout,
  type BallColor,
  BAND_ZETA,
  CATCH_SPAN,
  seatY,
  BIRD_R,
  EXIT,
  LEVEL_ID,
  REFILL_MODE,
  SLING_COLOR,
  DEAD_PULL,
  GRAVITY,
  MASS,
  MAX_CATCHUP,
  MAX_PULL,
  SHOW_BAG,
  ROPE_MASS,
  ROPE_THICKNESS,
  PLANKS,
  SLINGS,
  STEP,
  STIFFNESS,
  type Sling,
  meetBallY,
  slipBallY,
  followPull,
  launchSpeed,
} from './tune';

export type Phase = 'ready' | 'pulling' | 'launching' | 'flying' | 'catching' | 'settling' | 'asleep' | 'returning' | 'emerging' | 'gone';

export type Feel = 'pull' | 'slip' | 'launch' | 'catch' | 'bowl' | 'miss' | 'knock';

export type ShotSample = {
  phase: Phase;
  birdX: number;
  birdY: number;
  band: ReadonlyArray<{ x: number; y: number }>;
  strain: number;
  /** Finger distance from the pouch while pulling. 0 otherwise. */
  finger: number;
  aimX: number;
  aimY: number;
  /** 1 when the ball is full size. Smaller while it is leaving the pipe. */
  scale: number;
  color: BallColor;
};

export type BagSample = {
  /** Ball centers currently inside this U. Not a rule cap. */
  count: number;
  /** Reserved. Nothing in this level sets it. Hides the label and the stroke. */
  gone: boolean;
};

export type SimSample = {
  shots: ShotSample[];
  bags: BagSample[];
  /** World shift of the two-shot camera. The visible bottom is `look.y`. */
  look: { x: number; y: number };
  /** Balls that reached a U and stayed there. */
  resting: Array<{ x: number; y: number; color: BallColor }>;
  /** Balls that have already left the exit. The HUD turns that many pips into rings, from the left. */
  issued: number;
  /** Colors already sent, in the order they left the exits. */
  issuedColors: BallColor[];
  /** Left-side tapered capsule. Null on levels that do not have one. */
  capsule: { x: number; y: number; angle: number; length: number; rThin: number; rThick: number } | null;
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
  color: BallColor;
  /** 0 at the pipe mouth, 1 when the ball has reached the pouch. */
  emerge: number;
  /** Seconds left before the next ball drops. Negative means no refill is waiting. */
  refill: number;
  /** Finger distance from the pouch during a pull. */
  finger: number;
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
/** Same wait after a death and after the ball is in the bowl for good. */
const REFILL_DELAY = 0.5;
/** Opening beat: five solid pips, empty band, then the first ball drops. */
const OPEN_DELAY = 0.45;

/**
 * Level 1: an empty right band, then five balls from the exit, and one U on the left.
 * A sling with a ball can be pulled while another ball is in the air.
 */
export class Sim {
  readonly world: RAPIER.World;
  private bagColliders: RAPIER.Collider[] = [];
  private plankColliders: RAPIER.Collider[] = [];
  private readonly bagHandles = new Set<number>();
  private readonly events = new RAPIER.EventQueue(false);
  private readonly shots: Shot[];
  private gone: boolean[];
  private accumulator = 0;
  private active: number | null = null;
  private feel: Feel[] = [];
  /** Flyer index + seated index, so one overlap only knocks once. */
  private knocks = new Set<string>();
  private readonly camera = createFramingCamera();
  /** Balls already placed in the bowl. Their bodies stay in the world. */
  private readonly parked: Array<{ bird: RAPIER.RigidBody; collider: RAPIER.Collider; color: BallColor }> = [];
  private capsuleBody: RAPIER.RigidBody | null = null;
  /** Seconds into the snap-and-return cycle. */
  private capsuleT = 0;
  /** Balls already dropped from the exit. Each one is an empty pip, from the left. */
  private issued = 0;
  private issuedColors: BallColor[] = [];
  /** Level 2: same-color balls that died or landed in a bowl. */
  private settledColors: BallColor[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY });
    this.world.integrationParameters.lengthUnit = 80;
    this.syncBags();
    this.gone = BAGS.map(() => false);
    this.shots = SLINGS.map((sling) => this.makeShot(sling));
    for (const shot of this.shots) this.armEmpty(shot, OPEN_DELAY);
  }

  private makeShot(sling: Sling): Shot {
    const bird = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(sling.pouch.x, sling.pouch.y)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BIRD_R).setMass(MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
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
      color: 'gold',
      emerge: 1,
      refill: -1,
      finger: 0,
    };
  }

  /** No ball on the band. The next one drops from the exit after `wait` seconds. */
  private armEmpty(shot: Shot, wait: number): void {
    shot.phase = 'gone';
    shot.refill = wait;
    shot.drawn = 0;
    shot.returnIn = 0;
    shot.bandTouch = SLINGS.map(() => false);
    shot.collider.setEnabled(false);
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setGravityScale(0, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.band.placeAtRest();
  }

  applyTune(): void {
    this.world.gravity = { x: 0, y: -GRAVITY };
    for (const shot of this.shots) {
      shot.collider.setMass(MASS);
      shot.collider.setRadius(BIRD_R);
      applyBall(shot.bird, shot.collider, ballMaterial());
    }
    for (const ball of this.parked) {
      ball.collider.setMass(MASS);
      ball.collider.setRadius(BIRD_R);
      applyBall(ball.bird, ball.collider, ballMaterial());
    }
    this.syncBags();
  }

  /** Open U as a static polyline. Only its restitution is special. */
  private syncBags(): void {
    for (const collider of this.bagColliders) this.world.removeCollider(collider, true);
    this.bagColliders = [];
    this.bagHandles.clear();
    if (SHOW_BAG) for (let i = 0; i < BAGS.length; i++) {
      const pts = bagOuterPoints(BAGS[i], i);
      const vertices = new Float32Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) {
        vertices[i * 2] = pts[i].x;
        vertices[i * 2 + 1] = pts[i].y;
      }
      const desc = RAPIER.ColliderDesc.polyline(vertices);
      applyFixture(desc, woodMaterial());
      const collider = this.world.createCollider(desc);
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.bagHandles.add(collider.handle);
      this.bagColliders.push(collider);
    }
    this.syncPlanks();
    this.syncElbow();
  }

  /** Bent board. Centerline plus round ends. Same bounce as the straight boards. */
  private syncElbow(): void {
    for (const elbow of ELBOWS) {
      const pts = elbow.pts;
      const vertices = new Float32Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) {
        vertices[i * 2] = pts[i].x;
        vertices[i * 2 + 1] = pts[i].y;
      }
      const parts = [
        RAPIER.ColliderDesc.polyline(vertices),
        RAPIER.ColliderDesc.ball(elbow.width / 2).setTranslation(pts[0].x, pts[0].y),
        RAPIER.ColliderDesc.ball(elbow.width / 2).setTranslation(pts[pts.length - 1].x, pts[pts.length - 1].y),
      ];
      for (const desc of parts) {
        applyFixture(desc, plankMaterial());
        const collider = this.world.createCollider(desc);
        collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.bagHandles.add(collider.handle);
        this.plankColliders.push(collider);
      }
    }
  }

  /** Fixed board. Same bounce as the bowl. */
  private syncPlanks(): void {
    for (const collider of this.plankColliders) {
      this.bagHandles.delete(collider.handle);
      this.world.removeCollider(collider, true);
    }
    this.plankColliders = [];
    for (const plank of PLANKS) {
      const parts = plank.vertical
        ? [
            RAPIER.ColliderDesc.cuboid(plank.halfW, plank.halfH).setTranslation(plank.x, plank.y),
            RAPIER.ColliderDesc.ball(plank.halfW).setTranslation(plank.x, plank.y + plank.halfH),
            RAPIER.ColliderDesc.ball(plank.halfW).setTranslation(plank.x, plank.y - plank.halfH),
          ]
        : [
            RAPIER.ColliderDesc.cuboid(plank.halfW, plank.halfH).setTranslation(plank.x, plank.y),
            RAPIER.ColliderDesc.ball(plank.halfH).setTranslation(plank.x + plank.halfW, plank.y),
            RAPIER.ColliderDesc.ball(plank.halfH).setTranslation(plank.x - plank.halfW, plank.y),
          ];
      for (const desc of parts) {
        applyFixture(desc, plankMaterial());
        const collider = this.world.createCollider(desc);
        collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.bagHandles.add(collider.handle);
        this.plankColliders.push(collider);
      }
    }
  }

  /** Switch level, then open it the same way as a replay. */
  loadLevel(id: number): void {
    loadLevelLayout(id);
    this.gone = BAGS.map(() => false);
    this.syncBags();
    this.restart();
  }

  /** Empty the band and drop the first ball again after the opening beat. */
  restart(): void {
    for (const ball of this.parked) {
      if (!this.shots.some((shot) => shot.bird === ball.bird)) this.world.removeRigidBody(ball.bird);
    }
    this.parked.length = 0;
    loadLevelLayout(LEVEL_ID);
    this.syncBags();
    this.syncCapsule();
    this.issued = 0;
    this.issuedColors = [];
    this.settledColors = [];
    this.accumulator = 0;
    this.active = null;
    this.knocks.clear();
    this.feel = [];
    this.camera.reset();
    this.gone = BAGS.map(() => false);
    this.syncShots();
    for (const shot of this.shots) this.armEmpty(shot, OPEN_DELAY);
  }

  /** One shot per sling. Extra bands are removed with their ball. */
  private syncShots(): void {
    while (this.shots.length < SLINGS.length) this.shots.push(this.makeShot(SLINGS[this.shots.length]));
    while (this.shots.length > SLINGS.length) {
      const shot = this.shots.pop();
      if (shot) this.world.removeRigidBody(shot.bird);
    }
    for (let i = 0; i < this.shots.length; i++) {
      const shot = this.shots[i];
      shot.sling = SLINGS[i];
      shot.band = new Band(SLINGS[i]);
    }
  }

  /** The drop point sits above this band, at the shared exit height. */
  private exitAt(shot: Shot): { x: number; y: number } {
    return { x: shot.sling.pouch.x, y: EXIT.y };
  }

  /**
   * Pass as soon as every bowl holds a same-color ball.
   * Fail only after every ball has left play and a bowl is still short.
   */
  result(): { passed: boolean } | null {
    if (levelMatched(this.held())) return { passed: true };
    if (this.shots.some((shot) => shot.phase !== 'gone' || shot.refill >= 0)) return null;
    if (REFILL_MODE === 'same-color' && SLING_COLOR.some((color) => this.canRefresh(color))) return null;
    return { passed: false };
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
        if (shot.phase === 'ready' || shot.phase === 'pulling' || shot.phase === 'launching' || shot.phase === 'gone' || shot.phase === 'emerging') return n;
        if (BAG_SPEC[i]?.color !== shot.color) return n;
        const p = shot.bird.translation();
        return n + (ballInBag(p.x, p.y, i) ? 1 : 0);
      }, 0) + this.parked.reduce((n, ball) => {
        if (BAG_SPEC[i]?.color !== ball.color) return n;
        const p = ball.bird.translation();
        return n + (ballInBag(p.x, p.y, i) ? 1 : 0);
      }, 0),
      gone: this.gone[i],
    }));
    return {
      shots: this.shots.map((shot) => this.sampleShot(shot)),
      bags,
      look: { x: this.camera.x, y: this.camera.y },
      resting: this.parked.map((ball) => {
        const p = ball.bird.translation();
        return { x: p.x, y: p.y, color: ball.color };
      }),
      issued: this.issued,
      issuedColors: this.issuedColors.slice(),
      capsule: CAPSULE
        ? {
            x: CAPSULE.x,
            y: CAPSULE.y,
            angle: this.capsuleAngle(),
            length: CAPSULE.length,
            rThin: CAPSULE.rThin,
            rThick: CAPSULE.rThick,
          }
        : null,
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
      finger: shot.phase === 'pulling' ? shot.finger : 0,
      aimX: pull > 1 ? dx / pull : 0,
      aimY: pull > 1 ? dy / pull : 1,
      scale: shot.phase === 'emerging' ? Math.min(1, shot.emerge / 0.35) : 1,
      color: shot.color,
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
    const seated = shot.phase === 'catching' ? this.settleCatch(shot) : best;
    if (seated !== best || ANIMATION.has(this.shots[seated].phase)) this.restOnPouch(this.shots[seated]);
    const holder = this.shots[seated];
    holder.phase = 'pulling';
    this.active = seated;
    this.feel.push('pull');
    this.movePull(holder, worldX, worldY);
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
    const finger = len(dx, dy);
    shot.finger = finger;
    const pull = followPull(finger);
    if (finger > 0) {
      const s = pull / finger;
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
        this.letGo(shot, here.x, Math.min(here.y, slip), shot.band, true);
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

  /**
   * The ball crossed the shared let-go line.
   * A finger drag reports slip. A catch rebound does not.
   */
  private letGo(shot: Shot, x: number, y: number, band: Band, finger: boolean): void {
    shot.bird.setTranslation({ x, y }, true);
    shot.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    shot.bird.setGravityScale(1, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    band.holdAtRest();
    shot.prevX = x;
    shot.prevY = y;
    shot.bandTouch = SLINGS.map(() => false);
    shot.catchOn = -1;
    shot.phase = 'flying';
    if (!finger) return;
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
    const speed = launchSpeed(shot.drawn);
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
    shot.bandTouch[this.shots.indexOf(shot)] = true;
    shot.phase = 'flying';
  }

  private restOnPouch(shot: Shot): void {
    const pouch = shot.sling.pouch;
    const homeY = seatY(pouch.y);
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setAngvel(0, true);
    shot.bird.setTranslation({ x: pouch.x, y: homeY }, true);
    shot.bird.setNextKinematicTranslation({ x: pouch.x, y: homeY });
    shot.ropeX = pouch.x;
    shot.ropeY = homeY;
    shot.ropeVx = 0;
    shot.ropeVy = 0;
    shot.band.holdUnder(pouch.x, homeY);
    shot.catchOn = -1;
    shot.refill = -1;
    shot.collider.setEnabled(true);
    shot.emerge = 1;
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
    const homeY = seatY(pouch.y);
    const ux = p.x - pouch.x;
    const uy = p.y - homeY;
    const omega = Math.sqrt((STIFFNESS * CATCH_SPAN) / MASS);
    const ax = -omega * omega * ux - 2 * BAND_ZETA * omega * shot.catchVx;
    const ay = -omega * omega * uy - 2 * BAND_ZETA * omega * shot.catchVy;
    shot.catchVx += ax * STEP;
    shot.catchVy += ay * STEP;
    const x = p.x + shot.catchVx * STEP;
    const y = p.y + shot.catchVy * STEP;
    const sling = this.shots[shot.catchOn].sling;
    const slip = slipBallY(x, sling);
    if (y > slip) {
      this.letGo(shot, x, slip, this.shots[shot.catchOn].band, false);
      return;
    }
    shot.bird.setNextKinematicTranslation({ x, y });
    const band = this.shots[shot.catchOn].band;
    if (y > meetBallY(x, sling)) band.holdAtRest();
    else band.holdUnder(x, y);
    if (len(x - pouch.x, y - homeY) < 0.4 && len(shot.catchVx, shot.catchVy) < 2) {
      this.settleCatch(shot);
    }
  }

  /**
   * A caught ball sits on the band that caught it. The bands do not swap.
   * The ball's own band stays empty. That color does not refill while this ball is alive.
   */
  private settleCatch(shot: Shot): number {
    const self = this.shots.indexOf(shot);
    const hostIndex = shot.catchOn < 0 ? self : shot.catchOn;
    if (hostIndex === self) {
      this.restOnPouch(shot);
      return self;
    }
    const host = this.shots[hostIndex];
    const bird = shot.bird;
    const collider = shot.collider;
    const color = shot.color;
    shot.bird = host.bird;
    shot.collider = host.collider;
    shot.color = this.colorFor(shot);
    host.bird = bird;
    host.collider = collider;
    host.color = color;
    host.band.holdAtRest();
    this.armEmpty(shot, -1);
    this.restOnPouch(host);
    return hostIndex;
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
    const falling = shot.bird.linvel().y < 0;
    const arrived = (index: number) =>
      falling &&
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
      else if (shot.refill >= 0) this.stepRefill(shot);
      else if (shot.phase !== 'pulling' && shot.phase !== 'settling' && !this.bandHeld(this.shots.indexOf(shot))) shot.band.step(STEP);
    }
    this.stepCapsule();
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const hitBag = this.bagHandles.has(a) || this.bagHandles.has(b);
      if (hitBag) this.feel.push('bowl');
    });
    const flying = this.shots.find((shot) => shot.phase === 'flying');
    this.camera.step(flying ? flying.bird.translation().y : null, STEP);
    this.pumpRefill();
    for (const shot of this.shots) {
      this.afterFly(shot);
    }
  }

  /** The ball fell through the bottom of the current view. The next one waits the same delay. */
  private die(shot: Shot): void {
    const color = shot.color;
    shot.phase = 'gone';
    shot.refill = -1;
    this.scheduleRefill(shot, color);
    shot.bird.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setGravityScale(0, true);
    shot.collider.setEnabled(false);
  }

  /** Whole ball is below the lip, so the bowl keeps it. */
  private sealedInBowl(x: number, y: number): boolean {
    return BAGS.some((bag, i) => ballInBag(x, y, i) && y < bagMouth(bag).y - BIRD_R);
  }

  private stepRefill(shot: Shot): void {
    if (this.bandHeld(this.shots.indexOf(shot))) return;
    shot.refill -= STEP;
    if (shot.refill > 0) return;
    shot.refill = -1;
    if (shot.phase === 'flying') this.arrive(shot);
    else if (shot.phase === 'gone') this.issue(shot);
  }

  /** The flying ball is inside the U. It stays. A finished color does not drop another ball. */
  private arrive(shot: Shot): void {
    this.parked.push({ bird: shot.bird, collider: shot.collider, color: shot.color });
    shot.phase = 'gone';
    shot.refill = -1;
    this.scheduleRefill(shot, shot.color);
  }

  /** Death and a bowl landing share this. A finished color does not drop another ball. */
  private scheduleRefill(shot: Shot, color: BallColor): void {
    if (REFILL_MODE === 'same-color') {
      this.settledColors.push(color);
      return;
    }
    if (mayIssue(color, this.issued, 0, this.held())) shot.refill = REFILL_DELAY;
  }

  private held(): HeldBall[] {
    return this.parked.map((ball) => {
      const p = ball.bird.translation();
      return { color: ball.color, x: p.x, y: p.y };
    });
  }

  /** 0 at rest, 1 at the top of the snap. The rise is fast. The return is slow. */
  private capsuleUnit(): number {
    const snap = 0.1;
    const top = 1;
    const back = 0.8;
    const hold = 0.1;
    const t = this.capsuleT % (snap + top + back + hold);
    if (t < snap) {
      const s = t / snap;
      return 1 - (1 - s) * (1 - s);
    }
    if (t < snap + top) return 1;
    if (t < snap + top + back) return 1 - (t - snap - top) / back;
    return 0;
  }

  private capsuleAngle(): number {
    if (!CAPSULE) return 0;
    return CAPSULE.rest + CAPSULE.swing * this.capsuleUnit();
  }

  private syncCapsule(): void {
    if (this.capsuleBody) {
      this.world.removeRigidBody(this.capsuleBody);
      this.capsuleBody = null;
    }
    this.capsuleT = 0;
    if (!CAPSULE) return;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(CAPSULE.x, CAPSULE.y).setRotation(CAPSULE.rest),
    );
    const hull = RAPIER.ColliderDesc.convexHull(capsuleOutline(CAPSULE.length, CAPSULE.rThin, CAPSULE.rThick));
    if (hull) {
      applyFixture(hull, woodMaterial());
      this.world.createCollider(hull, body);
    }
    this.capsuleBody = body;
  }

  /** Snap the thick end upward, then let it drift back. Runs before the physics step. */
  private stepCapsule(): void {
    if (!CAPSULE || !this.capsuleBody) return;
    this.capsuleT += STEP;
    this.capsuleBody.setNextKinematicTranslation({ x: CAPSULE.x, y: CAPSULE.y });
    this.capsuleBody.setNextKinematicRotation(this.capsuleAngle());
  }

  /** Same-color mode: the next ball waits until the previous one has died or landed. */
  private alive(color: BallColor): number {
    const used = this.issuedColors.filter((item) => item === color).length;
    const settled = this.settledColors.filter((item) => item === color).length;
    return used - settled;
  }

  private canRefresh(color: BallColor): boolean {
    return mayIssue(color, this.issued, this.alive(color), this.held());
  }

  private homeShot(color: BallColor): Shot {
    const index = SLING_COLOR.indexOf(color);
    return this.shots[index >= 0 ? index : this.shots.length - 1];
  }

  private pumpRefill(): void {
    if (REFILL_MODE !== 'same-color') return;
    for (const color of SLING_COLOR) {
      if (!this.canRefresh(color)) continue;
      const home = this.homeShot(color);
      const index = this.shots.indexOf(home);
      if (home.phase !== 'gone' || home.refill >= 0 || this.bandHeld(index)) continue;
      home.refill = REFILL_DELAY;
    }
  }

  /** The color this band drops. It stays with the band when a ball is handed across. */
  private colorFor(shot: Shot): BallColor {
    const index = SLINGS.indexOf(shot.sling);
    return SLING_COLOR[index] ?? 'gold';
  }

  /** Drop the next ball of this band's color from the marked point. Gravity carries it onto the band. */
  private issue(shot: Shot): boolean {
    const color = this.colorFor(shot);
    if (!this.canRefresh(color)) return false;
    this.issuedColors.push(color);
    shot.color = color;
    this.issued += 1;
    if (this.parked.some((ball) => ball.bird === shot.bird)) {
      const bird = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(this.exitAt(shot).x, this.exitAt(shot).y).setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(BIRD_R).setMass(MASS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        bird,
      );
      applyBall(bird, collider, ballMaterial());
      shot.bird = bird;
      shot.collider = collider;
    }
    shot.phase = 'flying';
    shot.emerge = 0;
    shot.bandTouch = SLINGS.map(() => false);
    shot.collider.setEnabled(true);
    shot.bird.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    shot.bird.setGravityScale(1, true);
    shot.bird.setLinvel({ x: 0, y: 0 }, true);
    shot.bird.setAngvel(0, true);
    const exit = this.exitAt(shot);
    shot.bird.setTranslation({ x: exit.x, y: exit.y }, true);
    shot.prevX = exit.x;
    shot.prevY = exit.y;
    return true;
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
    if (p.y < this.camera.y) {
      this.die(shot);
      return;
    }
    if (this.sealedInBowl(p.x, p.y)) {
      this.arrive(shot);
      return;
    }
    if (shot.refill >= 0 && !BAGS.some((_, i) => ballInBag(p.x, p.y, i))) shot.refill = -1;
    this.catchArrival(shot, fromX, fromY, p.x, p.y);
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
