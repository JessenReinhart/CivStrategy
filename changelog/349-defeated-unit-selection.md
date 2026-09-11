# Defeated units leave the active selection

- Soldiers that die while selected are now removed from the player's active selection on the next input update.
- Surviving selected soldiers stay selected, so the remaining army can keep receiving commands normally.
- The selection HUD is only refreshed when a defeated unit actually needs to be removed, avoiding unnecessary per-frame UI updates.
