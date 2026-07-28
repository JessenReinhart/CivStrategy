# Terrain Elevation — Handoff Plan

## Status
- **N·L lighting: DONE** — baked as multiply per cell, visible
- **Geometric lift: PARTIAL** — helpers exist, not wired yet

## What's changed (3 files, on `main`)

### `constants.ts` — new TERRAIN_CONFIG keys
| Key | Value | Purpose |
|---|---|---|
| `LIGHT_DIR_X/Y/Z` | -0.65, -0.4, 0.65 | NW light direction |
| `LIGHT_AMBIENT` | 0.35 | base brightness |
| `LIGHT_DIFFUSE` | 0.75 | directional range |
| `NORMAL_STRENGTH` | 48 | exaggerate perlin normals |
| `HEIGHT_SHADE` | 0.35 | height-based ambient (valleys dark, peaks bright) |
| `HEIGHT_LIFT` | 120 | px screen-Y per height unit above WATER_LEVEL |

### `game/utils/iso.ts` — new helpers
- `toIsoElev(x, y, terrainHeight)` → iso with Y lifted by `(height - WATER_LEVEL) * HEIGHT_LIFT`
- `isoElevDepth(x, y, terrainHeight)` → depth key with lift baked in
- Both import `TERRAIN_CONFIG` (has circular dep risk — if build breaks, pass heightRef as arg instead)

### `game/systems/TerrainSystem.ts` — `applyVisualTinting()`
- Replaced Laplacian (height−avg) with directional N·L (central-diff normals × light)
- `multiply` composite (not source-over α — invisible on photo tiles)
- `soft-light` warm tint on sun-facing faces

## Remaining work (elevation lift)

### 1. TerrainSystem — lift diamonds + cliff faces
`applyVisualTinting()` line ~250: replace `toIso(wx,wy)` → `toIsoElev(wx,wy, height)` for c0–c3.
Expand canvas AABB to account for max lift (add `HEIGHT_LIFT * (1 - WATER_LEVEL)` to maxY).
For cliff faces: when adjacent cell has lower height, draw a darker trapezoid between this cell's top edge and the neighbor's top edge (side wall).

### 2. MainScene — water marching squares verts (line ~332–373)
Currently uses `toIso(wx, wy)` flat. Change corner verts to:
```
toIso(wx, wy).y - WATER_LEVEL * TERRAIN_CONFIG.HEIGHT_LIFT
```
All `c0–c3` and all edge points need the same lift so water floats at sea level above terrain diamonds.
Update `waterMaskBounds` AABB to include the lift offset.

### 3. Entity position + depth (many files)
Pattern everywhere: `const iso = toIso(x, y); visual.setPosition(iso.x, iso.y).setDepth(iso.y);`

Change to: `const iso = toIsoElev(x, y, this.scene.terrainSystem.getHeightAt(x, y));`

Files to touch:
- `game/systems/EntityFactory.ts` — building spawn (~line 88)
- `game/systems/CullingSystem.ts` — tree reposition (~line 228)
- `game/systems/UnitSystem.ts` — unit move + projectiles (~line 1050, 1249, 1303)
- `game/systems/SquadSystem.ts` — squad rendering (~line 109, 213, 300)
- `game/systems/VillagerSystem.ts` — villager move (~line 38, 103)
- `game/systems/AnimalSystem.ts` — animal move (~line 34, 93)
- `game/MainScene.ts` — building depth update (~line 1037), unit depth (~line 1050), camera pan (~line 606), minimap (~line 613)
- `game/systems/BuildingManager.ts` — preview building pos (~line 107), tree highlight pos, territory pos

### 4. Gameplay refs (optional)
- `game/systems/Pathfinder.ts` — movement cost already uses `getMovementModifier`; no change needed
- `game/systems/BuildingManager.ts` line 112 — build validity uses `getSlopeAt`; already height-aware, no change
- Camera pan / minimap — use flat `toIso` OK (center of viewport), but depth of sprites needs lift

## Tuning
- `HEIGHT_LIFT: 120` — raise for more dramatic cliffs, lower for subtle. AoE uses ~30-40 per tile level (they have 4 discrete levels). With continuous 0–1 height, 120 gives ~24px for a 0.2 height delta (noticeable but not broken).
- `NORMAL_STRENGTH: 48` — perlin gradient tiny, need big gain. Drop if lighting looks too harsh.
- `HEIGHT_SHADE: 0.35` — valley/peak ambient term independent of slope. Tune with LIFT.

## Risk
- `iso.ts` imports `TERRAIN_CONFIG` — potential circular if constants.ts ever imports from utils. If build breaks: remove the import, pass heightRef/HEIGHT_LIFT as params.
- Entities at water boundary (height ≈ WATER_LEVEL) will have lift ≈ 0, which is correct (sea-level entities stay flat).
- Canvas AABB in `applyVisualTinting` must expand for max lift or peaks get clipped off the bake canvas.
