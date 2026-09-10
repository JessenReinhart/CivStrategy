# Safer AI state on Continue

Corrupted saves that contain invalid optional AI progress, timing, or state values are now rejected before **Continue Game** can replace the running world. Older version-1 saves that omit these newer fields remain compatible and continue to use the existing safe defaults.
