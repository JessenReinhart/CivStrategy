# MainScene Decomposition — Agent Handoff / Patch Spec

## Objective

Begin decomposing `game/MainScene.ts` incrementally. Do **not** rewrite MainScene wholesale. Preserve gameplay behavior, event names, save semantics, update ordering, and existing Phaser lifecycle behavior.

This document is the implementation brief for the next coding agent.

## Current diagnosis

`MainScene` currently owns too many responsibilities at once:

- Phaser lifecycle (`preload`, `init`, `create`, `update`, shutdown)
- authoritative game state
- construction/wiring of ~20+ systems
- Phaser groups and spatial indexes
- terrain/map/water bootstrap
- starting entity bootstrap
- input/UI event binding
- stress-test setup/debug controls
- performance instrumentation
- periodic economy/season/age/autosave scheduling
- victory/dominance checks
- save/load facade
- spatial-hash maintenance
- rendering projection/synchronization

The goal is to reduce coupling by extracting **ownership**, not merely moving code to make the file shorter.

## First slice: WorldBootstrap

Extract the **construction and dependency assembly** portion of `create()` into a narrow helper, tentatively:

`game/systems/WorldBootstrap.ts`

or, if a non-system composition helper is clearer:

`game/bootstrap/WorldBootstrap.ts`

Prefer the latter if the abstraction is explicitly lifecycle/composition rather than gameplay behavior.

### WorldBootstrap should own

1. Creation of core Phaser groups:
   - `units`
   - `buildings`
   - `trees`
   - `treeVisuals`
   - `worldVisuals`
   - `worldLayer`
   - `groundLayer`

2. Creation of foundational infrastructure:
   - `Pathfinder`
   - `treeSpatialHash`
   - `unitSpatialHash`

3. Registration of group listeners that keep spatial hashes synchronized.

4. Construction of systems and their dependency order, including:
   - `EntityFactory`
   - `SquadSystem`
   - `UnitSystem`
   - `BuildingManager`
   - `EconomySystem`
   - `InputManager`
   - `EnemyAISystem`
   - `MapGenerationSystem`
   - `CullingSystem`
   - `FeedbackSystem`
   - `AtmosphericSystem`
   - `VillagerSystem`
   - `AnimalSystem`
   - `ProceduralSoundSystem`
   - `ClashSystem`
   - `LiquidCombatSystem`
   - `ResearchManager`
   - `TerrainSystem`

5. Terrain initialization that is clearly part of world bootstrap:
   - generate height map
   - flatten spawn-safe regions
   - generate rivers
   - apply terrain visual tinting
   - wire terrain costs into Pathfinder

6. Fixed/infinite map world initialization boundary:
   - fixed map physics bounds
   - infinite map system construction

### WorldBootstrap should NOT own

Do not put these into the new abstraction yet:

- game rules (`checkWinLose`, dominance, age advancement)
- periodic scheduling (`update` timers)
- UI/game event listeners
- save/load behavior
- performance profiler
- stress-test harness
- victory handling
- unit commands
- React bridge behavior
- general rendering synchronization
- arbitrary gameplay logic

Those are later slices.

## Dependency direction

The desired direction is:

```text
MainScene
   ↓
WorldBootstrap
   ↓
construct/wire systems + world infrastructure
```

Avoid:

```text
WorldBootstrap → MainScene → WorldBootstrap
```

A bootstrap helper may receive a narrow composition context if necessary, but do not create a generic `scene` dumping ground. If direct `MainScene` access is unavoidable because existing system constructors require it, keep the dependency local and document why. Do not broaden it unnecessarily.

## MainScene API stability

Existing systems currently expect public properties on `MainScene`, so the first slice should **not** attempt a broad dependency inversion.

Keep the public properties intact for now. The goal of this slice is to centralize construction, not to redesign every system interface.

## Suggested shape

A practical starting shape is:

```ts
export class WorldBootstrap {
  constructor(private readonly scene: MainScene) {}

  initialize(): void {
    this.createWorldInfrastructure();
    this.createSystems();
    this.initializeTerrain();
    this.initializeMapBounds();
  }

  private createWorldInfrastructure(): void { ... }
  private createSystems(): void { ... }
  private initializeTerrain(): void { ... }
  private initializeMapBounds(): void { ... }
}
```

Then `MainScene.create()` should call approximately:

```ts
const bootstrap = new WorldBootstrap(this);
bootstrap.initialize();
```

If a better API avoids keeping `MainScene` as a broad field, use it—but keep the first refactor conservative.

## Important water boundary

The large marching-squares water rendering block in `create()` is **not** part of WorldBootstrap extraction beyond the minimum map-boundary setup needed to initialize the world.

Leave water rendering for its own future `WaterRenderer` slice. Do not accidentally move hundreds of lines of water rendering logic into `WorldBootstrap`, because that simply creates another god-class.

## Starting entity bootstrap

Do not aggressively move player/AI starting entity spawning in the first pass unless it is clearly isolated by existing helper calls. It can remain temporarily in `MainScene.create()`.

Later, consider a dedicated `ScenarioBootstrap`/`InitialStateSpawner`.

## Acceptance criteria

The PR is successful when:

1. `MainScene.create()` is materially easier to read.
2. System construction and world infrastructure have one clear owner.
3. No gameplay rule changes occur.
4. Existing public `MainScene` system properties remain available.
5. Update order is unchanged.
6. Event names are unchanged.
7. Fixed and infinite map initialization both still work.
8. Save/load semantics are unchanged.
9. No new circular dependency is introduced.
10. Typecheck, lint, tests, and production build pass.
11. The new abstraction is reusable for the next decomposition slices rather than becoming another dumping ground.

## Verification checklist

Run:

```bash
npm run verify
```

Then specifically inspect:

- normal fixed-map boot
- infinite-map boot
- stress-test boot (`?stress=500` and `?stress=1000`)
- system construction order
- terrain/pathfinder initialization
- group spatial-hash listeners
- shutdown behavior for audio/clash listeners

Do not declare success solely because TypeScript compiles.

## Next slices after this one

After WorldBootstrap is stable:

1. `SceneEventBindings`
2. `PerformanceProfiler`
3. `StressTestHarness`
4. `WaterRenderer`
5. `SimulationScheduler`
6. `VictorySystem`
7. `GamePersistence`
8. `UnitSpatialIndex`
9. remaining scene composition

Keep each slice independently reviewable and behavior-preserving.
