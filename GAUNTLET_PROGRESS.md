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

### Gaps Discovered at Cycle 3 close

This table preserves the Cycle 3 discoveries, but its status is reconciled against current `main` so later Gauntlet runs do not re-select already-landed work.

| # | Gap | File:Line | Category | Priority | Current status |
|---|-----|-----------|----------|----------|----------------|
| 1 | Animal attacks: no damage numbers/sparks | `AnimalSystem.ts:263-285` | Combat | Medium | ✅ Resolved on `main`: unit-target hits emit damage number + hit spark |
| 2 | Animal-on-animal attacks: no feedback | `AnimalSystem.ts:289-300` | Combat | Low | ✅ Resolved on `main`: animal-target hits emit damage number + hit spark |
| 3 | Castle garrison: no projectile/spark visual | `MainScene.ts:1283-1290` | Visual FX | Medium | ✅ Resolved on `main`: garrison fire launches a projectile and emits impact spark feedback |
| 4 | Melee vs animal: damage numbers skipped | `UnitSystem.ts:1126` | Combat | Low | ✅ Resolved on `main`: melee animal hits emit damage number + hit spark before AnimalSystem damage routing |
| 5 | Forest concealment FOW inconsistency | `FogOfWarSystem.ts:161-200` | Systems | Medium | ✅ Resolved on `main`: forest vision reduction is applied to units, herbivore animals, and buildings |
| 6 | Rain of Fire: duplicate 0-damage numbers | `UnitSystem.ts:1576-1579` | Visual FX | Medium | ✅ Resolved on `main`: projectile impacts only emit damage numbers when `dmg > 0` |
| 7 | FeedbackSystem: no object pooling or cap | `FeedbackSystem.ts:101-155` | Performance | **High** | ✅ Resolved on `main`: bounded active counts + reusable effect pools |
| 8 | Stress projectiles: unbounded allocation | `UnitSystem.ts:1305, 1397` | Performance | **High** | ✅ Resolved on `main`: arrow/emitter reuse is bounded and overflow resources are destroyed instead of retained |
| 9 | Stress peaceful orbit: setPosition on disabled bodies | `UnitSystem.ts:213-230` | Performance | Medium | ✅ Resolved on `main`: disabled bodies are skipped and normal peaceful-stress unit work is gated |

### Performance Metrics

| Metric | Baseline | After Cycle 3 | Target | Status |
|--------|----------|---------------|--------|--------|
| p95 frame time | 26.7 ms | 21.6 ms | ≤ 16.67 ms | ❌ GPU-bound |
| avg FPS | 41.84 | 53.03 | ≥ 60 | ❌ GPU-bound |
| min FPS | 28.49 | 32.89 | ≥ 60 | ❌ GPU-bound |
| Game logic | — | ~3 ms | ≤ 5 ms | ✅ |
| Render phase | — | ~17 ms | — | ❌ GPU bottleneck |

**Bottleneck:** Phaser WebGL rendering (~17 ms). All CPU-side work optimized (~3 ms). Further gains require architectural changes (instanced meshes, draw call batching, terrain baking).

**Next:** All Cycle 3 discovered gaps above are now reconciled as resolved on current `main`. Future Gauntlet runs should discover against current code and measured runtime evidence rather than re-selecting this historical list.
