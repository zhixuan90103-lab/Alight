import { assistRelease, flightBowl } from '../src/game/aim';
import { loadLevelLayout, launchSpeed, MAX_PULL, SLINGS } from '../src/game/tune';

loadLevelLayout(1);
const pouch = SLINGS[0].pouch;
const full = launchSpeed(MAX_PULL);

function shot(deg: number, scale: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const speed = full * scale;
  return assistRelease(pouch.x, pouch.y, Math.cos(a), Math.sin(a), speed, 'gold', [], 0);
}

function seals(vel: { x: number; y: number }): boolean {
  return flightBowl(pouch.x, pouch.y, vel.x, vel.y) >= 0;
}

function unchanged(deg: number, scale: number, vel: { x: number; y: number }): boolean {
  const a = (deg * Math.PI) / 180;
  const speed = full * scale;
  return Math.hypot(vel.x - Math.cos(a) * speed, vel.y - Math.sin(a) * speed) < 0.5;
}

const rawLow = flightBowl(pouch.x, pouch.y, Math.cos((94 * Math.PI) / 180) * full * 0.9, Math.sin((94 * Math.PI) / 180) * full * 0.9);
const low = shot(94, 0.9);
if (rawLow >= 0) {
  console.error('the short probe already enters without help');
  process.exit(1);
}
if (!seals(low) || unchanged(94, 0.9, low)) {
  console.error('a slightly short shot was not helped into the bowl');
  process.exit(1);
}
if (Math.hypot(low.x, low.y) > full + 0.01) {
  console.error('help exceeded a full pull');
  process.exit(1);
}

const weak = shot(94, 0.7);
if (!unchanged(94, 0.7, weak) || seals(weak)) {
  console.error('a badly short shot was changed');
  process.exit(1);
}

const made = shot(95, 1);
if (!unchanged(95, 1, made) || !seals(made)) {
  console.error('a shot that already enters was changed');
  process.exit(1);
}

console.log('aim check ok');
