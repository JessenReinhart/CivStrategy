# GPU Optimization Verification — Interim Verdict

**Date:** 2026-08-05
**Verifier:** GPUCritic
**Status:** ⏳ PENDING — No optimizations to verify

---

## Background

GPUBuilder confirmed via IRC: "Still reading code. Nothing landed yet."
No GPU-specific rendering optimizations exist in codebase.

## What Exists Today

- **CullingSystem.ts** — CPU-side viewport culling with object pooling + fade tweens. Not GPU optimization.
- **SquadSystem.ts** — Squad management (movement, combat). No rendering optimization.
- **Standard Phaser 3 WebGL** — no instanced rendering, no batch drawcall reduction, no WebGPU, no compute shaders.

## Baseline (from Profiler, 2026-08-05)

| Metric | Idle (~9u) | 500u | Delta |
|--------|-----------|------|-------|
| FPS | 60.0 | 58.6 | -1.4 |
| Frame Time p99 | 16.69ms | 17.02ms | +0.33ms |
| GPU Tasks | 229 | 1513 | 6.6x |
| GPU Saturation | 1.0% | 75.6% | 75.6x |
| JS Heap | 32.1MB | 53.9MB | +21.8MB |
| 1000u | — | NOT TESTED | Tab OOM / HMR failure |

---

## Verdict (Per Criterion)

| # | Criterion | Target | Verdict | Evidence |
|---|-----------|--------|---------|----------|
| 1 | GPU task count reduction | 50%+ from 1513 | **FAIL — NO CHANGE** | No instanced rendering code exists. CullingSystem does CPU-side visibility toggle, not drawcall batching. |
| 2 | FPS at 500u | Steady 60 | **FAIL — UNVERIFIED** | Baseline already 58.6fps (close). No optimization to test. |
| 3 | 1000u stress test | Completes (F6) | **FAIL — UNVERIFIED** | Baseline 1000u never completed (OOM + HMR failures). No stability improvement shipped. |
| 4 | Frame time p99 | < 20ms | **PASS (baseline)** | Baseline p99 = 17.02ms at 500u. Already under threshold. |
| 5 | Memory at 1000u | < 200MB | **FAIL — UNVERIFIED** | 500u peaks at 109.8MB. 1000u not tested. No memory optimization exists. |

**Overall: 1 PASS (baseline), 4 FAIL (no optimizations to verify)**

---

## Gap Analysis

### Biggest Gap: GPU Draw Calls
- 500u generates 1513 GPU tasks (6.6x from idle)
- Each unit = separate draw call → GPU bound at 75.6%
- Target: instanced rendering could reduce to ~10-20 draw calls total
- **Missing code:** No `InstancedMesh`, no sprite batching, no GPU instancing

### Second Gap: 1000u Stability
- Tab crashes or Vite HMR fails before completion
- No LOD system to reduce draw distance complexity
- No memory pooling for unit assets

---

## Actionable Feedback for GPUBuilder

1. **Instanced rendering for units** — Replace individual sprite drawcalls with batch instanced rendering. Phaser 3.60+ supports this via `Phaser.GameObjects.Shader` or custom WebGL pipelines.

2. **Viewport culling at GPU level** — Current CullingSystem toggles `visible` on GameObjects (CPU overhead per unit). Use frustum culling in shader or WebGL clip-space discard.

3. **LOD for distant units** — Render far units as single-pixel dots or skip entirely. AoE II: DE uses 3 LOD levels.

4. **Texture atlas batching** — Ensure all unit sprites share a single texture atlas to minimize texture bind GPU state changes.

5. **1000u stability** — Investigate the OOM. Check for: event listener leaks (509 listeners at 500u = 2x idle), pathfinding memory growth, tween accumulation.

---

## Next Steps

- **GPUBuilder:** Land instanced rendering + LOD changes → message GPUCritic for verification
- **GPUCritic:** Will re-run full profiling suite (idle, 500u, 1000u) with Chrome DevTools CDP tracing
- **Manual test needed:** Fresh terminal, no concurrent agents, `npm run dev`, hard-refresh, F5→F6

---

## Artifacts

- Baseline data: `traces/PERF_RESULTS.md` (full CDP-grade profiling)
- Idle trace: `traces/idle-trace.json` (28.3MB)
- 500u trace: `traces/500u-trace.json` (53.9MB)
- This verdict: `traces/GPU_VERIFICATION_INTERIM.md`
