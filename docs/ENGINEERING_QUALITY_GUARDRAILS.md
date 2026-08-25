# Engineering Quality Guardrails

CivStrategy is developed heavily by autonomous agents. The codebase must not slowly turn into a history of small AI-generated patches, tests, and comments. Quality rules should preserve the game as a coherent product.

## Core rule

**Test player behavior, simulation behavior, and durable system invariants. Do not optimize for test count or coverage percentage.**

A test should fail when gameplay, simulation, persistence, performance assumptions, or user flows break. Harmless refactoring should not cause unrelated tests to fail.

## Preferred test order

Use the highest-value level that proves the acceptance criterion with reasonable cost:

1. **Gameplay / system integration tests** for behavior that crosses multiple game systems.
2. **Scenario tests** for player flows such as build, gather, train, move, fight, save, load, and continue.
3. **Focused unit tests** for deterministic algorithms and helpers such as pathing, economy math, save compatibility, formation logic, or spatial queries.
4. **Visual or browser verification** when rendering, input, HUD, scene transitions, or Phaser/React integration is the actual acceptance criterion.

Playwright is available in the repository. Use browser-level verification when a bug only becomes meaningful through the running game rather than forcing it into a unit test.

## Player-flow bias

Prefer tests that answer questions a player or game designer would care about:

- Can an army receive a command, move, deform under pressure, engage, and resolve combat without getting stuck?
- Does saving and loading preserve the state needed to continue the same game?
- Does an economy action produce the expected resource and population changes over time?
- Does stress mode measure the real gameplay path rather than a synthetic shortcut that hides regressions?
- Does the game remain responsive and coherent at the unit counts claimed by the performance target?

Do not split one player behavior into many tiny tests simply because several implementation details changed in separate tasks.

## Test suite shape

Organize tests by game domain or subsystem, not by the issue or PR that introduced them.

Before creating a new test file:

1. Check whether the case belongs in an existing subsystem suite.
2. Prefer adding a coherent `describe` block to that suite when setup and domain are shared.
3. Create a new file only when the behavior has a distinct boundary, setup, runtime, or verification strategy.
4. Name suites after durable systems and behavior, not task history.

A family of one-off regression files that mirrors issue history is a maintenance smell even if each individual test is valid.

## Comments

Comments should explain **why**, not narrate **what** the next line does.

Keep comments for:

- coordinate-space invariants;
- simulation ownership and lifecycle constraints;
- measured performance tradeoffs;
- non-obvious Phaser/browser behavior;
- save compatibility or serialization requirements;
- gameplay rules that are not obvious from code alone.

Avoid comments that:

- restate the following line;
- preserve PR history such as `Fix 1`, `second fix`, or issue-specific patch notes;
- explain obvious loops, assignments, or conditionals;
- become stale when names or implementation details change.

If patch history matters, put it in the PR. If the reason matters in the codebase, rewrite it as a durable rule or constraint.

## Performance verification

Do not treat a passing unit test as proof of smooth gameplay.

Performance-sensitive changes should distinguish:

- simulation CPU time;
- rendering/draw pressure;
- allocation and garbage-collection pressure;
- pathfinding or spatial-query cost;
- browser/GPU behavior;
- synthetic stress behavior versus normal gameplay behavior.

Use existing benchmark and trace tooling when relevant. Report measured evidence, not assumptions.

## Autonomous agent review checklist

Before publishing a PR, the agent must ask:

- Does each test prove gameplay/system behavior or a real invariant?
- Would a harmless refactor break this test? If yes, is it too coupled to implementation?
- Did I create a new test file because it is a real domain boundary, or because this task was separate?
- Could several fragmented tests become one clearer scenario?
- Did I add comments that narrate code or preserve patch history?
- Did I verify the running game when the acceptance criterion is visual, interactive, or performance-sensitive?
- Am I reporting observed validation rather than inferred confidence?

The goal is not fewer tests. The goal is stronger evidence that the game is correct, smooth, maintainable, and coherent as a whole.
