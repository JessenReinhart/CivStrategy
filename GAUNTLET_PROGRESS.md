# CivStrategy Gauntlet Progress

Live dashboard: http://localhost:5173/PROGRESS.html

---

Tracker for the Gauntlet Loop. One section per cycle.

---

## Cycle 0 — Baseline (2026-08-06)

**Scouts:** CombatScout, FXScout, SystemsScout, PerformanceScout
**Status:** 🔍 Discovery phase

### Known Gaps
| Gap | File | Root Cause | Priority |
|-----|------|-----------|----------|
| Slinger/Chariot no projectile | UnitSystem.ts:~1050 | Only ARCHER gets `fireProjectile()` | High |
| Shake from miles away (demolition) | BuildingManager.ts:463 | No camera-distance check | Medium |
| Shake from miles away (combat) | MeatGrinderEffect.ts:28 | Cooldown only, no distance check | Medium |
| Melee units oscillate | UnitSystem.ts | Repath resets pathStep=0 (fix exists in combatPath.ts) | High |

### Performance Baseline
| Metric | Value | Bar | Status |
|--------|-------|-----|--------|
| p95 | — | ≤ 16.67 ms | ❓ |
| avg FPS | — | ≥ 60 | ❓ |
| min FPS | — | ≥ 60 | ❓ |
| Top hog | — | ≤ 5 ms | ❓ |

*Run `node scripts/profile-stress.mjs` to populate.*

---

## Cycle Template

```
## Cycle N — [Focus Area] (date)

**Builders:** AgentName1, AgentName2
**Critic:** CriticName

### Changes
- [ ] Fix description + evidence

### Critic Verdict
- **Pass/Fail:** 
- **Largest gap:** 
- **Evidence:** 

### Metrics
| Metric | Before | After | Bar | Status |
|--------|--------|-------|-----|--------|
| p95 | | ≤ 16.67 ms | |
| avg FPS | | ≥ 60 | |
| min FPS | | ≥ 60 | |

**Next:**
```

---

## Cycle 3 — Final Summary (2026-08-07)

### Gaps Fixed (7 across Cycles 1-3)

| Gap | Category | Cycle |
|-----|----------|-------|
| Slinger/Chariot projectile | Combat | 1 |
| Melee chase/attack | Combat | 1 |
| Shake distance culling | Visual FX | 1 |
| Damage numbers visible (ranged) | Visual FX | 2 |
| Dominance win gate | Systems | 2 |
| Save/load round-trip | Systems | 2 |
| Stress-mode rendering cost | Performance | 3 |

### Gaps Discovered (9, unfixed)

| # | Gap | File:Line | Category | Priority |
|---|-----|-----------|----------|----------|
| 1 | Animal attacks: no damage numbers/sparks | `AnimalSystem.ts:263-285` | Combat | Medium |
| 2 | Animal-on-animal attacks: no feedback | `AnimalSystem.ts:289-300` | Combat | Low |
| 3 | Castle garrison: no projectile/spark visual | `MainScene.ts:1283-1290` | Visual FX | Medium |
| 4 | Melee vs animal: damage numbers skipped | `UnitSystem.ts:1126` | Combat | Low |
| 5 | Forest concealment FOW inconsistency | `FogOfWarSystem.ts:161-200` | Systems | Medium |
| 6 | Rain of Fire: duplicate 0-damage numbers | `UnitSystem.ts:1576-1579` | Visual FX | Medium |
| 7 | FeedbackSystem: no object pooling or cap | `FeedbackSystem.ts:101-155` | Performance | **High** |
| 8 | Stress projectiles: unbounded allocation | `UnitSystem.ts:1305, 1397` | Performance | **High** |
| 9 | Stress peaceful orbit: setPosition on disabled bodies | `UnitSystem.ts:213-230` | Performance | Medium |

### Performance Metrics

| Metric | Baseline | After Cycle 3 | Target | Status |
|--------|----------|---------------|--------|--------|
| p95 frame time | 26.7 ms | 21.6 ms | ≤ 16.67 ms | ❌ GPU-bound |
| avg FPS | 41.84 | 53.03 | ≥ 60 | ❌ GPU-bound |
| min FPS | 28.49 | 32.89 | ≥ 60 | ❌ GPU-bound |
| Game logic | — | ~3 ms | ≤ 5 ms | ✅ |
| Render phase | — | ~17 ms | — | ❌ GPU bottleneck |

**Bottleneck:** Phaser WebGL rendering (~17 ms). All CPU-side work optimized (~3 ms). Further gains require architectural changes (instanced meshes, draw call batching, terrain baking).

**Next:** High-priority items 7 + 8 (object pooling in FeedbackSystem and projectile emitters) would unlock the remaining gap to 60 FPS. Item 9 (skip orbit loop in stress) is a cheap win.
