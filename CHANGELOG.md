# Changelog

## 2026-08-28

- **Combat now has a same-session save/reload continuity check (#158):** Automated gameplay now fights through a real enemy defeat, saves the surviving army, reloads the page, restores that unit with the same health, re-selects it through the real canvas, and proves it can still move afterward. This protects the critical `fight -> save -> reload -> keep playing` boundary from silent regressions.
- **The world now moves through a visible day-and-night cycle (#156):** Dawn, daylight, sunset, and night transition continuously with lightweight building shadows that change with the sun. The effect follows game time and pause/speed controls, leaves the UI untinted, and limits shadow work so dense cities do not redraw every building every frame.
- **Barracks training is now protected by a real browser journey (#144):** Automated gameplay now places and selects a real Barracks, trains a Pikesman through the normal command UI, and checks population and resource costs so the build-to-train progression is less likely to regress silently.
- **Combat cleanup is now verified through actual defeat (#153):** The browser combat journey now continues through lethal damage and confirms a defeated enemy is removed from the live game, protecting the full select, move, fight, and resolve flow rather than stopping after the first hit.

## 2026-08-27

- **Main menu controls now have subtle click feedback (#155):** Menu buttons, faction and map options, toggles, randomize actions, and other discrete controls now play the same style of UI click used in the game. The menu audio starts lazily from user interaction and does not require the Phaser game scene to be running.
- **Villagers can now be selected and assigned to economy work directly (#148):** Players can click a villager, right-click an owned worker building such as a Lumber Camp to assign the job, or send the villager to a ground position. The browser journey now verifies the full gather, carry, return, and deposit loop, and save/reload clears stale workforce selection safely.
- **Enemy movement paths are no longer shown to the player (#149):** Player unit paths still appear normally, but enemy path overlays are hidden so the game no longer reveals where enemy units are planning to move. Developer debug path tools are unchanged.

## 2026-08-26

- **Large and Huge maps are much less likely to freeze the browser while loading (#145):** World generation now keeps the loading screen responsive, limits large terrain render buffers, spreads expensive decoration work across time, and preserves detailed terrain textures. The real Large-map browser check now enforces bounded long tasks, working progress updates, no page errors, and usable camera input after loading.
- **Army selection, movement, and combat now have a real browser journey (#140):** The game is now automatically checked by selecting a real unit on the canvas, moving it with a real right-click command, attacking an enemy, and confirming that combat actually changes enemy health and unit state.
- **Enemy towns no longer get stuck on one bad building spot (#142):** If an AI building location is blocked, underwater, too steep, overlapping, or outside the map, the AI now searches nearby for a valid place and keeps growing. It also only spends resources when a building is actually created.
- **Demolishing buildings can no longer give free wood (#137):** Resources, population, happiness, worker state, and blocked map space now change only after the building is actually removed. Failed or repeated demolition attempts leave the live building and economy untouched.
- **Early wood economy is easier to get started (#134):** The Lumber Camp now costs much less wood, so players can establish wood income without spending most of their starting wood on the first camp.
- **Early wood progression now has gameplay evidence (#136):** The economy test now follows a real woodcutter through assignment, travel, gathering, returning, and depositing wood, and verifies that the opening can still progress through a Lumber Camp, House, Farm, and Barracks without running resources below zero.
