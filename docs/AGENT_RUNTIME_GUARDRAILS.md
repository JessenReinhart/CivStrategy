# Agent Runtime Guardrails

These rules complement `AGENTS.md`; they do not replace the repository's existing game-specific context.

Also read `docs/ENGINEERING_QUALITY_GUARDRAILS.md` before adding tests, comments, or verification code.

## Non-negotiables

- Simulation state is authoritative; Phaser objects are projections.
- MainScene is composition/wiring, not the default place for new gameplay logic.
- Prefer focused system/service boundaries over new `system -> MainScene -> system` coupling.
- Do not let UnitSystem become the catch-all home for combat, rendering, effects, pathing, formations, and lifecycle concerns.
- Fix recurring bug patterns at the abstraction level and search sibling implementations before patching one call site.
- Optimize from measured evidence: distinguish simulation time, rendering/draw pressure, allocations, and memory.
- Bound high-frequency transient visuals with pools or equivalent reuse.
- Treat runtime verification as part of completion; tests passing alone are not sufficient evidence of correctness.
- Test player behavior, simulation behavior, and durable system invariants. Do not optimize for test count or coverage percentage.
- Before creating a new test file, check whether the case belongs in an existing domain or subsystem suite. Test organization should follow the game architecture, not issue history.
- Prefer gameplay/system scenarios when a behavior crosses systems. Use browser or visual verification when the acceptance criterion is interactive, rendered, or performance-sensitive.
- Comments must explain durable rationale, constraints, or tradeoffs. Remove comments that merely narrate code or preserve patch history such as `Fix 1`.

## Change discipline

Before a code change, trace state ownership and callers. After a code change, inspect affected adjacent paths for the same class of failure. Prefer the smallest change that improves the underlying abstraction and keeps gameplay behavior stable.

Before publishing, review each added test and comment from a critic perspective. A test should fail for a real gameplay/system regression, not for a harmless refactor. A comment should still make sense after the PR context is forgotten.
