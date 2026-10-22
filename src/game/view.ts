import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';

import { bagStrokePoints } from './bag';
import { capsuleOutline } from './tune';
import {
  BAG_RISE,
  BAGS,
  BAG_SPEC,
  BALL_DAMPING,
  BALL_HEX,
  bandWidth,
  BIRD_R,
  DEAD_PULL,
  fingerPullCap,
  GRAVITY,
  launchSpeed,
  PLANKS,
  RAIL,
  ELBOWS,
  SHOW_BAG,
  SHOW_HINT,
  SLINGS,
  type BallColor,
} from './tune';
import type { Sim } from './sim';

function circle(radius: number, color: number, segments = 40): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, segments),
    new THREE.MeshBasicMaterial({ color }),
  );
  return mesh;
}

/** Flat blue field, cyan mechanisms, gold balls, one long shadow down-right. */
const FIELD = 0x7fa5bf;
const BAND = 0xffffff;
const RIVET = 0x777268;
const GOLD = 0xecbf77;
/** Dark gray rivet in the middle of the capsule's thick end. */
const CAPSULE_RIVET = 0x4e555c;
/** A step darker than the gold bowl. Used only for the rail knob. */
const KNOB = 0xc49a55;
const SHADOW = 0x5f8096;
/** A step lighter than the shadow. Used only for the rail bowl's track. */
const RAIL_COLOR = 0x7098b0;
/** Shadow runs down-right. The soft ring is 10% of that length. */
const SHADOW_X = 14;
const SHADOW_Y = -14;
const SHADOW_BLUR = Math.hypot(SHADOW_X, SHADOW_Y) * 0.1;
/** Bands and balls cast a shorter shadow than the bowls. */
const NEAR_CAST = 0.6;
/** One even stroke. The tune thickness stays on the rope, not on this picture. */
const STROKE = 8;

/** Full-draw hum along the pull. Anchors stay put, so the contact does not open a gap. */
const HUM_MAX = 1.6;
/** Radians per second at a full pull. A shorter pull is slower. */
const HUM_RATE = 64;
/** Preferred space between hint dots. A short arc uses a tighter gap so the line stays a line. */
const HINT_GAP = 12;
const HINT_MIN = 8;

type HintDot = { x: number; y: number; radius: number; opacity: number };

/**
 * Free-flight dots from the pouch to the apex.
 * Spacing follows the arc. A short arc still gets HINT_MIN dots instead of two or three.
 * Opacity falls with height and is 0 at the apex. Each dot carries its own opacity.
 */
function sampleHintArc(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  floorY: number,
  limit: number,
): HintDot[] {
  const dt = 1 / 240;
  const damp = Math.exp(-BALL_DAMPING * dt);
  const path: Array<{ x: number; y: number }> = [{ x: x0, y: y0 }];
  let x = x0;
  let y = y0;
  const rising = vy > 0;
  for (let n = 0; n < 4000; n++) {
    vy -= GRAVITY * dt;
    vx *= damp;
    vy *= damp;
    x += vx * dt;
    y += vy * dt;
    if (y < floorY) break;
    path.push({ x, y });
    if (rising ? vy <= 0 : path.length > 2 && vy >= 0) break;
  }
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  if (length < 1) return [];
  const gap = Math.min(HINT_GAP, length / HINT_MIN);
  const raw: Array<{ x: number; y: number }> = [];
  let walked = 0;
  for (let i = 1; i < path.length && raw.length < limit; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-6) continue;
    let consumed = 0;
    while (walked + (seg - consumed) >= gap && raw.length < limit) {
      const need = gap - walked;
      const t = (consumed + need) / seg;
      raw.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      consumed += need;
      walked = 0;
    }
    walked += seg - consumed;
  }
  if (raw.length === 0) return [];
  let yLo = raw[0].y;
  let yHi = raw[0].y;
  for (const p of raw) {
    yLo = Math.min(yLo, p.y);
    yHi = Math.max(yHi, p.y);
  }
  const rise = Math.max(1, yHi - yLo);
  return raw.map((p, i) => {
    const along = raw.length <= 1 ? 0 : i / (raw.length - 1);
    const height = rising ? (p.y - yLo) / rise : along;
    return {
      x: p.x,
      y: p.y,
      radius: 3.2 - along * 1.2,
      opacity: 0.9 * (1 - height),
    };
  });
}
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

const RIBBON_VERTS = 640;
const RIBBON_INDICES = 2400;
const SHADOW_VERTS = 4096;
const SHADOW_INDICES = 12000;
const CAP_STEPS = 12;

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

function meshGeom(vertCount: number, indexCount: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indexCount), 1));
  geom.setDrawRange(0, 0);
  return geom;
}

/** Solid face swept from a disc along the shadow vector. The cyan shape covers the start. */
function writeDiscSweep(
  positions: Float32Array,
  indices: Uint32Array,
  cx: number,
  cy: number,
  radius: number,
  z: number,
  cursor: { v: number; c: number },
  cast = 1,
): void {
  const room = SHADOW_VERTS - cursor.v;
  const iroom = SHADOW_INDICES - cursor.c;
  if (room < CAP_STEPS * 2 + 4 || iroom < CAP_STEPS * 6 + 6) return;
  const ox = SHADOW_X * cast;
  const oy = SHADOW_Y * cast;
  const mag = Math.hypot(ox, oy) || 1;
  const px = (-oy / mag) * radius;
  const py = (ox / mag) * radius;
  const add = (x: number, y: number) => {
    const i = cursor.v++;
    const o = i * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    return i;
  };
  const fan = (x: number, y: number) => {
    const center = add(x, y);
    let prev = add(x + radius, y);
    for (let k = 1; k <= CAP_STEPS; k++) {
      const ang = (Math.PI * 2 * k) / CAP_STEPS;
      const rim = add(x + Math.cos(ang) * radius, y + Math.sin(ang) * radius);
      indices[cursor.c++] = center;
      indices[cursor.c++] = prev;
      indices[cursor.c++] = rim;
      prev = rim;
    }
  };
  fan(cx, cy);
  fan(cx + ox, cy + oy);
  const a = add(cx + px, cy + py);
  const b = add(cx - px, cy - py);
  const c = add(cx + ox - px, cy + oy - py);
  const d = add(cx + ox + px, cy + oy + py);
  indices[cursor.c++] = a;
  indices[cursor.c++] = b;
  indices[cursor.c++] = d;
  indices[cursor.c++] = b;
  indices[cursor.c++] = c;
  indices[cursor.c++] = d;
}

/**
 * Long shadow of an open stroke: each disc and each straight segment is swept into a flat face.
 * Overlaps stay the same color, so the visible part is the slab sticking down-right.
 */
function writeStrokeShadow(
  positions: Float32Array,
  indices: Uint32Array,
  points: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  cast = 1,
): number {
  const cursor = { v: 0, c: 0 };
  const raw: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    const last = raw[raw.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.35) continue;
    raw.push(p);
  }
  if (raw.length === 0) return 0;
  const radius = width / 2;
  const z = 0.2;
  for (const p of raw) writeDiscSweep(positions, indices, p.x, p.y, radius, z, cursor, cast);

  const add = (x: number, y: number) => {
    if (cursor.v >= SHADOW_VERTS) return -1;
    const i = cursor.v++;
    const o = i * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    return i;
  };
  for (let i = 0; i < raw.length - 1; i++) {
    if (cursor.c + 18 >= SHADOW_INDICES || cursor.v + 8 >= SHADOW_VERTS) break;
    const a = raw[i];
    const b = raw[i + 1];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const mag = Math.hypot(tx, ty) || 1;
    tx /= mag;
    ty /= mag;
    const lx = -ty * radius;
    const ly = tx * radius;
    const corners = [
      { x: a.x + lx, y: a.y + ly },
      { x: a.x - lx, y: a.y - ly },
      { x: b.x + lx, y: b.y + ly },
      { x: b.x - lx, y: b.y - ly },
    ];
    const swept = corners.flatMap((p) => [p, { x: p.x + SHADOW_X * cast, y: p.y + SHADOW_Y * cast }]);
    swept.sort((p, q) => p.x - q.x || p.y - q.y);
    const cross = (
      o: { x: number; y: number },
      u: { x: number; y: number },
      w: { x: number; y: number },
    ) => (u.x - o.x) * (w.y - o.y) - (u.y - o.y) * (w.x - o.x);
    const lower: Array<{ x: number; y: number }> = [];
    for (const p of swept) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: Array<{ x: number; y: number }> = [];
    for (let k = swept.length - 1; k >= 0; k--) {
      const p = swept[k];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    const ring = lower.concat(upper);
    if (ring.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
    }
    cx /= ring.length;
    cy /= ring.length;
    const center = add(cx, cy);
    if (center < 0) break;
    let prev = add(ring[0].x, ring[0].y);
    for (let k = 1; k < ring.length; k++) {
      const rim = add(ring[k].x, ring[k].y);
      if (prev < 0 || rim < 0) break;
      indices[cursor.c++] = center;
      indices[cursor.c++] = prev;
      indices[cursor.c++] = rim;
      prev = rim;
    }
    const close = add(ring[0].x, ring[0].y);
    if (prev >= 0 && close >= 0) {
      indices[cursor.c++] = center;
      indices[cursor.c++] = prev;
      indices[cursor.c++] = close;
    }
  }
  return cursor.c;
}

/**
 * World +x is design +x, world +y is up.
 * Camera sits on +z looking toward -z, so screen-right is world +x and screen-up is world +y.
 */
export function createPlayView(scene: THREE.Scene): {
  camera: THREE.OrthographicCamera;
  /** World shift of the framing camera. Touch samples add this. */
  look: { x: number; y: number };
  sync: (sim: Sim, dt: number) => void;
} {
  scene.background = new THREE.Color(FIELD);

  const camera = new THREE.OrthographicCamera(
    -DESIGN_WIDTH / 2,
    DESIGN_WIDTH / 2,
    DESIGN_HEIGHT / 2,
    -DESIGN_HEIGHT / 2,
    0.1,
    50,
  );
  const homeX = DESIGN_WIDTH / 2;
  const homeY = DESIGN_HEIGHT / 2;
  camera.position.set(homeX, homeY, 10);
  camera.lookAt(homeX, homeY, 0);
  camera.up.set(0, 1, 0);
  const look = { x: 0, y: 0 };

  const shadowMat = new THREE.MeshBasicMaterial({
    color: SHADOW,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const softShadowMat = new THREE.MeshBasicMaterial({
    color: SHADOW,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const bowlMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const bandMat = new THREE.MeshBasicMaterial({
    color: BAND,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const rivetMat = new THREE.MeshBasicMaterial({
    color: RIVET,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const goldMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const blueMat = new THREE.MeshBasicMaterial({
    color: BALL_HEX.blue,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const redMat = new THREE.MeshBasicMaterial({
    color: BALL_HEX.red,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const ballMat: Record<BallColor, THREE.MeshBasicMaterial> = { gold: goldMat, blue: blueMat, red: redMat };
  const bowlPaint: Record<BallColor, THREE.MeshBasicMaterial> = { gold: bowlMat, blue: blueMat, red: redMat };
  const mountShadow = (geom: THREE.BufferGeometry, cast = 1) => {
    const group = new THREE.Group();
    const len = Math.hypot(SHADOW_X, SHADOW_Y) || 1;
    const dx = SHADOW_X / len;
    const dy = SHADOW_Y / len;
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mat = softShadowMat.clone();
      mat.opacity = 0.5 * (1 - t);
      const soft = new THREE.Mesh(geom, mat);
      soft.frustumCulled = false;
      soft.renderOrder = i;
      soft.position.set(dx * SHADOW_BLUR * cast * t, dy * SHADOW_BLUR * cast * t, 0);
      group.add(soft);
    }
    const mesh = new THREE.Mesh(geom, shadowMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = steps + 1;
    group.add(mesh);
    scene.add(group);
    return { mesh, group };
  };

  const bagRibbons = [0, 1, 2].map(() => {
    const geom = meshGeom(RIBBON_VERTS, RIBBON_INDICES);
    const shadowGeom = meshGeom(SHADOW_VERTS, SHADOW_INDICES);
    const shadow = mountShadow(shadowGeom);
    const mesh = new THREE.Mesh(geom, bowlMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    return { mesh, shadow };
  });
  const bagEnds: THREE.Mesh[] = [];
  for (let i = 0; i < bagRibbons.length * 2; i++) {
    const end = circle(1, GOLD, 64);
    end.material = bowlMat;
    end.renderOrder = 3;
    bagEnds.push(end);
    scene.add(end);
  }

  const BAND_SLOTS = 3;
  const arcs = Array.from({ length: BAND_SLOTS }, () => {
    const geom = meshGeom(RIBBON_VERTS, RIBBON_INDICES);
    const shadowGeom = meshGeom(SHADOW_VERTS, SHADOW_INDICES);
    const shadow = mountShadow(shadowGeom, NEAR_CAST);
    const mesh = new THREE.Mesh(geom, bandMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    return { mesh, shadow };
  });

  const bandEnds: THREE.Mesh[] = [];
  for (let i = 0; i < BAND_SLOTS * 2; i++) {
    const end = circle(1, BAND, 64);
    end.material = bandMat;
    end.renderOrder = 3;
    bandEnds.push(end);
    scene.add(end);
  }
  const plankRibbons = [0, 1, 2].map(() => {
    const mesh = new THREE.Mesh(meshGeom(RIBBON_VERTS, RIBBON_INDICES), bowlMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    const caps = [0, 1].map(() => {
      const cap = circle(1, GOLD, 64);
      cap.material = bowlMat;
      cap.renderOrder = 3;
      scene.add(cap);
      return cap;
    });
    return { mesh, shadow: mountShadow(meshGeom(SHADOW_VERTS, SHADOW_INDICES)), caps };
  });
  const railMat = new THREE.MeshBasicMaterial({ color: RAIL_COLOR });
  const railMesh = new THREE.Mesh(meshGeom(RIBBON_VERTS, RIBBON_INDICES), railMat);
  railMesh.frustumCulled = false;
  railMesh.renderOrder = 1;
  scene.add(railMesh);
  const railCaps = [0, 1].map(() => {
    const cap = circle(1, RAIL_COLOR, 64);
    cap.material = railMat;
    cap.renderOrder = 1;
    scene.add(cap);
    return cap;
  });
  const capsuleMat = new THREE.MeshBasicMaterial({ color: GOLD });
  const capsuleShadowMat = new THREE.MeshBasicMaterial({ color: SHADOW });
  const capsuleMesh = new THREE.Mesh(new THREE.BufferGeometry(), capsuleMat);
  const capsuleShadow = new THREE.Mesh(new THREE.BufferGeometry(), capsuleShadowMat);
  capsuleMesh.frustumCulled = false;
  capsuleShadow.frustumCulled = false;
  capsuleMesh.renderOrder = 3;
  capsuleShadow.renderOrder = 1;
  scene.add(capsuleShadow);
  scene.add(capsuleMesh);
  const capsuleRivet = circle(1, CAPSULE_RIVET, 64);
  capsuleRivet.material = new THREE.MeshBasicMaterial({ color: CAPSULE_RIVET });
  capsuleRivet.renderOrder = 4;
  capsuleRivet.visible = false;
  scene.add(capsuleRivet);
  const elbowSlots = [0, 1].map(() => {
    const mesh = new THREE.Mesh(meshGeom(RIBBON_VERTS, RIBBON_INDICES), bowlMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    const shadow = mountShadow(meshGeom(SHADOW_VERTS, SHADOW_INDICES));
    const caps = [0, 1].map(() => {
      const cap = circle(1, GOLD, 64);
      cap.material = bowlMat;
      cap.renderOrder = 3;
      scene.add(cap);
      return cap;
    });
    return { mesh, shadow, caps };
  });
  const railKnob = circle(1, KNOB, 64);
  railKnob.material = new THREE.MeshBasicMaterial({ color: KNOB, depthTest: false, depthWrite: false });
  railKnob.renderOrder = 2;
  railKnob.visible = false;
  scene.add(railKnob);

  const rivetR = STROKE * 0.34;
  const rivets: THREE.Mesh[] = [];
  for (let n = 0; n < BAND_SLOTS; n++) {
    for (const rivet of [SLINGS[0].left, SLINGS[0].right]) {
      const head = circle(1, RIVET, 64);
      head.material = rivetMat;
      head.renderOrder = 4;
      head.position.set(rivet.x, rivet.y, 0.8);
      head.scale.set(rivetR, rivetR, 1);
      scene.add(head);
      rivets.push(head);
    }
  }

  const ballShadows = Array.from({ length: BAND_SLOTS }, () => {
    return mountShadow(meshGeom(64, 192), NEAR_CAST);
  });
  const balls = Array.from({ length: BAND_SLOTS }, () => {
    const body = circle(1, GOLD);
    body.material = goldMat;
    body.renderOrder = 4;
    const group = new THREE.Group();
    group.add(body);
    group.renderOrder = 2;
    scene.add(group);
    return group;
  });
  const HINT_DOTS = 80;
  const hintGeom = new THREE.CircleGeometry(1, 16);
  const hintDots = Array.from({ length: HINT_DOTS }, () => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(hintGeom, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    scene.add(mesh);
    return mesh;
  });
  const restingBalls = Array.from({ length: 6 }, () => {
    const body = circle(1, GOLD);
    body.material = goldMat;
    body.renderOrder = 4;
    body.visible = false;
    scene.add(body);
    const shadow = mountShadow(meshGeom(64, 192), NEAR_CAST);
    shadow.group.visible = false;
    return { body, shadow };
  });
  let hum = 0;

  return {
    camera,
    look,
    sync(sim: Sim, dt: number) {
      const s = sim.sample();
      const cap = s.capsule;
      capsuleMesh.visible = Boolean(cap);
      capsuleShadow.visible = Boolean(cap);
      capsuleRivet.visible = Boolean(cap);
      if (cap) {
        const flat = capsuleOutline(cap.length, cap.rThin, cap.rThick);
        const shape = new THREE.Shape();
        shape.moveTo(flat[0], flat[1]);
        for (let i = 2; i < flat.length; i += 2) shape.lineTo(flat[i], flat[i + 1]);
        shape.closePath();
        capsuleMesh.geometry.dispose();
        capsuleShadow.geometry.dispose();
        const geom = new THREE.ShapeGeometry(shape);
        capsuleMesh.geometry = geom;
        capsuleShadow.geometry = geom.clone();
        capsuleMesh.position.set(cap.x, cap.y, 0.3);
        capsuleMesh.rotation.z = cap.angle;
        capsuleShadow.position.set(cap.x + SHADOW_X * NEAR_CAST, cap.y + SHADOW_Y * NEAR_CAST, 0.1);
        capsuleShadow.rotation.z = cap.angle;
        capsuleRivet.position.set(cap.x, cap.y, 0.5);
        capsuleRivet.scale.set(cap.rThick * 0.38, cap.rThick * 0.38, 1);
      }

      for (let n = 0; n < plankRibbons.length; n++) {
        const board = PLANKS[n];
        const slot = plankRibbons[n];
        const showBoard = Boolean(board);
        const paint = bowlPaint[board?.color ?? 'gold'];
        slot.mesh.material = paint;
        slot.mesh.visible = showBoard;
        slot.shadow.group.visible = showBoard;
        for (const cap of slot.caps) {
          cap.material = paint;
          cap.visible = showBoard;
        }
        if (!board) continue;
        const pts = board.vertical
          ? [
              { x: board.x, y: board.y + board.halfH },
              { x: board.x, y: board.y - board.halfH },
            ]
          : [
              { x: board.x - board.halfW, y: board.y },
              { x: board.x + board.halfW, y: board.y },
            ];
        const width = (board.vertical ? board.halfW : board.halfH) * 2;
        const geom = slot.mesh.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const count = writeRibbon(attr.array as Float32Array, index.array as Uint32Array, pts, width);
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
        const shadowGeom = slot.shadow.mesh.geometry;
        const shadowAttr = shadowGeom.getAttribute('position') as THREE.BufferAttribute;
        const shadowIndex = shadowGeom.getIndex() as THREE.BufferAttribute;
        const shadowCount = writeStrokeShadow(
          shadowAttr.array as Float32Array,
          shadowIndex.array as Uint32Array,
          pts,
          width,
        );
        shadowGeom.setDrawRange(0, shadowCount);
        shadowAttr.needsUpdate = true;
        shadowIndex.needsUpdate = true;
        for (let i = 0; i < 2; i++) {
          slot.caps[i].position.set(pts[i].x, pts[i].y, 0.55);
          slot.caps[i].scale.set(width / 2, width / 2, 1);
        }
      }
      for (let e = 0; e < elbowSlots.length; e++) {
        const elbow = ELBOWS[e];
        const slot = elbowSlots[e];
        const elbowOn = Boolean(elbow && SHOW_BAG);
        slot.mesh.visible = elbowOn;
        slot.shadow.group.visible = elbowOn;
        for (const cap of slot.caps) cap.visible = elbowOn;
        if (!elbow || !elbowOn) continue;
        const paint = bowlPaint[elbow.color];
        slot.mesh.material = paint;
        const geom = slot.mesh.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const count = writeRibbon(attr.array as Float32Array, index.array as Uint32Array, elbow.pts, elbow.width);
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
        const shadowGeom = slot.shadow.mesh.geometry;
        const shadowAttr = shadowGeom.getAttribute('position') as THREE.BufferAttribute;
        const shadowIndex = shadowGeom.getIndex() as THREE.BufferAttribute;
        const shadowCount = writeStrokeShadow(
          shadowAttr.array as Float32Array,
          shadowIndex.array as Uint32Array,
          elbow.pts,
          elbow.width,
        );
        shadowGeom.setDrawRange(0, shadowCount);
        shadowAttr.needsUpdate = true;
        shadowIndex.needsUpdate = true;
        const ends = [elbow.pts[0], elbow.pts[elbow.pts.length - 1]];
        for (let i = 0; i < 2; i++) {
          slot.caps[i].material = paint;
          slot.caps[i].position.set(ends[i].x, ends[i].y, 0.55);
          slot.caps[i].scale.set(elbow.width / 2, elbow.width / 2, 1);
        }
      }
      const rail = RAIL;
      railMesh.visible = Boolean(rail);
      for (const cap of railCaps) cap.visible = Boolean(rail);
      if (rail) {
        const pts = [
          { x: rail.x, y: rail.y + rail.halfH },
          { x: rail.x, y: rail.y - rail.halfH },
        ];
        const width = rail.halfW * 2;
        const geom = railMesh.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const count = writeRibbon(attr.array as Float32Array, index.array as Uint32Array, pts, width);
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
        for (let i = 0; i < 2; i++) {
          railCaps[i].position.set(pts[i].x, pts[i].y, 0.4);
          railCaps[i].scale.set(width / 2, width / 2, 1);
        }
      }
      for (let i = 0; i < bagRibbons.length; i++) {
        const bagState = s.bags[i];
        const here = Boolean(bagState) && SHOW_BAG && !bagState.gone;
        const ribbon = bagRibbons[i].mesh;
        const paint = bowlPaint[BAG_SPEC[i]?.color ?? 'gold'];
        ribbon.material = paint;
        bagEnds[i * 2].material = paint;
        bagEnds[i * 2 + 1].material = paint;
        if (!here || !BAGS[i]) {
          ribbon.visible = false;
          bagRibbons[i].shadow.group.visible = false;
          bagEnds[i * 2].visible = false;
          bagEnds[i * 2 + 1].visible = false;
          continue;
        }
        const pts = bagStrokePoints(BAGS[i], i);
        const shadow = bagRibbons[i].shadow;
        ribbon.visible = here;
        shadow.group.visible = here;
        const geom = ribbon.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const count = writeRibbon(attr.array as Float32Array, index.array as Uint32Array, pts, STROKE);
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
        const shadowGeom = shadow.mesh.geometry;
        const shadowAttr = shadowGeom.getAttribute('position') as THREE.BufferAttribute;
        const shadowIndex = shadowGeom.getIndex() as THREE.BufferAttribute;
        const shadowCount = writeStrokeShadow(
          shadowAttr.array as Float32Array,
          shadowIndex.array as Uint32Array,
          pts,
          STROKE,
        );
        shadowGeom.setDrawRange(0, shadowCount);
        shadowAttr.needsUpdate = true;
        shadowIndex.needsUpdate = true;
        const endR = STROKE / 2;
        const tips = [pts[0], pts[pts.length - 1]];
        for (let k = 0; k < 2; k++) {
          const end = bagEnds[i * 2 + k];
          end.visible = here;
          end.position.set(tips[k].x, tips[k].y, 0.55);
          end.scale.set(endR, endR, 1);
        }
        if (BAG_RISE[i] && BAG_SPEC[i]?.color === 'gold') {
          let bottom = pts[0];
          for (const p of pts) if (p.y < bottom.y) bottom = p;
          const knobR = RAIL?.halfW ?? STROKE / 2;
          railKnob.visible = true;
          railKnob.position.set(bottom.x, bottom.y, 0);
          railKnob.scale.set(knobR * 1.25, knobR * 1.25, 1);
        }
      }
      if (!BAG_RISE.some((rise, i) => rise && BAG_SPEC[i]?.color === 'gold' && s.bags[i] && !s.bags[i].gone)) {
        railKnob.visible = false;
      }
      for (let i = 0; i < rivets.length; i++) {
        const sling = SLINGS[Math.floor(i / 2)];
        const side = sling ? (i % 2 === 0 ? sling.left : sling.right) : null;
        rivets[i].visible = Boolean(side);
        if (side) rivets[i].position.set(side.x, side.y, 0.8);
      }
      for (let i = 0; i < balls.length; i++) {
        if (i < s.shots.length) continue;
        arcs[i].mesh.visible = false;
        arcs[i].shadow.group.visible = false;
        balls[i].visible = false;
        ballShadows[i].group.visible = false;
        bandEnds[i * 2].visible = false;
        bandEnds[i * 2 + 1].visible = false;
      }
      let humPull = 0;
      for (let i = 0; i < s.shots.length; i++) {
        const shot = s.shots[i];
        const fingerCap = fingerPullCap();
        const pullT = shot.phase === 'pulling' && fingerCap > 0 ? Math.min(1, shot.finger / fingerCap) : 0;
        if (pullT > humPull) humPull = pullT;
        const amp = pullT > 0 ? Math.sin(hum * HUM_RATE) * HUM_MAX * pullT : 0;
        const ball = balls[i];
        const ballShadow = ballShadows[i];
        const bx = shot.birdX + shot.aimX * amp;
        const by = shot.birdY + shot.aimY * amp;
        const shown = shot.phase !== 'gone';
        ball.position.set(bx, by, 1);
        ball.visible = shown;
        const body = ball.children[0] as THREE.Mesh;
        body.material = ballMat[shot.color];
        ball.scale.set(BIRD_R * shot.scale, BIRD_R * shot.scale, 1);
        ballShadow.group.visible = shown;
        const ballGeom = ballShadow.mesh.geometry;
        const ballAttr = ballGeom.getAttribute('position') as THREE.BufferAttribute;
        const ballIndex = ballGeom.getIndex() as THREE.BufferAttribute;
        const ballCursor = { v: 0, c: 0 };
        if (shown) {
          writeDiscSweep(ballAttr.array as Float32Array, ballIndex.array as Uint32Array, bx, by, BIRD_R * shot.scale, 0.2, ballCursor, NEAR_CAST);
        }
        ballGeom.setDrawRange(0, ballCursor.c);
        ballAttr.needsUpdate = true;
        ballIndex.needsUpdate = true;
        const points = amp === 0 ? shot.band : humAlongForce(shot.band, shot.birdX, shot.birdY, shot.aimX, shot.aimY, amp);
        const arc = arcs[i];
        arc.mesh.visible = true;
        arc.shadow.group.visible = true;
        const geom = arc.mesh.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const width = bandWidth(shot.strain);
        const count = writeRibbon(
          attr.array as Float32Array,
          index.array as Uint32Array,
          points,
          width,
        );
        const shadowGeom = arc.shadow.mesh.geometry;
        const shadowAttr = shadowGeom.getAttribute('position') as THREE.BufferAttribute;
        const shadowIndex = shadowGeom.getIndex() as THREE.BufferAttribute;
        const shadowCount = writeStrokeShadow(
          shadowAttr.array as Float32Array,
          shadowIndex.array as Uint32Array,
          points,
          width,
          NEAR_CAST,
        );
        shadowGeom.setDrawRange(0, shadowCount);
        shadowAttr.needsUpdate = true;
        shadowIndex.needsUpdate = true;
        const cap = width / 2;
        const tips = [points[0], points[points.length - 1]];
        for (let k = 0; k < 2; k++) {
          const end = bandEnds[i * 2 + k];
          end.visible = true;
          end.position.set(tips[k].x, tips[k].y, 0.5);
          end.scale.set(cap, cap, 1);
        }
        geom.setDrawRange(0, count);
        attr.needsUpdate = true;
        index.needsUpdate = true;
      }
      hum += dt * humPull;
      for (let i = 0; i < restingBalls.length; i++) {
        const held = s.resting[i];
        const mark = restingBalls[i];
        mark.body.visible = Boolean(held);
        mark.shadow.group.visible = Boolean(held);
        if (!held) continue;
        mark.body.position.set(held.x, held.y, 1);
        mark.body.material = ballMat[held.color];
        mark.body.scale.set(BIRD_R, BIRD_R, 1);
        const geom = mark.shadow.mesh.geometry;
        const attr = geom.getAttribute('position') as THREE.BufferAttribute;
        const index = geom.getIndex() as THREE.BufferAttribute;
        const cursor = { v: 0, c: 0 };
        writeDiscSweep(attr.array as Float32Array, index.array as Uint32Array, held.x, held.y, BIRD_R, 0.2, cursor, NEAR_CAST);
        geom.setDrawRange(0, cursor.c);
        attr.needsUpdate = true;
        index.needsUpdate = true;
      }
      const pulling = SHOW_HINT ? s.shots.findIndex((item) => item.phase === 'pulling') : -1;
      let hint: HintDot[] = [];
      if (pulling >= 0) {
        const shot = s.shots[pulling];
        const pouch = SLINGS[pulling]?.pouch;
        if (pouch) {
          const pull = Math.hypot(pouch.x - shot.birdX, pouch.y - shot.birdY);
          if (pull >= DEAD_PULL) {
            const speed = launchSpeed(pull);
            hint = sampleHintArc(
              pouch.x,
              pouch.y,
              shot.aimX * speed,
              shot.aimY * speed,
              s.look.y - DESIGN_HEIGHT / 2 - 20,
              HINT_DOTS,
            );
          }
        }
      }
      for (let i = 0; i < hintDots.length; i++) {
        const mesh = hintDots[i];
        const dot = hint[i];
        mesh.visible = Boolean(dot);
        if (!dot) continue;
        mesh.position.set(dot.x, dot.y, 1.2);
        mesh.scale.set(dot.radius, dot.radius, 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = dot.opacity;
      }
      look.x = s.look.x;
      look.y = s.look.y;
      camera.position.set(homeX + look.x, homeY + look.y, 10);
      camera.lookAt(homeX + look.x, homeY + look.y, 0);
    },
  };
}
