# Phase 9 — E2E Journey Results (Round 24)

Run against the live Vite dev server via Playwright (`scripts/*.mjs`).

| Journey | Result | Notes |
|---|---|---|
| `new-game-config-journey.mjs` | PASS | `ready: true`, faction/config round-trip |
| `day-night-journey.mjs` | PASS | `passed: true` |
| `villager-gather-journey.mjs` | PASS | `phase: passed`, worker assignment rebuilt |
| `army-combat-journey.mjs` | PASS | `phase: complete` |
| `canonical-play-session-journey.mjs` | PASS up to `failed:train` | **Fixed**: UI build bridge missing (`BUILD_MODE_TOGGLED` -> `request-build`) in `PlayerSceneBootstrap.ts` and `MainScene.ts` restored. Journey advanced from `failed:house-placement` -> through House build, gather, Barracks placement -> now hits `failed:train` (population check race). |

## save-reload-journey: stale, not a code regression

The journey (line 460-479) drives a **live in-place reload**: it dispatches
`window Event('load-game')` then waits for the *same* scene to release the old
`lumberCamp` (`oldLumberCamp.active === false`) and rebuild the worker in place.

The current load flow (`App.tsx:291-319` `loadGameHandler`) does **not** reload
in place. It captures world-defining settings, then tears the Phaser instance
down (`setGameInstance(null)`) and reboots the world from the saved seed/config
(`setPhaserSession(...)`, `setPhaserSession` bump). The old scene's entity
references therefore never transition `active === false` in place — they are
orphaned by the rebuild.

**Action:** update `save-reload-journey.mjs` (and any sibling journey using the
same live-reload assumption) to assert against the rebuilt world (`isReady` on
the new scene + persistence check via `localStorage`), matching the real load
semantics. This is a Phase 9 task-3 residual, not an engine regression.

## Related evidence

- Unit suite: 69 files / 511 tests green (includes `SaveSystem.deserialize`,
  `storage`, `meta`, `research`).
- `MainScene.loadGame()` → `deserializeGame()` remains the *in-place* path and is
  still exercised by unit tests; the React `loadGameHandler` full-rebuild path is
  the user-facing flow.