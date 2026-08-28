import type { PartBox, PixelRenderer, Rgb, Rgba } from './types.ts';

export type Point = { x: number; y: number };

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

function channel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgb(r: number, g: number, b: number): Rgba {
  return { r: channel(r), g: channel(g), b: channel(b), a: 255 };
}

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r: channel(r), g: channel(g), b: channel(b), a: channel(a) };
}

/** Parse #rgb, #rrggbb, or #rrggbbaa without relying on browser color APIs. */
export function color(value: string, alpha = 255): Rgba {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex) || (hex.length !== 3 && hex.length !== 4 && hex.length !== 6 && hex.length !== 8)) {
    throw new Error(`Invalid color: ${value}`);
  }
  const expanded = hex.length <= 4 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex;
  const hasAlpha = expanded.length === 8;
  return rgba(
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
    hasAlpha ? parseInt(expanded.slice(6, 8), 16) : alpha,
  );
}

export const hex = color;

export function withAlpha(value: Rgb | Rgba, alpha: number): Rgba {
  return rgba(value.r, value.g, value.b, alpha);
}

export function mix(a: Rgb | Rgba, b: Rgb | Rgba, amount: number): Rgba {
  const t = Math.max(0, Math.min(1, amount));
  const alphaA = 'a' in a ? a.a : 255;
  const alphaB = 'a' in b ? b.a : 255;
  return rgba(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, alphaA + (alphaB - alphaA) * t);
}

export function lighten(value: Rgb | Rgba, amount: number): Rgba {
  return mix(value, WHITE, amount);
}

export function darken(value: Rgb | Rgba, amount: number): Rgba {
  return mix(value, BLACK, amount);
}

/** Inclusive deterministic pseudo-random number generator. */
export interface SeededRng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  fork(salt: number): SeededRng;
}

function hashSeed(seed: number): number {
  let value = (Number.isFinite(seed) ? Math.trunc(seed) : 0) | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return value | 0;
}

export function createRng(seed: number): SeededRng {
  let state = hashSeed(seed) || 0x6d2b79f5;
  const next = (): number => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      const low = Math.ceil(Math.min(min, max));
      const high = Math.floor(Math.max(min, max));
      return low + Math.floor(next() * (high - low + 1));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from an empty array');
      return items[Math.floor(next() * items.length)];
    },
    fork(salt: number) {
      return createRng(hashSeed(state ^ Math.trunc(salt)));
    },
  };
}

export const seededRng = createRng;

function blendPixel(dst: Uint8ClampedArray, index: number, source: Rgba): void {
  if (source.a <= 0) return;
  if (source.a >= 255 || dst[index + 3] === 0) {
    dst[index] = source.r;
    dst[index + 1] = source.g;
    dst[index + 2] = source.b;
    dst[index + 3] = source.a;
    return;
  }
  const srcAlpha = source.a / 255;
  const dstAlpha = dst[index + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  dst[index] = channel((source.r * srcAlpha + dst[index] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  dst[index + 1] = channel((source.g * srcAlpha + dst[index + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  dst[index + 2] = channel((source.b * srcAlpha + dst[index + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  dst[index + 3] = channel(outAlpha * 255);
}

export class PixelBuffer implements PixelRenderer {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, pixels?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(`Invalid pixel buffer dimensions: ${width}x${height}`);
    }
    if (pixels !== undefined && pixels.length !== width * height * 4) {
      throw new Error('Pixel buffer length does not match dimensions');
    }
    this.pixels = pixels ?? new Uint8ClampedArray(width * height * 4);
  }
  clear(fill: Rgba = TRANSPARENT): void {
    for (let index = 0; index < this.pixels.length; index += 4) {
      this.pixels[index] = fill.r;
      this.pixels[index + 1] = fill.g;
      this.pixels[index + 2] = fill.b;
      this.pixels[index + 3] = fill.a;
    }
  }

  setPixel(x: number, y: number, value: Rgba): void {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    blendPixel(this.pixels, (py * this.width + px) * 4, value);
  }

  getPixel(x: number, y: number): Rgba | undefined {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return undefined;
    const index = (py * this.width + px) * 4;
    return { r: this.pixels[index], g: this.pixels[index + 1], b: this.pixels[index + 2], a: this.pixels[index + 3] };
  }

  fillRect(x: number, y: number, width: number, height: number, value: Rgba): void {
    const left = Math.ceil(x);
    const top = Math.ceil(y);
    const right = Math.floor(x + width);
    const bottom = Math.floor(y + height);
    for (let py = top; py < bottom; py++) {
      for (let px = left; px < right; px++) this.setPixel(px, py, value);
    }
  }

  fillPolygon(points: readonly Point[], value: Rgba): void {
    if (points.length < 3) return;
    let minY = this.height - 1;
    let maxY = 0;
    for (const point of points) {
      minY = Math.min(minY, Math.floor(point.y));
      maxY = Math.max(maxY, Math.ceil(point.y));
    }
    minY = Math.max(0, minY);
    maxY = Math.min(this.height - 1, maxY);
    for (let py = minY; py <= maxY; py++) {
      const intersections: number[] = [];
      for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
        const a = points[index];
        const b = points[previous];
        if ((a.y > py) !== (b.y > py)) intersections.push(a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = Math.ceil(intersections[index]);
        const right = Math.floor(intersections[index + 1]);
        for (let px = left; px <= right; px++) this.setPixel(px, py, value);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, value: Rgba): void {
    if (rx <= 0 || ry <= 0) return;
    const left = Math.max(0, Math.floor(cx - rx));
    const right = Math.min(this.width - 1, Math.ceil(cx + rx));
    const top = Math.max(0, Math.floor(cy - ry));
    const bottom = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let py = top; py <= bottom; py++) {
      for (let px = left; px <= right; px++) {
        const dx = (px - cx) / rx;
        const dy = (py - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.setPixel(px, py, value);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, value: Rgba, width = 1): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const sx = ax < bx ? 1 : -1;
    const dy = -Math.abs(by - ay);
    const sy = ay < by ? 1 : -1;
    let error = dx + dy;
    const radius = Math.floor(width / 2);
    while (true) {
      if (width <= 1) this.setPixel(ax, ay, value);
      else this.fillRect(ax - radius, ay - radius, width, width, value);
      if (ax === bx && ay === by) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; ax += sx; }
      if (twice <= dx) { error += dx; ay += sy; }
    }
  }
}

export function createPixelBuffer(width: number, height: number, fill: Rgba = TRANSPARENT): PixelBuffer {
  const result = new PixelBuffer(width, height);
  result.clear(fill);
  return result;
}

export function rect(renderer: PixelRenderer, box: PartBox, value: Rgba): void {
  renderer.fillRect(box.x, box.y, box.width, box.height, value);
}

export function polygon(renderer: PixelRenderer, points: readonly Point[], value: Rgba): void {
  renderer.fillPolygon(points, value);
}

export function ellipse(renderer: PixelRenderer, cx: number, cy: number, rx: number, ry: number, value: Rgba): void {
  renderer.fillEllipse(cx, cy, rx, ry, value);
}

export function line(renderer: PixelRenderer, x0: number, y0: number, x1: number, y1: number, value: Rgba, width = 1): void {
  renderer.line(x0, y0, x1, y1, value, width);
}

export const drawRect = rect;
export const drawPolygon = polygon;
export const drawEllipse = ellipse;
export const drawLine = line;
