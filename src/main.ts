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
import { mountHud } from './game/hud';
import { LEVEL_COUNT, LEVEL_ID } from './game/tune';
import { createPlayView } from './game/view';
import { beginCharge, endCharge, updateCharge } from './game/pullHaptics';
import { haptics } from './utils/haptics';

const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;
async function boot(): Promise<void> {
  applyNativeClass();
  const native = Capacitor.isNativePlatform();
  const renderer = await createRenderer({ container: stage });
  const scene = new THREE.Scene();
  const sim = await Sim.create();
  const view = createPlayView(scene);
  const uiRoot = document.getElementById('ui-root');
  let pointerId: number | null = null;
  let resultShown = false;
  /** Seconds left before the result card. Negative means the level is not finished. */
  let resultWait = -1;
  const clearResult = () => {
    pointerId = null;
    resultShown = false;
    resultWait = -1;
    hud?.hideResult();
    sim.cancelPull();
  };
  const hud = uiRoot
    ? mountHud(
        uiRoot,
        sim,
        () => {
          clearResult();
          sim.restart();
        },
        () => {
          if (LEVEL_ID >= LEVEL_COUNT) return;
          clearResult();
          sim.loadLevel(LEVEL_ID + 1);
        },
        () => {
          clearResult();
          sim.loadLevel(LEVEL_ID >= LEVEL_COUNT ? 1 : LEVEL_ID + 1);
        },
      )
    : null;

  let preview: DevicePreviewController;

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
    const world = designToWorld(x, y);
    return { x: world.x + view.look.x, y: world.y + view.look.y };
  };

  const onTune = (event: Event) => (event.target as HTMLElement | null)?.closest?.('#tune, #hud, #result');

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
    if (hud && !resultShown) {
      const outcome = sim.result();
      if (!outcome) resultWait = -1;
      else if (resultWait < 0) resultWait = 1;
      else {
        resultWait -= dt;
        if (resultWait <= 0) {
          resultShown = true;
          pointerId = null;
          sim.cancelPull();
          hud.showResult(outcome.passed);
        }
      }
    }
    for (const cue of sim.takeFeel()) {
      if (cue === 'pull') {
        const pulling = sim.sample().shots.find((shot) => shot.phase === 'pulling');
        beginCharge(pulling?.strain ?? 0);
      }
      if (cue === 'catch' || cue === 'knock' || cue === 'bowl') void haptics.impact('light');
      if (cue === 'launch') void haptics.impact('medium');
      if (cue === 'slip' || cue === 'miss') void haptics.impact('rigid');
    }
    const snap = sim.sample();
    const pulling = snap.shots.find((shot) => shot.phase === 'pulling');
    if (pulling) updateCharge(pulling.strain);
    else endCharge();
    hud?.sync(snap);
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
