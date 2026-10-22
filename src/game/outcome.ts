import { ballInBag } from './bag';
import { BAGS, BAG_SPEC, LEVEL_BALLS, REFILL_MODE, type BallColor } from './tune';

/** A ball that has already settled in a bowl. Positions are world coordinates. */
export type HeldBall = { color: BallColor; x: number; y: number };

/** This bowl holds at least one ball of its own color. */
export function bowlMatched(index: number, held: readonly HeldBall[]): boolean {
  const color = BAG_SPEC[index]?.color;
  if (!color) return false;
  return held.some((ball) => ball.color === color && ballInBag(ball.x, ball.y, index));
}

/** Every bowl holds a matching ball. */
export function levelMatched(held: readonly HeldBall[]): boolean {
  return BAGS.every((_, index) => bowlMatched(index, held));
}

/**
 * Every bowl of this color holds a matching ball.
 * A color with no bowl is not finished, so its balls can still be issued.
 */
export function colorDone(color: BallColor, held: readonly HeldBall[]): boolean {
  let any = false;
  for (let index = 0; index < BAG_SPEC.length; index++) {
    if (BAG_SPEC[index]?.color !== color) continue;
    any = true;
    if (!bowlMatched(index, held)) return false;
  }
  return any;
}

/**
 * Another ball of this color may leave the exit.
 * The white pips are one shared pool, `LEVEL_BALLS`, not a per-color quota.
 * `alive` is how many of that color are still on a band or in flight. Same-color levels wait until it is 0.
 */
export function mayIssue(color: BallColor, issued: number, alive: number, held: readonly HeldBall[]): boolean {
  if (issued >= LEVEL_BALLS) return false;
  if (colorDone(color, held)) return false;
  if (REFILL_MODE === 'same-color' && alive > 0) return false;
  return true;
}
