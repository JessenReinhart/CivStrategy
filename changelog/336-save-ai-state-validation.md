# Safer Continue for AI state

Corrupted save data can no longer expose a Continue option when its AI plan is not safe to restore. CivStrategy now checks the saved AI economy, base position, build progress, and building blueprint before replacing the running world, so malformed browser storage fails closed instead of breaking a resumed game.
