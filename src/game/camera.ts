/** One fixed frame. The view does not follow the ball. */
export function createFramingCamera() {
  return {
    get x() {
      return 0;
    },
    get y() {
      return 0;
    },
    step(_birdY: number | null, _dt: number) {},
    reset() {},
  };
}
