/* eslint-disable no-console -- CLI generator */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { encodePNG } from "./png-encode.ts";
import { readPngDimensions, type SpriteManifestEntry, DEFAULT_GENERATED_DIR } from "./build-sprite-manifest.ts";

export interface ContactSheet {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONTACT_SHEET_DIR = join(moduleDirectory, "..", "assets", "textures", "generated");

const SHEET_BACKGROUND: RGBA = [30, 32, 36, 255];
const SHEET_GRID: RGBA = [55, 60, 70, 255];
const LABEL_COLOR: RGBA = [220, 225, 230, 255];
const TITLE_COLOR: RGBA = [255, 240, 200, 255];
const SCALE_COLOR: RGBA = [180, 185, 190, 255];
const MARGIN = 32;
const CELL = 96;
const IMAGE_SIZE = 32;
const LABEL_HEIGHT = 24;
const HEADER = 80;
const FOOTER = 96;

export function buildContactSheet(generatedDirectory = DEFAULT_GENERATED_DIR): ContactSheet {
  const manifest = readManifest(generatedDirectory);
  const entries = manifest.assets.length ? manifest.assets : collectPngEntries(generatedDirectory);
  if (entries.length === 0) throw new Error(`No generated PNGs found in ${generatedDirectory}.`);
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length * (CELL / (CELL + LABEL_HEIGHT)))));
  const rows = Math.ceil(entries.length / columns);
  const width = MARGIN * 2 + columns * CELL;
  const height = HEADER + rows * (CELL + LABEL_HEIGHT) + FOOTER;
  const pixels = new Uint8ClampedArray(width * height * 4);
  fillRect(pixels, width, height, 0, 0, width, height, SHEET_BACKGROUND, 255);

  drawText(pixels, width, height, MARGIN, MARGIN - 10, "Prop Family Contact Sheet", 2, TITLE_COLOR);
  drawText(pixels, width, height, MARGIN, MARGIN + 18, `${entries.length} variants  |  ${columns}x${rows} grid  |  seed 0x517a9d31`, 1, LABEL_COLOR);
  drawGrid(pixels, width, height, rows, columns);

  const decoded = new Map<string, ImageBuffer>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = MARGIN + column * CELL;
    const cellY = HEADER + row * (CELL + LABEL_HEIGHT);
    const centerX = cellX + CELL / 2;
    const centerY = cellY + (CELL - IMAGE_SIZE) / 2;
    const image = getImage(decoded, generatedDirectory, entry);
    blitNearest(pixels, width, height, centerX - IMAGE_SIZE / 2, centerY, image, image.width, image.height, IMAGE_SIZE, IMAGE_SIZE);
    drawText(pixels, width, height, cellX + 4, cellY + CELL + 6, entry.key, 1, LABEL_COLOR);
    if (entry.atlas) {
      drawText(pixels, width, height, cellX + 4, cellY + CELL + 18, `${entry.width}x${entry.height}`, 1, LABEL_COLOR);
    }
  }

  drawPaletteStrip(pixels, width, height, MARGIN, height - 68);
  drawScaleRuler(pixels, width, height, MARGIN, height - 34);

  return { width, height, pixels };
}

export function writeContactSheet(generatedDirectory = DEFAULT_CONTACT_SHEET_DIR): string {
  const outDir = resolve(generatedDirectory);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const { width, height, pixels } = buildContactSheet(outDir);
  const path = join(outDir, "contact-sheet.png");
  writeFileSync(path, Buffer.from(encodePNG(width, height, pixels)));
  console.log(`Generated contact sheet ${path} (${width}x${height}).`);
  return path;
}

function readManifest(generatedDirectory: string): { assets: readonly SpriteManifestEntry[] } {
  const manifestPath = join(generatedDirectory, "manifest.json");
  if (!existsSync(manifestPath)) return { assets: [] };
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { assets?: unknown };
  if (!parsed.assets || !Array.isArray(parsed.assets)) return { assets: [] };
  return { assets: parsed.assets.filter(isManifestEntry) };
}

function isManifestEntry(value: unknown): value is SpriteManifestEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.sourceDefinition === "string" &&
    typeof candidate.seed === "number" &&
    Array.isArray(candidate.tags)
  );
}

function collectPngEntries(generatedDirectory: string): SpriteManifestEntry[] {
  if (!existsSync(generatedDirectory)) return [];
  return readdirSync(generatedDirectory)
    .filter((name) => extname(name).toLowerCase() === ".png" && name !== "contact-sheet.png")
    .map((name) => {
      const fileBuffer = readFileSync(join(generatedDirectory, name));
      const dimensions = readPngDimensions(fileBuffer);
      return {
        key: name.replace(/\.png$/i, ""),
        source: name,
        width: dimensions.width,
        height: dimensions.height,
        sourceDefinition: `generated/${name.replace(/\.png$/i, "")}`,
        seed: 0,
        tags: [],
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

interface ImageBuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

function getImage(cache: Map<string, ImageBuffer>, generatedDirectory: string, entry: SpriteManifestEntry): ImageBuffer {
  const decoded = cache.get(entry.source) ?? decodePng(readFileSync(join(generatedDirectory, entry.source)));
  cache.set(entry.source, decoded);
  if (!entry.atlas) return decoded;
  const pixels = new Uint8ClampedArray(entry.width * entry.height * 4);
  for (let row = 0; row < entry.height; row += 1) {
    const sourceStart = ((entry.atlas.y + row) * decoded.width + entry.atlas.x) * 4;
    pixels.set(decoded.pixels.subarray(sourceStart, sourceStart + entry.width * 4), row * entry.width * 4);
  }
  return { width: entry.width, height: entry.height, pixels };
}

function drawGrid(pixels: Uint8ClampedArray, width: number, height: number, rows: number, columns: number): void {
  for (let row = 0; row <= rows; row += 1) {
    const y = HEADER + row * (CELL + LABEL_HEIGHT);
    drawLine(pixels, width, height, MARGIN, y, MARGIN + columns * CELL, y, SHEET_GRID);
    if (row < rows) {
      const labelY = y + CELL;
      drawLine(pixels, width, height, MARGIN, labelY, MARGIN + columns * CELL, labelY, SHEET_GRID);
    }
  }
  for (let col = 0; col <= columns; col += 1) {
    const x = MARGIN + col * CELL;
    drawLine(pixels, width, height, x, HEADER, x, HEADER + rows * (CELL + LABEL_HEIGHT), SHEET_GRID);
  }
}

function drawPaletteStrip(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): void {
  const palette: RGBA[] = [
    [117, 69, 43, 255],
    [169, 106, 63, 255],
    [208, 149, 93, 255],
    [162, 147, 104, 255],
    [115, 153, 63, 255],
    [168, 196, 93, 255],
    [220, 232, 160, 255],
  ];
  drawText(pixels, width, height, x, y - 18, "Palette", 1, LABEL_COLOR);
  for (let index = 0; index < palette.length; index += 1) {
    fillRect(pixels, width, height, x + index * 28, y, 24, 16, palette[index] as RGBA, 255);
    drawRect(pixels, width, height, x + index * 28, y, 24, 16, [255, 255, 255, 60], 1);
  }
}

function drawScaleRuler(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): void {
  const length = 100;
  drawLine(pixels, width, height, x, y, x + length, y, SCALE_COLOR);
  drawLine(pixels, width, height, x, y - 5, x, y + 5, SCALE_COLOR);
  drawLine(pixels, width, height, x + length, y - 5, x + length, y + 5, SCALE_COLOR);
  drawText(pixels, width, height, x, y + 8, "0", 1, SCALE_COLOR);
  drawText(pixels, width, height, x + length - 12, y + 8, `${length}px`, 1, SCALE_COLOR);
}

// ── Minimal PNG decode (BTYPE=0 stored deflate, all standard PNG filters) ──

function decodePng(png: Uint8Array): ImageBuffer {
  if (png.length < 24 || !isPngSignature(png)) throw new Error("Invalid PNG signature.");
  const chunks = readPngChunks(png);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "IHDR") {
      width = readUint32(chunk.data, 0);
      height = readUint32(chunk.data, 4);
    } else if (chunk.type === "IDAT") {
      idat.push(chunk.data);
    }
  }
  const compressed = concatBuffers(idat);
  const decompressed = inflateStored(compressed);
  const pixels = unfilterPng(width, height, decompressed);
  return { width, height, pixels };
}

function isPngSignature(data: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) if (data[index] !== signature[index]) return false;
  return true;
}

function readUint32(data: Uint8Array, offset: number): number {
  return data[offset] * 0x1000000 + data[offset + 1] * 0x10000 + data[offset + 2] * 0x100 + data[offset + 3];
}

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function readPngChunks(data: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < data.length) {
    const length = readUint32(data, offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    chunks.push({ type, data: data.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const buffer of buffers) total += buffer.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  return result;
}

function inflateStored(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error("Zlib data too short.");
  let pos = 2;
  const output: number[] = [];
  while (pos < data.length - 4) {
    const blockType = data[pos++];
    const bfinal = blockType & 1;
    const btype = (blockType >> 1) & 3;
    if (btype !== 0) throw new Error("Only stored deflate blocks are supported.");
    const len = data[pos] | (data[pos + 1] << 8);
    const nlen = data[pos + 2] | (data[pos + 3] << 8);
    pos += 4;
    if ((len ^ nlen) !== 0xffff) throw new Error("Invalid stored block length.");
    for (let index = 0; index < len; index += 1) output.push(data[pos + index]);
    pos += len;
    if (bfinal) break;
  }
  return new Uint8Array(output);
}

function unfilterPng(width: number, height: number, data: Uint8Array): Uint8ClampedArray {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rowLength = stride + 1;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let previousRow = new Uint8Array(stride);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowLength;
    const filter = data[offset];
    const current = data.subarray(offset + 1, offset + 1 + stride);
    const out = pixels.subarray(row * stride, (row + 1) * stride);
    switch (filter) {
      case 0:
        out.set(current);
        break;
      case 1:
        for (let index = 0; index < stride; index += 1) {
          const left = index >= bytesPerPixel ? out[index - bytesPerPixel] : 0;
          out[index] = (current[index] + left) & 255;
        }
        break;
      case 2:
        for (let index = 0; index < stride; index += 1) out[index] = (current[index] + previousRow[index]) & 255;
        break;
      case 3:
        for (let index = 0; index < stride; index += 1) {
          const left = index >= bytesPerPixel ? out[index - bytesPerPixel] : 0;
          out[index] = (current[index] + Math.floor((left + previousRow[index]) / 2)) & 255;
        }
        break;
      case 4:
        for (let index = 0; index < stride; index += 1) {
          const left = index >= bytesPerPixel ? out[index - bytesPerPixel] : 0;
          const up = previousRow[index];
          const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
          out[index] = (current[index] + paethPredictor(left, up, upLeft)) & 255;
        }
        break;
      default:
        throw new Error(`Unsupported PNG filter ${filter}.`);
    }
    previousRow = new Uint8Array(out);
  }
  return pixels;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpLeft = Math.abs(prediction - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

// ── Pixel drawing helpers ──

type RGBA = readonly [number, number, number, number];

function fillRect(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: RGBA, alpha: number): void {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let col = x; col < x + rectWidth; col += 1) {
      paint(pixels, width, height, col, row, color, alpha);
    }
  }
}

function drawRect(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, rectWidth: number, rectHeight: number, color: RGBA, thickness: number): void {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let col = x; col < x + rectWidth; col += 1) {
      if (col < x + thickness || col >= x + rectWidth - thickness || row < y + thickness || row >= y + rectHeight - thickness) {
        paint(pixels, width, height, col, row, color, 255);
      }
    }
  }
}

function drawLine(pixels: Uint8ClampedArray, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: RGBA): void {
  let x = x1;
  let y = y1;
  const deltaX = Math.abs(x2 - x1);
  const deltaY = Math.abs(y2 - y1);
  const stepX = x1 < x2 ? 1 : -1;
  const stepY = y1 < y2 ? 1 : -1;
  let error = deltaX - deltaY;
  while (true) {
    paint(pixels, width, height, x, y, color, 255);
    if (x === x2 && y === y2) break;
    const twiceError = 2 * error;
    if (twiceError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (twiceError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function paint(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, color: RGBA, alpha: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
  const index = (y * width + x) * 4;
  if (alpha >= 255 && color[3] === 255) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = color[3];
    return;
  }
  const sourceAlpha = (alpha / 255) * (color[3] / 255);
  const existingAlpha = pixels[index + 3] / 255;
  const outputAlpha = sourceAlpha + existingAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  pixels[index] = Math.round((color[0] * sourceAlpha + pixels[index] * existingAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 1] = Math.round((color[1] * sourceAlpha + pixels[index + 1] * existingAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 2] = Math.round((color[2] * sourceAlpha + pixels[index + 2] * existingAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 3] = Math.round(outputAlpha * 255);
}

function blitNearest(
  dest: Uint8ClampedArray,
  destWidth: number,
  destHeight: number,
  x: number,
  y: number,
  src: ImageBuffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): void {
  for (let row = 0; row < targetHeight; row += 1) {
    for (let col = 0; col < targetWidth; col += 1) {
      const sourceX = Math.floor((col * srcWidth) / targetWidth);
      const sourceY = Math.floor((row * srcHeight) / targetHeight);
      const sourceIndex = (sourceY * srcWidth + sourceX) * 4;
      const alpha = src.pixels[sourceIndex + 3] / 255;
      if (alpha <= 0) continue;
      const dx = Math.round(x + col);
      const dy = Math.round(y + row);
      if (dx < 0 || dy < 0 || dx >= destWidth || dy >= destHeight) continue;
      const destinationIndex = (dy * destWidth + dx) * 4;
      if (alpha >= 1) {
        dest.set(src.pixels.subarray(sourceIndex, sourceIndex + 4), destinationIndex);
        continue;
      }
      const existingAlpha = dest[destinationIndex + 3] / 255;
      const outputAlpha = alpha + existingAlpha * (1 - alpha);
      dest[destinationIndex] = Math.round((src.pixels[sourceIndex] * alpha + dest[destinationIndex] * existingAlpha * (1 - alpha)) / outputAlpha);
      dest[destinationIndex + 1] = Math.round((src.pixels[sourceIndex + 1] * alpha + dest[destinationIndex + 1] * existingAlpha * (1 - alpha)) / outputAlpha);
      dest[destinationIndex + 2] = Math.round((src.pixels[sourceIndex + 2] * alpha + dest[destinationIndex + 2] * existingAlpha * (1 - alpha)) / outputAlpha);
      dest[destinationIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
}

// ── 5x7 pixel font (subset covering printable ASCII) ──

const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT: Record<string, number> = {
  " ": 0x00,
  "!": 0x2f,
  '"': 0x06,
  "#": 0x7f,
  "$": 0x6d,
  "%": 0x72,
  "&": 0x77,
  "'": 0x08,
  "(": 0x3e,
  ")": 0x7c,
  "*": 0x55,
  "+": 0x14,
  ",": 0xc0,
  "-": 0x10,
  ".": 0x80,
  "/": 0x24,
  "0": 0x7e,
  "1": 0x48,
  "2": 0x6d,
  "3": 0x7d,
  "4": 0x37,
  "5": 0x6d,
  "6": 0x7f,
  "7": 0x71,
  "8": 0x7f,
  "9": 0x7d,
  ":": 0x14,
  ";": 0x94,
  "<": 0x46,
  "=": 0x14,
  ">": 0x62,
  "?": 0x63,
  "@": 0x7b,
  "A": 0x77,
  "B": 0x7f,
  "C": 0x4e,
  "D": 0x7e,
  "E": 0x4f,
  "F": 0x47,
  "G": 0x5e,
  "H": 0x37,
  "I": 0x49,
  "J": 0x78,
  "K": 0x57,
  "L": 0x0e,
  "M": 0x76,
  "N": 0x37,
  "O": 0x7e,
  "P": 0x67,
  "Q": 0x7e,
  "R": 0x67,
  "S": 0x5b,
  "T": 0x49,
  "U": 0x3e,
  "V": 0x36,
  "W": 0x36,
  "X": 0x55,
  "Y": 0x55,
  "Z": 0x6d,
  "[": 0x4e,
  "\\": 0x42,
  "]": 0x78,
  "^": 0x22,
  "_": 0x08,
  "`": 0x02,
  "a": 0x7d,
  "b": 0x0f,
  "c": 0x0d,
  "d": 0x3d,
  "e": 0x6d,
  "f": 0x47,
  "g": 0x5d,
  "h": 0x17,
  "i": 0x20,
  "j": 0x78,
  "k": 0x17,
  "l": 0x0e,
  "m": 0x55,
  "n": 0x15,
  "o": 0x1d,
  "p": 0x67,
  "q": 0x3d,
  "r": 0x05,
  "s": 0x5b,
  "t": 0x0e,
  "u": 0x1d,
  "v": 0x16,
  "w": 0x16,
  "x": 0x55,
  "y": 0x56,
  "z": 0x4d,
  "{": 0x46,
  "|": 0x49,
  "}": 0x62,
  "~": 0x08,
};

function drawText(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, text: string, scale: number, color: RGBA): void {
  let cursorX = x;
  for (const character of text) {
    const glyph = FONT[character] ?? FONT["?"];
    for (let row = 0; row < FONT_HEIGHT; row += 1) {
      for (let col = 0; col < FONT_WIDTH; col += 1) {
        const bit = (glyph >> (row * FONT_WIDTH + col)) & 1;
        if (bit) {
          fillRect(pixels, width, height, cursorX + col * scale, y + row * scale, scale, scale, color, 255);
        }
      }
    }
    cursorX += (FONT_WIDTH + 1) * scale;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  writeContactSheet(DEFAULT_CONTACT_SHEET_DIR);
}
