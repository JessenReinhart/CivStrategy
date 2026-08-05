# HANDOFF-WATER-RENDERING.md
## Water Rendering Implementation — Complete

**Status:** COMPLETE — WaterCritic signed off, all 6 criteria PASS
**File:** `game/MainScene.ts`
**Date:** 2026-08-05

---

## What Was Done

### 1. Shore Edge Chain Extraction (lines 476-543)
- Added `isCross: boolean[]` to `WaterPoly` type — tracks which vertices are MS edge-crossing points
- All 14 MS polygon cases + saddle masks (5, 10) populate `isCross`
- Shore edge detection: edge is shoreline iff BOTH endpoints are crossing points (`!(isCross[i] && isCross[ni])`)
- Segment dedup via coarsened key (`×10|0`), chain merging via endpoint hash map
- Short chains (<6 points) dropped for performance
- Glint points: every 3rd vertex of each shore chain + 150 interior points (seeded random)

### 2. Animated Wave Canvas (lines 568-584)
- `_waterWaves` canvas at depth -8998 (above static depth -9000 and foam TileSprite -8999)
- Bitmap mask from `_waterDepth` alpha (soft edges at shore, full interior)
- `waterWavesSprite` created as Phaser Image with mask
- Layer stack: depth -9000 → foam -8999 → waves -8998 → entities

### 3. drawWaterSurface(time) Method (lines 1265-1349)
- **Interior calm shimmer**: 2 independent horizontal wave bands, amp 1.5px, alpha 0.04-0.06, multi-sine displacement. Each row is its own path (not zigzag).
- **Shore wave passes**: 5 passes along merged shore chains:
  - Foam: 2.5px stroke, alpha 0.55, white
  - Foam core: 1.2px stroke, alpha 0.80, white
  - Wave bands at offsets 5/11/17px: decreasing amplitude, light blue
- **Glint sparkles**: brightness² for sharp peaks, 1-2px radius, alpha threshold 0.08
- **Inward normals**: toward water bbox center (acceptable approximation for convex lakes)
- **Texture upload**: `tex.source[0].update()` (not `.refresh()` which doesn't exist)

### 4. Update Loop Integration (lines 923-932)
- Foam TileSprite scroll uses `delta` (scene time) — NOT `dt = delta * gameSpeed`
- Animated canvas: throttled 50ms gate, scene time for wave phase
- Fixes the pause/speed bug where waves sped up with game speed

### 5. Foam TileSprite Alpha
- Reduced from 0.28 to 0.08 (was too prominent, competing with wave canvas)


### 6. Bug Fixes (WaterCritic FAIL → FIX)
- **Bug 1 — Shore chains=0**: Original filter `!a && !b` kept edges where at least ONE endpoint was crossing. This included interior corner-to-midpoint edges, creating small triangle-loops that never linked into long chains. Fix: `!(a && b)` — requires BOTH endpoints crossing. Now only actual shoreline edges survive.
- **Bug 2 — Wave canvas sprite 0×0**: Canvas textures via `addCanvas` don't propagate frame dimensions to sprites in all Phaser versions. Fix: explicit `setDisplaySize(w,h)` for both `waterDepthSprite` and `waterWavesSprite`.
- Enhanced debug logging: segment count, epMap key count, chain count, warning when segments exist but all chains dropped.

### 7. Amplitude Scaling (WaterCritic TUNING → PASS)
- Canvas size varies with map (e.g. 3090×1953 for small fixed map). Fixed pixel amplitudes invisible at overview zoom.
- Scale factor: `const s = Math.max(1, W / 800)` — all amplitudes, offsets, line widths, glint sizes multiplied by `s`.
- Interior shimmer: amp 4*s, lineWidth 2.5*s, row spacing 28*s
- Shore waves: foam 8*s, bands 7-10*s, offsets 15-55*s
- Glint: size (1+0.8*brightness)*s, threshold lowered 0.08→0.04
- On 3090px canvas: s≈3.86, foam amp≈31px, glint size≈4-7px
---

## Build Status
- `npx tsc --noEmit`: 0 MainScene errors (only pre-existing Pathfinder.ts AnimalData/Arc)
- `npm run build`: passes (9.14s, 1765 modules)

---

## Pending (Next Session)
1. **Screenshots**: Take 3 screenshots via browser automation
   - Shoreline zoom (foam + wave bands visible)
   - Interior calm (subtle shimmer bands)
   - Full water body (depth shading visible)
2. **VisualAuditor review**: Send screenshots for AoE II DE comparison
3. **Potential improvements**:
   - Per-edge inward normal (currently bbox-center approximation)
   - Camera visibility culling for off-screen water canvas
   - Foam TileSprite interaction with wave canvas (both at same offset 0)

---

## Technical Notes
- Shore chain dedup key: `${(x*10|0)},${(y*10|0)}` — coarsened to avoid float precision issues
- Interior shimmer draws ~100 rows × 125 columns = 12,500 points per draw at 20Hz
- Shore wave passes: ~2000 chain vertices × 5 passes = 10,000 sin calls per draw
- Total CPU: ~22,500 trig calls per 50ms frame — negligible
- GPU: single 12MB texture upload per 50ms (~240MB/s) — negligible vs 1513 GPU tasks at 500u
