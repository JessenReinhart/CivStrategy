# CivStrategy Gauntlet — Stress Test Prompt

**Purpose:** The exact prompt and setup used to evaluate whether CivStrategy meets its 60 FPS performance bar.

---

## Quality Bar

> **60 FPS with 5,000 active entities simultaneously.**  
> All 5,000 units must remain active and pathfinding/moving every frame.  
> Visual representation may use LODs (Blitter dots) but entity logic must remain active.  
> Strict acceptance: p95 frame time ≤ 16.67 ms, minimum FPS ≥ 60.

**Interpretation:** the bar is about *active entities* (pathfinding, combat, movement, economy), not about *visual sprites on screen*. A unit using a single DOT Bob for rendering still counts as active if its game logic runs every frame.

---

## Gauntlet Configuration

### URL Parameters
```
http://localhost:5173/?stress=5000
```

| Parameter | Value | Effect |
|-----------|-------|--------|
| `stress` | 5000 | Spawns 5,000 units (4,999 player + 1 enemy if enabled) |

### Profiler Command
```bash
node scripts/profile-stress.mjs
```

### Profiler Settings
| Setting | Value |
|---------|-------|
| Viewport | 1440 × 810 |
| Warmup | 5,000 ms |
| Capture duration | 20,000 ms |
| Units target | 5,000 |
| Browser | Chromium (headless, Playwright) |

### What Gets Measured
1. **`window.__perf`** API — snapshots every frame in stress mode:
   - `frameMs`: total frame time
   - `updateMs`: game logic time (sum of profiled systems)
   - `renderMs`: `frameMs − updateMs` (includes Phaser render pipeline + GPU)
   - `fps`: `1000 / frameMs`
2. **Per-system hogs:** top 8 CPU consumers per frame (squadSystem, unitSystem, etc.)
3. **Percentiles:** p50, p95 frame times over 20s capture window

### What "All Active" Means
Each stress unit has:
- ✅ A position that changes every frame (orbital path: `radius × cos/sin(time)`)
- ✅ `hp`, `maxHp`, `owner`, `unitType` game data
- ✅ `squadContainer` + soldier state (hidden in stress mode)
- ✅ Participation in `unitSystem.update()` (orbital movement) every frame
- ❌ No pathfinding queries (no flow field lookups — would require 5k AI targets)
- ❌ No combat (no enemy targets spawned by default)
- ❌ No physics bodies (disabled for stress benchmark)

---

## Gauntlet Results History

### Best Result (2026-08-06, Intel UHD iGPU, `STRESS_RENDER_INTERVAL=20`)

| Metric | Value | Bar | Status |
|--------|-------|-----|--------|
| avg FPS | 42.81 | ≥ 60 | ❌ |
| min FPS | 26.88 | ≥ 60 | ❌ |
| p50 | 23.8 ms | ≤ 16.67 ms | ❌ |
| p95 | 31.8 ms | ≤ 16.67 ms | ❌ |
| max FPS | 70.42 | — | — |
| samples | 416 | — | — |

### Best p95 (2026-08-06, same hardware, `STRESS_RENDER_INTERVAL=5`)

| Metric | Value | Bar | Status |
|--------|-------|-----|--------|
| p95 | 30.1 ms | ≤ 16.67 ms | ❌ |
| avg FPS | 44.31 | ≥ 60 | ❌ |
| min FPS | 29.67 | ≥ 60 | ❌ |

### Hollow Shell Baseline (no visible rendering)

| Metric | Value | Bar | Status |
|--------|-------|-----|--------|
| p95 | 12.5 ms | ≤ 16.67 ms | ✅ |
| avg FPS | 122 | ≥ 60 | ✅ |

---

## Running the Gauntlet Yourself

```bash
# 1. Start dev server
npm run dev

# 2. Run headless profiler
node scripts/profile-stress.mjs

# 3. View results
cat profile-results.json | jq .

# 4. View dashboard (open in browser)
open progress.html
```

### Manual Browser Test
1. Open `http://localhost:5173/?stress=5000`
2. Wait for "5,000 UNITS SPAWNED!" overlay
3. Check `window.__perf