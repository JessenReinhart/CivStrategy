# Training source lifecycle

- Training no longer treats a destroyed or otherwise inactive selected Barracks as a valid spawn source.
- If another live player Barracks exists, training safely falls back to it instead of spawning from the stale building reference.
- A destroyed Barracks is also removed from the active building selection after the fallback, so the UI cannot keep advertising actions for a building that no longer exists.
