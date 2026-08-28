# Living City Phase 2 — Scalable Asset Pipeline

**Goal:** Define the Sprite Art Bible, refactor the existing building generator into modular reusable components, and generate the first coherent variant family (house Roman village/town + civilian sprite atlas + initial prop family). Introduce a deterministic manifest/atlas workflow, a contact-sheet review script, and regression checks so adding coherent visual variety no longer requires hand-authoring each asset.

**Architecture:** Extend `scripts/gen-sprites.ts` with a modular composition system. Add a new `scripts/generate-sprite-atlas.ts` driver that consumes a manifest of variant definitions and emits texture atlases + JSON manifests. Keep deterministic, seed-based generation. No runtime game integration in Phase 2 — this is pure asset pipeline work, though a small demo load in a test scene is optional for acceptance. Phase 2 does not create new gameplay systems or alter existing gameplay rendering.

**Tech Stack:** TypeScript 5.2, Node `canvas` (already in devDependencies), deterministic seeded RNG (`scripts/pixel-builder.ts` / `scripts/png-encode.ts`), Vitest for regression tests.

## Global Constraints

- Generated assets must look like one game; all new generators follow the Sprite Art Bible.
- Deterministic: same definition + seed → same PNG bytes.
- No new runtime game dependencies; the pipeline may use existing devDependencies.
- Zero-warning ESLint (`--max-warnings 0`).
- Do not run project-wide lint/format/build/test during implementation — the orchestrator runs gates once per phase.

---

## Task 1: Define and commit the Sprite Art Bible

**Files:**
- Create: `docs/superpowers/specs/2026-08-28-sprite-art-bible.md`

**Interfaces:**
- Produces: documented rules for projection, scale, anchor/origin, light/shadow, palette, faction-color slots, silhouette/readability, age variation, LOD simplification.

**Steps:**
1. Codify the existing 2:1 isometric projection and canonical world-to-sprite scale bands by reading `game/utils/iso.ts`, existing building sprites at root/assets, and `scripts/gen-sprites.ts` output dimensions.
2. Record light direction (from current generated sprites), shadow direction and softness, palette/material families, faction-color usage, silhouette/readability, transparent background, outline policy, and age/faction variation rules.
3. Keep the bible concise (≤2 pages) and directly referenceable from generator code comments.

**Acceptance:**
- Document exists and is checked in.
- Every rule is grounded in at least one existing sprite or generator measurement.

---

## Task 2: Refactor `scripts/gen-sprites.ts` into a modular composition system

**Files:**
- Modify: `scripts/gen-sprites.ts`
- Create: `scripts/sprite-parts/
  - `CanvasRenderer.ts`
  - `parts/WallMaterial.ts`
  - `parts/RoofMaterial.ts`
  - `parts/Foundation.ts`
  - `parts/Door.ts`
  - `parts/Window.ts`
  - `parts/Chimney.ts`
  - `parts/Awning.ts`
  - `parts/Fence.ts`
  - `parts/Porch.ts`
  - `parts/Banner.ts`
  - `parts/Crates.ts`
  - `parts/MarketStall.ts`
  - `parts/Hay.ts`
  - `parts/ToolRack.ts`
  - `parts/Garden.ts`
  - `parts/LivestockPen.ts`
  - `parts/StreetDebris.ts`
  - `parts/MilitaryRack.ts`
  - `parts/SmokeSocket.ts`
  - `parts/DamageOverlay.ts`
- Create: `scripts/sprite-parts/types.ts`

**Interfaces:**
- Consumes: seed, faction, age, building type, footprint, and a `PartConfig` map.
- Produces: a `SpritePart` function that renders into a shared canvas context.

**Steps:**
1. Extract canvas helper utilities (pixel-perfect rect/circle/polygon, shadow, outline, dither) from `scripts/gen-sprites.ts` and `scripts/pixel-builder.ts` into `CanvasRenderer.ts`.
2. Define a `SpritePart` contract:
   ```ts
   export type SpritePart = (ctx: CanvasRenderingContext2D, box: PartBox, config: PartConfig, seed: number) => void;
   export interface PartBox { x: number; y: number; width: number; height: number; }
   export interface PartConfig { [key: string]: unknown; }
   ```
3. Refactor the existing house generator into a composition of `base + wall + roof + door + window + chimney + props + age + faction + seed`.
4. Ensure existing generated PNGs remain byte-identical or visually equivalent when produced with the same seed — add a deterministic baseline test.

**Acceptance:**
- `npx tsx scripts/gen-sprites.ts` still produces all existing assets.
- A new deterministic regression test compares output hashes for at least one seed.

---

## Task 3: Generate the first coherent house variant family

**Files:**
- Modify: `scripts/gen-sprites.ts`
- Create: `scripts/definitions/HouseFamily.ts`
- Create: `assets/textures/generated/.gitkeep` if missing

**Interfaces:**
- Consumes: `HouseDefinition` with footprint, age (`village` | `town` | `city`), faction, seed.
- Produces: `house_roman_village_01` … `house_roman_town_04`, plus corner variants.

**Steps:**
1. Define `HouseDefinition` and a generator that combines wall, roof, door, window, chimney, props, age, faction, and seed.
2. Generate at least 8 variants (3 village, 3 town, 2 corner) deterministically.
3. Save outputs to `assets/textures/generated/` with stable naming.

**Acceptance:**
- `scripts/gen-sprites.ts` emits the new house family when run.
- Variants share the same footprint and palette but differ visibly enough to break repetition.

---

## Task 4: Generate civilian sprite atlas and variants

**Files:**
- Create: `scripts/generate-civilian-sprites.ts`
- Create: `scripts/definitions/CivilianSpriteFamily.ts`

**Interfaces:**
- Consumes: roles (`civilian`, `worker`, `merchant`, `farmer`, `porter`), LOD (`near`, `mid`, `far`), seed.
- Produces: `civilian-atlas.png` and `civilian-atlas.json` under `assets/textures/generated/`.

**Steps:**
1. Generate role-specific base sprites using the existing dot/silhouette approach plus the Phase 1 role tints.
2. Pack near (32x32), mid (16x16), far (8x8) frames into a single atlas with a JSON manifest containing frame coordinates.
3. Keep deterministic and seed-based.

**Acceptance:**
- Atlas PNG and JSON are generated deterministically.
- Regression test asserts stable bytes for a fixed seed.

---

## Task 5: Introduce prop family generator and manifest workflow

**Files:**
- Create: `scripts/generate-prop-family.ts`
- Create: `scripts/definitions/PropFamily.ts`
- Create: `scripts/build-sprite-manifest.ts`

**Interfaces:**
- Consumes: prop family definitions (barrels, crates, sacks, carts, hay, fence sections, garden).
- Produces: `assets/textures/generated/props.png` + `props.json` manifest; combined `assets/textures/generated/manifest.json`.

**Steps:**
1. Generate a small prop family (≥6 prop types, ≥2 variants each) into a packed texture atlas.
2. Write a manifest builder that walks `assets/textures/generated/` and produces `manifest.json` with metadata per texture: key, dimensions, source definition, seed, tags.
3. Make manifest generation idempotent and deterministic (sorted keys).

**Acceptance:**
- `scripts/build-sprite-manifest.ts` runs without error and produces sorted, deterministic JSON.

---

## Task 6: Contact sheet generation for visual review

**Files:**
- Create: `scripts/generate-contact-sheet.ts`

**Interfaces:**
- Consumes: manifest JSON + PNG assets.
- Produces: `assets/textures/generated/contact-sheet.png`.

**Steps:**
1. Lay out all generated sprites in a grid with labels.
2. Include a scale ruler and a small color palette strip.

**Acceptance:**
- Contact sheet PNG is produced deterministically.
- Visual review shows no broken anchors, obvious scale drift, or duplicate variants at a glance.

---

## Task 7: Deterministic seed regression checks

**Files:**
- Create: `scripts/sprite-parts/spritePipeline.test.ts`

**Interfaces:**
- Consumes: generator definitions and a fixed seed set.
- Produces: test pass/fail with hash comparison.

**Steps:**
1. Generate house, civilian, and prop families for 3 fixed seeds.
2. Hash output buffers and compare to golden snapshots committed under `scripts/__snapshots__/spritePipeline/`.
3. Document how to update snapshots when the art bible changes intentionally.

**Acceptance:**
- `npm run test -- scripts/sprite-parts/spritePipeline.test.ts` passes.

---

## Task 8: Package scripts and verification

**Files:**
- Modify: `package.json`

**Steps:**
1. Add scripts:
   - `sprites:build`
   - `sprites:atlas`
   - `sprites:contact`
   - `sprites:test`
2. Do not alter existing game scripts.

**Acceptance:**
- `npm run sprites:build` regenerates assets.
- `npm run sprites:test` runs regression tests.

---

## Task 9: Orchestrator verification

- [ ] `npm run test -- scripts/sprite-parts/spritePipeline.test.ts` passes.
- [ ] `npm run lint` zero warnings.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` passes.
- [ ] `npm run sprites:build` and `npm run sprites:contact` produce expected artifacts.

---

## Self-review

- Spec coverage: all 7 Phase 2 issue #116 checkboxes covered (art bible, modular generator, house variants, civilian atlas, prop families, manifest workflow, contact sheet, seed regression).
- Scope check: no runtime gameplay changes, no new game systems, no combat/city-builder integration.
