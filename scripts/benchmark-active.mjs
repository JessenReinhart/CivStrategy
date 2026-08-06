#!/usr/bin/env node

/**
 * Active-entity headless benchmark.
 *
 * Simulates 5,000 *moving* entities every frame:
 *   - position / velocity update  (SoA Float32Arrays)
 *   - spatial-hash grid broadphase (grid SpatialHash, per-cell buckets)
 *   - bucketed flow-field steering  (deterministic sine-field + separation)
 *
 * No Phaser, no GPU, no rendering — pure CPU simulation cost.
 * Reports p50 / p95 / min / max frame-ms and effective FPS.
 *
 * Exit 0 only when p95 ≤ 16.67 ms  (meets 60 FPS quality gate).
 *
 * Usage:
 *   node scripts/benchmark-active.mjs [--units 5000] [--frames 600] [--seed 1]
 */

// ── CLI flags ──────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), Number(arr[i + 1]) ?? 1]);
    return acc;
  }, [])
);

const UNITS  = args.units  ?? 5_000;
const FRAMES = args.frames ?? 600;
const SEED   = args.seed   ?? 1;

// ── Seeded PRNG (xorshift32) ───────────────────────────────────────────────

function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ── Entity store — Structure-of-Arrays (SoA) ──────────────────────────────
// Float32Array per field: zero GC pressure, cache-friendly iteration.

const xs        = new Float32Array(UNITS);
const ys        = new Float32Array(UNITS);
const vxs       = new Float32Array(UNITS);
const vys       = new Float32Array(UNITS);
const targetXs  = new Float32Array(UNITS);
const targetYs  = new Float32Array(UNITS);
const speeds    = new Float32Array(UNITS);   // 0.8-1.2 px/frame base speed
const owners    = new Uint8Array(UNITS);     // 0=player, 1=enemy

// Reusable neighbours buffer per entity (max 64 neighbours — sufficient here)
const NEIGH_CAP = 64;
const neighbourBuf = new Int32Array(UNITS * NEIGH_CAP);
const neighbourCnt = new Uint16Array(UNITS);

// ── Deterministic flow-field (simple sine-based warp, no pathfinder IO) ───

const FIELD_RES   = 64;        // 64×64 grid
const FIELD_SIZE  = 4096;      // world-space extent
const FIELD_CELLS = FIELD_RES * FIELD_RES;
const flowFieldX  = new Float32Array(FIELD_CELLS);
const flowFieldY  = new Float32Array(FIELD_CELLS);

(function buildField() {
  const rng = makeRng(SEED + 999);
  const scale = Math.PI * 2 / FIELD_RES;
  for (let i = 0; i < FIELD_CELLS; i++) {
    const cx = (i % FIELD_RES);
    const cy = (i / FIELD_RES) | 0;
    // Three overlapping sine waves → smooth but non-trivial gradient
    const a = Math.sin(cx * scale * 0.5 + rng() * 0.3);
    const b = Math.cos(cy * scale * 0.7 + rng() * 0.4);
    const c = Math.sin((cx + cy) * scale * 0.3 + rng() * 0.5);
    const mx = a + 0.5 * c;
    const my = b - 0.3 * c;
    const len = Math.sqrt(mx * mx + my * my) || 1;
    flowFieldX[i] = mx / len;
    flowFieldY[i] = my / len;
  }
})();

// ── Grid SpatialHash (flat bucket arrays, string-free) ────────────────────

const CELL_SIZE   = 64;
const WORLD_SIZE  = FIELD_SIZE;
const GRID_RES    = Math.ceil(WORLD_SIZE / CELL_SIZE); // 64
const TOTAL_CELLS = GRID_RES * GRID_RES;
const MAX_PER_CELL = 64;

const bucketData  = new Int32Array(TOTAL_CELLS * MAX_PER_CELL); // stores unit indices
const bucketCount = new Uint16Array(TOTAL_CELLS);               // how many in cell
const entityCell  = new Uint16Array(UNITS);                      // current cell per entity

function hashInsert(idx) {
  const cx = (xs[idx] / CELL_SIZE) | 0;
  const cy = (ys[idx] / CELL_SIZE) | 0;
  const ci = Math.max(0, Math.min(GRID_RES - 1, cx)) +
             Math.max(0, Math.min(GRID_RES - 1, cy)) * GRID_RES;
  const pos = bucketCount[ci];
  if (pos < MAX_PER_CELL) {
    bucketData[ci * MAX_PER_CELL + pos] = idx;
  }
  bucketCount[ci] = pos + 1; // overflow is benign — won't crash, just sparse
  entityCell[idx] = ci;
}

function hashRemove(idx) {
  const ci = entityCell[idx];
  const cnt = bucketCount[ci];
  if (cnt === 0) return;
  const base = ci * MAX_PER_CELL;
  for (let i = 0; i < cnt; i++) {
    if (bucketData[base + i] === idx) {
      bucketData[base + i] = bucketData[base + cnt - 1];
      bucketCount[ci] = cnt - 1;
      return;
    }
  }
}

function queryNeighbours(cx, cy) {
  const results = [];
  const x0 = Math.max(0, cx - 1), x1 = Math.min(GRID_RES - 1, cx + 1);
  const y0 = Math.max(0, cy - 1), y1 = Math.min(GRID_RES - 1, cy + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ci = x + y * GRID_RES;
      const cnt = Math.min(bucketCount[ci], MAX_PER_CELL);
      const base = ci * MAX_PER_CELL;
      for (let j = 0; j < cnt; j++) results.push(bucketData[base + j]);
    }
  }
  return results;
}

// ── Per-entity neighbour query (fills per-entity buffer) ──────────────────

function buildNeighbourCounts() {
  for (let i = 0; i < UNITS; i++) {
    const ci = entityCell[i];
    const cx = ci % GRID_RES;
    const cy = (ci / GRID_RES) | 0;
    const neigh = queryNeighbours(cx, cy);
    const n = Math.min(neigh.length, NEIGH_CAP);
    neighbourCnt[i] = n;
    const base = i * NEIGH_CAP;
    for (let j = 0; j < n; j++) neighbourBuf[base + j] = neigh[j];
  }
}

// ── Initialise entities ───────────────────────────────────────────────────

const INIT_SPREAD = FIELD_SIZE * 0.5;
const OFF = FIELD_SIZE * 0.25;

(function initEntities() {
  const rng = makeRng(SEED);
  for (let i = 0; i < UNITS; i++) {
    xs[i] = OFF + rng() * INIT_SPREAD;
    ys[i] = OFF + rng() * INIT_SPREAD;
    vxs[i] = 0;
    vys[i] = 0;
    speeds[i] = 0.8 + rng() * 0.4;
    owners[i] = i < (UNITS >> 1) ? 0 : 1;
    // Pick a flow-field target cell ahead of start position
    targetXs[i] = xs[i] + (rng() - 0.5) * FIELD_SIZE * 0.6;
    targetYs[i] = ys[i] + (rng() - 0.5) * FIELD_SIZE * 0.6;
    hashInsert(i);
  }
})();

// ── Simulation tick ───────────────────────────────────────────────────────

const SEP_RADIUS    = 24;
const SEP_RADIUS_SQ = SEP_RADIUS * SEP_RADIUS;
const SEP_WEIGHT    = 1.8;
const FLOW_WEIGHT   = 1.0;
const ARRIVE_DIST   = 48;
const WORLD_PAD     = 32;

function simulateFrame() {
  // Phase 1: Clear spatial hash and rebuild
  bucketCount.fill(0);
  for (let i = 0; i < UNITS; i++) hashInsert(i);

  // Phase 2: Build neighbour tables
  buildNeighbourCounts();

  // Phase 3: Steering + velocity + position update
  for (let i = 0; i < UNITS; i++) {
    const x = xs[i], y = ys[i];

    // Flow-field steering: sample field at entity cell
    const fieldCx = Math.max(0, Math.min(FIELD_RES - 1, (x / FIELD_SIZE * FIELD_RES) | 0));
    const fieldCy = Math.max(0, Math.min(FIELD_RES - 1, (y / FIELD_SIZE * FIELD_RES) | 0));
    const fi = fieldCx + fieldCy * FIELD_RES;
    let steerX = flowFieldX[fi] * FLOW_WEIGHT;
    let steerY = flowFieldY[fi] * FLOW_WEIGHT;

    // Arrival at target: steer toward targetX/targetY when close
    const dxT = targetXs[i] - x;
    const dyT = targetYs[i] - y;
    const distSqT = dxT * dxT + dyT * dyT;
    if (distSqT < ARRIVE_DIST * ARRIVE_DIST) {
      // Pick new random target (deterministic from index)
      const rng2 = makeRng(SEED + i * 7 + 1);
      targetXs[i] = WORLD_PAD + rng2() * (WORLD_SIZE - WORLD_PAD * 2);
      targetYs[i] = WORLD_PAD + rng2() * (WORLD_SIZE - WORLD_PAD * 2);
    } else {
      const invLen = 1 / Math.sqrt(distSqT);
      steerX += dxT * invLen * 0.3;
      steerY += dyT * invLen * 0.3;
    }

    // Separation from neighbours
    const nCnt = neighbourCnt[i];
    const base = i * NEIGH_CAP;
    for (let j = 0; j < nCnt; j++) {
      const k = neighbourBuf[base + j];
      if (k === i) continue;
      const dxN = x - xs[k];
      const dyN = y - ys[k];
      const dSq = dxN * dxN + dyN * dyN;
      if (dSq > 0 && dSq < SEP_RADIUS_SQ) {
        const d = Math.sqrt(dSq);
        const push = SEP_WEIGHT * (1 - d / SEP_RADIUS);
        steerX += (dxN / d) * push;
        steerY += (dyN / d) * push;
      }
    }

    // Integrate
    const len = Math.sqrt(steerX * steerX + steerY * steerY) || 1;
    vxs[i] = (steerX / len) * speeds[i];
    vys[i] = (steerY / len) * speeds[i];

    let nx = x + vxs[i];
    let ny = y + vys[i];

    // Clamp to world bounds
    nx = Math.max(WORLD_PAD, Math.min(WORLD_SIZE - WORLD_PAD, nx));
    ny = Math.max(WORLD_PAD, Math.min(WORLD_SIZE - WORLD_PAD, ny));

    xs[i] = nx;
    ys[i] = ny;
  }
}

// ── Timing infrastructure ─────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

const frameTimes = new Float64Array(FRAMES);

// ── Warmup: 30 frames ────────────────────────────────────────────────────

const WARMUP_FRAMES = 30;
console.error(`[active-bench] warming up ${WARMUP_FRAMES} frames...`);
for (let f = 0; f < WARMUP_FRAMES; f++) simulateFrame();

// ── Measured run ──────────────────────────────────────────────────────────

console.error(`[active-bench] ${UNITS} entities × ${FRAMES} frames (seed ${SEED})...`);
const t0 = performance.now();

for (let f = 0; f < FRAMES; f++) {
  const s = performance.now();
  simulateFrame();
  frameTimes[f] = performance.now() - s;
}

const wallMs = performance.now() - t0;

// ── Report ────────────────────────────────────────────────────────────────

const sorted = Array.from(frameTimes).sort((a, b) => a - b);

const p50   = +percentile(sorted, 50).toFixed(3);
const p95   = +percentile(sorted, 95).toFixed(3);
const pMin  = +(sorted[0]).toFixed(3);
const pMax  = +(sorted[sorted.length - 1]).toFixed(3);
const avg   = +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3);
const avgFps = avg > 0 ? +(1000 / avg).toFixed(1) : 0;

const pass = p95 <= 16.67;

const result = {
  timestamp: Date.now(),
  benchmark: 'active-entity-headless',
  units: UNITS,
  frames: FRAMES,
  warmupFrames: WARMUP_FRAMES,
  seed: SEED,
  wallMs: +wallMs.toFixed(1),
  avgFrameMs: avg,
  p50FrameMs: p50,
  p95FrameMs: p95,
  minFrameMs: pMin,
  maxFrameMs: pMax,
  avgFps,
  pass,
  note: pass
    ? 'p95 ≤ 16.67ms — active simulation meets 60 FPS gate'
    : `p95 ${p95}ms > 16.67ms — active simulation FAILS 60 FPS gate`,
};

// Write report
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.cwd(), 'active-profile-results.json'), JSON.stringify(result, null, 2) + '\n');

// Console output
console.log(JSON.stringify(result, null, 2));
console.error(`\n[active-bench] ${result.pass ? '✅ PASS' : '❌ FAIL'}`);
console.error(`  p50=${p50}ms  p95=${p95}ms  min=${pMin}ms  max=${pMax}ms  avgFps=${avgFps}`);
console.error(`  wall=${wallMs.toFixed(0)}ms  ${UNITS}×${FRAMES} frames`);
console.error(`  wrote active-profile-results.json`);

process.exit(pass ? 0 : 1);
