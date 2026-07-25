# Water Rendering Performance Optimization

## Target
`game/MainScene.ts` — `drawWater()` (lines 545–596) and update loop (lines 611–622).

## Approach

### 1. Pre-computed Bounding Boxes + Viewport Culling (HIGHEST IMPACT)
At water init time (line 354 push site), pre-compute each poly's axis-aligned bounding box `{ minX, minY, maxX, maxY }`. Store alongside each poly entry.

In `drawWater()`, obtain camera viewport via `this.cameras.main.worldView` (returns `Phaser.Geom.Rectangle` with x, y, width, height). Before drawing each poly, check:
```
if (poly.maxX < vx - PAD || poly.minX > vx + vw + PAD ||
    poly.maxY < vy - PAD || poly.minY > vy + vh + PAD) continue;
```
PAD = 100px prevents pop-in at edges.

Estimated impact: 70-90% of polys skipped when zoomed in. Each skipped poly saves fillPath + potential strokePath.

### 2. Reduce Animation Throttle
Change `waterAnimFrame % 3 === 0` → `% 6` (line 614). Water animation runs at ~10 FPS (60fps / 6) which is visually smooth for subtle wave color shifts.

### 3. Sine Lookup Table
Pre-compute a `Float32Array(256)` sine LUT at init time. In `drawWater()`, replace `Math.sin(phase * freq + ...)` with `SIN_LUT[((value % TWO_PI) * INV_TWO_PI * 256) | 0]`. Eliminates costly transcendental function calls for ~25K-40K polys.

### 4. Edge Foam Skip for Viewport-Border Polys
For shore polys whose bounding box overlaps the viewport by less than 50px on any side, skip the foam strokePath call. This saves the most expensive per-poly operation for edge polys.

## Files Modified
- `game/MainScene.ts` — water init (add bbox), drawWater (culling + LUT), update loop (throttle)

## What Does NOT Change
- Water geometry (marching-squares output)
- Water level, terrain generation
- Game mechanics, AI, pathfinding, economy, building, unit behavior
- Visual appearance (same colors, same waves, same foam — just culled when off-screen)

## Verification
- `npm run build` passes
- `npm run lint` passes  
- `npm run test` passes
- Water visually identical when on-screen (same marching-squares shoreline, animated waves, depth coloring, shore foam)
