// Pure-JS minimal PNG encoder. No deps.
// Writes RGBA pixel data to PNG binary. Uses stored (raw) format for simplicity.

export function encodePNG(
  width: number,
  height: number,
  pixels: Uint8ClampedArray
): Uint8Array {
  // pixels are RGBA per row, no filter rows included yet
  const rowLen = width * 4 + 1; // 1 filter byte + RGBA
  const raw = new Uint8Array(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * rowLen + 1);
  }

  const data = deflateNoop(raw); // No compression - stored blocks only
  const chunks: Uint8Array[] = [];

  // PNG signature
  chunks.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  {
    const ihdr = new Uint8Array(13);
    write32(ihdr, 0, width);
    write32(ihdr, 4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    chunks.push(makeChunk("IHDR", ihdr));
  }

  // IDAT - raw stored zlib stream
  chunks.push(makeChunk("IDAT", data));

  // IEND
  chunks.push(makeChunk("IEND", new Uint8Array(0)));

  // Concat
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length + 12;
  const buf = new Uint8Array(len);
  write32(buf, 0, data.length);
  buf.set(new TextEncoder().encode(type), 4);
  buf.set(data, 8);
  const crc = crc32(buf.subarray(4, len - 4));
  write32(buf, len - 4, crc);
  return buf;
}

function write32(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 24) & 0xff;
  buf[off + 1] = (v >> 16) & 0xff;
  buf[off + 2] = (v >> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

// Minimal zlib: no compression, just stored blocks with Adler-32
function deflateNoop(input: Uint8Array): Uint8Array {
  const ZLIB_CMF = 0x78; // deflate, window=32K
  const ZLIB_FLG = 0x01; // no dict, check bits
  const MAX_BLOCK = 65535;

  // Count blocks
  const blocks = Math.ceil(input.length / MAX_BLOCK);
  const header = 2;
  const footer = 4; // Adler32
  const blockHeaders = blocks * 5; // 1 byte type + 4 bytes len per block
  const total = header + input.length + blockHeaders + footer;
  const out = new Uint8Array(total);
  let off = 0;

  // Zlib header
  out[off++] = ZLIB_CMF;
  out[off++] = ZLIB_FLG;

  // Store blocks
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX_BLOCK;
    const len = Math.min(MAX_BLOCK, input.length - start);
    const isFinal = b === blocks - 1;
    out[off++] = isFinal ? 0x01 : 0x00; // BTYPE=0 stored, BFINAL flag

    write16(out, off, len);
    off += 2;
    write16(out, off, ~len & 0xffff);
    off += 2;

    out.set(input.subarray(start, start + len), off);
    off += len;
  }

  // Adler32
  const a32 = adler32(input);
  write32(out, off, a32);

  return out;
}

function write16(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
