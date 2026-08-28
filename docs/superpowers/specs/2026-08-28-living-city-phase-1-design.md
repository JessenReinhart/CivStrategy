# Living City Phase 1 — Foundation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CivStrategy settlements visibly more alive as population grows, by extending the existing lightweight ambient population layer with population-linked density, role/LOD tiers, contextual building activity, and a dense-settlement stress scenario — without turning ambient citizens into gameplay entities.

**Architecture:** Extend `game/systems/AmbientPopulationSystem.ts` in-place. Internally refactor into focused private helpers, but keep the public boundary identical. Ambient citizens remain pure visual Blitter bobs, isolated from physics, spatial hashes, selection, combat, and pathfinding. Density is derived from `MainScene.population / maxPopulation` and building anchor capacity. LOD and role variants use generated textures. A new browser stress script exercises a dense city and gates frame time.

**Tech Stack:** TypeScript 5.2, Phaser 3, Vite, Vitest, Playwright.

## Global Constraints

- Ambient citizens must **never** become gameplay `GameUnit`s: no Arcade bodies, no spatial-hash entries, no selection state, no combat state, no pathfinder requests.
- Re-use existing coordinate and rendering conventions (`toIso`, `toIsoElev`, Blitter/Bob, `setDepth(-9998)`).
- No new dependencies.
- Phase 1 does **not** persist ambient state through save/load; re-derive on load like today.
- All changes must pass `npm run verify` (type check, lint, tests, build) and the new stress scenario.

---

## Task 1: Link ambient density to real population

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts` (new)

**Interfaces:**
- Consumes: `MainScene.population` (number), `MainScene.maxPopulation` (number), `MainScene.buildings` (Phaser Group).
- Produces: `desiredCitizenCount` now reflects both population ratio and anchor capacity.

- [ ] **Step 1: Add population-aware budget calculation**

Replace the fixed anchor-weight-only density with a population-linked budget:

```ts
const populationRatio = scene.population / Math.max(1, scene.maxPopulation);
const targetFromPopulation = Math.floor(MAX_CITIZENS * populationRatio * DENSITY_FACTOR);
const targetFromAnchors = anchors.reduce((sum, a) => sum + a.weight, 0);
desiredCitizenCount = clamp(Math.min(targetFromPopulation, targetFromAnchors), 0, MAX_CITIZENS);
```

Constants: `DENSITY_FACTOR = 0.75`, `MIN_CITIZENS = 8`.

- [ ] **Step 2: Write failing test**

Create `AmbientPopulationSystem.test.ts` with a minimal Phaser mock. Test: given a scene with `population=100, maxPopulation=200`, and anchors summing to 220, `desiredCitizenCount` equals `floor(220 * 0.5 * 0.75) = 82` (capped by anchors).

- [ ] **Step 3: Run test, confirm failure**

- [ ] **Step 4: Implement minimal code**

- [ ] **Step 5: Run test, confirm pass**

---

## Task 2: Introduce near/mid/far civilian LOD tiers

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: `Phaser.Cameras.Scene2D.Camera.worldView` and zoom.
- Produces: Three generated textures (`ambient_civilian_near`, `ambient_civilian_mid`, `ambient_civilian_far`), tier per citizen, throttled update cadence.

- [ ] **Step 1: Generate three LOD textures in `ensureTexture`**

| Tier | Texture key | Visual | Update cadence |
| --- | --- | --- | --- |
| Near | `ambient_civilian_near` | 6x8 colored bob | every frame |
| Mid | `ambient_civilian_mid` | 4x4 silhouette | every 2nd frame |
| Far | `ambient_civilian_far` | 2x2 dot | every 4th frame |

- [ ] **Step 2: Assign tier per citizen based on distance to camera center**

Use screen-space distance thresholds matching `SquadSystem` precedent: near < 900 px, mid < 1800 px, far beyond. Store `tier` on `AmbientCitizen`.

- [ ] **Step 3: Throttle updates by tier**

In `handleUpdate`, skip position/animation for mid/far citizens on non-aligned frames (use `this.scene.gameTime` or frame counter). Far citizens move only every 4th frame; mid every 2nd.

- [ ] **Step 4: Add tests**

Test that a citizen at screen distance > 1800 uses the far texture and updates every 4th frame; a citizen at < 900 uses near texture and updates every frame.

---

## Task 3: Add lightweight civilian role variants

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Modify: `types.ts` (new `AmbientRole` enum)
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: Building type of anchor.
- Produces: `AmbientCitizen.role` influences tint/texture and anchor preference.

- [ ] **Step 1: Define `AmbientRole` enum**

```ts
export enum AmbientRole {
  CIVILIAN = 'civilian',
  WORKER = 'worker',
  MERCHANT = 'merchant',
  FARMER = 'farmer',
}
```

- [ ] **Step 2: Generate role-tinted near/mid textures**

Generate one base texture and apply tints at runtime via `bob.tint` instead of pre-generating all permutations. Roles map to a tint palette:
- civilian: cloth palette (existing)
- worker: browns/grays
- merchant: richer colors (reds/blues)
- farmer: earth/green

- [ ] **Step 3: Assign roles biased by anchor context**

When resetting a citizen near an anchor, set role based on anchor type:
- FARM → farmer
- MARKET → merchant
- LUMBER_CAMP, HUNTERS_LODGE, BARRACKS → worker
- TOWN_CENTER, HOUSE, CATHEDRAL, BONFIRE, SMALL_PARK, CASTLE → civilian

- [ ] **Step 4: Role-aware movement bias**

Merchants and farmers prefer short-range movement near their anchor; civilians roam farther between anchors.

- [ ] **Step 5: Add tests**

Mock a scene with one market anchor and assert the spawned citizen role is `MERCHANT` with the merchant tint.

---

## Task 4: Contextual building activity

**Files:**
- Modify: `game/systems/AmbientPopulationSystem.ts`
- Test: `game/systems/AmbientPopulationSystem.test.ts`

**Interfaces:**
- Consumes: `AmbientAnchor` building type.
- Produces: Movement patterns that evoke market bustle, farm labor, and workshop activity.

- [ ] **Step 1: Define activity profiles per anchor type**

```ts
interface ActivityProfile {
  jitterRadius: number;     // how tightly they move near anchor
  pauseChance: number;      // chance to briefly stand still
  switchAnchorChance: number;
}
```

- [ ] **Step 2: Apply profiles in `assignTarget`**

- **Market**: high jitter, frequent re-target, clustered movement — creates bustle.
- **Farm**: medium jitter, slower speed — creates farm labor feel.
- **Workshop/Lumber**: short back-and-forth paths.
- **Civic/Religious**: slower, more spread out.

- [ ] **Step 3: Add tests**

For a market anchor, assert re-target interval is shorter than for a farm anchor.

---

## Task 5: Dense-settlement stress scenario

**Files:**
- Create: `scripts/profile-city-density.mjs`
- Create: `utils/cityDensityBootstrap.ts` (or extend `utils/stressUrlBootstrap.ts`)
- Modify: `game/MainScene.ts` (add city-stress bootstrap hook)
- Modify: `components/StressTestOverlay.tsx` (optional: show city metrics)

**Interfaces:**
- Consumes: URL `?stress=city&density=high` or config object.
- Produces: Frame-time metrics + ambient count + population + assertion that ambient bobs are not in `scene.units`.

- [ ] **Step 1: Add city-stress bootstrap in MainScene**

If `stressTestConfig` is `{ city: true, density: 'high' }`, run a setup function that places a dense ring/grid of houses, farms, and markets and sets initial population high enough to fill the ambient budget.

- [ ] **Step 2: Create `scripts/profile-city-density.mjs`**

Re-use Playwright/Vite patterns from `scripts/profile-stress.mjs`. Boot game with `?stress=city&density=high`. Wait for world ready, run for 20s, capture `window.__perf`, assert:
- p95 frame time ≤ 16.67 ms
- min FPS ≥ 60
- ambient citizen count > 150
- `scene.units.getLength()` does not include ambient bobs

- [ ] **Step 3: Add minimal unit test for bootstrap helper**

If a new `cityDensityBootstrap` helper is created, test that it returns a valid config and cleans URL params.

---

## Task 6: Verification and acceptance

- [ ] **Step 1: Run focused tests**

```bash
npm run test -- game/systems/AmbientPopulationSystem.test.ts
```

- [ ] **Step 2: Run full verification suite**

```bash
npm run verify
```

- [ ] **Step 3: Run dense-city stress scenario**

```bash
node scripts/profile-city-density.mjs
```

- [ ] **Step 4: Manual in-browser sanity check**

Launch `npm run dev`, start a normal game, place several houses and a market, observe ambient citizens moving around buildings with role-appropriate tints and density increasing as population grows.

---

## Spec self-review

- **Spec coverage:** All 6 Phase 1 checkboxes from issue #116 are covered.
- **Placeholder scan:** No TBD/TODO or vague steps; each step names exact files and test commands.
- **Type consistency:** `AmbientRole` enum introduced once; `MAX_CITIZENS` reused; LOD thresholds mirror `SquadSystem`.
- **Scope check:** Phase 1 only; no roads, households, logistics, or combat panic.
