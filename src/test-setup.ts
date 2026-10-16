import "@testing-library/jest-dom";

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      arc: () => {},
      beginPath: () => {},
      clearRect: () => {},
      closePath: () => {},
      drawImage: () => {},
      fill: () => {},
      fillRect: () => {},
      fillText: () => {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      lineTo: () => {},
      measureText: () => ({ width: 0 }),
      moveTo: () => {},
      putImageData: () => {},
      restore: () => {},
      save: () => {},
      scale: () => {},
      setTransform: () => {},
      stroke: () => {},
      strokeRect: () => {},
      translate: () => {},
    }),
  });
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: class ResizeObserver {
      observe() {
        // jsdom does not perform layout, so this is intentionally empty.
      }
      unobserve() {
        // jsdom does not perform layout, so this is intentionally empty.
      }
      disconnect() {
        // jsdom does not perform layout, so this is intentionally empty.
      }
    },
  });
}
