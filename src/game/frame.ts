import { DESIGN_HEIGHT } from '../adapt/design';

/** Design pixels: +x right, +y down. World: +x right, +y up. One flip. */
export function designToWorld(x: number, yDown: number): { x: number; y: number } {
  return { x, y: DESIGN_HEIGHT - yDown };
}

/** Check: design top-left (0, 0) is world (0, 844). Design bottom-center (195, 844) is world (195, 0). */
export function worldToDesign(x: number, yUp: number): { x: number; y: number } {
  return { x, y: DESIGN_HEIGHT - yUp };
}
