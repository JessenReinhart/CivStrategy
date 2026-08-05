/**
 * Seeded pseudo-random number generator (LCG).
 * Same seed → same sequence, every time. Zero seed is treated as invalid.
 */

export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Deterministic integer between min and max (inclusive), using a seeded RNG. */
export function randomBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
