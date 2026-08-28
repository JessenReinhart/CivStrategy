/**
 * Core contracts for the deterministic sprite composition pipeline.
 *
 * Everything here is pure TypeScript with no browser dependencies, so it can be
 * imported by Node tooling and Vitest tests without polyfills.
 */

/** Axis-aligned box a part may draw inside. */
export interface PartBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Config values are intentionally open so each authored part can add typed fields. */
export interface PartConfig {
  [key: string]: unknown;
}
/** RGB colour (no alpha). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** RGBA colour. */
export interface Rgba extends Rgb {
  a: number;
}

/** Minimal contract exposed by the pure-JS pixel renderer. */
export interface PixelRenderer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;

  setPixel(x: number, y: number, color: Rgba): void;
  getPixel(x: number, y: number): Rgba | undefined;

  fillRect(x: number, y: number, width: number, height: number, color: Rgba): void;
  fillPolygon(points: readonly { x: number; y: number }[], color: Rgba): void;
  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Rgba): void;
  line(x0: number, y0: number, x1: number, y1: number, color: Rgba, width?: number): void;
}

/** A part that renders into a shared pixel buffer. */
export type SpritePart<T extends PartConfig = PartConfig> = (
  renderer: PixelRenderer,
  box: PartBox,
  config: T,
  seed: number
) => void;
