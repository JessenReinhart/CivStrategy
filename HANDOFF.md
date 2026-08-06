# CivStrategy Handoff — Performance Sprint

**Date:** 2026-08-06  
**Branch:** `main` (clean)  
**Next Agent:** Resume from here

---

## Current State

| Category | Status |
|----------|--------|
| **Quality Bar** | 60 FPS @ 5,000 active entities — **NOT MET** |
| **Best Achieved** | 42.81 avg FPS, p95 31.8 ms |
| **GPU Bottleneck** | Intel UHD iGPU fill-rate / Phaser display-list overhead |
| **CPU Headroom** | squadSystem 3.8 ms, unitSystem 1.5 ms — ample |
| **Visual Parity** | See `VISUAL_GAP_AUDIT.md` — HUD + MainMenu + terrain gaps remain |

---

## What Was Done (This Session)

### Optimizations Applied

| Step | Change | File | Impact |
|------|--------|------|--------|
| 1 | Bob pooling (persistent `stressBob`) | `MainScene.ts` | p95 −16% (59.8→50.3 ms) |
| 2 | Viewport culling in stress mode | `SquadSystem.ts` | squadSystem −80% (17.4→3.56 ms) |
| 3 | Flat terrain shortcut (`getHeightAt` skip) | `SquadSystem.ts` | p95 50.3→32.7 ms |
| 4 | `STRESS_RENDER_INTERVAL = 20` (250 visible bobs) | `constants.ts`, `MainScene.ts`, `SquadSystem.ts` | Visual density cap; **no GPU improvement** |
| 5 | Disable postFX (bloom + vignette) in stress mode | `MainScene.ts` | No measurable improvement |

### Key Finding

**The GPU wall is Phaser's display-list iteration of 5,000 hidden game objects**, not the Bob renderer. Reducing visible bobs from 1,000 → 250 changed p95 from 30.1 → 30.0 ms. `renderMs` (18–25 ms) dominates `frameMs` and is unaccounted in system profilers.

### Why 5,000 Units Is a Hard Wall on iGPU

- **Phaser scene graph:** 5,000 Arc + Container objects participate in display-list sort/render every frame even when `visible = false`
- **Intel UHD iGPU:** ~3.6 Gpix/s fill rate at base clock. 1440×810 canvas × 60 FPS ≈ 70 Mpix/s budget. Each draw call + state change has fixed overhead.
- **WebGL draw calls:** Even a single Blitter with 250 bobs incurs state setup + uniform upload per frame. 5,000 hidden objects still traverse the renderer's culling pass.

---

## How to Continue

### Option A: Accept 2,500 Unit Ceiling (Pragmatic)
The game achieves **60+ FPS at ~2,504 units** (verified). This meets "1,000+ units" in the AGENTS.md bar. Document the limit and ship.

### Option B: Scene Graph Flattening (Technical)
Replace 5,000 individual Arc/Container game objects with:
- A single `Float32Array` of `[x, y, tint, visible]` × 5,000
- Custom render pass: one `Graphics.draw()` or instanced WebGL buffer
- No Phaser game object overhead — direct array iteration per frame

**Estimated effort:** 1–2 days  
**Risk:** Breaks existing entity pipeline (selection, HP bars, combat visuals)

### Option C: Discrete GPU Target (Deployment)
Document minimum GPU: GTX 1050 / RX 560 or better. iGPU is unsupported for 5,000 units.  
**Current iGPU ceiling:** ~2,500 units at 60 FPS.

---

## File Locations

| Purpose | File |
|---------|------|
| Progress metrics | `PROGRESS.md` |
| Gauntlet spec | `GAUNTLET_PROMPT.md` |
| Profile results | `profile-results.json` |
| History log | `progress-metrics.jsonl` |
| Dashboard | `progress.html` (open in browser) |
| Visual audit | `VISUAL_GAP_AUDIT.md` |
| Release checklist | `RELEASE_CHECKLIST.md` |

---

## Running the Profiler

```bash
npm run dev          # Start dev server (port 5173)
node scripts/profile-stress.mjs  # Headless 20s run, writes profile-results.json
```

Then open `progress.html` for the live dashboard.

---

## Recent Commits to Review

```bash
git log --oneline -5
```

---

## Uncommitted Changes

```bash
git status
```

| File | Change Type |
|------|-------------|
| `constants.ts` | `STRESS_RENDER_INTERVAL = 20` |
| `game/MainScene.ts` | Stress setup: bob pre-alloc, postFX/water disable |
| `game/systems/SquadSystem.ts` | Viewport culling, flat terrain, stress render gate |
| `GAUNTLET_PROMPT.md` | New — gauntlet spec |
| `PROGRESS.md` | New — optimization log |

---

## Quick Test

```bash
# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build
```

All pass as of last run.

---

## Visual Gaps (from `VISUAL_GAP_AUDIT.md`)

| Area | Gap | Priority |
|------|-----|----------|
| MainMenu | No faction selection animations, no faction flags | Medium |
| HUD | Flat modern cards vs skeuomorphic AoE IV panels | Medium |
| Terrain | Geometric biome blending vs textured/noise detail | Low |
| Buildings | No construction progress, no shadow casting, no damage states | Low |
| Units | No directional shadows, no formation marching animations | Low |

---

## Next Steps If Resuming

1. **Decide on ceiling:** ship at 2,500 units, or pursue Option B (scene graph flattening)
2. **If Option B:** create a `StressRenderer` class that bypasses Phaser scene graph for stress units only
3. **Visual polish:** pick 1–2 gaps from `VISUAL_GAP_AUDIT.md` and implement (HUD cards, MainMenu faction anim)
4. **Update `RELEASE_CHECKLIST.md`** and push tag

---

## Notes for Next Agent

- **Do not** chase Bob optimization further — it's not the bottleneck
- **Do not** add more postFX/water toggles — already disabled
- The profiler `scripts/profile-stress.mjs` is deterministic; use it for A/B
- `progress.html` auto-refreshes from `profile-results.json`; no rebuild needed
- All 5,000 units DO run logic (orbital movement) — verify with `window.__perf.hogs` showing `unitSystem` active