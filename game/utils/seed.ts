/**
 * Deterministic seed derivation utilities.
 */

/**
 * Resolves an arbitrary seed input into a stable, non-zero unsigned 32-bit integer.
 *
 * Rules:
 * - `undefined` or `null` or `NaN`: generated randomly via crypto/Math.random in [1, 0x7fffffff].
 * - Explicit `0`: deterministic non-zero seed (0x5eed0, 388816) so seed 0 is reproducible.
 * - Negative numbers or floats: hashed/mixed into positive 32-bit unsigned integers.
 * - Finite positive integers: kept verbatim (or wrapped to unsigned 32-bit if out of range).
 */
export function resolveSeed(input?: number | null): number {
  if (input === undefined || input === null || Number.isNaN(input) || !Number.isFinite(input)) {
    return (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0;
  }

  // Treat integer 0 as a distinct deterministic seed rather than randomly mutating it
  if (input === 0) {
    return 388816; // 0x5eed0
  }

  // Fold negative or float into a positive unsigned 32-bit integer
  let n = Math.floor(Math.abs(input));
  if (n === 0) n = 1;
  // Simple Murmur-style avalanche mixer
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n = (n ^ (n >>> 16)) >>> 0;

  return n === 0 ? 1 : n;
}

/**
 * Derives a deterministic, strictly positive 32-bit integer chunk seed from
 * world mapSeed and integer chunk coordinates (cx, cy), supporting negative coordinates.
 */
export function chunkSeed(mapSeed: number, cx: number, cy: number): number {
  // Convert cx, cy to unsigned representations
  const ux = (cx | 0) >>> 0;
  const uy = (cy | 0) >>> 0;
  const ms = (mapSeed | 0) >>> 0;

  let h = ms ^ 0x9e3779b9;
  h = Math.imul(h ^ ux, 0xcc9e2d51);
  h = (h << 13) | (h >>> 19);
  h = Math.imul(h ^ uy, 0x1b873593);
  h = (h << 15) | (h >>> 17);
  h = (h ^ (h >>> 16)) >>> 0;

  return h === 0 ? 1 : h;
}
