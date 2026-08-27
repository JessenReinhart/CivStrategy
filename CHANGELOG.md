# Changelog

## 2026-08-27

- **Enemy movement paths are no longer shown to the player (#149):** Player unit paths still appear normally, but enemy path overlays are hidden so the game no longer reveals where enemy units are planning to move. Developer debug path tools are unchanged.

## 2026-08-26

- **Large and Huge maps are much less likely to freeze the browser while loading (#145):** World generation now keeps the loading screen responsive, limits large terrain render buffers, spreads expensive decoration work across time, and preserves detailed terrain textures. The real Large-map browser check now enforces bounded long tasks, working progress updates, no page errors, and usable camera input after loading.
- **Army selection, movement, and combat now have a real browser journey (#140):** The game is now automatically checked by selecting a real unit on the canvas, moving it with a real right-click command, attacking an enemy, and confirming that combat actually changes enemy health and unit state.
- **Enemy towns no longer get stuck on one bad building spot (#142):** If an AI building location is blocked, underwater, too steep, overlapping, or outside the map, the AI now searches nearby for a valid place and keeps growing. It also only spends resources when a building is actually created.
- **Demolishing buildings can no longer give free wood (#137):** Resources, population, happiness, worker state, and blocked map space now change only after the building is actually removed. Failed or repeated demolition attempts leave the live building and economy untouched.
- **Early wood economy is easier to get started (#134):** The Lumber Camp now costs much less wood, so players can establish wood income without spending most of their starting wood on the first camp.
- **Early wood progression now has gameplay evidence (#136):** The economy test now follows a real woodcutter through assignment, travel, gathering, returning, and depositing wood, and verifies that the opening can still progress through a Lumber Camp, House, Farm, and Barracks without running resources below zero.
