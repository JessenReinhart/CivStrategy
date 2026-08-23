# CivStrategy Gauntlet Loop

**Pattern:** Matt Shumer's Gauntlet Loop — single orchestration prompt, fan-out subagents, independent critics, repeat until passing.

**Primary Objective:** Deliver a playable, visually coherent, and performant RTS that meets quality bars for both content completeness and 60 FPS at 5,000 active units.

**North Star:** Before major gameplay, UI, visual, or performance work, read `NORTH_STAR.md`. It is the persistent product-quality reference. This file defines the execution loop; `NORTH_STAR.md` defines what "AAA-level" means for CivStrategy and should be used by builders and fresh critics when judging whether a result is actually done.

---

## The Prompt

```
I want you to build a polished, bug-free, high-performance real-time strategy game
in Phaser 3 + React that is fun to play and runs at 60 FPS with 5,000 active units.

The current codebase exists at ~/CivStrategy. It has systems for terrain, units,
buildings, economy, combat, pathfinding, and UI — but it is missing visual effects,
has gameplay bugs, and fails performance targets.

Before selecting or judging work, read NORTH_STAR.md and use it as the product-quality bar.

## Quality Bars (These are the reference standards — compare against them)

**Gameplay Bar:**
- Melee units chase and attack enemies within range (no stuck/wander states)
- Slinger and all ranged units fire visible projectiles with trajectory
- Screen shake only triggers when combat is within camera view (~500px)
- Damage numbers, hit feedback, and unit death effects all render correctly
- Build placement, resource deduction, and undo (Ctrl+Z) work reliably
- AI spawns symmetrically at game start, builds, recruits, and attacks
- Save/load round-trips state correctly (units, buildings, resources, AI buildIndex)
- Dominance/win detection works but does not fire on first building placement
- Forest concealment, river penalties, and wall defense modifiers all apply

**Visual/Feedback Bar:**
- All unit types have distinguishing visual feedback on attack, hit, and death
- Building states (intact/damaged/destroyed) are visually clear
- Projectiles are visible and track targets
- Floating combat text is readable and positioned correctly
- Fog of war reveals/explores correctly without pure black
- Atmospheric effects (bloom, clouds, vignette) do not wash out the screen

**Performance Bar:**
- p95 frame time ≤ 16.67 ms at 5,000 active units (?stress=5000)
- Minimum FPS ≥ 60 over 20s capture window
- updateMs (game logic) ≤ 12 ms; renderMs (Phaser WebGL) ≤ 4.67 ms
- Top-3 system hogs identified and reduced below 5 ms each

**Reference for "great":**
- Gameplay feel: 0 A.D. RTS combat (chase, attack, retreat, abilities)
- Visual clarity: Isometric RTS with readable unit states at scale
- Performance bar: Hollow shell baseline passes (p95 = 12.5 ms); visible rendering must not exceed 16.67 ms p95

---

## The Loop

**Step 1 — Decompose:** Split the work into the smallest independently judgeable parts:
- Combat: melee chase/attack, ranged projectiles, wall defense, garrison fire
- Visual FX: hit feedback, damage numbers, death effects, shake culling
- Systems: AI behavior, building placement, economy, save/load, dominance
- Performance: WebGL batching, spatial hash, LOD, culling interval tuning

**Step 2 — Gap Discovery (mandatory before building):**
Each builder MUST first survey their domain for known and hidden gaps, not just fix what's listed. Scan the relevant codebase files for:
- Missing feature wiring (e.g., a unit type defined but no code handles it)
- Hardcoded defaults that override intended behavior (e.g., fallback || 40 for range)
- Unchecked conditions that silently skip logic
- Copy-pasted patterns where the fix was applied once but not everywhere it applies

Report every gap found, then prioritize: fix the highest-impact bugs first, then surface remaining gaps in your cycle summary so the next builder can pick them up.

**Step 3 — Fan out builders:** Assign each part to a separate builder subagent.
Builders should read relevant code, identify the bug or gap, and fix it.
Do not parallelize tightly coupled systems — fix one system's logic before
optimizing its rendering.

Known bugs to start with (verify each, then fix):

1. **Slinger / CHARIOT no projectile visual**
   - Location: game/systems/UnitSystem.ts, performAttack() ~line 1010
   - Bug: Only UnitType.ARCHER gets fireProjectile(). SLINGER (range 180, Pierce/Crush) and CHARIOT (range 180, Pierce) fall through to the melee branch — damage works but no arrow/rock flies.
   - Fix: Treat any unit with range > meleeRange (~60) as ranged → call fireProjectile() instead of lunge animation. Do NOT change the damage logic — it's already correct.

2. **Screen shake fires regardless of camera distance**
   - Location A: game/systems/BuildingManager.ts line 258, emitExplosionParticles() — unconditional shake(150, 0.005)
   - Location B: game/utils/MeatGrinderEffect.ts line 28 — unconditional shake(200, 0.004)
   - Fix: Before shaking, compute world-to-screen position. Skip the shake if the event's iso-screen position is more than ~500px outside the camera viewport bounds.

3. **Melee units don't consistently engage**
   - Location: game/systems/UnitSystem.ts, handleCombatState()
   - Verify: After fixing #1, test that non-archer ranged units and melee units both enter ATTACKING state correctly. The dist <= range check should work now that range is properly set on all units (verified: range is set via setData in EntityFactory).

**Step 4 — Independent critics with fresh context:** After each builder finishes,
spawn a separate critic that has never seen the builder's reasoning. The critic:
- Inspects the real artifact (runs the code, takes screenshots, runs the profiler)
- Compares directly against NORTH_STAR.md and the quality bars above
- Uses scripts/profile-stress.mjs for performance; npm run test for logic
- Names the largest remaining gap with evidence
- Reports ALL gaps found, even ones outside the original scope

**Step 5 — Iterate:** If any critic fails, feed the gap back to the builder and repeat.
Continue until all critics pass or improvements no longer justify the cost.

**Step 6 — Integration pass:** When all parts pass individually, spawn a final
fresh critic to inspect the complete game: does it feel coherent? Do systems
interact correctly? Any regressions from fixes?

---

## Boundaries

- Do not deploy or touch production — this is a local dev build only
- Do not spend money, use credentials, or contact external services
- Stop after 4 hours, 3 failed approaches on the same gap, or if the user intervenes
- Escalate blockers requiring human judgment (unclear design decisions, subjective visual calls)
- Record progress in GAUNTLET_PROGRESS.md: what changed, evidence, next action

---

Finish with a summary: what was fixed, what still fails, and by how much each metric improved.
```

---

## Supporting Artifacts

### Product Quality Reference
Read `NORTH_STAR.md` before selecting major gameplay/UI work and again during critic review.

### Gauntlet Progress Tracker
Maintain GAUNTLET_PROGRESS.md throughout the run. One section per cycle.

### Verification Commands (for critics to run)

```bash
npm run test
npx tsc --noEmit
npm run lint
npm run verify
node scripts/profile-stress.mjs
cat profile-results.json | jq '.percentiles, .hogs'
open progress.html
```

### How to Run

1. Open a fresh Claude Code session (or any agentic environment with subagent support)
2. Paste the prompt above
3. The lead agent will decompose, discover gaps, fan out builders, and loop with critics
4. Monitor GAUNTLET_PROGRESS.md for cycle-by-cycle status
5. Stop condition: all quality bars met, or boundaries fire, or you intervene

---

## Notes

- The hollow shell baseline (no visible rendering) already passes: p95 = 12.5 ms. The bottleneck is Phaser WebGL rendering, not game logic.
- Each stress unit in ?stress=5000 has orbital movement but no pathfinding/combat — the performance bar is about rendering 5,000 entities, not AI computation.
- Use STRESS_RENDER_INTERVAL (currently 20) to tune render frequency during stress tests.
- Key insight: the slinger bug is a pattern bug. Any ranged unit (range > ~60) bypasses fireProjectile(). Check CHARIOT too.
```
