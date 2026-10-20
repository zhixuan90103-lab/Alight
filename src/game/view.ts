import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { BAND_COUNT } from './band';
import { bagDepth, bagMouth, bagMouthHalf, bagOuterPoints } from './bag';
import {
  BAGS,
  bandWidth,
  BIRD_R,
  GROUND_Y,
  SHOW_BAG,
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

function writeStrip(positions: Float32Array, points: ReadonlyArray<{ x: number; y: number }>, width: number): void {
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const mag = Math.hypot(tx, ty) || 1;
    tx /= mag;
    ty /= mag;
    const ox = -ty * half;
    const oy = tx * half;
    const o = i * 6;
    positions[o] = points[i].x + ox;
    positions[o + 1] = points[i].y + oy;
    positions[o + 2] = 0.45;
    positions[o + 3] = points[i].x - ox;
    positions[o + 4] = points[i].y - oy;
    positions[o + 5] = 0.45;
  }
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

  const postMat = new THREE.MeshBasicMaterial({ color: ROPE });
  for (const sling of SLINGS) {
    for (const post of [sling.left, sling.right]) {
      const mesh = circle(6, ROPE);
      mesh.position.set(post.x, post.y, 0.4);
      mesh.material = postMat;
      scene.add(mesh);
    }
  }

  const arcs = SLINGS.map(() => {
    const positions = new Float32Array(BAND_COUNT * 2 * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const index: number[] = [];
    for (let i = 0; i < BAND_COUNT - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geom.setIndex(index);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: ROPE, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  });

  const balls = SLINGS.map(() => {
    const body = circle(BIRD_R, BALL);
    const highlight = circle(BIRD_R * 0.38, BALL_LIGHT);
    highlight.position.set(-7, 8, 0.2);
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
        const radius = BIRD_R / 26;
        ball.scale.set(radius, radius, 1);
        const points = amp === 0 ? shot.band : humAlongForce(shot.band, shot.birdX, shot.birdY, shot.aimX, shot.aimY, amp);
        const attr = arcs[i].geometry.getAttribute('position') as THREE.BufferAttribute;
        writeStrip(attr.array as Float32Array, points, bandWidth(shot.strain));
        attr.needsUpdate = true;
      }
    },
  };
}
