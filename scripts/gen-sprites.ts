/* eslint-disable no-console -- CLI generator */
// Pixel-art isometric building sprite generator.
// Run: bun run scripts/gen-sprites.ts
// Outputs transparent PNGs to assets/textures/

import { writeFileSync } from "fs";
import { join } from "path";
import { encodePNG } from "./png-encode";

const OUT = join(import.meta.dir, "..", "assets", "textures");
const W = 128;
const H = 128;

interface C {
  r: number;
  g: number;
  b: number;
}

function hex(h: string): C {
  const v = parseInt(h.replace("#", ""), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function dim(c: C, f: number): C {
  return { r: Math.floor(c.r * f), g: Math.floor(c.g * f), b: Math.floor(c.b * f) };
}

function bright(c: C, f: number): C {
  return {
    r: Math.min(255, Math.floor(c.r + (255 - c.r) * f)),
    g: Math.min(255, Math.floor(c.g + (255 - c.g) * f)),
    b: Math.min(255, Math.floor(c.b + (255 - c.b) * f)),
  };
}

// ─── Block drawing helpers ────────────────────────────

function fill(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  ox: number,
  oy: number,
  bw: number,
  bh: number,
  c: C,
  shade?: { ox: number; oy: number; c: C }
) {
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      if (d[i + 3] !== 0) {
        // blend
        const a = 0.5;
        d[i] = Math.floor(d[i] * (1 - a) + c.r * a);
        d[i + 1] = Math.floor(d[i + 1] * (1 - a) + c.g * a);
        d[i + 2] = Math.floor(d[i + 2] * (1 - a) + c.b * a);
      } else {
        d[i] = c.r;
        d[i + 1] = c.g;
        d[i + 2] = c.b;
        d[i + 3] = 255;
      }
    }
  }
  if (shade) {
    fill(d, w, h, shade.ox, shade.oy, bw, bh, shade.c);
  }
}

// ─── Buildings ────────────────────────────────────────

function makeSprite(draw: (d: Uint8ClampedArray, w: number, h: number) => void): Buffer {
  const pixels = new Uint8ClampedArray(W * H * 4);
  // fill transparent
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  draw(pixels, W, H);
  return Buffer.from(encodePNG(W, H, pixels));
}

// ─── BARRACKS ────────────────────────────────────────
// Pitched red roof on wood walls, a side training yard
function drawBarracks(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#9B7653");
  const wallLight = bright(wall, 0.15);
  const roof = hex("#B83030");
  const roofLight = bright(roof, 0.2);
  const roofDark = dim(roof, 0.6);
  const trim = hex("#C89550");
  const floor = hex("#B8944A");

  // Base platform
  fill(d, w, h, 24, 80, 80, 12, floor);
  fill(d, w, h, 22, 86, 84, 4, dim(floor, 0.5));

  // Back wall (left side in iso)
  fill(d, w, h, 28, 48, 16, 36, wall);
  fill(d, w, h, 28, 48, 16, 36, dim(wall, 0.7), { ox: 32, oy: 48, c: wallLight });

  // Front wall (right side in iso)
  fill(d, w, h, 44, 48, 16, 36, wall);
  fill(d, w, h, 44, 48, 16, 36, dim(wall, 0.7), { ox: 48, oy: 48, c: wallLight });

  // Front face wall
  fill(d, w, h, 60, 48, 28, 36, wall);
  // Windows on front face
  fill(d, w, h, 66, 56, 8, 8, hex("#1a1a2e"));
  fill(d, w, h, 74, 56, 8, 8, hex("#1a1a2e"));
  // Door
  fill(d, w, h, 70, 64, 10, 16, hex("#4A2F1A"));

  // Roof slope left (pitched roof ridge)
  // Combined roof shape
  // Roof top ridge
  for (let y = 0; y < 24; y++) {
    const rowW = Math.floor(28 + (y / 24) * 40);
    const startX = 44 - Math.floor((y / 24) * 20);
    const isDark = y > 12;
    const c = isDark ? roofDark : (y < 6 ? roofLight : roof);
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 22 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      if (px < startX + 6 || px > startX + rowW - 6) {
        // edge darker trim
        d[i] = roofDark.r; d[i + 1] = roofDark.g; d[i + 2] = roofDark.b;
      } else {
        d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b;
      }
      d[i + 3] = 255;
    }
  }

  // Training yard (to the right, empty ground with fence)
  fill(d, w, h, 88, 60, 28, 30, floor);
  fill(d, w, h, 86, 88, 32, 6, dim(floor, 0.4));

  // Fence posts
  const fence = hex("#6B4226");
  fill(d, w, h, 88, 58, 4, 30, fence);
  fill(d, w, h, 100, 58, 4, 30, fence);
  fill(d, w, h, 112, 58, 4, 30, fence);
  // Fence rails (horizontal)
  fill(d, w, h, 88, 64, 28, 2, dim(fence, 1.2));
  fill(d, w, h, 88, 72, 28, 2, dim(fence, 1.2));

  // Shadow under roof
  fill(d, w, h, 28, 48, 64, 4, dim(roof, 0.3));

  // Roof trim
  fill(d, w, h, 28, 44, 64, 4, trim);

  // Training dummy (pole + target)
  fill(d, w, h, 94, 62, 3, 22, hex("#8B6F4E"));
  fill(d, w, h, 96, 74, 8, 10, hex("#D4A060"), { ox: 97, oy: 76, c: hex("#E8C880") });
}

// ─── TOWN CENTER (distinct from current townhall) ─────
// Larger: columned structure with decorative roof
function drawTownCenter(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#8B7355");
  const wallLight = bright(wall, 0.2);
  const roof = hex("#C84040");
  const roofLight = bright(roof, 0.25);
  const roofDark = dim(roof, 0.5);
  const column = hex("#D4C5A9");
  const floor = hex("#B8944A");
  const banner = hex("#2563EB");
  const bannerDark = dim(banner, 0.6);

  // Large platform
  fill(d, w, h, 8, 72, 112, 16, floor);
  fill(d, w, h, 6, 84, 116, 8, dim(floor, 0.5));

  // Main building body
  fill(d, w, h, 20, 36, 32, 40, wall);
  fill(d, w, h, 56, 36, 32, 40, wall);
  fill(d, w, h, 20, 36, 68, 40, dim(wall, 0.75), { ox: 24, oy: 36, c: wallLight });

  // Columns
  fill(d, w, h, 20, 36, 6, 40, column);
  fill(d, w, h, 40, 36, 6, 40, column);
  fill(d, w, h, 60, 36, 6, 40, column);
  fill(d, w, h, 80, 36, 6, 40, column);

  // Banner (faction colors)
  fill(d, w, h, 40, 38, 8, 14, banner);
  fill(d, w, h, 60, 38, 8, 14, bannerDark);

  // Grand roof
  for (let y = 0; y < 28; y++) {
    const rowW = Math.floor(40 + (y / 28) * 48);
    const startX = 36 - Math.floor((y / 28) * 24);
    const c = y < 8 ? roofLight : (y > 18 ? roofDark : roof);
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 6 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  // Decorative ridge
  fill(d, w, h, 36, 4, 56, 4, roofLight);

  // Shadow
  fill(d, w, h, 20, 36, 68, 6, dim(roof, 0.35));

  // Entrance
  fill(d, w, h, 46, 50, 16, 22, hex("#4A2F1A"));
}

// ─── HOUSE (replacement for existing) ────────────────
function drawHouse(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#C4A76C");
  const wallLight = bright(wall, 0.1);
  const roof = hex("#8B4513");
  const roofLight = bright(roof, 0.2);
  const roofDark = dim(roof, 0.6);
  const door = hex("#5C3A1E");
  const floor = hex("#B8944A");

  fill(d, w, h, 28, 74, 72, 10, floor);
  fill(d, w, h, 26, 80, 76, 6, dim(floor, 0.5));

  // Walls
  fill(d, w, h, 32, 44, 64, 32, wall);
  fill(d, w, h, 32, 44, 64, 32, dim(wall, 0.8), { ox: 36, oy: 44, c: wallLight });

  // Windows
  fill(d, w, h, 40, 52, 10, 10, hex("#1a1a2e"));
  fill(d, w, h, 78, 52, 10, 10, hex("#1a1a2e"));

  // Door
  fill(d, w, h, 58, 54, 12, 22, door);

  // Roof
  for (let y = 0; y < 24; y++) {
    const rowW = Math.floor(30 + (y / 24) * 44);
    const startX = 44 - Math.floor((y / 24) * 20);
    const c = y < 8 ? roofLight : (y > 14 ? roofDark : roof);
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 22 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  fill(d, w, h, 32, 44, 64, 4, dim(roof, 0.3));
}

// ─── LUMBER CAMP ─────────────────────────────────────
function drawLumberCamp(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#7A5A3E");
  const roof = hex("#5A8A3C");
  const roofLight = bright(roof, 0.25);
  const roofDark = dim(roof, 0.5);
  const floor = hex("#B8944A");
  const log = hex("#8B6F4E");
  const logEnd = hex("#C4A76C");

  fill(d, w, h, 20, 70, 88, 12, floor);
  fill(d, w, h, 18, 78, 92, 6, dim(floor, 0.5));

  // Open shed walls (3 sides)
  fill(d, w, h, 24, 36, 14, 38, wall);
  fill(d, w, h, 68, 36, 14, 38, wall);
  fill(d, w, h, 38, 36, 30, 8, wall);
  fill(d, w, h, 38, 66, 30, 8, wall);

  // Open front - log piles visible inside
  fill(d, w, h, 42, 50, 22, 14, logEnd);
  for (let i = 0; i < 3; i++) {
    const lx = 40 + i * 8;
    fill(d, w, h, lx, 44, 6, 4, log);
  }

  // Roof (green - forest building)
  for (let y = 0; y < 22; y++) {
    const rowW = Math.floor(34 + (y / 22) * 48);
    const startX = 36 - Math.floor((y / 22) * 22);
    const c = y < 6 ? roofLight : (y > 14 ? roofDark : roof);
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 14 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  // Shadow
  fill(d, w, h, 24, 36, 58, 4, dim(roof, 0.3));

  // Saw dust pile nearby
  fill(d, w, h, 72, 56, 16, 8, hex("#D4C080"), { ox: 74, oy: 58, c: hex("#DEC890") });
}

// ─── HUNTER'S LODGE ─────────────────────────────────
function drawLodge(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#6B4423");
  const wallLight = bright(wall, 0.15);
  const roof = hex("#2D5A27");
  const roofLight = bright(roof, 0.2);
  const roofDark = dim(roof, 0.5);
  const floor = hex("#B8944A");
  const trophy = hex("#D4C080");

  fill(d, w, h, 40, 74, 48, 10, floor);
  fill(d, w, h, 38, 80, 52, 6, dim(floor, 0.5));

  // Walls
  fill(d, w, h, 42, 40, 44, 36, wall);
  fill(d, w, h, 42, 40, 44, 36, dim(wall, 0.8), { ox: 46, oy: 40, c: wallLight });

  // Door
  fill(d, w, h, 60, 52, 10, 24, hex("#3A1F0E"));

  // Window
  fill(d, w, h, 46, 48, 8, 8, hex("#1a1a2e"));

  // Trophy antlers over door
  fill(d, w, h, 60, 44, 4, 8, trophy);
  fill(d, w, h, 56, 44, 2, 6, dim(trophy, 0.7));
  fill(d, w, h, 66, 44, 2, 6, dim(trophy, 0.7));

  // Roof - steep A-frame
  for (let y = 0; y < 22; y++) {
    const rowW = Math.floor(20 + (y / 22) * 38);
    const startX = 50 - Math.floor((y / 22) * 18);
    const c = y < 6 ? roofLight : (y > 14 ? roofDark : roof);
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 18 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  fill(d, w, h, 42, 40, 44, 4, dim(roof, 0.3));
}

// ─── FARM ────────────────────────────────────────────
function drawFarm(d: Uint8ClampedArray, w: number, h: number) {
  const wall = hex("#B8944A");
  const roof = hex("#C84040");
  const roofDark = dim(roof, 0.5);
  const floor = hex("#8B7355");

  fill(d, w, h, 32, 78, 64, 10, floor);
  fill(d, w, h, 30, 84, 68, 6, dim(floor, 0.5));

  // Open barn
  fill(d, w, h, 36, 42, 10, 36, wall);
  fill(d, w, h, 80, 42, 10, 36, wall);
  fill(d, w, h, 36, 42, 54, 6, wall);

  // Hay inside
  fill(d, w, h, 48, 52, 30, 14, hex("#E8C840"), { ox: 50, oy: 54, c: hex("#F0D860") });

  // Roof
  for (let y = 0; y < 24; y++) {
    const rowW = Math.floor(24 + (y / 24) * 42);
    const startX = 48 - Math.floor((y / 24) * 20);
    const c = y > 14 ? roofDark : roof;
    for (let x = 0; x < rowW; x++) {
      const px = startX + x;
      const py = 18 + y;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const i = (py * w + px) * 4;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
    }
  }

  fill(d, w, h, 36, 42, 54, 4, dim(roof, 0.3));

  // Wheat field patches around
  fill(d, w, h, 20, 68, 14, 16, hex("#C8A830"));
  fill(d, w, h, 44, 66, 12, 12, hex("#B89828"));
  fill(d, w, h, 74, 68, 12, 16, hex("#C8A830"), { ox: 76, oy: 70, c: hex("#B89828") });
}

// ─── Generate all ─────────────────────────────────────
console.log("Generating building sprites...");

writeFileSync(join(OUT, "barracks.png"), makeSprite(drawBarracks));
console.log("  barracks.png ✓ (replacement)");

writeFileSync(join(OUT, "towncenter.png"), makeSprite(drawTownCenter));
console.log("  towncenter.png ✓");

writeFileSync(join(OUT, "house.png"), makeSprite(drawHouse));
console.log("  house.png ✓ (replacement)");

writeFileSync(join(OUT, "lumber.png"), makeSprite(drawLumberCamp));
console.log("  lumber.png ✓ (replacement)");

writeFileSync(join(OUT, "lodge.png"), makeSprite(drawLodge));
console.log("  lodge.png ✓ (replacement)");

writeFileSync(join(OUT, "field.png"), makeSprite(drawFarm));
console.log("  field.png ✓ (replacement)");

console.log("Done.");
