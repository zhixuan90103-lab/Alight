/**
 * Boot: safe-area → device preview → WebGPU design stage → level 1.
 * Keep: adapt/*, create-renderer, utils/haptics, DOM contract.
 */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import {
  DESIGN_HEIGHT,
  DESIGN_SAFE,
  DESIGN_WIDTH,
  applyStageTransform,
  computeStageLayout,
  isInDesignBounds,
  watchStageLayout,
  type StageLayout,
} from './adapt/design';
import {
  mountDevicePreview,
  type DevicePreviewController,
} from './adapt/devicePreview';
import { applyNativeClass, applySafeAreaCssVars, readSafeAreaInsets } from './adapt/safeArea';
import { createRenderer, resizeToDesign } from './create-renderer';
import { designToWorld } from './game/frame';
import { Sim } from './game/sim';
import { BAG_Y, BIRD_R, LANE_X, SHOW_BAG } from './game/tune';
import { mountTunePanel } from './game/tunePanel';
import { createPlayView } from './game/view';
import { haptics } from './utils/haptics';

const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;
const heartsEl = document.getElementById('hearts')!;

function paintHearts(count: number): void {
  heartsEl.replaceChildren(
    ...[0, 1, 2].map((i) => {
      const dot = document.createElement('span');
      dot.className = i < count ? 'heart is-full' : 'heart';
      return dot;
    }),
  );
}

async function boot(): Promise<void> {
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const renderer = await createRenderer({ container: stage });
  const scene = new THREE.Scene();
  const sim = await Sim.create();
  const view = createPlayView(scene);
  paintHearts(sim.hearts);
  const uiRoot = document.getElementById('ui-root');
  const bagCounts = LANE_X.map((x, i) => {
    const el = document.createElement('div');
    el.className = 'bag-count';
    el.style.left = `${x}px`;
    el.style.top = `${BAG_Y[i] - BIRD_R - 22}px`;
    el.textContent = '0';
    uiRoot?.append(el);
    return el;
  });
  if (uiRoot) mountTunePanel(uiRoot, sim);

  let preview: DevicePreviewController;
  let pointerId: number | null = null;

  const onLayout = (layout: StageLayout) => {
    applyStageTransform(stage, layout);
    applySafeAreaCssVars(native);
    resizeToDesign(renderer);
    const safe = readSafeAreaInsets();
    document.documentElement.style.setProperty('--safe-top', `${native ? safe.top : DESIGN_SAFE.top}px`);
  };

  preview = mountDevicePreview(shell, viewportEl, () => {
    const size = preview.getViewSize();
    onLayout(computeStageLayout(size.width, size.height, 'contain'));
  });

  const unwatch = watchStageLayout(onLayout, {
    mode: 'contain',
    getViewSize: () => preview.getViewSize(),
  });

  const designPoint = (event: PointerEvent) => {
    // The phone frame is centered and CSS-scaled. Use its drawn rect, not the window origin.
    const rect = stage.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    if (!isInDesignBounds(x, y)) return null;
    return designToWorld(x, y);
  };

  const onTune = (event: Event) => (event.target as HTMLElement | null)?.closest?.('#tune');

  window.addEventListener('pointerdown', (event) => {
    if (onTune(event)) return;
    if (pointerId !== null) return;
    const world = designPoint(event);
    if (!world) return;
    pointerId = event.pointerId;
    sim.pointerDown(world.x, world.y);
  });

  window.addEventListener('pointermove', (event) => {
    if (onTune(event)) return;
    if (event.pointerId !== pointerId) return;
    const world = designPoint(event);
    if (!world) return;
    sim.pointerMove(world.x, world.y);
  });

  const endPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    sim.pointerUp();
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    sim.cancelPull();
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    sim.advance(dt);
    for (const cue of sim.takeFeel()) {
      if (cue === 'pull' || cue === 'catch' || cue === 'knock') void haptics.impact('light');
      if (cue === 'launch') void haptics.impact('medium');
      if (cue === 'asleep') void haptics.impact('heavy');
      if (cue === 'slip' || cue === 'miss' || cue === 'gone') void haptics.impact('rigid');
      if (cue === 'miss' || cue === 'gone') paintHearts(sim.hearts);
    }
    const bags = sim.sample().bags;
    for (let i = 0; i < bagCounts.length; i++) {
      const el = bagCounts[i];
      const here = SHOW_BAG && !bags[i].gone;
      el.style.display = here ? 'block' : 'none';
      const text = String(bags[i].count);
      if (el.textContent !== text) el.textContent = text;
    }
    view.sync(sim, dt);
    renderer.render(scene, view.camera);
  });

  window.addEventListener(
    'pagehide',
    () => {
      unwatch();
      preview.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
    { once: true },
  );

}

boot().catch((err) => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `boot failed: ${err instanceof Error ? err.message : String(err)}`;
});
