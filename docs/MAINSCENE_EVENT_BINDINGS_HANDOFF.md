# MainScene Decomposition — SceneEventBindings Handoff

## Objective

Continue decomposing `game/MainScene.ts` after the `WorldBootstrap` extraction.

Extract the **event listener/binding layer** from `MainScene.create()` into a narrow `SceneEventBindings` abstraction while preserving all current event names, handler behavior, ordering, and teardown semantics.

This slice is intentionally about **wiring**, not gameplay ownership.

## Target abstraction

Preferred location:

`game/bootstrap/SceneEventBindings.ts`

Alternative:

`game/systems/SceneEventBindings.ts`

Prefer `bootstrap/` because this abstraction binds the scene to existing systems and external UI/game events; it is not itself a simulation system.

## What to extract

Move the event-registration blocks currently in `MainScene.create()` that primarily do:

### `this.game.events` bindings

- `request-unit-spawn`
- `EVENTS.SET_TAX_RATE`
- `EVENTS.CENTER_CAMERA`
- `EVENTS.SET_GAME_SPEED`
- `EVENTS.SET_BLOOM_INTENSITY`
- `set-bloom-intensity-ui`
- `request-set-formation`
- `request-set-stance`
- `EVENTS.ADVANCE_AGE`
- `EVENTS.START_RESEARCH`
- `release-garrison`
- `save-game`
- `load-game`

### Scene-level event bindings

- `EVENTS.RESEARCH_COMPLETED`
- `EVENTS.SEASON_CHANGED`
- `EVENTS.AI_AGE_ADVANCED`
- any other `this.events.on(...)` registration in `create()` whose job is wiring/notification rather than owning the underlying gameplay rule.

### Window / DOM bridge binding

- `minimap-click-ui` listener and its matching teardown.

### Renderer lifecycle instrumentation

Do **not** move performance measurement yet. The renderer `prerender/postrender` hooks belong to the later `PerformanceProfiler` slice.

## What NOT to extract

Do not move these responsibilities into `SceneEventBindings`:

- `handleUnitSpawnRequest()` implementation
- `startAgeAdvancement()` / `completeAgeAdvancement()` implementation
- `checkWinLose()` / `checkDominance()`
- save/load implementation
- stress-test setup
- simulation scheduling
- performance profiling
- rendering synchronization
- system construction
- terrain/water initialization

`SceneEventBindings` should **call** those owners, not absorb their implementation.

## Important ownership rule

The new abstraction should be a thin wiring layer.

Good:

```ts
bindings.bind();
```

with handlers delegating to the existing scene/system methods.

Bad:

```ts
class SceneEventBindings {
  // 500 lines of actual game logic
}
```

If a callback contains substantial business logic, extract only the registration and keep the business logic in the existing owner, or create a later dedicated owner if justified.

## API shape

A conservative API is preferred:

```ts
export class SceneEventBindings {
  constructor(private readonly scene: MainScene) {}

  bind(): void {
    this.bindGameEvents();
    this.bindSceneEvents();
    this.bindExternalEvents();
  }

  dispose(): void {
    // remove only listeners owned by this binder
  }
}
```

Use Phaser's context argument consistently where the existing code already relies on it.

For anonymous event callbacks, preserve behavior exactly. Do not silently change event emitter targets (`this.events` vs `this.game.events`).

## Teardown requirement

Today `MainScene` explicitly removes the `minimap-click-ui` window listener on scene shutdown.

The extracted binder should make ownership explicit:

```text
SceneEventBindings.bind()
        ↓
register listeners
        ↓
Scene SHUTDOWN
        ↓
SceneEventBindings.dispose()
```

Do not accidentally remove Phaser listeners that are automatically scoped to the scene. Only explicitly detach external/global listeners that require manual cleanup.

## Dependency direction

Desired:

```text
MainScene
   ↓
SceneEventBindings
   ↓
existing scene/system owners
```

Avoid:

```text
SceneEventBindings ↔ MainScene
```

A `MainScene` reference is acceptable for this conservative slice because existing methods and public systems are the current compatibility boundary. Do not introduce a broader service-locator abstraction.

## MainScene result

`create()` should become conceptually:

```ts
new WorldBootstrap(this).initialize();

// world/terrain/water bootstrap that is not yet extracted

// initial scenario/entity setup

new SceneEventBindings(this).bind();

// UI camera setup / stress setup / remaining lifecycle setup
```

Do not require an exact ordering if the existing code proves a different order is necessary. Preserve all dependencies such as `minimapSystem`, `fogOfWar`, `economySystem`, `inputManager`, and `researchManager` being initialized before their respective listeners are registered.

## Acceptance criteria

1. `MainScene.create()` has materially less event-registration noise.
2. Event names and emitter targets are unchanged.
3. Handler behavior is unchanged.
4. `minimap-click-ui` still works and is removed on scene shutdown.
5. No business logic is duplicated in `SceneEventBindings`.
6. No new circular module dependency is introduced.
7. `npm run verify` passes.
8. Existing fixed/infinite map and stress-test boot paths still initialize without event-related regressions.
9. Scene restart does not accumulate duplicate external listeners.

## Verification checklist

At minimum:

```bash
npm run verify
```

Then inspect:

- set game speed
- set tax rate
- center camera
- bloom controls
- formation/stance controls
- unit spawn request
- age advancement request
- research request/completion
- garrison release
- save/load events
- minimap click
- season/AI-age notifications
- scene shutdown and re-entry for duplicate listener leaks

Do not broaden this PR into performance or gameplay refactors.

## Next slice

After this is stable, target:

`PerformanceProfiler`

Extract the `window.__perf` setup, renderer timing hooks, frame profiling accumulators, and reporting into a dedicated instrumentation owner, while leaving simulation timing itself in `MainScene` until the later `SimulationScheduler` slice.
