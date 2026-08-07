# HANDOFF — Liquid Combat / Melee Flow (UEBS-style)

**Date:** 2026-08-07 · **Branch:** `main` (feature branch recommended next: `feat/liquid-combat`)
**Status:** Core system SHIPPED + unit-tested. Visual verification of *contact-line* forces BLOCKED by pre-existing melee-engagement bug (units never close to within attack range → fronts never engage → contact lines never fire).

---

## What was built

### 1. `game/systems/LiquidCombatSystem.ts` (NEW, ~525 lines)
Three cheap, scalable forces (no fluid engine, no physics rewrite):
- **Pressure** — SpatialHash density per 150px cell; dense cells push outward (quadratic curve). Front lines compress, units squeeze around congestion.
- **Contact line** — formations grouped by owner + cell; **AABB box-gap detection** (front-to-front proximity, NOT centroid distance — centroids stay 100px+ apart at engagement). Contact point = midpoint of front gap/overlap; strength = `1 - gap/CONTACT_RANGE`. Backward push + lateral tangent → front ripples/bends.
- **Velocity alignment** — lerp toward neighbor average velocity (kills jitter, coherent mass flow). Reuses separation-tick SpatialHash query; no double sweep.

Public surface: `.enabled`, `.pressureCellCount`, `.contactLineCount`, `.getContactForce(x, y, owner)`, `.getPressure(cellKey)`, `.applyAlignment(unit)`, `.precompute()`, `.destroy()`.

Tuning constants at top of file: `PRESSURE_DENSITY_MAX=8`, `PRESSURE_FORCE_MAX=60`, `CONTACT_RANGE=60`, `CONTACT_BACKWARD_FORCE=80`, `CONTACT_LATERAL_FORCE=50`, `DEFORMATION_SCALE` lives in UnitSystem (0.15).

### 2. UnitSystem.ts integration
- `applyLiquidSteering(unit, time)` called INSIDE the existing rotating bucket loop (after `updateUnitLogicTimed`, ~line 172-177) — no starvation, no new loop, `maxUnitsPerFrame` respected.
- Accumulates forceX/forceY from pressure + contact-line + alignment; stores on `unit.modifiedOffset = { x: forceX * 0.15, y: forceY * 0.15 }`.
- Skips civilians, flow-field units, disabled physics bodies (early-return → stress mode shows nothing by design).

### 3. SquadSystem.ts renderSquad
- Inline per-soldier projection of `unit.modifiedOffset` with **alignment weight**: front soldiers (0.5–1.0) deform fully, rear (0–0.5) barely → "wall of bodies" front compression, coherent rear.
- Zero per-frame allocation.
- Stress cache `deformKey` now includes `round(mo.x)|round(mo.y)` → combat deformation triggers redraws.

### 4. types.ts
- `GameUnit.modifiedOffset?: { x: number; y: number }` (line ~224).

### 5. MainScene.ts
- `liquidCombat` system instantiated + wired into update loop (after enemy AI, before economy per AGENTS.md order). Debug fields on scene.

### 6. Tests — `game/systems/LiquidCombatSystem.test.ts` (NEW)
- **18/18 pass.** Covers: pressure gradient, contact line detection (opposing pair, out-of-range, neutral exclusion, diagonal tangent, closer=stronger, CONTACT_RANGE boundary), velocity alignment (neighbor average, civilian exclusion, <2 neighbors no-op), mode gating (peaceful no-op, stress+enemies computes, disabled no-op), lifecycle (destroy clears).
- Mock pattern mirrors ProceduralSoundSystem.test.ts (vi.mock phaser, duck-typed scene).

## Verification evidence (last run)

`node scripts/liquid-combat-normal-verify.mjs` (normal game, 42v42 Pikesman, ISO camera, zoom 2 → LOD_FULL):
```
liquid system live:     PASS (pressure=3)
contact lines firing:   FAIL (front gap 163.3px, contact=0)
modifiedOffset applied: PASS (88/88 units)
visible deformation:    PASS (47 units > 1px, max 9px)
LOD_FULL rendering:     PASS (88/88 units)
errors:                 NONE
```
- Pressure deformation works and is visible (front units squeeze ~4-9px).
- Screenshots: `shots/liquid-combat-normal-t1-melee.png` (battle visible, blue vs green Pikesman blocks, HP dropping = real combat), `t2-late.png`.
- **Contact lines = 0 because fronts never close.** Front gap stays ~160px — melee units won't advance into attack range (40px). This is the PRE-EXISTING melee-engagement bug, not the liquid system.

## THE BLOCKER — melee units don't engage (pre-existing bug, user confirmed)

- Symptom: armies stop ~160px apart, units sit in CHASING, never reach ATTACKING (`dist <= range` at `UnitSystem.ts:912` never true).
- Location: `UnitSystem.ts handleCombatState()` (line 859+), `shouldRepathChase`/`combatPath.ts`, pathfinder routing. Units mid-chase lose momentum; repath logic (`findResumePathStep`, `_chaseTargetPos` staleness at 80px, `pathEndNearTarget`) may stall them short of range.
- Known issue: GAUNTLET_PROMPT.md item #3 "Melee units don't consistently engage" (line 87-90) — pre-dates this feature.
- User's prior ask: "ini yang kemaren sempet gw bring up" — they know this bug, want it checked/fixed.
- Suggested next: reproduce with minimal repro script, check `dist` vs `range` live during chase, look at pathfinder terminal-cell arrival (units stop 1 cell early → 100px short), or verify `explicitTarget`/stance tether isn't dropping CHASING.

## If contact lines still don't fire after engagement fix

1. `CONTACT_RANGE` 60 → 120 (fronts at melee engage ~40-80px apart; AABB gap may still exceed 60).
2. Consider contact lines firing on *any* opposing formation within `CONTACT_RANGE + attackRange` (40px) — i.e. anticipate engagement.
3. `DEFORMATION_SCALE` 0.15 → 0.3 if 9px max looks subtle at full zoom.

## Scripts (all Playwright, proven pattern from profile-stress.mjs)

| Script | Purpose |
|---|---|
| `scripts/liquid-combat-normal-verify.mjs` | Main verifier: spawns 42v42, forces attack, probes modifiedOffset/pressure/contact/LOD, screenshots t1(8s)+t2(14s), verdict. **WORKS — use this.** |
| `scripts/liquid-combat-verify.mjs` | Stress-mode precompute probe (pressure/contact counts only; deformation impossible in stress by design). |
| `scripts/compare-normal-stress.mjs` | Pre-existing perf comparison (not this session). |
| `scripts/test-contact-overlap.mjs` | BROKEN test sketch (require/ESM mix) — **do not use**, delete or rewrite as Vitest. Contact math is already covered by the 18 Vitest tests. |

## How to run verification

```bash
# dev server must be on localhost:5173 (currently running — do not restart)
node scripts/liquid-combat-normal-verify.mjs
```

Key facts for the verify script (do not "fix" them):
- Fog of War is ON by default in lobby → script clicks the toggle before Commence.
- Camera is ISO space: `centerOn(toIso(x,y))` = `{x: x-y, y: (x+y)*0.5}`, zoom 2 → LOD_FULL (<800px screenDist/zoom).
- Stress mode disables physics bodies → steering early-returns; use NORMAL mode for deformation, stress only for precompute counts.

## Perf note

- All forces ride existing budgeted bucket; no O(n²). Pressure O(cells), contact O(formations²) with formations << units, align piggybacks separation tick.
- Stress baseline already committed (277e1b9): 42.81 FPS avg @5k entities, CPU ~6ms. Liquid precompute adds negligible cost (pressureCells:13, contactLines:10, enabled:true, zero errors in stress run).

## Repo state

Uncommitted on `main` (this session): `types.ts`, `UnitSystem.ts`, `SquadSystem.ts`, `MainScene.ts`, `AGENTS.md` (minor), `.fallow-report.json` (minor); untracked: `LiquidCombatSystem.ts`, `LiquidCombatSystem.test.ts`, `scripts/liquid-combat-verify.mjs`, `scripts/liquid-combat-normal-verify.mjs`, `scripts/compare-normal-stress.mjs`, `scripts/test-contact-overlap.mjs` (delete or ignore). Head: `16f6b90 fix: Pathfinder dynamic map dims`.

**Next session: fix melee engagement (blocker) → verify contact lines fire → tune DEFORMATION_SCALE → visual pass on screenshots → commit as `feat/liquid-combat`.**
