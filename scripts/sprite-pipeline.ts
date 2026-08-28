import { encodePNG } from './png-encode.ts';
import { PixelBuffer, createPixelBuffer } from './sprite-parts/CanvasRenderer.ts';
import type { PartBox, PartConfig, SpritePart } from './sprite-parts/types.ts';

export interface SpriteCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface SpriteLayer<C extends PartConfig = PartConfig> {
  part: SpritePart<C>;
  box: PartBox;
  config: C;
  /** Optional salt used to keep each layer's random choices independent. */
  seed?: number;
}

export type AnySpriteLayer = SpriteLayer<PartConfig> | SpriteLayer<Record<string, unknown>>;

/** Render an ordered list of reusable parts into a transparent pixel canvas. */
export function renderParts(
  width: number,
  height: number,
  layers: readonly AnySpriteLayer[],
  seed = 0,
): SpriteCanvas {
  const renderer = createPixelBuffer(width, height);
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    layer.part(renderer, layer.box, layer.config, seed + (layer.seed ?? index));
  }
  return { width, height, pixels: renderer.pixels };
}

/** Encode a pure pixel canvas as a deterministic PNG. */
export function encodeSprite(canvas: SpriteCanvas): Uint8Array {
  return encodePNG(canvas.width, canvas.height, canvas.pixels);
}

/** Render and encode reusable parts in one operation. */
export function renderPartsPNG(
  width: number,
  height: number,
  layers: readonly AnySpriteLayer[],
  seed = 0,
): Uint8Array {
  return encodeSprite(renderParts(width, height, layers, seed));
}

export function asPixelBuffer(canvas: SpriteCanvas): PixelBuffer {
  return new (class extends PixelBuffer {
    constructor() { super(canvas.width, canvas.height, canvas.pixels); }
  })();
}
