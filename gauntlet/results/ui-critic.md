# UI/UX Critic Verdict — round 2

## Verdict: `REFERENCE`

## Fresh evidence

- Revised implementation inspected in `components/GameUI.tsx` (`hud-resource-ribbon`, status rail, selection card, `ResourceItem`, build cards).
- Builder evidence inspected: `gauntlet/results/ui-builder.md`.
- Prior valid live captures inspected: `gauntlet/evidence/civ-gameplay-1.png`, `gauntlet/evidence/civ-buildmenu-1.png`.
- Current live recapture was attempted but unavailable: the dev server stopped, and the builder explicitly labels `before-ui.png` / `after-ui.png` as loading-state frames that are invalid HUD evidence.
- Relevant fetched bars: Age of Empires IV selection/command HUD and Anno 1800 economy HUD.

The previous top-ribbon gap is closed in code: `components/GameUI.tsx:200-236` now anchors exactly four resources top-left; `:238-280` moves Civilization, Morale, Season, and Diplomacy into a separate status rail. `ResourceItem` preserves bright totals, secondary signed rates, capacity meter, and warning text.

## One largest observable gap

**The selected unit/building command card still lacks live, stateful selection readability comparable to Age of Empires IV.**

The current panel represents a selected unit group with generic Lucide symbols, type text, static maximum HP (for example `HP:100`), and aggregate counts. It does not show current health, current action/order, per-unit portraits, or explicit labels/hotkeys for formation and stance controls. This makes the player's immediate tactical state slower to parse than the reference even though the resource HUD is now structurally cleaner.

## Relevant files and symbols

- `components/GameUI.tsx:466-716` — selection card, selected group list, formation/stance/ability controls
- `components/GameUI.tsx:1120-1158` — `ResourceItem` (previous gap closed)
- `components/GameUI.tsx:1293-1330` — `FormationButton`, `StanceButton`
- `types.ts` — `GameStats` / selection-state data contract

## Concrete acceptance check

At 1280×720, select (a) one damaged military unit and (b) a mixed group, then capture both states. The selection card passes only if all are visible without hover:

1. current HP or health bar for the selected unit/group, not static max HP;
2. current order/action (`Idle`, `Moving`, `Attacking`, `Gathering`, etc.);
3. current formation and stance with text or hotkey labels, not icon-only controls;
4. distinct unit-type visual identity (unit sprite/portrait or equivalent), not only generic Lucide icons;
5. the two captures are valid live-game frames and the changed state is visually obvious in under one second.

Until those captures exist and pass, `REFERENCE` wins.
