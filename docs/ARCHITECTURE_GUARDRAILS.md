# Architecture Guardrails

CivStrategy is a real-time simulation whose **simulation state is authoritative** and whose Phaser/React layers are projections and interfaces over that state.

## Core boundaries

- **Simulation state is authoritative.** Game rules, unit state, economy, AI decisions, combat outcomes, and victory conditions must not depend on sprite state being correct.
- **Rendering is a projection.** Phaser objects visualize simulation state; they should not become the source of truth for gameplay rules.
- **React is presentation/control.** UI state should flow through explicit game events/commands rather than reaching into arbitrary Phaser internals.
- **Systems own capabilities, not the whole game.** A system should expose a narrow responsibility and avoid becoming a second MainScene.
- **MainScene is composition, not a dumping ground.** New cross-system behavior should be placed in the smallest owning abstraction, with MainScene wiring dependencies and update order.

## Dependency rules

- Prefer one-way dependencies toward stable domain data and explicit service interfaces.
- Avoid adding new `system -> MainScene -> system` chains when a narrower dependency can express the same behavior.
- Do not add gameplay logic solely because the required object is convenient to access through `scene.*`.
- Keep rendering-only concerns out of simulation hot paths whenever practical.
- Shared state should have an explicit owner. Do not create a second copy of authoritative state in a system or UI component.

## Unit/combat rule

`UnitSystem` is responsible for coordinating unit behavior, but it must not become the permanent home for every military concern. New combat features should first identify their owning abstraction (combat resolution, movement/pathing, formation/deformation, effects, projectile lifecycle, etc.) and keep orchestration glue thin.

## Performance rule

Optimize from measured evidence. The current bottleneck is primarily rendering, so do not trade simulation clarity for speculative micro-optimizations. Any substantial performance change should identify whether it improves **update cost, render cost, allocations, or draw pressure** and include before/after evidence when practical.

## Agent workflow

Before changing code:

1. Read the relevant system and its callers.
2. Trace the state ownership and update path.
3. Search for sibling implementations of the same behavior.
4. Fix the abstraction if the same bug pattern can occur elsewhere.

After changing code:

1. Run the smallest relevant test first.
2. Run the full verification suite before declaring completion.
3. Inspect runtime behavior for regressions, not just test output.
4. Record important discoveries in the appropriate handoff/progress document.

The goal is not merely to make the current task pass. The goal is to improve the game while preventing architectural drift.
