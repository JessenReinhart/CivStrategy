# MainScene Refactor

## Goal

Reduce `MainScene` from a large game-system coordinator into a thin Phaser lifecycle/composition layer. Gameplay behavior should remain unchanged while responsibilities move into focused runtime modules.

## Current PR

This refactor is intentionally incremental. New runtime modules are introduced before changing `MainScene`, so each extraction can be reviewed independently and the existing scene remains the behavioral reference until the wiring step.

### Simulation pipeline

- [x] Introduce `game/runtime/SimulationRuntime.ts`
- [x] Capture the existing simulation ordering
- [ ] Wire `SimulationRuntime` into `MainScene`
- [ ] Remove the duplicated simulation pipeline from `MainScene`
- [ ] Build/typecheck
- [ ] Run gameplay/stress verification

## Planned runtime boundaries

### WorldRuntime

Own world/environment orchestration currently performed by the scene:

- infinite-map updates
- fog-of-war updates
- minimap updates
- terrain/environment coordination
- ambient world behavior

### EconomyRuntime

Own time-based economy and progression ticks:

- economy tick
- population tick
- research tick
- seasonal clock
- age advancement progress
- periodic resource lifecycle work

### CombatRuntime

Own combat orchestration that is currently mixed into the scene update loop:

- enemy AI update
- castle garrison firing
- combat-specific periodic checks
- victory/dominance evaluation

### PresentationRuntime

Own non-authoritative presentation synchronization:

- unit/building visual synchronization
- atmospheric updates
- feedback/notifications
- procedural sound
- UI camera synchronization

## Target MainScene responsibilities

After the extractions, `MainScene` should primarily own:

1. Phaser lifecycle (`preload`, `create`, `update` wiring).
2. Scene/camera/rendering primitives.
3. Runtime composition and dependency construction.
4. Player input wiring.
5. High-level game/session state that genuinely belongs to the scene.

It should not contain the implementation details of every simulation subsystem.

## Refactoring rule

Prefer **one responsibility per extraction** and preserve update ordering. Do not rewrite unrelated gameplay systems while moving orchestration. Each step should leave the game behaviorally equivalent unless the PR explicitly states otherwise.
