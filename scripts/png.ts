import { encodePNG } from './png-encode';

export { encodePNG };

export interface PixelCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Minimal in-memory RGBA canvas used by the offline sprite generator.
 * The renderer writes directly into the pixel buffer before PNG encoding.
 */
export function createCanvas(width: number, height: number): PixelCanvas {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid canvas size: ${width}x${height}`);
  }

  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}
