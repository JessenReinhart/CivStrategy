# Training source lifecycle

- Training no longer treats a destroyed or otherwise inactive selected Barracks as a valid spawn source.
- If another live player Barracks exists, training safely falls back to it instead of spawning from the stale building reference.
- Destroyed buildings are now removed from active selection on the next scene update, so the UI stops advertising actions for a building that no longer exists without waiting for another player action.
