import { createCanvas, encodePNG } from "./png";

export interface PixelDef {
  /** building width in blocks */
  w: number;
  /** building height in blocks */
  h: number;
  /** block size in pixels */
  bs: number;
  /** palette { hex key -> hex color } */
  palette: Record<string, string>;
  /** grid of block keys; '' = empty (transparent) */
  grid: string[][];
  /** isometric offset (row shift per tile) */
  isoShift?: number;
}

/**
 * Build a pixel-art isometric building into a RGBA PNG buffer.
 * Transparent where grid cells are empty.
 */
export function renderIsometric(def: PixelDef): Buffer {
  const { w, h, bs, palette, grid, isoShift = bs / 2 } = def;
  // Flat grid w x h
  // Render: from bottom-left, each row shifted right by isoShift
  const pad = bs;
  const maxX = w * bs + h * isoShift + pad * 2;
  const maxY = h * bs + pad * 2;
  const { width, height, data } = createCanvas(maxX, maxY);

  // fill transparent
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 0;
  }

  // Draw back-to-front (bottom rows first)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const key = grid[row]?.[col];
      if (!key || key === "") continue;
      const hex = palette[key];
      if (!hex) continue;
      const color = parseHex(hex);

      // position: isometric offset per row
      const ox = pad + col * bs + (h - 1 - row) * isoShift;
      const oy = pad + row * bs;

      // Draw this block
      drawBlock(data, width, height, ox, oy, bs, color);
    }
  }

  return encodePNG(width, height, data);
}

function parseHex(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function drawBlock(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  ox: number,
  oy: number,
  bs: number,
  [r, g, b]: [number, number, number]
) {
  // Top face — full block
  // Side faces — darker
  const topR = Math.min(255, r + 30);
  const topG = Math.min(255, g + 30);
  const topB = Math.min(255, b + 30);
  const sideR = Math.floor(r * 0.6);
  const sideG = Math.floor(g * 0.6);
  const sideB = Math.floor(b * 0.6);

  for (let y = 0; y < bs; y++) {
    for (let x = 0; x < bs; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = (py * w + px) * 4;

      // Simple 3-face look: top (y < bs*0.6), front-right, front-left
      const topH = Math.floor(bs * 0.6);
      if (y < topH) {
        data[idx] = topR;
        data[idx + 1] = topG;
        data[idx + 2] = topB;
        data[idx + 3] = 255;
      } else {
        data[idx] = sideR;
        data[idx + 1] = sideG;
        data[idx + 2] = sideB;
        data[idx + 3] = 255;
      }
    }
  }
}
