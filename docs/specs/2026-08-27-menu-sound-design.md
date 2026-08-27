# Menu Sound Integration — Design Spec

## Summary

Add subtle click/activation sounds to every interactive control in `components/MainMenu.tsx` (landing, lobby, and diagnostics screens). A standalone lazy Web Audio helper initializes synchronously within the first user-gesture click and reuses the game's existing `ui-click` procedural tone so menu audio matches in-game UI audio.

## Goals

- Play a click sound on every menu button, toggle, navigation, and input activation.
- Keyboard activation works automatically (React `onClick` fires on Enter/Space in buttons).
- No coupling between `MainMenu` (React) and `MainScene` / `ProceduralSoundSystem` (Phaser).
- Graceful degradation: no audio context failure if Web Audio unsupported or user-gesture blocked.
- Full test coverage of the audio node graph without a browser.

## Non-Goals

- Ambient menu music.
- Spatial audio in menus.
- Audio context sharing between menu and game (a fresh context is cheap and avoids lifecycle coupling).
- Modifying `ProceduralSoundSystem.ts` or `SFXAssetLoader.ts`.

## Architecture

### Constraint

`ProceduralSoundSystem` is instantiated in `WorldBootstrap.ts:147` during `MainScene.create()`. `MainMenu` renders in React before Phaser exists (`App.tsx` mounts `MainMenu` when `gameState === 'menu'`). Therefore the sound system is **unavailable** during the menu phase.

### Decision: Standalone lazy helper

`game/utils/uiAudio.ts` — a pure module exporting `uiClick()` plus internal helpers `noiseBurst` and `tone`:

- `ensureAudioContext()` lazily creates an `AudioContext` + `GainNode` master gain on first call (synchronous — valid because `uiClick` is invoked from a click handler inside a user gesture).
- `uiClick()` plays a highpass noise burst + sine tick (same parameters as `ProceduralSoundSystem.ts:635-639`, volume `0.08`, pan `0`).
- Node graph: `source → filter → envelope gain → channel merger → master gain → destination`.
- The envelope gain node is the **sole tail** connected to the merger; no raw source/oscillator connects directly to `masterGain` or `destination` (mirrors the contract in `ProceduralSoundSystem.ts:18`).

### Integration in MainMenu

`MainMenu.tsx` imports `uiClick` and calls it inside every `onClick` handler. Navigation helpers (`handleNavigate`, `handleStart`, `handleContinue`, `handleStressTestStart`) each call `uiClick()` before/after their existing logic. Toggle/setter callbacks (`setFowEnabled`, `setPeacefulMode`, `setAiDisabled`, `setMapMode`, `setMapSize`, `setMapSeed`, `setMapPreset`, `setSelectedFaction`, `setTreatyLength`, `setStressUnitCount`, `setStressEnableEnemies`) wrap via an inline `() => { uiClick(); setter(...) }` pattern. The randomize-seed button and "Space to skip" keyboard path also call `uiClick()`.

## Coverage (all calls in `components/MainMenu.tsx`)

| Control | Line(s) | Handler | Sound |
|---|---|---|---|
| Continue Game button | 387-410 | `handleContinue` | `uiClick()` |
| Start Game button | 417-443 | `handleNavigate('lobby')` | `uiClick()` |
| Diagnostics button | 445-471 | `handleNavigate('stress')` | `uiClick()` |
| Lobby close (X) | 543-551 | `handleNavigate('landing')` | `uiClick()` |
| Faction selection buttons | 578-651 | `setSelectedFaction` + `uiClick()` | `uiClick()` |
| Map Mode toggles | 670-688 | `setMapMode` + `uiClick()` | `uiClick()` |
| Map Size toggles | 704-721 | `setMapSize` + `uiClick()` | `uiClick()` |
| Map Seed input | 735-752 | `uiClick()` on focus (change) | `uiClick()` |
| Randomize seed button | 753-775 | `setMapSeed` + `uiClick()` | `uiClick()` |
| Map Type select | 790-809 | `setMapPreset` + `uiClick()` | `uiClick()` |
| Fog / Peaceful / AI toggles | 823-873 | `toggle.onChange` + `uiClick()` | `uiClick()` |
| Lobby Cancel button | 901-922 | `handleNavigate('landing')` | `uiClick()` |
| Lobby Commence button | 923-947 | `handleStart` | `uiClick()` |
| Stress Back button | 1061-1082 | `handleNavigate('landing')` | `uiClick()` |
| Stress Launch button | 1083-1107 | `handleStressTestStart` | `uiClick()` |
| Peace duration slider | 885-893 | `uiClick()` on change | `uiClick()` |

## Testing Design

`game/utils/uiAudio.test.ts` mirrors `ProceduralSoundSystem.test.ts:1-100`:

1. Replace `window.AudioContext` with a mock factory that records `connect()` calls on all created nodes.
2. Call `uiClick()` three times.
3. Assert:
   - AudioContext created lazily on first call only.
   - Exactly one master `GainNode` created.
   - Each call produces a noise source + filter + envelope gain + oscillator + tone gain.
   - **No orphaned nodes**: every created node is reachable.
   - **Single output path**: exactly one path from every source to `destination`, routed only through the envelope gain (no direct source→destination edges).
   - `ctx.resume()` called if state is `suspended`.

## Verification

```bash
npm test uiAudio
```

(plus full suite at end of implementation)

## Files

- `game/utils/uiAudio.ts` (new, ~50 lines)
- `game/utils/uiAudio.test.ts` (new)
- `components/MainMenu.tsx` (import + `uiClick()` calls added)
