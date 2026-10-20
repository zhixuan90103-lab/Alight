import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';

import { bagDepth, bagMouth, bagMouthHalf, bagOuterPoints } from './bag';
import {
  BAGS,
  bandWidth,
  BIRD_R,
  GROUND_Y,
  SHOW_BAG,
  RIVET_R,
  SLINGS,
} from './tune';
import type { Sim } from './sim';

function circle(radius: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({ color }),
  );
  return mesh;
}

const BALL = 0x2f80ed;
const BALL_LIGHT = 0x8ebfff;
const ROPE = 0x2c333a;

/** At full draw the ball and the band hum along the pull. Anchors stay put, so the contact does not open a gap. */
function humAlongForce(
  points: ReadonlyArray<{ x: number; y: number }>,
  birdX: number,
  birdY: number,
  aimX: number,
  aimY: number,
  amp: number,
): Array<{ x: number; y: number }> {
  let reach = 1;
  for (const p of points) reach = Math.max(reach, Math.hypot(p.x - birdX, p.y - birdY));
  const contact = BIRD_R + 4;
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return { x: p.x, y: p.y };
    const d = Math.hypot(p.x - birdX, p.y - birdY);
    const w = d <= contact ? 1 : Math.max(0, 1 - (d - contact) / (reach - contact));
    return { x: p.x + aimX * amp * w, y: p.y + aimY * amp * w };
  });
}

/** Filled silhouette. The top edge is only the drawing of the cloth; the mouth stays open in the sim. */
function bagGeometry(): THREE.ShapeGeometry {
  const mouth = bagMouth();
  const pts = bagOuterPoints();
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x - mouth.x, pts[0].y - mouth.y);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x - mouth.x, pts[i].y - mouth.y);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

const RIBBON_VERTS = 640;
const RIBBON_INDICES = 2400;

/**
 * Round strap. Each bend is a fan of radius half the width.
 * A miter would run out along the bisector and read as a spike, so the fan never extends past that radius.
 * Points that fold back are dropped. A fold is a spike.
 */
function writeRibbon(
  positions: Float32Array,
  indices: Uint32Array,
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
): number {
  let v = 0;
  let c = 0;
  const add = (x: number, y: number) => {
    const i = v++;
    const o = i * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = 0.45;
    return i;
  };

  const raw: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    const last = raw[raw.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.35) continue;
    raw.push(p);
  }
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < raw.length; i++) {
    const prev = pts[pts.length - 1];
    const next = raw[i + 1];
    if (prev && next) {
      const ax = raw[i].x - prev.x;
      const ay = raw[i].y - prev.y;
      const bx = next.x - raw[i].x;
      const by = next.y - raw[i].y;
      const am = Math.hypot(ax, ay) || 1;
      const bm = Math.hypot(bx, by) || 1;
      if ((ax / am) * (bx / bm) + (ay / am) * (by / bm) < -0.35) continue;
    }
    pts.push(raw[i]);
  }
  if (pts.length < 2) return 0;

  const tang: Array<{ tx: number; ty: number }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    let tx = pts[i + 1].x - pts[i].x;
    let ty = pts[i + 1].y - pts[i].y;
    const mag = Math.hypot(tx, ty) || 1;
    tang.push({ tx: tx / mag, ty: ty / mag });
  }

  const half = width / 2;
  const segEnd: Array<[number, number]> = [];

  for (let i = 0; i < tang.length; i++) {
    const lx = -tang[i].ty * half;
    const ly = tang[i].tx * half;
    const a = pts[i];
    const b = pts[i + 1];
    let sO: number;
    let sI: number;
    if (i === 0) {
      sO = add(a.x + lx, a.y + ly);
      sI = add(a.x - lx, a.y - ly);
    } else {
      const prev = tang[i - 1];
      const cross = prev.tx * tang[i].ty - prev.ty * tang[i].tx;
      const dot = prev.tx * tang[i].tx + prev.ty * tang[i].ty;
      const turn = Math.atan2(cross, dot);
      if (Math.abs(turn) < 0.02) {
        sO = segEnd[i - 1][0];
        sI = segEnd[i - 1][1];
      } else {
        sO = add(a.x + lx, a.y + ly);
        sI = add(a.x - lx, a.y - ly);
        const center = add(a.x, a.y);
        const ap = Math.atan2(prev.ty, prev.tx);
        const startAngle = turn > 0 ? ap - Math.PI / 2 : ap + Math.PI / 2;
        const steps = Math.max(1, Math.ceil(Math.abs(turn) * 5));
        const rimStart = turn > 0 ? segEnd[i - 1][1] : segEnd[i - 1][0];
        const rimEnd = turn > 0 ? sI : sO;
        let prevRim = rimStart;
        for (let k = 1; k <= steps; k++) {
          const ang = startAngle + (turn * k) / steps;
          const rim = k === steps ? rimEnd : add(a.x + Math.cos(ang) * half, a.y + Math.sin(ang) * half);
          indices[c++] = center;
          indices[c++] = prevRim;
          indices[c++] = rim;
          prevRim = rim;
        }
      }
    }
    const eO = add(b.x + lx, b.y + ly);
    const eI = add(b.x - lx, b.y - ly);
    segEnd.push([eO, eI]);
    indices[c++] = sO;
    indices[c++] = sI;
    indices[c++] = eO;
    indices[c++] = sI;
    indices[c++] = eI;
    indices[c++] = eO;
  }
  return c;
}

/**
 * World +x is design +x, world +y is up.
 * Camera sits on +z looking toward -z, so screen-right is world +x and screen-up is world +y.
 */
export function createPlayView(scene: THREE.Scene): {
  camera: THREE.OrthographicCamera;
  sync: (sim: Sim, dt: number) => void;
} {
  scene.background = new THREE.Color(0xf2f3f5);

  const camera = new THREE.OrthographicCamera(
    -DESIGN_WIDTH / 2,
    DESIGN_WIDTH / 2,
    DESIGN_HEIGHT / 2,
    -DESIGN_HEIGHT / 2,
    0.1,
    50,
  );
  camera.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, 10);
  camera.lookAt(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, 0);
  camera.up.set(0, 1, 0);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH, GROUND_Y),
    new THREE.MeshBasicMaterial({ color: 0xd5d8de }),
  );
  ground.position.set(DESIGN_WIDTH / 2, GROUND_Y / 2, 0);
  scene.add(ground);
  const groundH = GROUND_Y;

  const bagMat = new THREE.MeshBasicMaterial({
    color: BALL,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sealMat = new THREE.MeshBasicMaterial({
    color: 0x1d5bb8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const bags = BAGS.map(() => {
    const mesh = new THREE.Mesh(bagGeometry(), bagMat);
    mesh.renderOrder = 3;
    scene.add(mesh);
    return mesh;
  });
  const seals = BAGS.map(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 6), sealMat);
    mesh.renderOrder = 4;
    scene.add(mesh);
    return mesh;
  });
  let bagKey = -1;

  const rivetMat = new THREE.MeshBasicMaterial({ color: ROPE });
  const rivetHole = new THREE.MeshBasicMaterial({ color: 0xf2f3f5 });
  for (const sling of SLINGS) {
    for (const rivet of [sling.left, sling.right]) {
      const head = circle(RIVET_R, ROPE);
      head.material = rivetMat;
      head.position.set(rivet.x, rivet.y, 0.7);
      const hole = circle(RIVET_R * 0.38, 0xf2f3f5);
      hole.material = rivetHole;
      hole.position.set(rivet.x, rivet.y, 0.75);
      scene.add(head, hole);
    }
  }

  const arcs = SLINGS.map(() => {
    const positions = new Float32Array(RIBBON_VERTS * 3);
    const indices = new Uint32Array(RIBBON_INDICES);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: ROPE, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  });

  const balls = SLINGS.map(() => {
    const body = circle(1, BALL);
    const highlight = circle(0.38, BALL_LIGHT);
    highlight.position.set(-0.28, 0.32, 0.2);
    const group = new THREE.Group();
    group.add(body, highlight);
    group.renderOrder = 2;
    scene.add(group);
    return group;
  });
  let hum = 0;

  return {
    camera,
    sync(sim: Sim, dt: number) {
      const s = sim.sample();
      hum += dt;
      const half = bagMouthHalf();
      const key = half * 1000 + bagDepth();
      if (key !== bagKey) {
        bagKey = key;
        for (const bag of bags) {
          bag.geometry.dispose();
          bag.geometry = bagGeometry();
        }
      }
      for (let i = 0; i < bags.length; i++) {
        const mouth = bagMouth(BAGS[i]);
        const bagState = s.bags[i];
        const giveX = bagState.pressX * bagState.give * 0.55;
        const giveY = bagState.pressY * bagState.give * 0.55;
        const here = SHOW_BAG && !bagState.gone;
        bags[i].visible = here;
        bags[i].position.set(mouth.x - giveX, mouth.y - giveY, 0.2);
        seals[i].visible = here && bagState.sealed;
        seals[i].position.set(mouth.x, mouth.y - 1, 0.4);
        seals[i].scale.set(half * 2 + 10, 1, 1);
      }
      ground.scale.y = GROUND_Y / groundH;
      ground.position.y = GROUND_Y / 2;

      for (let i = 0; i < s.shots.length; i++) {
        const shot = s.shots[i];
        const atMax = shot.phase === 'pulling' && shot.strain >= 0.995;
        const amp = atMax ? Math.sin(hum * 64) * 1.6 : 0;
        const ball = balls[i];
        ball.position.set(shot.birdX + shot.aimX * amp, shot.birdY + shot.aimY * amp, 1);
        ball.visible = shot.phase !== 'gone' && shot.phase !== 'asleep';
        ball.scale.set(BIRD_R, BIRD_R, 1);
        const points = amp === 0 ? shot.band : humAlongForce(shot.band, shot.birdX, shot.birdY, shot.aimX, shot.aimY, amp);
        const geom = arcs[i].geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const count = writeRibbon(
          attr.array as Float32Array,
          index.array as Uint32Array,
          points,
          bandWidth(shot.strain),
        );
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
      }
    },
  };
}
