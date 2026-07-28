/* eslint-disable no-console -- CLI generator */
// Offline seamless grit terrain tiles (256²). True toroidal noise + grain.
// Run: bun run scripts/gen-terrain-tiles.ts
// Overwrites assets/textures/terrain_{sand,grass,forest,scrub,stone}.png

import { writeFileSync } from "fs";
import { join } from "path";
import { encodePNG } from "./png-encode";

const OUT = join(import.meta.dir, "..", "assets", "textures");
const SIZE = 256;

// ─── Math ─────────────────────────────────────────────

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash2(x: number, y: number, seed: number): number {
  // Deterministic 2D hash → [0,1)
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return fract(n);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on a toroidal lattice so the field wraps on SIZE. */
function valueNoise(px: number, py: number, cell: number, seed: number): number {
  // World in [0, SIZE)
  const gx = ((px % SIZE) + SIZE) % SIZE;
  const gy = ((py % SIZE) + SIZE) % SIZE;
  const cells = SIZE / cell;
  // Grid coords in continuous cell space
  const fx = (gx / SIZE) * cells;
  const fy = (gy / SIZE) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);
  // Toroidal cell indices
  const ix0 = ((x0 % cells) + cells) % cells;
  const iy0 = ((y0 % cells) + cells) % cells;
  const ix1 = (ix0 + 1) % cells;
  const iy1 = (iy0 + 1) % cells;

  const v00 = hash2(ix0, iy0, seed);
  const v10 = hash2(ix1, iy0, seed);
  const v01 = hash2(ix0, iy1, seed);
  const v11 = hash2(ix1, iy1, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** fBm with power-of-two cell sizes that divide SIZE → seamless. */
function fbm(px: number, py: number, seed: number, octaves: number, baseCell: number): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let cell = baseCell;
  for (let i = 0; i < octaves; i++) {
    // cell must divide SIZE for lattice wrap
    if (SIZE % cell !== 0) cell = largestDivisor(SIZE, cell);
    sum += valueNoise(px, py, cell, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    cell = Math.max(1, Math.floor(cell / 2));
  }
  return sum / norm;
}

function largestDivisor(n: number, prefer: number): number {
  for (let d = prefer; d >= 1; d--) if (n % d === 0) return d;
  return 1;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type RGB = [number, number, number];

function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.floor(lerp(a[0], b[0], t)),
    Math.floor(lerp(a[1], b[1], t)),
    Math.floor(lerp(a[2], b[2], t)),
  ];
}

// ─── Biome palettes (low / mid / high / accent) ────────

interface BiomeSpec {
  name: string;
  file: string;
  seed: number;
  low: RGB;
  mid: RGB;
  high: RGB;
  accent: RGB;
  accentAmt: number; // 0..1 chance-ish via noise
  grit: number;      // grain amplitude
  contrast: number;  // stretch fbm
}

const BIOMES: BiomeSpec[] = [
  {
    name: "sand",
    file: "terrain_sand.png",
    seed: 101,
    low: [168, 140, 96],
    mid: [196, 168, 118],
    high: [220, 196, 148],
    accent: [140, 118, 78], // darker grit / tiny pebbles
    accentAmt: 0.18,
    grit: 0.12,
    contrast: 1.15,
  },
  {
    name: "grass",
    file: "terrain_grass.png",
    seed: 202,
    low: [62, 78, 38],
    mid: [86, 110, 48],
    high: [110, 132, 58],
    accent: [92, 72, 42], // bare dirt patches
    accentAmt: 0.22,
    grit: 0.14,
    contrast: 1.2,
  },
  {
    name: "forest",
    file: "terrain_forest.png",
    seed: 303,
    low: [42, 48, 28],
    mid: [58, 68, 36],
    high: [78, 88, 48],
    accent: [72, 52, 28], // leaf litter brown
    accentAmt: 0.28,
    grit: 0.16,
    contrast: 1.25,
  },
  {
    name: "scrub",
    file: "terrain_scrub.png",
    seed: 404,
    low: [118, 102, 72],
    mid: [148, 128, 88],
    high: [168, 148, 108],
    accent: [96, 108, 72], // sparse dry green
    accentAmt: 0.2,
    grit: 0.15,
    contrast: 1.2,
  },
  {
    name: "stone",
    file: "terrain_stone.png",
    seed: 505,
    low: [72, 70, 66],
    mid: [108, 104, 98],
    high: [148, 142, 134],
    accent: [58, 56, 52], // cracks / dark grit
    accentAmt: 0.25,
    grit: 0.18,
    contrast: 1.35,
  },
];

// ─── Generate one seamless tile ───────────────────────

function generateTile(spec: BiomeSpec): Uint8ClampedArray {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Macro relief (large cells)
      let n = fbm(x, y, spec.seed, 5, 64);
      // Stretch contrast around mid
      n = clamp(0.5 + (n - 0.5) * spec.contrast, 0, 1);

      // Fine grain (cell=1 and 2 still divide 256)
      const grain = fbm(x, y, spec.seed + 99, 3, 8);
      const g = (grain - 0.5) * spec.grit;

      // Accent mask (pebbles / dirt / litter) — also seamless
      const accentN = fbm(x + 13, y + 7, spec.seed + 55, 4, 32);
      const accentMask = accentN > 1 - spec.accentAmt ? (accentN - (1 - spec.accentAmt)) / spec.accentAmt : 0;

      // Base color from low→mid→high
      let col: RGB;
      if (n < 0.5) col = mixRGB(spec.low, spec.mid, n * 2);
      else col = mixRGB(spec.mid, spec.high, (n - 0.5) * 2);

      // Mix accent
      if (accentMask > 0) col = mixRGB(col, spec.accent, clamp(accentMask * 0.85, 0, 1));

      // Apply grain
      col = [
        clamp(Math.floor(col[0] * (1 + g)), 0, 255),
        clamp(Math.floor(col[1] * (1 + g)), 0, 255),
        clamp(Math.floor(col[2] * (1 + g)), 0, 255),
      ];

      // Extra micro hash speckles (wrap-safe via pixel hash of toroidal x,y)
      const speck = hash2(x, y, spec.seed + 7);
      if (speck > 0.97) {
        const s = speck > 0.99 ? -18 : 12;
        col = [
          clamp(col[0] + s, 0, 255),
          clamp(col[1] + s, 0, 255),
          clamp(col[2] + s, 0, 255),
        ];
      }

      const i = (y * SIZE + x) * 4;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

/** Verify toroidal seam: left/right and top/bottom edge MSE. */
function seamError(px: Uint8ClampedArray): { lr: number; tb: number } {
  let lr = 0;
  let tb = 0;
  for (let y = 0; y < SIZE; y++) {
    const i0 = (y * SIZE + 0) * 4;
    const i1 = (y * SIZE + (SIZE - 1)) * 4;
    lr += Math.abs(px[i0] - px[i1]) + Math.abs(px[i0 + 1] - px[i1 + 1]) + Math.abs(px[i0 + 2] - px[i1 + 2]);
  }
  for (let x = 0; x < SIZE; x++) {
    const i0 = (0 * SIZE + x) * 4;
    const i1 = ((SIZE - 1) * SIZE + x) * 4;
    tb += Math.abs(px[i0] - px[i1]) + Math.abs(px[i0 + 1] - px[i1 + 1]) + Math.abs(px[i0 + 2] - px[i1 + 2]);
  }
  // Mean per channel
  return { lr: lr / (SIZE * 3), tb: tb / (SIZE * 3) };
}

// ─── Main ─────────────────────────────────────────────

console.log(`Generating ${SIZE}² seamless grit terrain tiles…`);
for (const spec of BIOMES) {
  const px = generateTile(spec);
  const err = seamError(px);
  const buf = encodePNG(SIZE, SIZE, px);
  const path = join(OUT, spec.file);
  writeFileSync(path, buf);
  console.log(`  ${spec.file}  seamΔ L/R=${err.lr.toFixed(2)} T/B=${err.tb.toFixed(2)}  (${buf.length} B)`);
}
console.log("Done.");
