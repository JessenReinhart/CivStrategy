# Phase 9 — E2E Journey Results (Round 24)

Run against the live Vite dev server via Playwright (`scripts/*.mjs`).

| Journey | Result | Notes |
|---|---|---|
| `new-game-config-journey.mjs` | PASS | `ready: true`, faction/config round-trip |
| `day-night-journey.mjs` | PASS | `passed: true` |
| `villager-gather-journey.mjs` | PASS | `phase: passed`, worker assignment rebuilt |
| `army-combat-journey.mjs` | PASS | `phase: complete` |
| `canonical-play-session-journey.mjs` | PASS | **Complete end-to-end**: `phase: complete`, `browserErrors: []`. Training works (food 200, gold 50, pop 6->7, Pikesman trained), combat works, double-save cold load verified. Fixed by removing the blocking external fog texture load (`FogOfWarSystem.createFogCloudsTexture`). |
| `save-reload-journey.mjs` | PASS | `storedWorkforceTarget: 1`, `coldReloadWorkforce: 1`, `afterLoad: 6 pop / 13 maxPop`, camera arrow pan responsive, zero browser errors. |

## save-reload-journey: verified green

Re-ran `save-reload-journey.mjs` against the current build after the fog fix.
It completes (`storedWorkforceTarget`/`coldReloadWorkforce`/`reopenedWorkforce`
all reconciled), the restored camera pans under arrow input, and `browserErrors`
is empty. The stale live-reload concern documented in Round 24 is resolved in the
current flow.

## Related evidence

- Unit suite: 69 files / 511 tests green (includes `SaveSystem.deserialize`,
  `storage`, `meta`, `research`).
- Coverage (v8, `game/**`): 38.19% lines / 71.87% branches / 48.90% functions;
  Vitest thresholds (35/45/50/35) pass and are now enforced in CI via
  `npm run coverage`.
- `MainScene.loadGame()` → `deserializeGame()` remains the *in-place* path and is
  still exercised by unit tests; the React `loadGameHandler` full-rebuild path is
  the user-facing flow.