# Settlement/Economy Builder Evidence — Round 2

## What was delivered
1. **checkBuildValidity restored** — removes the `managerValidity.checkBuildValidity is not a function` runtime regression detected by the critic's journey.
2. **Per-building production attribution wired into EconomySystem and the selected-building panel** — the numeric source→producer gap is now exposed in-game and in React UI:
   - `EconomySystem.depositResource` accepts an optional `sourceBuilding` parameter.
   - `VillagerSystem.depositCarry` passes the dropsite (`villager.jobBuilding`) into `depositResource`.
   - `EconomySystem.queueBuildingProduction` and `flushProductionWindow` maintain a 10-tick attribution ledger per building.
   - `EconomySystem.getBuildingProduction` exposes the rollup to both `updateStats` and callers.
   - `updateStats` populates `selectedBuildingInfo.production` whenever a selected building has a non-zero recorded rate.
   - `components/GameUI.tsx` now renders that production rate in the selected-building ribbon (done by UIBuilder).
3. **Placement legibility from Round 1 remains intact** — ghost still shows the live validity reason when blocked and fertility when valid for farms; building completion still emits the green `building ready/complete` floating text.

## Relevant files / symbols touched
- `game/systems/EconomySystem.ts`
  - `depositResource(... sourceBuilding)`
  - `queueBuildingProduction(...)`
  - `flushProductionWindow()`
  - `getBuildingProduction(...)`
  - `updateStats()` selected-building production wiring
- `game/systems/VillagerSystem.ts`
  - `depositCarry(...)` now forwards `villager.jobBuilding`
- `game/systems/buildingPlacementSnap.ts`
  - `formatBuildingPlacementFeedback(...)`
- `game/systems/BuildingManager.ts`
  - restored `checkBuildValidity` (required by `SpriteGhostBuildingManager`)
  - completion floating text / sound
- `game/systems/buildingPlacementSnap.test.ts`
- `types.ts`
  - `BuildingProduction`, `SelectedBuildingInfo`
- `components/GameUI.tsx` (UIBuilder-owned)

## Build evidence
### tsc
```
npx tsc --noEmit
EXIT 0
```

### vite build
```
> vite build

vite v5.4.21 building for production...
✓ 1839 modules transformed.
dist/assets/index-CJMj0Chz.js             2,223.51 kB │ gzip: 586.20 kB
✓ built in 21.91s
```

## Screenshots / captures
- `gauntlet/results/settlement-before.png`
- `gauntlet/results/settlement-after.png`

## Biggest remaining gap vs the critic's reference bar
The numeric production attribution now exists, so a selected staffed Lumber Camp exposes its own wood rate in the panel. The remaining gap versus Anno 1800 / Stronghold is **aggregate production-chain topology**: the game still does not show input→output arrows, chain efficiency, stockpile fill levels, or multi-building logistics flow. The panel is a single-building rate readout, not a full chain graph.

## Acceptance read
- `checkBuildValidity` regression: fixed.
- selected-working-building panel now displays `production: { resource, perTick }` when nonzero: implemented.
- the panel render was done by UIBuilder; my scope intentionally does not include React UI edits beyond the type/data contract.
