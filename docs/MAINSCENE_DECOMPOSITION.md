# MainScene Decomposition

`game/MainScene.ts` is currently the composition root, simulation state owner, Phaser lifecycle owner, rendering coordinator, UI/event bridge, stress-test harness, and several gameplay orchestrators at once.

The goal is **not** to rewrite it in one pass. Extract one ownership seam at a time while preserving behavior.

## Planned slices

| Slice | Current responsibility in MainScene | Target abstraction | Risk |
|---|---|---|---|
| 1 | world/system bootstrap | `WorldBootstrap` / explicit scene composition helpers | Low–Medium |
| 2 | UI/game event bindings | `SceneEventBindings` | Low |
| 3 | performance instrumentation | `PerformanceProfiler` | Low |
| 4 | stress-test setup/debug controls | `StressTestHarness` | Low |
| 5 | water generation/render bootstrap | `WaterRenderer` | Medium |
| 6 | periodic simulation scheduling | `SimulationScheduler` | Medium |
| 7 | victory/dominance evaluation | `VictorySystem` | Medium |
| 8 | save/load facade | `GamePersistence` | Medium |
| 9 | unit spatial-index maintenance | `UnitSpatialIndex` | Medium |
| 10 | remaining scene composition | thin `MainScene` composition root | High, final step |

## Rules for each slice

1. Preserve public behavior and existing event names.
2. Do not move authoritative state merely to reduce line count.
3. Extract ownership, not arbitrary blocks of code.
4. Keep new abstractions narrow and dependency-directed.
5. Avoid introducing `NewSystem -> MainScene -> NewSystem` cycles.
6. Run the smallest relevant tests first, then the full verification suite.
7. Compare runtime behavior before/after; a smaller `MainScene.ts` is not itself a success metric.

## First code target: world/bootstrap composition

`create()` currently constructs nearly every system, creates groups/spatial indexes, generates terrain/rivers/water, initializes starting entities, wires input and UI events, and configures cameras. This is the clearest structural seam because it is mostly lifecycle/composition work rather than game-rule ownership.

The first refactor should extract **construction and wiring**, not move gameplay logic into another god-class. `MainScene` should remain the Phaser lifecycle boundary while a bootstrap/composition helper owns dependency assembly.

## What success looks like

After the first slices, the top-level scene should read more like:

```text
preload()
init(config)
create() -> compose world + bind events + start runtime
update() -> ordered runtime ticks + rendering projection
shutdown() -> teardown owned resources
```

The long-term target is a thin scene that coordinates specialized owners rather than storing every concern itself.
