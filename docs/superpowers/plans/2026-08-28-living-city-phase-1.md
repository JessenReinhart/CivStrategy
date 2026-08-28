# Living City Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settlements visibly denser and more alive as population grows by extending the lightweight ambient population layer with population-linked density, near/mid/far LOD, role variants, contextual building activity, and a dense-city stress scenario.

**Architecture:** Extend `game/systems/AmbientPopulationSystem.ts` in place. Ambient citizens remain pure visual Blitter bobs, isolated from gameplay units, physics, spatial hashes, selection, combat, and pathfinding. Density derives from `MainScene.population / maxPopulation` and building anchor capacity. LOD tiers mirror the `SquadSystem` precedent. A Playwright script gates frame time on a dense settlement.

**Tech Stack:** TypeScript 5.2, Phaser 3 (Blitter/Bob), Vite, Vitest, Playwright.

## Global Constraints

- Ambient citizens must NEVER become `GameUnit`s: no Arcade bodies, no spatial-hash entries, no selection, no combat, no pathfinder requests.
- Reuse `toIso`, `toIsoElev`, `setDepth(-9998)`, Blitter/Bob conventions.
- No new dependencies. Zero-warning ESLint (`--max-warnings 0`).
- Do not persist ambient state in save/load; re-derive like today.
- Do NOT run project-wide lint/format/build/test during implementation — the orchestrator runs gates once per phase.

---

### Task 1: Population-linked ambient density budget

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts` (new)

**Interfaces:**
- Consumes: `scene.population`, `scene.maxPopulation` (MainScene public fields), `scene.buildings` group.
- Produces: `desiredCitizenCount` derived from both population ratio and anchor capacity.

Steps:
1. In `refreshAnchors()`, after computing `anchorCapacity = sum(weights)`, compute:
   - `populationRatio = scene.population / max(1, scene.maxPopulation)`
   - `fromPopulation = floor(MAX_CITIZENS * populationRatio * DENSITY_FACTOR)` with `DENSITY_FACTOR = 0.75`
   - `fromPopulation = max(0, min(MAX_CITIZENS, fromPopulation))`
   - `desiredCitizenCount = min(fromPopulation, anchorCapacity)` — buildings must still support the crowd.
2. If `scene.population <= 0` (brand-new game), keep a small baseline so the starting settlement is not empty: `desiredCitizenCount = max(desiredCitizenCount, min(8, anchorCapacity))`.
3. Write `AmbientPopulationSystem.test.ts` with a minimal Phaser mock (mirror `ProceduralSoundSystem.test.ts` vi.mock('phaser') pattern). The mock needs: a fake scene exposing `population`, `maxPopulation`, `gameTime`, `gameSpeed`, `buildings` (group of fake objects with `getData`), `terrainSystem.getHeightAt/getWaterLevel`, `mapMode`, `mapWidth`, `mapHeight`, `cameras.main.worldView`, `getFactionColor`, `stressTestConfig`, `textures.exists/generateTexture`, `make.graphics`, `add.blitter`, `worldLayer.add`, `events.on/once/off`.
4. Tests:
   - `population 100 / maxPopulation 200`, anchors sum 220 → desired `floor(220*0.5*0.75)=82` (clamped by anchor capacity 220 → 82).
   - `population 0` → baseline 8 (if anchor capacity ≥ 8).
   - Small settlement: population 30, max 100 → `floor(220*0.3*0.75)=49`.
5. Keep the `handleUpdate` early-exit when `desiredCitizenCount === 0` and the `stressTestConfig` visibility toggle exactly as-is.

### Task 2: Near/mid/far LOD tiers

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: `scene.cameras.main` zoom and `worldView`.
- Produces: three textures `ambient_civilian_near|mid|far`; per-citizen `tier`; throttled per-tier update cadence.

Steps:
1. In `ensureTexture()`, generate three textures (near 6x8 colored person, mid 4x4 rounded silhouette, far 2x2 dot). Keep the existing `ambient_citizen` texture generation as the near-tier texture or add new keys; the old key may be replaced only if no other code references it (search first).
2. In `handleUpdate`, compute per-citizen tier by screen distance from camera center (use `Phaser.Math.Distance.Between` on iso screen coords vs `worldView.centerX/centerY`):
   - `< 900` near, `< 1800` mid, else far.
3. Store `tier` on `AmbientCitizen`. In the per-citizen loop, skip movement for mid on odd frames and far on non-multiple-of-4 frames (use a frame counter or `scene.gameTime` bucket). Far citizens keep position update but can skip terrain-height sampling every 4th frame.
4. When tier changes, switch `bob.setTexture(...)` accordingly (Blitter Bobs support `setFrame`/texture swap via `bob.setTexture`).
5. Tests:
   - Citizen at screen distance > 1800 uses far texture and updates at most every 4th frame.
   - Citizen at < 900 uses near texture and updates every frame.
   - Tier switching changes the active texture.

### Task 3: Lightweight civilian role variants

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Modify: `types.ts` (add `AmbientRole` enum)
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: anchor building type.
- Produces: `AmbientCitizen.role` (enum) + per-role tint palette and movement bias.

Steps:
1. In `types.ts`:
   ```ts
   export enum AmbientRole {
     CIVILIAN = 'civilian',
     WORKER = 'worker',
     MERCHANT = 'merchant',
     FARMER = 'farmer',
   }
   ```
2. In the ambient system, add `role` to `AmbientCitizen`. Add a `roleForAnchor(type)` helper mapping:
   - FARM → FARMER
   - MARKET → MERCHANT
   - LUMBER_CAMP, HUNTERS_LODGE, BARRACKS → WORKER
   - everything else → CIVILIAN
3. Per-role tint palettes:
   - civilian: existing cloth palette `[0xd8c7a2, 0xb88a62, 0x8c7055, 0xc2b7a3, 0x9c8064, 0xe0d2b8]`
   - worker: browns/grays `[0x9a8a72, 0x7a6a55, 0x6b5d4a, 0x8a7a62]`
   - merchant: richer reds/blues `[0xa05a4a, 0x4a6a8a, 0x7a4a5a, 0x5a7a6a]`
   - farmer: earth/green `[0x8a9a5a, 0x7a8a4a, 0x6a7a4a, 0x9aaa6a]`
4. Assign role when resetting a citizen (`resetCitizen`/`assignTarget`) from the anchor type; store it; apply tint from role palette (with 20% chance of faction color as today).
5. Movement bias: merchants/farmers prefer short hops (re-target interval lower, radius smaller), civilians roam wider (existing behavior).
6. Tests:
   - A citizen reset near a MARKET anchor gets `role === MERCHANT` and merchant tint.
   - A citizen near FARM gets `FARMER`.
   - A citizen near HOUSE gets `CIVILIAN`.

### Task 4: Contextual building activity

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: `AmbientAnchor` building type.
- Produces: activity profile per anchor type (jitter radius, pause chance, re-target cadence).

Steps:
1. Add an `ActivityProfile` interface: `{ jitterRadius: number; pauseChance: number; retargetMs: [number, number] }`.
2. Extend `getAnchorConfig` to also return the profile, or add `getActivityProfile(type)`:
   - MARKET: jitter 34, pause 0.25, retarget 900–2200 (bustle)
   - FARM: jitter 60, pause 0.05, retarget 2600–5200 (slow labor)
   - LUMBER_CAMP/HUNTERS_LODGE/BARRACKS: jitter 42, pause 0.12, retarget 1600–3600 (workshop rhythm)
   - TOWN_CENTER/CATHEDRAL: jitter 70, pause 0.18, retarget 2400–5000 (spread, slow)
   - HOUSE/BONFIRE/SMALL_PARK/CASTLE: jitter 50, pause 0.15, retarget 2000–4200
3. In `assignTarget`, use the profile: roll pause → set `retargetAt` far future + stop (bob stays); else target within jitter radius and set `retargetAt = now + rand(profile.retargetMs)`.
4. Keep the 18% nearby-anchor hop unchanged.
5. Tests:
   - Market re-target interval statistically shorter than farm interval (run many samples, compare means).
   - Pause chance respected: with pauseChance 1.0, citizen does not move until retargetAt.

### Task 5: Dense-settlement stress scenario

**Files:**
- Create: `scripts/profile-city-density.mjs`
- Modify: `game/MainScene.ts` (add `setupCityStress()`)
- Modify: `game/bootstrap/PlayerSceneBootstrap.ts` (call it when `stressTestConfig?.city`)
- Modify: `types.ts` (extend stress config type with `city?: boolean; density?: 'high'`)
- Modify: `components/PhaserGame.tsx` (prop type)
- Modify: `package.json` (add `profile:city` script)
- Modify: `utils/stressUrlBootstrap.ts` (parse `?stress=city` → `{ city: true, unitCount: 0 }`)
- Modify: `game/MainScene.ts` `init()` URL fallback (accept `stress=city`)
- Test: `utils/stressUrlBootstrap.test.ts` (add `stress=city` parse case)

**Interfaces:**
- Consumes: URL `?stress=city&density=high`.
- Produces: dense settlement (many houses/markets/farms near player TC), ambient density > 150, frame-time gate.

Steps:
1. `types.ts`:
   ```ts
   export type StressTestConfig =
     | { unitCount: number; enableEnemies?: boolean; city?: never; density?: never }
     | { city: true; density: 'high' | 'medium' | 'low'; unitCount?: never; enableEnemies?: never };
   ```
   Update `MainScene.stressTestConfig`, `PhaserGameProps.stressTestConfig`, `StressTestOverlay` props accordingly. (If TS spread of `{...config}` needs casts, use them.)
2. `MainScene.init` URL fallback: parse `stress=city` → `{ city: true, density: 'high' }` (default density high); keep numeric stress path unchanged.
3. `utils/stressUrlBootstrap.ts`: extend `StressUrlConfig` with `city?: boolean; density?: 'high'|'medium'|'low'`; parse `stress=city` → `{ city: true, density: params.get('density') ?? 'high' }`.
4. `MainScene.setupCityStress()`:
   - Spawn a ring of buildings around player TC: 12 houses, 4 markets, 6 farms, 2 lumber camps (use `entityFactory.spawnBuilding(type, x, y, 0)`; guard for invalid placement — try offset until success).
   - Set `scene.population` to 220 and `scene.maxPopulation` to 240 (so the density budget fills), then call `economySystem.updateStats()`.
   - Spawn ~50 extra villagers via `villagerSystem.spawnVillager` near the TC (owner 0) so the settlement feels occupied — these are real units; count them in the ambient assertion.
5. `PlayerSceneBootstrap.ts`: in the `if (scene.stressTestConfig)` block, branch: `config.city ? scene.setupCityStress() : scene.setupStressTest()`; do NOT hide worldLayer/ground when city mode (the settlement must be visible); keep UI camera hidden.
6. `scripts/profile-city-density.mjs` (mirror `profile-stress.mjs`):
   - URL `http://localhost:5173/?stress=city&density=high`
   - Wait for `window.__perf`, wait for `scene.isReady === true`.
   - Wait for: `scene.ambient?.desiredCitizenCount` or a `window.__civStrategyGame.scene.getScenes(true)[0].population >= 200` AND buildings count >= 24 AND ambient bobs count >= 150 (access via a new public getter on MainScene: `getAmbientCitizenCount()` returning `this.ambientSystem?.citizenCount ?? 0` — add it; also expose `ambientSystem` public field in WorldBootstrap assignment: `scene.ambientSystem = new AmbientPopulationSystem(scene)`).
   - 8s warmup, 20s capture, p95 ≤ 16.67ms AND minFPS ≥ 60 gate.
   - Assert ambient bobs are NOT in `scene.units` (`units.getChildren()` length === expected real-unit count, and no bob object appears).
   - Write `profile-city-results.json` + append `progress-metrics.jsonl`; exit 0/1.
7. `utils/stressUrlBootstrap.test.ts`: add a case for `?stress=city&density=high` → `{ city: true, density: 'high' }`.

### Task 6: Verification

- [ ] `npm run test -- game/systems/AmbientPopulationSystem.test.ts` — all ambient tests pass.
- [ ] `npm run lint` — zero warnings.
- [ ] `npx tsc --noEmit` (per repo verify.sh) — clean.
- [ ] `npm run build` — succeeds.
- [ ] `npm run profile:city` — dense-city stress gate passes (or a documented, measured FPS result with a fix loop).

---

## Self-review

- Spec coverage: all 6 Phase 1 checkboxes covered (density↔population, LOD tiers, role variants, contextual activity, stress scenario, gate).
- Placeholder scan: every step names exact files, symbols, and test commands.
- Type consistency: `AmbientRole`, `StressTestConfig`, `getAmbientCitizenCount`, `ambientSystem` field names used consistently across tasks.
- Scope check: roads, households, logistics, districts, panic hooks, save/load of ambient state are explicitly out.
