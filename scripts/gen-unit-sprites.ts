/* eslint-disable no-console -- CLI generator */
// Pixel-art isometric unit sprite generator.
// Run: bun run scripts/gen-unit-sprites.ts
// Outputs transparent PNGs to assets/textures/units/
// Sprites are 48x48 with white base for faction tinting.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { encodePNG } from "./png-encode";

const OUT = join(import.meta.dir, "..", "assets", "textures", "units");
const W = 48;
const H = 48;

interface C { r: number; g: number; b: number; a: number; }

const CLEAR: C = { r: 0, g: 0, b: 0, a: 0 };
const WHITE: C = { r: 255, g: 255, b: 255, a: 255 };
const _LIGHT: C = { r: 220, g: 220, b: 220, a: 255 };
const DARK: C = { r: 160, g: 160, b: 160, a: 255 };
const SHADOW: C = { r: 100, g: 100, b: 100, a: 255 };
const METAL: C = { r: 180, g: 180, b: 190, a: 255 };
const SKIN: C = { r: 230, g: 190, b: 150, a: 255 };
const LEATHER: C = { r: 140, g: 100, b: 60, a: 255 };
const WOOD: C = { r: 120, g: 80, b: 40, a: 255 };

function px(d: Uint8ClampedArray, x: number, y: number, c: C) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = c.a;
}

function rect(d: Uint8ClampedArray, x: number, y: number, w: number, h: number, c: C) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(d, x + dx, y + dy, c);
}

function ellipse(d: Uint8ClampedArray, cx: number, cy: number, rx: number, ry: number, c: C) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) px(d, cx + x, cy + y, c);
  }
}

function line(d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, c: C) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (true) {
    px(d, x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function makeSprite(draw: (d: Uint8ClampedArray) => void): Buffer {
  const d = new Uint8ClampedArray(W * H * 4);
  draw(d);
  return encodePNG(W, H, d);
}

// ─── Unit Draw Functions ────────────────────────────────────

function drawPikesman(d: Uint8ClampedArray) {
  // Head with helmet
  ellipse(d, 24, 10, 5, 5, SKIN);
  rect(d, 19, 6, 10, 4, METAL); // helmet
  px(d, 20, 7, DARK); px(d, 28, 7, DARK); // helmet details
  // Body with armor
  rect(d, 19, 15, 10, 12, WHITE); // torso armor (faction-colored)
  rect(d, 20, 16, 8, 3, DARK); // chest plate detail
  // Legs
  rect(d, 20, 27, 3, 10, DARK); // left leg
  rect(d, 25, 27, 3, 10, DARK); // right leg
  // Boots
  rect(d, 19, 37, 5, 3, LEATHER);
  rect(d, 24, 37, 5, 3, LEATHER);
  // Pike (long spear)
  line(d, 12, 2, 12, 42, WOOD);
  px(d, 12, 1, METAL); px(d, 12, 0, METAL); // spear tip
  // Shield
  ellipse(d, 32, 22, 4, 6, WHITE);
  rect(d, 31, 20, 2, 4, DARK); // shield boss
}

function drawCavalry(d: Uint8ClampedArray) {
  // Horse body
  ellipse(d, 24, 30, 12, 6, DARK);
  rect(d, 14, 26, 20, 8, DARK);
  // Horse legs
  rect(d, 16, 36, 2, 8, SHADOW);
  rect(d, 20, 36, 2, 8, SHADOW);
  rect(d, 26, 36, 2, 8, SHADOW);
  rect(d, 30, 36, 2, 8, SHADOW);
  // Horse head
  ellipse(d, 36, 22, 4, 3, DARK);
  rect(d, 38, 20, 2, 4, SHADOW); // ear
  // Rider torso
  rect(d, 20, 14, 8, 10, WHITE); // armor
  rect(d, 21, 15, 6, 3, DARK); // chest plate
  // Rider head
  ellipse(d, 24, 8, 4, 4, SKIN);
  rect(d, 20, 4, 8, 4, METAL); // helmet
  // Spear
  line(d, 16, 2, 16, 26, WOOD);
  px(d, 16, 1, METAL);
  // Shield
  ellipse(d, 30, 18, 3, 5, WHITE);
}

function drawLegion(d: Uint8ClampedArray) {
  // Large warrior with tower shield
  // Head with crested helmet
  ellipse(d, 24, 10, 5, 5, SKIN);
  rect(d, 19, 4, 10, 6, METAL); // helmet
  rect(d, 22, 2, 4, 4, RED); // crest
  // Body with segmented armor
  rect(d, 18, 15, 12, 14, WHITE);
  rect(d, 19, 16, 10, 2, DARK);
  rect(d, 19, 20, 10, 2, DARK);
  rect(d, 19, 24, 10, 2, DARK);
  // Legs
  rect(d, 19, 29, 4, 10, DARK);
  rect(d, 25, 29, 4, 10, DARK);
  // Boots
  rect(d, 18, 39, 6, 3, LEATHER);
  rect(d, 24, 39, 6, 3, LEATHER);
  // Tower shield (large)
  rect(d, 8, 12, 8, 20, WHITE);
  rect(d, 9, 13, 6, 2, DARK); // shield pattern
  rect(d, 9, 17, 6, 2, DARK);
  rect(d, 9, 21, 6, 2, DARK);
  // Gladius (short sword)
  line(d, 34, 14, 38, 28, METAL);
  rect(d, 33, 13, 3, 2, LEATHER); // hilt
}

const RED: C = { r: 200, g: 50, b: 50, a: 255 };

function drawArcher(d: Uint8ClampedArray) {
  // Lean figure with bow
  // Head
  ellipse(d, 24, 10, 4, 4, SKIN);
  rect(d, 20, 6, 8, 4, LEATHER); // hood
  // Body
  rect(d, 20, 14, 8, 12, WHITE); // tunic
  rect(d, 21, 15, 6, 2, DARK); // belt
  // Legs
  rect(d, 21, 26, 3, 12, DARK);
  rect(d, 25, 26, 3, 12, DARK);
  // Boots
  rect(d, 20, 38, 5, 3, LEATHER);
  rect(d, 24, 38, 5, 3, LEATHER);
  // Bow
  line(d, 14, 8, 14, 36, WOOD);
  line(d, 14, 8, 14, 36, LEATHER); // string
  // Arrow
  line(d, 16, 18, 36, 18, WOOD);
  px(d, 37, 18, METAL); // arrowhead
  // Quiver on back
  rect(d, 28, 12, 4, 10, LEATHER);
  px(d, 29, 11, METAL); px(d, 30, 11, METAL); // arrow tips
}

function drawSlinger(d: Uint8ClampedArray) {
  // Light figure with sling
  // Head
  ellipse(d, 24, 12, 4, 4, SKIN);
  // Body (light cloth)
  rect(d, 20, 16, 8, 10, WHITE);
  // Legs (bare)
  rect(d, 21, 26, 3, 12, SKIN);
  rect(d, 25, 26, 3, 12, SKIN);
  // Sandals
  rect(d, 20, 38, 5, 2, LEATHER);
  rect(d, 24, 38, 5, 2, LEATHER);
  // Sling
  line(d, 14, 16, 14, 30, LEATHER);
  ellipse(d, 14, 30, 3, 2, LEATHER); // pouch
  // Stone
  ellipse(d, 14, 30, 2, 2, SHADOW);
}

function drawAxeman(d: Uint8ClampedArray) {
  // Muscular figure with large axe
  // Head
  ellipse(d, 24, 10, 5, 5, SKIN);
  rect(d, 19, 6, 10, 4, LEATHER); // headband
  // Body (bare chest with leather harness)
  rect(d, 18, 15, 12, 14, SKIN);
  rect(d, 18, 15, 12, 3, LEATHER); // harness
  rect(d, 22, 15, 4, 14, LEATHER); // center strap
  // Legs
  rect(d, 19, 29, 4, 10, DARK);
  rect(d, 25, 29, 4, 10, DARK);
  // Boots
  rect(d, 18, 39, 6, 3, LEATHER);
  rect(d, 24, 39, 6, 3, LEATHER);
  // Large axe
  line(d, 34, 6, 34, 40, WOOD); // handle
  rect(d, 30, 4, 8, 8, METAL); // axe head
  rect(d, 31, 5, 6, 6, DARK); // axe edge
}

function drawHoplite(d: Uint8ClampedArray) {
  // Elite spearman with round shield
  // Head with Corinthian helmet
  ellipse(d, 24, 10, 5, 5, SKIN);
  rect(d, 18, 4, 12, 8, METAL); // helmet
  rect(d, 20, 6, 2, 4, CLEAR); // eye slit
  rect(d, 26, 6, 2, 4, CLEAR); // eye slit
  // Body with bronze armor
  rect(d, 18, 14, 12, 14, METAL); // bronze cuirass
  rect(d, 19, 15, 10, 3, DARK); // pectoral detail
  // Legs with greaves
  rect(d, 19, 28, 4, 10, METAL); // greave
  rect(d, 25, 28, 4, 10, METAL); // greave
  // Boots
  rect(d, 18, 38, 6, 3, LEATHER);
  rect(d, 24, 38, 6, 3, LEATHER);
  // Spear
  line(d, 12, 2, 12, 42, WOOD);
  px(d, 12, 1, METAL); px(d, 12, 0, METAL);
  // Round shield (aspis)
  ellipse(d, 32, 22, 6, 6, WHITE);
  ellipse(d, 32, 22, 4, 4, METAL); // shield rim
  ellipse(d, 32, 22, 2, 2, DARK); // boss
}

function drawChariot(d: Uint8ClampedArray) {
  // Chariot with archer
  // Chariot body
  rect(d, 10, 24, 28, 14, WOOD);
  rect(d, 11, 25, 26, 2, DARK); // rim detail
  // Wheels
  ellipse(d, 14, 38, 5, 5, WOOD);
  ellipse(d, 14, 38, 3, 3, DARK);
  ellipse(d, 34, 38, 5, 5, WOOD);
  ellipse(d, 34, 38, 3, 3, DARK);
  // Horse (front)
  ellipse(d, 6, 20, 6, 4, DARK);
  rect(d, 2, 16, 8, 8, DARK);
  // Archer in chariot
  ellipse(d, 24, 12, 4, 4, SKIN);
  rect(d, 20, 16, 8, 8, WHITE); // tunic
  // Bow
  line(d, 30, 10, 30, 24, WOOD);
  line(d, 30, 10, 40, 17, WOOD); // arrow
  px(d, 41, 17, METAL); // arrowhead
}

function drawRam(d: Uint8ClampedArray) {
  // Battering ram — covered siege engine
  // Roof (wicker/wood covering)
  rect(d, 6, 10, 36, 12, WOOD);
  rect(d, 7, 11, 34, 2, DARK); // roof detail
  rect(d, 7, 15, 34, 2, DARK);
  // Side walls
  rect(d, 6, 22, 4, 16, WOOD);
  rect(d, 38, 22, 4, 16, WOOD);
  // Ram beam
  rect(d, 2, 20, 44, 4, DARK);
  // Ram head (iron-tipped)
  rect(d, 0, 18, 6, 8, METAL);
  rect(d, 0, 20, 2, 4, DARK); // tip
  // Wheels
  ellipse(d, 12, 40, 4, 4, WOOD);
  ellipse(d, 12, 40, 2, 2, DARK);
  ellipse(d, 36, 40, 4, 4, WOOD);
  ellipse(d, 36, 40, 2, 2, DARK);
}

function drawVillager(d: Uint8ClampedArray) {
  // Simple peasant figure
  // Head
  ellipse(d, 24, 12, 4, 4, SKIN);
  // Body (simple cloth)
  rect(d, 20, 16, 8, 12, WHITE);
  rect(d, 21, 17, 6, 2, DARK); // belt
  // Legs
  rect(d, 21, 28, 3, 10, DARK);
  rect(d, 25, 28, 3, 10, DARK);
  // Sandals
  rect(d, 20, 38, 5, 2, LEATHER);
  rect(d, 24, 38, 5, 2, LEATHER);
  // Tool (pickaxe)
  line(d, 32, 10, 32, 36, WOOD);
  rect(d, 29, 8, 7, 4, METAL); // pickaxe head
}

// ─── Generate all ────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
console.log("Generating unit sprites...");

const sprites: [string, (d: Uint8ClampedArray) => void][] = [
  ["pikesman.png", drawPikesman],
  ["cavalry.png", drawCavalry],
  ["legion.png", drawLegion],
  ["archer.png", drawArcher],
  ["slinger.png", drawSlinger],
  ["axeman.png", drawAxeman],
  ["hoplite.png", drawHoplite],
  ["chariot.png", drawChariot],
  ["ram.png", drawRam],
  ["villager.png", drawVillager],
];

for (const [name, fn] of sprites) {
  writeFileSync(join(OUT, name), makeSprite(fn));
  console.log(`  ${name} ✓`);
}

console.log("Done.");
