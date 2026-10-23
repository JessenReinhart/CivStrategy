# CivStrategy — Comprehensive Remediation Plan

Scope: every CRITICAL / HIGH / MEDIUM / LOW finding from the six-area audit
(frontend, engine, simulation, rendering, architecture, tooling).

## Ground rules

1. **Correctness before performance before architecture.** Data corruption,
   hard locks, and time-model inversion ship first. Big rewrites ship last.
2. **One PR per phase, or one PR per tightly-coupled group inside a phase.**
   No mega-branch.
3. **Every fix lands with a regression test or a reproducible acceptance
   procedure.** A bug without a repro test is not "fixed", it is "patched".
4. **Determinism is a gate.** No balance tuning or AI tuning until the sim is
   deterministic (single RNG source, stable seeds, no `Math.random()` in logic).
5. **Run `npm run verify` before claiming any phase done.** The audit found the
   current `verify`/docs are partially stale; Phase 0 repairs that.
6. **git-bisectable.** Phases build on each other but the game must boot after
   every phase.

---

## Defect registry

Canonical IDs used throughout the plan.

| ID | Severity | Defect | Primary location |
|---|---|---|---|
| T1 | CRITICAL | Game speed inverted; `1/0` on pause breaks physics | `MainScene.ts:772-784`, `PlayerSceneBootstrap.ts`, `InputManager.ts:126`, `SaveSystem.ts:427` | [x] Fixed |
| A1 | HIGH | God-class field bloat: 26 systems + ~25 state scalars public | `MainScene.ts:86-207` | [x] Fixed |
| A2 | CRITICAL | Global `game.events.on` listeners never torn down; N× handlers after restart | `MainScene.ts:769-815,1007-1014` | [x] Fixed |
| A3 | HIGH | State mutated ad hoc, no invariants | `InputManager`, `EconomySystem`, `MainScene` | [x] Fixed |
| E1 | CRITICAL | Velocity-gated spatial hash leaves stale unit cells | `MainScene.ts:1821-1823`, `SpatialHash.ts` | [x] Fixed |
| E2 | HIGH | LOD blitters cleared every frame, budgeted update every 5th | `SquadSystem.ts:311-320` | [x] Fixed |
| E3 | HIGH | FIFO queue in weighted Dijkstra flow field | `Pathfinder.ts:630-675` | [x] Fixed |
| E4 | CRITICAL | Async path queue: no depth cap, no cancellation; stale callbacks | `Pathfinder.ts:779-786`, `UnitSystem.ts:1106-1117` | [x] Fixed |
| E5 | HIGH | Diagonal JPS forced-neighbor branches empty | `Pathfinder.ts:420-431` | [x] Fixed |
| E6 | HIGH | `_engageCache` not owner-partitioned | `UnitSystem.ts:924-940` | [x] Fixed |
| E7 | HIGH | Bucket offset over mutating `getChildren()` array | `UnitSystem.ts:193-211` | [x] Fixed |
| E8 | MED | SpatialHash lacks negative/NaN coordinate guard | `SpatialHash.ts` | [x] Fixed |
| E9 | MED | LiquidCombat string keys `cx,cy` per frame | `LiquidCombatSystem.ts` | [x] Fixed |
| E10 | MED | Wedge formation divides 0/0 → NaN | `FormationSystem.ts` | [x] Fixed |
| E11 | CRITICAL | Formation defense bonus applied twice | `UnitSystem.ts:1500-1503`, `EntityFactory.ts:400-404` | [x] Fixed |
| E12 | HIGH | `attackShare` (fraction) used as min-damage floor | `EntityFactory.ts:404,419` | [x] Fixed |
| E13 | MED | Building/unit stat scaling applied at inconsistent layers | `EntityFactory.ts:22-32`, `UnitSystem.ts`, `handleDamage` | [x] Fixed |
| S1 | CRITICAL | Enemy AI stalls forever on unbuildable blueprint slot | `EnemyAISystem.ts:479-483` | [x] Fixed |
| S2 | CRITICAL | `handleDamage` has no death guard; double-kill corrupts population/maxPopulation | `EntityFactory.ts:443-485` | [x] Fixed |
| S3 | CRITICAL | Combat building death leaks assigned worker | `EntityFactory.ts:458-483` | [x] Fixed |
| S4 | CRITICAL | Infinite chunks ignore world seed and terrain/biome | `InfiniteMapSystem.ts:38-66` | [x] Fixed |
| S5 | HIGH | Resource placement skips slope/collision/biome | `MapGenerationSystem.ts:224-233` | [x] Fixed |
| S6 | HIGH | Starvation/happiness clamp-then-check death spiral | `EconomySystem.ts:402-448` | [x] Fixed |
| S7 | HIGH | `getIdleVillagers` ignores `jobBuilding`; worker theft | `VillagerSystem.ts:608-613`, `EconomySystem.ts:145` | [x] Fixed |
| S8 | HIGH | AI population = building count; no real food model | `EnemyAISystem.ts:340-397` | [x] Fixed |
| S9 | HIGH | Player/AI slope threshold desync (0.15 vs 0.20) | `TerrainSystem.ts:821-825`, `constants.ts:434` | [x] Fixed |
| S10 | HIGH | AI placement bypasses all validation | `EnemyAISystem.ts:512`, `EntityFactory.ts:16-48` | [x] Fixed |
| S11 | MED | Population tick uses `if`, not capped `while`; catch-up drift | `ProgressionRuntime.ts:36-38,79-82` | [x] Fixed |
| S12 | MED | Wall-clock throttling mixed with game-time | `EconomySystem.ts:451,456,462` | [x] Fixed |
| S13 | MED | Demolition refund ignores construction progress | `BuildingManager.ts:533,339-341` | [x] Fixed |
| S14 | MED | Out-of-bounds terrain returns 0.5 (mid-land) | `TerrainSystem.ts:115-117` | [x] Fixed |
| S15 | HIGH | Seed 0 silently randomized | `MainScene.ts:349-350` | [x] Fixed |
| S16 | MED | Negative chunk seed → negative RNG seed | `InfiniteMapSystem.ts:46-47` | [x] Fixed |
| S17 | MED | `getBuildValidity` O(N) full scans despite spatial hashes | `BuildingManager.ts:390-412` | [x] Fixed |
| R1 | CRITICAL | Web Audio node graph leaks; no `disconnect`/`onended` | `ProceduralSoundSystem.ts:124-136,268-280` | [x] Fixed |
| R2 | CRITICAL | Fog full re-blit on every camera-pan frame | `FogOfWarSystem.ts:119-186,290-296` | [x] Fixed |
| R3 | HIGH | No persistent explored state; reveal viewport-limited | `FogOfWarSystem.ts:168-210` | [x] Fixed |
| R4 | HIGH | Per-entity `erase()` FBO thrash | `FogOfWarSystem.ts:359-388` | [x] Fixed |
| R5 | HIGH | Fog scans all units/buildings, no spatial hash | `FogOfWarSystem.ts:192-211,237-256` | [x] Fixed |
| R6 | MED | Fog ignores devicePixelRatio | `FogOfWarSystem.ts:26,100-111` | [x] Fixed |
| R7 | LOW | Fog stamps at subpixel coords → shimmer | `FogOfWarSystem.ts:361-366,383-387` | [x] Fixed |
| R8 | HIGH | Minimap territory O(16²×buildings) | `MinimapSystem.ts:238-271` | [x] Fixed |
| R9 | MED | Minimap one draw call per building | `MinimapSystem.ts:196-213` | [x] Fixed |
| R10 | HIGH | `refreshStaticLayer` dead; chopped trees/infinite map stale | `MinimapSystem.ts:92-94,184-186` | [x] Fixed |
| R11 | MED | Minimap single scalar distorts non-square maps | `MinimapSystem.ts:361-375` | [x] Fixed |
| R12 | HIGH | 200ms culling + 100px pad → pop-in/pop-out | `CullingSystem.ts:47-51,161-168` | [x] Fixed |
| R13 | MED | Tree pool grows during fade-held slots | `CullingSystem.ts:80-98,219-232` | [x] Fixed |
| R14 | MED | Culling allocates rects/set every tick + O(N) scan | `CullingSystem.ts:191-194,250-273` | [x] Fixed |
| R15 | HIGH | Full-screen multi-pass PostFX, no LOD/auto-disable | `AtmosphericSystem.ts:121-147,302-315` | [x] Fixed |
| R16 | HIGH | AtmosphericSystem has no `destroy()`; PostFX leak | `AtmosphericSystem.ts:41-47`, `MainScene.ts:1007-1014` | [x] Fixed |
| R17 | MED | `toIso`/`toCartesian` allocate per call in hot loops | `iso.ts:1-6,34-39` | [x] Fixed |
| R18 | MED | Minimap counter-scale + geometry mask drift | `MinimapSystem.ts:108-119,70-79` | [x] Fixed |
| R19 | LOW | Minimap docs claim 15 frames, code uses 45 | `MinimapSystem.ts:26` | [x] Fixed |
| R20 | MED | Minimap viewport drawn cartesian, not iso footprint | `MinimapSystem.ts:320-339,366-375` | [x] Fixed |
| R21 | MED | Wind sway 2 `sin` calls per visible tree/frame | `CullingSystem.ts:276-286`, `AtmosphericSystem.ts:397-408` | [x] Fixed |
| R22 | MED | MeatGrinder module-global cooldown + emitter churn | `MeatGrinderEffect.ts:13-14,56-87` | [x] Fixed |
| R23 | MED | Noise PSN wraps negative coords pathologically | `Noise.ts:43-44`, `FogOfWarSystem.ts:324-325` | [x] Fixed |
| R24 | MED | Wind noise buffer rebuilt on every restart | `ProceduralSoundSystem.ts:886-896` | [x] Fixed |
| R25 | MED | `exponentialRampToValueAtTime` unguarded vs 0 | `ProceduralSoundSystem.ts:163-165,194-196` | [x] Fixed |
| R26 | MED | Constant-gain pan: +6dB center, no limiter | `ProceduralSoundSystem.ts:268-280` | [x] Fixed |
| R27 | LOW | `water.frag` dead code, divide-by-zero if wired | `water.frag:1-53` | [x] Fixed |
| R28 | LOW | `fogCloudLayer.setSize()` every fog update | `FogOfWarSystem.ts:130` | [x] Fixed |
| R29 | MED | Profiler reports active-time FPS, not wall-time | `MainScene.ts:1386-1399` | [x] Fixed |
| R30 | LOW | Stress render sample off-by-one frame | `MainScene.ts:1370-1377,818-826` | [x] Fixed |
| R31 | LOW | Profiler allocates heavily in stress mode; self-pollutes | `MainScene.ts:1370-1408` | [x] Fixed |
| R32 | LOW | Profiler prints `_`-prefixed meta as system rows | `MainScene.ts:1435-1441` | [x] Fixed |
| R33 | LOW | Atmospheric clones view rect every frame | `AtmosphericSystem.ts:300` | [x] Fixed |
| R34 | LOW | Noise seed low-period LCG + shuffle bias | `Noise.ts:12-20` | [x] Fixed |
| F1 | CRITICAL | Magic-string bridge + `-ui` dual namespace; duplicate listeners | `App.tsx`, `GameUI.tsx`, `MainScene.ts:801-816` | [x] Fixed |
| F2 | CRITICAL | 1,571-line unmemoized HUD reconciles on every deposit | `GameUI.tsx:94` | [x] Fixed |
| F3 | CRITICAL | Treaty unit mismatch: turns vs minutes vs ms | `MainMenu.tsx:889`, `PhaserGame.tsx:107`, `EconomySystem.ts:541` | [x] Fixed |
| F4 | HIGH | Tailwind JIT CDN + blocking `@import` fonts | `index.html:7-9` | [x] Fixed |
| F5 | HIGH | Unpinned caret importmap; build tools in browser; no CSP/SRI | `index.html:140-152` | [x] Fixed |
| F6 | HIGH | Tech tree mouse-only `<div>`s; no keyboard/ARIA | `GameUI.tsx:981-990` | [x] Fixed |
| F7 | HIGH | StrictMode race + hardcoded `'game-container'` ID; over-reactive destroy | `PhaserGame.tsx:26-50,107,123` | [x] Fixed |
| F8 | HIGH | Build/train validate only resources; silent no-op | `GameUI.tsx:1336,1443-1446` | [x] Fixed |
| F9 | HIGH | Unvalidated `localStorage` save → white screen | `MainMenu.tsx:274-297` | [x] Fixed |
| F10 | MED | Loading screen no timeout watchdog, no ARIA live region | `App.tsx:150-186`, `LoadingScreen.tsx:14-97` | [x] Fixed |
| F11 | MED | Duplicated selection listeners in App and StressTestOverlay | `App.tsx:195-222`, `StressTestOverlay.tsx:23-35` | [x] Fixed |
| F12 | MED | Ref mutated during render | `MainMenu.tsx:120` | [x] Fixed |
| F13 | MED | Inline dynamic styles/arrow props block memoization | `MainMenu.tsx:305-309,735,748`, `GameUI.tsx:984` | [x] Fixed |
| F14 | LOW | `text-[8px]`/`text-[9px]` low-contrast text fails WCAG AA | `GameUI.tsx` (multiple) | [x] Fixed |
| F15 | MED | Global `select-none` disables text selection in HUD | `App.tsx:377` | [x] Fixed |
| F16 | MED | GSAP tweens leaked on unmount | `MainMenu.tsx:164,241-253` | [x] Fixed |
| F17 | LOW | Direct DOM style mutation vs React events | `MainMenu.tsx:1078-1085` | [x] Fixed |
| F18 | MED | 38 lucide icon imports, no memoization | `GameUI.tsx:5-14` | [x] Fixed |
| F19 | MED | `handleTaxChange` raw `parseInt`, no clamps | `GameUI.tsx:156-160` | [x] Fixed |
| F20 | LOW | Undocumented component imports contradict AGENTS.md | `App.tsx:5-6` | [x] Fixed |
| G1 | HIGH | No coverage thresholds/enforcement | `package.json` | [x] Fixed |
| G2 | HIGH | `recommendedTypeChecked` disabled; `scripts/` excluded | `tsconfig.json` | [x] Fixed |
| G3 | MED | 206 `any` + 94 `eslint-disable` | repo-wide | Partial: down from 206 to 40 `: any` / 92 `eslint-disable` lines across 8 files; structural GameUnit + DamageableTarget landed |
| G4 | MED | Phantom `src/`, vestigial deps, stale docs, root PNGs, ad-hoc Playwright scripts | repo root | [x] Fixed |

---

## Phase 0 — Baseline, guards, and repro tests (no behavior change)

**Goal:** make the fixes verifiable and the current failure modes observable.

**Tasks**

1. Add `@vitest/coverage-v8`; add `test:coverage` and coverage thresholds
   (start low: 35% lines/statements, raise per phase). Add thresholds to CI.
2. Update `.husky/pre-push` to `npm run verify` and ensure `verify` runs
   `tsc`, `eslint`, `vitest`, and `vite build` un-truncated.
3. Enable `@typescript-eslint/recommendedTypeChecked`; add a curated
   allow-list for the Phaser `any` boundaries (do not remove all 206 at once).
4. Add repro/regression tests that currently fail, then skip them with a
   `TODO(phase N)` link until their phase lands:
   - T1: `speed=0` must not set `timeScale=Infinity`.
   - S1: stone/water blueprint slot must not halt `buildIndex`.
   - S2: second `takeDamage` on a dead entity must be a no-op.
   - E11: formation defense applied exactly once end-to-end.
   - E4: stale async callback must not overwrite newer order.
   - R1: audio graph reachable-node count must stabilize, not grow.
5. Snapshot baseline: `npm run build`, test count, lint warn/error counts, and
   a Playwright smoke script for boot → start → build → exit.

**Exit gate:** CI reports coverage; `verify` fails on truncated/known safe errors
correctly; baseline recorded.

---

## Phase 1 — Blocker correctness (ship first, behind tests)

**Defects:** T1, A2, S1, S2, S3, E11, E12.

**Tasks**

1. **Unify game speed (T1).**
   - `MainScene.update` must derive one `gameDelta = rawDelta * speed` for sim,
     keep `physics.world.timeScale = 1` (or clamp its reciprocal), keep
     `tweens.timeScale` equal to the sim scale, and pause via an explicit
     `isPaused` branch that skips sim update rather than multiplying by zero.
   - Single source of truth in `PlayerSceneBootstrap`/`InputManager`/`SaveSystem`;
     delete the three divergent speed implementations.
   - Test: pause preserves all positions/resources; speed=2 runs sim at 2×; no
     `Infinity`/`NaN` reaches physics.

2. **Tear down global listeners (A2).**
   - Track every `game.events.on` registration; remove each in
     `MainScene.shutdown` (or register via a small `scene.bindEvent/shutdown`
     helper that auto-removes).
   - Test: restart scene → one UI toggle emits one `UPDATE_STATS`.

3. **Enemy AI blueprint stall (S1).**
   - Advance `buildIndex` on a skipped slot or keep a permanent `blocked` map;
     return a skip result that never counts as "built".
   - Add fallback placement search (nearest buildable tile) for the TC slot.

4. **Death guard + worker release (S2, S3).**
   - Gate `takeDamage` with `if (!entity.active || entity.getData('_dead')) return;`
     and set `_dead=true` before `destroy()`.
   - Extract `releaseAssignedWorker(building)` shared by
     `BuildingManager.demolishBuilding` and `EntityFactory` building-death.

5. **Formation defense + attackShare (E11, E12).**
   - Apply formation defense once (choose `UnitSystem` profile scaling or
     `EntityFactory` damage reduction, not both).
   - Replace `Math.max(attackShare, …)` floor with an explicit min-damage
     constant if floored damage is intended; document it.

**Exit gate:** all Phase 1 tests green; population/maxPopulation stay
non-negative under simultaneous-kill scenario; AI progresses past blocked slot.

---

## Phase 2 — Time and determinism

**Defects:** S4, S15, S16, S14, S11, S12, plus animal-faction RNG sources found
diverging from the single-seed intent.

**Tasks**

1. **Deterministic seeds (S15, S16, S4).**
   - Reject/derive stable nonzero seeds without rewriting caller intent; expose
     a `resolveSeed(input)` utility with documented behavior.
   - Seed infinite chunks from `hash(mapSeed, cx, cy)` (unsigned, no negatives)
     and route chunk tree spawn through the same terrain/biome gate as
     `MapGenerationSystem._trySpawnTreeAt`.
   - Replace `Math.random()` animal species fallback with the seeded RNG.

2. **Terrain sentinel (S14).**
   - Return an explicit `NO_TERRAIN` sentinel/`TerrainSample` for out-of-bounds;
     every placement/culling path must reject sentinel terrain.

3. **Progression catch-up (S11, S12).**
   - Convert population window to a capped `while` loop; add an explicit policy:
     either catch up fully below a cap or re-anchor time after a stall.
   - Pass `gameTime` into `tickEconomy`; throttle happiness/enemy notifications
     on game time, not `Date.now()`.

**Exit gate:** two identical `mapSeed` runs produce identical chunk layout,
animal species, and, given identical input ordering, identical simulation.
Pause/resume and tab-hide do not permanently drift game time.

---

## Phase 3 — AI and economy invariants

**Defects:** S8, S6, S7, S9, S10, S13, S5, S17.

**Tasks**

1. **AI economy honest or explicitly handicap (S8).**
   - Decision point (see Open decisions): give AI the same worker/deposit
     pipeline, or declare AI a flat-income handicap with a documented, tunable
     multiplier. Default recommendation: same pipeline, with a
     `DIFFICULTY` handicap constant layered on top.

2. **Starvation fix (S6).**
   - Compute `isStarving` from pre-clamp deficit, not `food === 0`.
   - Add cooldown-based recovery independent of tax/crowding.
   - Rebalance the `happiness < 50 → 0.5× food` feedback so the crisis resource
     is not halved by the crisis itself (apply penalty only to non-food or clamp
     at a floor that permits recovery).

3. **Worker stability (S7).**
   - `getIdleVillagers` filter adds `&& !v.jobBuilding`.

4. **Shared placement validation (S9, S10, S5, S17).**
   - Single `canPlace(type, x, y, owner)` in `BuildingManager`; AI calls it with
     territory-radius excluded but water/slope/overlap included.
   - One `MAX_BUILDABLE_SLOPE` constant used by both player and AI stone check.
   - Gold/forest/animal spawn goes through slope/biome/overlap gate.
   - `getBuildValidity` uses `treeSpatialHash`/`unitSpatialHash` and building
     AABB not full scans.

5. **Refund progress (S13).**
   - Track paid/reserved material per building; refund = paid −
     cost-of-work-already-applied, or full refund only pre-construction.

**Exit gate:** AI cannot spawn on invalid tiles; player and AI slope rule
identical; workers stable under building churn with a unit test; no
food-deficit death spiral with a recovery test.

---

## Phase 4 — Engine hot paths (movement, combat, spatial indexing)

**Defects:** E1–E10.

**Tasks**

1. **Spatial hash (E1, E8).**
   - Update the unit hash on actual position change (`setPosition` delta, not
     body velocity); invalidate on teleport/formation/push.
   - Clamp or reject negative/NaN keys; add unit tests for all four coord signs.

2. **Pathfinding (E3, E4, E5).**
   - Swap flow-field queue to a MinHeap (binary heap keyed by cost).
   - Add a cancellation token / monotonically increasing command id to async
     path requests; `commit` ignores stale ids.
   - Enforce `maxQueueDepth` with drop counter and metric.
   - Implement diagonal JPS forced-neighbor pruning (or revert to safe
     non-diagonal JPS if forced neighbors stay too risky).

3. **Unit batching (E6, E7).**
   - Key `_engageCache` by `owner:targetId`.
   - Iterate a stable snapshot (copy of ids/indices) or a ring buffer instead
     of a mutating `getChildren()` array for budget buckets.

4. **Misc engine invariants (E9, E10).**
   - LiquidCombat integer pair key (`x | (y<<16)` or tuple in a Map).
   - Guard wedge `0/0` with epsilon.

5. **Combat stat single-source (E13).**
   - Centralize unit/building stat computation (`computeEffectiveStats`) so
     research/faction/formation apply once, at one point, in one order.

**Exit gate:** spatial-hash tests cover stationary-teleport and boundary cases;
flow-field monotonicity test; async-stale test green; JPS corner test green.

---

## Phase 5 — Rendering, audio, and hot-path performance

**Defects:** R1–R34.

**Tasks**

1. **Audio lifecycle (R1, R24, R25, R26).**
   - Per-voice bus gain, `disconnect()` tail on `source.onended`; hard cap on
     graph node count.
   - Precompute ambient noise buffer once.
   - Clamp `exponentialRampToValueAtTime` target to `>= 1e-4`.
   - `StereoPannerNode` + master `DynamicsCompressorNode`.

2. **Fog rewrite (R2–R7, R23, R28).**
   - Persistent `explored` mask + live `visible` hole layer; reveal only on
     cell/vision change; camera pan only re-blits transform, never clears.
   - Batch vision stamps into a single `Graphics`/blitter draw.
   - Spatial-hash the visibility pass; keep DPR-aware RT scale; snap stamps to
     texels; fix negative-domain noise lookup; remove per-update `setSize`.

3. **Minimap (R8–R11, R18–R20).**
   - One-pass territory grid (256 cells, assign per building), batched building
     `Graphics`, scale X/Y independently, true ISO frustum footprint, time-based
     throttle, wire `refreshStaticLayer` on chop/scroll, fix mask drift.

4. **Culling & trees (R12–R14, R21).**
   - Cull on camera change with scroll-delta padding, not fixed 200ms only.
   - Release pooled tree slot at leave; fade without holding the pool entry.
   - Reuse rect objects; use spatial hash; precompute tree sway phase table.

5. **PostFX (R15, R16, R33).**
   - Tiered presets (low drops TiltShift, halves bloom/colorGrade); skip uniform
     writes when unchanged.
   - Add `AtmosphericSystem.destroy()` and invoke on scene shutdown.
   - Replace per-frame rect clone with scalar compare.

6. **Misc (R17, R22, R27, R29–R32, R34).**
   - `toIsoInto`/`toCartesianInto` scratch-object variants for hot loops.
   - Move MeatGrinder cooldown/pulse onto scene/system; pool two emitters.
   - Delete or harden `water.frag`.
   - Fix profiler: wall-time FPS, publish render on `postrender`, batch stress
     sampling, exclude `_`-prefixed meta.
   - Replace LCG with mulberry32/xorshift.

**Exit gate:** audio node graph stable under 30s clash test; fog explored layer
persists after pan; minimap territory O(buildings) not O(16²×buildings);
profiler reports actual wall-time FPS; `npm run build` warns on no dead
`water.frag`.

---

## Phase 6 — React bridge and UI

**Defects:** F1–F20.

**Tasks**

1. **Typed bridge (F1, F3).**
   - Delete `window` CustomEvent hop; use one `game.events.emit/on` with a
     single typed `EVENTS` namespace and payload types in `types.ts`.
   - Delete `MainScene` dual-channel registration.
   - Represent treaty duration in one unit (game seconds) end-to-end; store turns
     only for display.

2. **HUD decomposition (F2, F11, F18, F13).**
   - Split `GameUI` into memoized leaf/config panels: `ResourceBar`,
     `BuildMenu`, `TrainMenu`, `TechTree`, `WorkerPanel`, `TopBar`.
   - Subscribe via selectors with reference equality (subscribe only to the slice
     each panel needs); React passes `selectedCount` down from App.

3. **Perf + a11y (F6, F8, F9, F10, F12–F17, F19, F20).**
   - Tech tree: `<button>`/`role="button"` with `tabIndex`, keyboard nav, ARIA
     labels, `aria-expanded`.
   - Build/train gating by population/age/prereq/cap with visible disabled reason.
   - Validate `localStorage` save against enums; fall back to defaults.
   - Loading watchdog (timeout → failed state) + `role="progressbar"`/aria-live.
   - Move `menuScreenRef` assignment into `useEffect`; kill all GSAP tweens on
     unmount; replace direct DOM border styling with React state; kill global
     `select-none`; clamp tax input; isolate lucide icon imports.

**Exit gate:** no magic strings across the bridge; tech tree keyboard-operable;
corrupt save does not white-screen; pop-cap click shows a reason; HUD does not
reconcile the tech tree on villager deposits (React Profiler/console count).

---

## Phase 7 — Build and asset pipeline

**Defects:** F4, F5, F7, G4 (frontend/asset subset), R27 if not already done.

**Tasks**

1. **Self-contained bundle (F4, F5).**
   - Replace Tailwind CDN with the already-present `tailwindcss`/`postcss`/
     `autoprefixer` devDeps via Vite plugin; remove blocking Google Fonts
     `@import` in favor of self-hosted or `preload` + `font-display: swap`.
   - Pin importmap to exact versions; remove `vite`/`@vitejs/plugin-react` from
     the browser importmap; add CSP + SRI for remaining third-party CDNs.

2. **PhaserGame lifecycle (F7).**
   - Guard `game.destroy(true)` against double-destroy; derive container id via
     `useId`; stop destroying the sim on non-identity prop changes
     (memoize config by identity and diff only real deps).

3. **Repo hygiene (G4 asset subset).**
   - Delete phantom `src/` (keep only `vite-env.d.ts` if referenced) and root
     sprite PNGs as appropriate; normalize ad-hoc Playwright `.mjs` scripts into
     `@playwright/test` specs; refresh `AGENTS.md`/`GEMINI.md` from code.

**Exit gate:** `vite build` has no Tailwind CDN and no Node build-tool import in
the client; `npm run preview` boots and plays; CSP set; PhaserGame restart
leak test green.

---

## Phase 8 — Architecture refactor

**Defects:** A1, A3, plus residual event duplication from F1.

**Goal (target state):**

```
MainScene
  └─ RuntimeHost (already partially present)
       ├─ GameStateService (population/resources/happiness/diplomacy/age)
       │    ├─ guarded mutators + DirtyFlags
       │    └─ subscribe() selector API for React and systems
       ├─ EntityRegistryService (spatial hashes, groups, ids)
       ├─ SchedulingService (per-frame order, budgets)
       └─ SystemRegistry (typed system lookup)
```

- Systems take `GameContext` (state + services), not the whole `MainScene`.
- Only `SchedulingService` calls systems in `update`.
- React subscribe via selectors returns sliced state; no full stats object.

**Tasks**

1. Introduce `GameStateService` with guarded mutators and freeze/validate in dev.
   Migrate `population`/`resources`/`happiness` writes one system at a time.
2. Introduce `GameContext`; migrate systems to it progressively. Keep
   `MainScene` as the Phaser binding layer, not the state owner.
3. Move Phaser group ownership and spatial hashes into `EntityRegistryService`.
4. Replace direct `scene.events.emit(UPDATE_STATS, stats)` with state-service
   dirty subscription (done in tandem with Phase 6 F1).
5. Delete dead public fields as systems migrate.

**Exit gate:** `MainScene` contains binding/Phaser setup and scheduling only;
no system imports `MainScene` fields that live in `GameState`; dev-mode
invariant violations throw with a clear stack.

---

## Phase 9 — Hardening, coverage, and documentation

**Defects:** G1–G4 residual, R-tooling residual.

**Tasks**

1. Raise coverage thresholds to a meaningful floor (recommend: 70% lines on
   `game/` engine + system logic, 60% on bridge/UI helpers) after the migration
   makes testing feasible.
2. Eliminate `recommendedTypeChecked` overrides except an audited allow-list.
3. Add Playwright smoke/E2E: boot, new game, build TC, recruit, save/load,
   stress `?stress=1000`, load with corrupt save, restart.
4. Regenerate `AGENTS.md`/`GEMINI.md` from the refactored code (update system
   count, update loop via `SchedulingService`, correct test/coverage claims).
5. Remove vestigial dependencies and root artifact files; run `npx fallow
   dead-code` and route findings into a cleanup backlog.

**Exit gate:** coverage gates enforced in CI; `recommendedTypeChecked` clean;
E2E green; docs match code.

---

## Cross-cutting implementation notes

- **Single RNG.** Central `SeededRandom` in `game/utils/rng.ts`; Terrains,
  InfiniteMap, Animal, EnemyAI all consume it. No `Math.random()` in logic.
- **Shared validation.** `canPlace`/`isWalkable`/`getEffectiveStats` live once;
  player and AI call the same functions with owner-specific policy flags.
- **Time.** One `ClockService` exposes `gameTimeMs`, `gameDeltaMs`, `isPaused`;
  no system reads `Date.now()` for simulation cadence.
- **Worker release.** One `releaseAssignedWorker` used by demolition, combat
  death, and job reassignment.
- **Visibility.** Persistent explored layer + live visible layer; reveal is
  content-addressed by cell, not by camera transform.
- **Pooling.** Release pool slots immediately; separation of "visible status"
  from "fade animation" so culling never holds a pooled object open.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 8 refactor breaks gameplay subtlety | High | Land after correctness phases; migrate one system per PR; keep `npm run test` + Playwright smoke green per migration |
| AI "honest economy" makes AI too weak | High | Tunable `DIFFICULTY` handicap + a fake-AI mode to A/B verify before release |
| Fog rewrite regresses visuals | Medium | Keep old fog behind flag; compare screenshot captures for 3 map modes before removal |
| Tackling all 206 `any` at once destabilizes build | Medium | Curated allow-list per phase; type-clean the engine boundary only where touched |
| Perf work without a profiler fix claims false wins | Medium | Land R29 profiler fix in Phase 5 before other perf acceptance numbers |
| Stale docs (AGENTS/GEMINI) mislead during execution | Medium | Regenerate in Phase 9 and add a lint check that docs systems match source |

---

## Acceptance criteria for the whole plan

1. Pause/restart/speed no longer corrupt state or time.
2. A blocked blueprint slot never halts AI; AI cannot build on invalid tiles.
3. Simultaneous kills cannot negative population or corrupt maxPopulation.
4. Same seed ⇒ same map, same animals, same AI openings (deterministic).
5. Player and AI share placement/stat/slope invariants (balance is honest or an
   explicit, documented handicap).
6. Audio node count, minimap cost, fog cost, and culling cost stop growing
   linearly with total population; profiler reports real wall-time FPS.
7. React bridge is typed; HUD reconciles only the slices that changed.
8. Production bundle is self-contained, pinned, CSP'd; save corruption and
   loading hangs have recovery paths.
9. `MainScene` is a scheduler/binder, systems hold services, no direct scene
   state mutation.
10. CI enforces type, lint, test, build, coverage, and E2E smoke.

---

## Open decisions

1. **AI economy (S8):** true shared economy vs explicit difficulty handicap?
   *Recommendation: shared pipeline + tunable handicap.*
2. **Seeded save compatibility (S15/S4):** invalidate old saves/seeds, or add a
   migration map for already-issued seeds?
   *Recommendation: invalidate with explicit error; keep enum migration only for
   `localStorage` payload fields.*
3. **Coverage floor at Phase 9:** 70% engine / 60% bridge, or lower for a
   prototype? *Recommendation: enforce on `game/` first, bridge second.*
4. **Tailwind:** local Vite Tailwind (recommended) vs drop Tailwind and go
   CSS-variables/utility modules? *Recommendation: local Vite Tailwind to
   preserve existing markup.*
