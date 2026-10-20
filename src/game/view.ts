import * as THREE from 'three';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { BAND_COUNT } from './band';
import { bandWidth, BIRD_R, GROUND_Y, NEST } from './tune';
import { SLING_ANCHORS, type Sim } from './sim';

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

  // Lower semicircle, opening upward. Inner edge matches the ball so a stop fills the seat.
  const seat = new THREE.Mesh(
    new THREE.RingGeometry(BIRD_R + 2, BIRD_R + 10, 28, 1, Math.PI, Math.PI),
    new THREE.MeshBasicMaterial({ color: BALL }),
  );
  seat.position.set(NEST.x, NEST.y, 0);
  scene.add(seat);

  const postMat = new THREE.MeshBasicMaterial({ color: ROPE });
  const postL = circle(6, ROPE);
  const postR = circle(6, ROPE);
  postL.position.set(SLING_ANCHORS.left.x, SLING_ANCHORS.left.y, 0.4);
  postR.position.set(SLING_ANCHORS.right.x, SLING_ANCHORS.right.y, 0.4);
  postL.material = postMat;
  postR.material = postMat;
  scene.add(postL, postR);

  const arcPositions = new Float32Array(BAND_COUNT * 2 * 3);
  const arcGeom = new THREE.BufferGeometry();
  arcGeom.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
  const arcIndex: number[] = [];
  for (let i = 0; i < BAND_COUNT - 1; i++) {
    const a = i * 2;
    arcIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  arcGeom.setIndex(arcIndex);
  const arc = new THREE.Mesh(arcGeom, new THREE.MeshBasicMaterial({ color: ROPE, side: THREE.DoubleSide }));
  arc.frustumCulled = false;
  arc.renderOrder = 1;
  scene.add(arc);

  const body = circle(BIRD_R, BALL);
  const highlight = circle(BIRD_R * 0.38, BALL_LIGHT);
  highlight.position.set(-7, 8, 0.2);
  const ball = new THREE.Group();
  ball.add(body, highlight);
  ball.renderOrder = 2;
  scene.add(ball);
  let hum = 0;

  return {
    camera,
    sync(sim: Sim, dt: number) {
      const s = sim.sample();
      hum += dt;
      const atMax = s.phase === 'pulling' && s.strain >= 0.995;
      const amp = atMax ? Math.sin(hum * 46) * 3.2 : 0;
      ball.position.set(s.birdX + s.aimX * amp, s.birdY + s.aimY * amp, 1);
      ball.visible = s.phase !== 'gone';
      const settling = s.phase === 'settling';
      ball.scale.set(settling ? 1.06 : 1, settling ? 0.92 : 1, 1);

      const points = amp === 0 ? s.band : humAlongForce(s.band, s.birdX, s.birdY, s.aimX, s.aimY, amp);
      const attr = arcGeom.getAttribute('position') as THREE.BufferAttribute;
      writeStrip(attr.array as Float32Array, points, bandWidth(s.strain));
      attr.needsUpdate = true;
    },
  };
}
