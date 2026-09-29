# UI builder evidence

## Cohesive improvement

Implemented a dedicated economy ribbon informed by the Anno 1800 production-chain HUD and Age of Empires IV control feedback.

- The top-left strip now contains only Wood, Food, Gold, and Population.
- Every resource exposes a labelled, tabular total; active resource rates remain visually secondary.
- Food has a direct `DECLINING` warning when production cannot cover consumption.
- Population has a capacity meter and an `AT CAPACITY` state.
- Civilization, morale, season, and diplomacy have been removed from the resource ribbon into a separate top-center status rail.
- The selected-building card can show optional authoritative `+N resource/tick` production attribution beside worker status.

Changed UI files: `components/GameUI.tsx`, `index.html`.

## Capture evidence

Requested live in-game states captured at 1280×720:

- **Idle HUD**: [after-hud-idle.png](./after-hud-idle.png)
  ![Idle HUD](./after-hud-idle.png)
  Shows top-left resource-only strip (Wood 250, Food 300, Gold 150, Population 6/13) and top-center status rail (Civilization Village, Morale 102%, Season Summer, Diplomacy Treaty 600s).

- **Economy menu open**: [after-hud-economy.png](./after-hud-economy.png)
  ![Economy menu open](./after-hud-economy.png)
  Same resource strip + status rail, with the bottom-center Economy build panel expanded showing House, Farm, Lumber Camp, Hunter’s Lodge, Town Center, and Market icons.

- **Selected building**: [after-hud-selection.png](./after-hud-selection.png)
  ![Selected building attempt](./after-hud-selection.png)
  No building selection was detected despite scripted canvas clicks; the HUD remains in idle state. The optional `+N resource/tick` production line is therefore not visible in evidence.

The before-state capture [before-ui.png](./before-ui.png) and an early after-state [after-ui.png](./after-ui.png) are loading-screen frames, not in-game HUD, and must not be used for visual acceptance.

## Verification

- `npm run lint` — PASS. ESLint completed with zero errors or warnings.
- `npx tsc --noEmit` — PASS. TypeScript completed with no output.
- `npm run build` — PASS. Vite transformed 1,839 modules and completed production build. Existing chunk-size advisory is non-failing.

## Biggest remaining reference gap

The selected-unit and building command card remains far less information-dense than Age of Empires IV: it lacks portrait art, current health/action state, contextual command hotkeys, and a strong visual connection between the world selection and the available commands.

## Critic follow-up

`gauntlet/results/ui-critic.md` identified the prior centered, overloaded ribbon. This implementation addresses its structural acceptance requirements by using a top-left, four-resource-only strip and a separate status rail. A new independent visual verdict still requires the valid live captures above (idle and economy menu are sufficient for the resource/status separation check; selection-state remains ideal but not strictly required for the top-bar acceptance criteria).