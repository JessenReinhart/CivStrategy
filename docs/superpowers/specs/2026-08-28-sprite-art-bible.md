# CivStrategy Sprite Art Bible

Rules for generated and hand-authored city/unit sprites so Living City assets read as one game. Each rule is grounded in existing generators, runtime code, or measured assets.

## 1. Projection

- Use the 2:1 isometric projection from `game/utils/iso.ts` (`toIso`). Cartesian `(x, y)` maps to screen `(x - y, (x + y) * 0.5)`.
- Draw sprites flat/canvas-aligned; the runtime places them at the iso position.
- World elevation is applied at runtime via `toIsoElev`/`isoElevDepth` (`TERRAIN_CONFIG.HEIGHT_LIFT`). Generated static sprites do not encode elevation.

## 2. Canvas & Scale Bands

| Asset class | Source canvas | Runtime usage |
|-------------|---------------|---------------|
| Buildings | `128x128` (`scripts/gen-sprites.ts`) | `house`, `barracks`, etc. |
| Units | `48x48` (`scripts/gen-unit-sprites.ts`) | `unit_*`, tinted by faction |
| Ambient citizen | `6x8` (`AmbientPopulationSystem`) | Runtime-generated blitter bob |

- Buildings fill ~72–112 px of the 128 px canvas so `setScale` stays crisp.
- `EntityFactory.setupSprite` scales with `targetWidth = def.width * scaleMultiplier`. Current multipliers: house `1.6`, barracks `1.5`, TC `1.2`, lumber `1.7`, lodge `1.6`, farm `1.3`. Keep new multipliers between `1.2` and `2.0`.
- Same building type keeps the same gameplay footprint across all age variants; only the art varies.

## 3. Anchors & Origins

- Buildings: `EntityFactory.setupSprite` defaults to origin `(0.5, 0.75)`. Current overrides are farm `(0.5, 0.5)`, house `(0.5, 0.85)`, and lodge/TC/barracks/lumber `(0.5, 0.75)`. Draw the ground plane near the canvas bottom and preserve each variant's declared origin.
- Units: origin `(0.5, 1)` in `SquadSystem`; put feet/boots at the bottom of the `48x48` canvas.
- Ambient citizen: implicit centered bob; figure is centered in the 6x8 texture.

## 4. Light Direction & Shadows

- Light from **top-left** (northwest), matching `TERRAIN_CONFIG.LIGHT_DIR_X/Y/Z = (-0.65, -0.4, 0.65)` in `constants.ts`. Highlight front/top faces; darken right/rear faces.
- Shadows cast to **bottom-right** (southeast) of the object.
- Hard pixel-art shadows only; no blur. Use a flat shadow color at low alpha (`dim(..., 0.3)` as in `gen-sprites.ts`).
- Static shadows should be subtle so they do not conflict with runtime shadows from `DayNightSystem` (which projects a contact ellipse plus tapered polygon).

## 5. Palette & Material Families

| Material | Base | Dark | Highlight | Used in |
|----------|------|------|-----------|---------|
| Plaster/stucco | `#C4A76C` | `dim 0.7–0.8` | `bright 0.1–0.2` | House walls |
| Wood walls | `#9B7653` | `dim 0.6` | `bright 0.15` | Barracks walls |
| Roof terracotta | `#B83030` | `dim 0.5–0.6` | `bright 0.2–0.25` | Barracks/TC roofs |
| Roof thatch/shingle | `#8B4513` | `dim 0.6` | `bright 0.2` | House roofs |
| Roof forest | `#5A8A3C` | `dim 0.5` | `bright 0.25` | Lumber/lodge roofs |
| Stone platform | `#B8944A` | `dim 0.5` | none | Building bases |
| Wood prop | `#8B6F4E` | `dim 0.7` | none | Logs, fences, props |
| Skin | `#E6BE96` | none | none | Unit faces (`SKIN`) |
| Metal/iron | `#B4B4BE` | `dim 0.7` | none | Armor, shield rims (`METAL`) |
| Faction white | `#FFFFFF` | none | none | Unit tint slots (`WHITE`) |

- Keep building walls desaturated and earthy. Roofs may be one step more saturated but never neon. Terrain biome colors (`constants.ts`) are the backdrop; sprite materials must remain distinct from grass/forest greens.

## 6. Faction-Color Slots

- Units: draw armor/tunic/shield/cloth areas that should receive faction color in pure white `#FFFFFF` (`WHITE` in `gen-unit-sprites.ts`). Runtime applies `setTint(getFactionColor(owner))` to squad sprites.
- Buildings: do not tint the whole building. Use small banners, flags, or awnings for faction color (e.g. the town-center banner in `gen-sprites.ts`).
- Faction colors from `constants.ts`: Romans blue (`0x3b82f6`), Gauls green (`0x22c55e`), Carthage red (`0xef4444`).

## 7. Silhouette & Readability

- Every building must have a recognizable silhouette at `128x128`: distinct roof, doorway, or prop cluster.
- Avoid details thinner than `2 px` at native resolution; existing block helpers paint whole-pixel rectangles.
- Darkest and lightest areas on a sprite must differ by at least ~60 in the value channel.
- Props remain subordinate; no single prop may dominate its parent building.

## 8. Transparent Backgrounds

- Output true alpha PNGs (`alpha = 0` where nothing is drawn) through `scripts/png-encode.ts`.
- No matte or color key. The runtime needs alpha for depth sorting and bloom.

## 9. Outline Policy

- No black outlines. Edges are defined by value contrast between adjacent materials.
- Optional `1–2 px` darker rim at roof edges, sampled from the same material family (e.g. `roofDark`).

## 10. Age Variation

| Age | Walls | Roof | Props | Read |
|-----|-------|------|-------|------|
| Village | Rough wood/plaster | Thatch/simple tiles | Few: firewood, simple door | Small, humble |
| Town | Cleaner plaster, timber framing | Terracotta tiles | Shutters, small garden, crates | Medium |
| City-State | Stone/ashlar, carved details | Ornate tiles, banners | Balconies, market clutter | Larger, grander |

## 11. LOD Simplification

- Near: full `128x128` buildings, `48x48` units.
- Mid: runtime Blitter rects/dots for units; buildings remain readable at 50 % scale.
- Far: units collapse to single tinted dots; buildings remain sprite-based or are culled.

## 12. Determinism

- Same definition + seed must produce byte-identical PNG output.
- Current generators use fixed draw order and no random calls. Future variant choices (geometry, palette, prop presence) must use an explicit seeded RNG; never `Math.random()`.
- Manifest JSON keys must be sorted alphabetically; contact-sheet grid order must be fixed.

## 13. Naming & Layout

- Generated assets go to `assets/textures/generated/`.
- Name: `<building>_<faction>_<age>_<variant>.png` (e.g. `house_roman_town_01.png`).
- Manifest: `assets/textures/generated/manifest.json` with stable keys: `key`, `width`, `height`, `source`, `seed`, `tags`.
- Naming and manifest metadata support visual review: contact sheets compare variants for scale drift, broken anchors, duplicate silhouettes, shadow inconsistencies, and faction/age mismatches.

## 14. Anti-Goals

- No perspective that contradicts the 2:1 iso projection.
- No ungoverned AI prompts that bypass this bible; concept references must be normalized through the generators.
- No runtime gameplay or combat changes from art pipeline work.

