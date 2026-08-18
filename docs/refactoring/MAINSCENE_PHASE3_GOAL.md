# MainScene Refactor — Phase 3 Goal

Continue refactoring `game/MainScene.ts` on the current `main` branch.

PR #8 extracted SimulationRuntime.
PR #9 extracted WorldRuntime.

## Mission

Identify the **best remaining cohesive subsystem** in the complete MainScene and extract it into a clean runtime/module.

- Inspect the full MainScene first; do not assume the subsystem.
- Keep the extracted runtime independent of MainScene.
- A temporary MainScene adapter/bridge is acceptable.
- Preserve all existing behavior, ordering, timing, profiling, throttling, and lifecycle semantics.
- Do not rewrite unrelated code or introduce abstractions just to move code.
- Add meaningful tests for the extracted behavior.
- Run typecheck, lint, tests, and build/CI.
- Update refactor documentation when appropriate.
- Keep this phase focused on **one major responsibility**.
- Create a focused PR and do not merge it automatically.

## Target Architecture

```text
MainScene = thin composition / lifecycle / orchestration layer
Game domains = cohesive, independently testable modules
```

Prefer fewer cohesive modules over many fragmented managers.

## Handoff

When complete, report:

1. What was extracted and why.
2. Files changed.
3. What responsibility left MainScene.
4. Resulting dependency structure.
5. Validation results.
6. Remaining major MainScene responsibilities.
7. Any architectural debt intentionally left for later.
