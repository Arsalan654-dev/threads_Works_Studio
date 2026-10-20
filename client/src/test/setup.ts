import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement canvas rendering, and the editor calls
 * `getContext('2d')` on mount. Stub it with a recording no-op so components
 * can render without each test having to mock the canvas itself.
 *
 * The stub records nothing by default; individual tests that care about
 * drawing can replace `window.HTMLCanvasElement.prototype.getContext`.
 */
const noop = (): void => undefined;

const context2d: Record<string, unknown> = {
  canvas: null,
  save: noop,
  restore: noop,
  clearRect: noop,
  fillRect: noop,
  strokeRect: noop,
  beginPath: noop,
  closePath: noop,
  moveTo: noop,
  lineTo: noop,
  arc: noop,
  ellipse: noop,
  stroke: noop,
  fill: noop,
  setLineDash: noop,
  translate: noop,
  rotate: noop,
  scale: noop,
  setTransform: noop,
  fillText: noop,
  measureText: () => ({ width: 0 }),
  drawImage: noop,
};

if (!HTMLCanvasElement.prototype.getContext) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => context2d,
  });
} else {
  const original = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === '2d') return context2d;
      return original.call(this, type as never, ...(rest as never[]));
    },
  });
}

// jsdom has no layout engine, so `getBoundingClientRect` always returns zeros.
// The canvas sizes itself from that value; give it a usable box so rendering
// paths that guard on width/height are exercised.
Element.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect;
};

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;

/**
 * Pointer capture.
 *
 * jsdom has no pointer system, so `setPointerCapture` is either absent or
 * rejects an id that does not correspond to a real active pointer. The editor
 * calls it unconditionally on every pointerdown, so it is replaced outright
 * rather than conditionally polyfilled - a half-working implementation would
 * make pointer tests pass or fail for the wrong reason.
 */
Element.prototype.setPointerCapture = function (): void {};
Element.prototype.releasePointerCapture = function (): void {};
Element.prototype.hasPointerCapture = function (): boolean {
  return false;
};

/**
 * `pathOf` builds a `Path2D` for every object outline. jsdom ships neither
 * Path2D nor the 2D backend behind it, so outline drawing in component tests
 * would throw before reaching the context. Stubs the command list only -
 * there is no rasterisation to fake, and nothing here inspects pixel output.
 */
if (!globalThis.Path2D) {
  class StubPath2D {
    moveTo(): void {}
    lineTo(): void {}
    closePath(): void {}
    arc(): void {}
    ellipse(): void {}
    rect(): void {}
    roundRect(): void {}
    quadraticCurveTo(): void {}
    bezierCurveTo(): void {}
    addPath(): void {}
  }
  (globalThis as unknown as { Path2D: unknown }).Path2D = StubPath2D;
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (handle: number): void => clearTimeout(handle as never);
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => undefined;
}
