# Agent Runtime Guardrails

These rules complement `AGENTS.md`; they do not replace the repository's existing game-specific context.

## Non-negotiables

- Simulation state is authoritative; Phaser objects are projections.
- MainScene is composition/wiring, not the default place for new gameplay logic.
- Prefer focused system/service boundaries over new `system -> MainScene -> system` coupling.
- Do not let UnitSystem become the catch-all home for combat, rendering, effects, pathing, formations, and lifecycle concerns.
- Fix recurring bug patterns at the abstraction level and search sibling implementations before patching one call site.
- Optimize from measured evidence: distinguish simulation time, rendering/draw pressure, allocations, and memory.
- Bound high-frequency transient visuals with pools or equivalent reuse.
- Treat runtime verification as part of completion; tests passing alone are not sufficient evidence of correctness.

## Change discipline

Before a code change, trace state ownership and callers. After a code change, inspect affected adjacent paths for the same class of failure. Prefer the smallest change that improves the underlying abstraction and keeps gameplay behavior stable.
