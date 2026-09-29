# Settlement/economy critic verdict (round 1)

## Verdict: REFERENCE

Compared against the cited bars in `gauntlet/evidence/references.md` (Stronghold Crusader DE settlement economy, Manor Lords grounded construction/production, Anno 1800 production chains and logistics HUD). Direct reference footage fetches were blocked in this sandbox; the reference comparison below is limited to the official gameplay descriptions retrieved by web search, not frame-by-frame footage.

## Evidence examined

1. **Running game** (`http://localhost:5173/`): booted, captured start menu and world-gen loading screens (`gauntlet/evidence/settlement-current.png`). No gameplay-state screenshot was obtainable through the headless tab; the scripted journey below is the current gameplay evidence. Visual A/B comparison remains unverified.
2. **Economy progression journey** (`node scripts/economy-progression-journey.mjs`, 2026-09-14): reached gather-deposit, house placement/completion, barracks, unit training, and movement. Evidence in `artifacts/economy-progression-journey.json`:
   - Lumber Camp placed for exactly 25 wood; villager assigned and matched; +20 wood deposited over 30.3s simulated.
   - House cost exactly 50 wood, maxPopulation stayed 13 during construction, rose to 21 on completion, alpha 0.55→1.
   - Barracks built; training a Pikesman cost exactly 100 food + 50 gold, pop +1, units +1.
   - Journey FAILED at `continue-playing` with browser errors: `managerValidity.checkBuildValidity is not a function` (twice) — a live regression in the placement-validity call path.
3. **Static code inspection**: `EconomySystem.tickEconomy()` aggregates resource generation in `lastRates`; `updateStats()` exposes selected-building worker/resource context but no per-building production field; `depositResource()` displays player deposits at the Town Center. `BuildingManager.updatePreview()` supplies valid/invalid ghost feedback and `SpriteGhostBuildingManager` supplies sprite ghosting.
4. **Builder evidence**: `gauntlet/results/settlement-builder.md` does NOT exist. SettlementBuilder reported "mid-run" over IRC and never delivered captures. No builder-produced settlement improvement is verifiable this round.
5. **UI builder evidence** (`gauntlet/results/ui-builder.md`, separate workstream): HUD ribbon now shows per-resource icons, values, signed rates, DECLINING food state, population capacity meter. Verified lint/tsc/build PASS.

## Comparison

| Axis | Reference bar | CivStrategy now |
|---|---|---|
| Settlement character | Retrieved descriptions characterize Stronghold/Manor Lords as settlements where production structures, storage, markets, and trade communicate economic activity | Journey proves placement/completion but not a visually captured settlement identity; no builder gameplay capture is available |
| Building tactility | Retrieved Manor Lords description emphasizes grounded placement, construction, and production | Static inspection finds a terrain-aware valid/invalid ghost plus under-construction alpha 0.55→1 (journey-proven), but the visual comparison is unverified |
| Production-chain readability | Retrieved Anno description says the HUD traces raw materials through factories to consumers and exposes stocks/rates/bottlenecks | Static inspection finds aggregate-only `EconomySystem.lastRates`; selected-building data has worker/resource context but no production contribution |
| Economy clarity | Retrieved Anno/Stronghold descriptions emphasize traceable stocks, production, consumption, and bottlenecks | Separate UI evidence shows signed aggregate rates; static inspection finds deposits float only at the TC |

## Largest observable gap (the one to fix)

**Production-chain readability: no per-building production attribution anywhere in the inspected game code.** The player can see that wood went up (aggregate rate, TC floating text), but not which building produced it, at what rate, or whether a specific camp is stalled. The retrieved Anno description explicitly identifies source → factory → consumer tracing and stocks/rates/bottlenecks as the reference bar; CivStrategy does not expose an equivalent attribution.

Relevant files/symbols:
- `game/systems/EconomySystem.ts` — `tickEconomy()` (aggregates `foodGen`/`woodGen`/`goldGen` into `lastRates` without per-building attribution), `updateStats()` (`selectedBuildingInfo` carries `hasWorker`/`nearbyResources` but no production rate), `depositResource()` (floating text at TC only).
- `components/GameUI.tsx` — selected-building panel renders `selectedBuildingInfo`; no production-rate field exists to render.
- `game/systems/BuildingManager.ts` / `SpriteGhostBuildingManager.ts` — placement feedback is strong, but post-placement economic state is not surfaced.

## Acceptance check (concrete)

Select a working Lumber Camp with an assigned villager. The selected-building panel must visibly display **that building's own** wood-per-tick contribution, and the displayed number must equal the actual simulated deposit attribution for that building over a 10-tick window. An implementation may expose this through `selectedBuildingInfo` or any equivalent UI contract. Verify with:
1. A scripted journey asserting the visible/published per-building rate matches simulated deposits (extend `scripts/economy-progression-journey.mjs`), and
2. A gameplay screenshot showing the panel with the per-building rate visible over the settlement.

Secondary defect noted (not the headline gap): `managerValidity.checkBuildValidity is not a function` browser errors from the journey. This placement-validity regression must be resolved and its journey rerun successfully before a later `OURS` verdict can be evidenced.

## Round

1 — settlement-builder.md evidence absent; verdict issued against current game state and journey evidence. Builder to return with per-building production attribution (or an equivalent single cohesive chain-readability improvement) plus captures.

## Round 2 re-review — 2026-09-14

### Verdict: REFERENCE

### What closed from round 1

The previous per-building-attribution gap is closed in the implementation; its runtime acceptance (displayed rate equals simulated attribution over a ten-tick window) is not yet verified:

- `EconomySystem.depositResource(..., sourceBuilding)`, `queueBuildingProduction()`, `flushProductionWindow()`, and `getBuildingProduction()` maintain a rolling ten-tick, per-building resource rate.
- `VillagerSystem.depositCarry()` forwards `villager.jobBuilding` as the attribution source.
- `EconomySystem.updateStats()` publishes `selectedBuildingInfo.production`; `components/GameUI.tsx` renders `+{perTick} {resource}/tick`.
- `BuildingManager.checkBuildValidity()` is restored and delegates to `getBuildValidity()`, resolving the prior `SpriteGhostBuildingManager` runtime error.

### Fresh verification

- `npx tsc --noEmit` — PASS (exit 0).
- `npm run build` — PASS: 1,839 modules transformed; production build completed in 14.75s. Existing >1 MB chunk advisory remains non-fatal.
- `node scripts/economy-progression-journey.mjs` — PASS: `phase: "complete"`, `browserErrors: []`; it proves Lumber Camp assignment and deposit (+20 wood), construction progression, training, movement, combat command, and save/reload continuity. The earlier `checkBuildValidity` browser error is absent.
- Static inspection confirms the attribution data path and selected-building render noted above.

The journey proves camp assignment and net wood growth but does NOT assert the published per-building rate equals its simulated deposit attribution over a ten-tick window, and no live gameplay capture exists. `settlement-after.png` is a menu capture, not settlement gameplay. So the round-1 acceptance check is implemented but remains runtime-unverified. Direct YouTube fetches remain blocked; reference claims remain limited to the retrieved descriptions cited in round 1.

### Single largest remaining observable gap

**Aggregate production-chain topology is still invisible.** A selected Lumber Camp now explains its own output, but there is no settlement-level view showing the relationship between sources, producers, storage/consumers, and bottlenecks. This remains below the retrieved Anno 1800 reference description (source → factory → consumer tracing with stock/rate/bottleneck visibility) and the Stronghold/Manor Lords descriptions' legible economic flows.

Relevant files/symbols:
- `game/systems/EconomySystem.ts` — `getBuildingProduction()` exposes isolated building rates only; no chain/topology model or settlement roll-up exists.
- `types.ts` — `BuildingProduction` and `SelectedBuildingInfo.production` represent one resource/rate, not dependencies or flows.
- `components/GameUI.tsx` — selected-building ribbon renders one building's `+N resource/tick`; no multi-building production-flow display.

### Acceptance check

In a live settlement containing at least a source/producers/storage-or-consumer path, open one economy overview and see every active production leg as a connected, labeled flow with its current per-tick rate and a blocked/idle state where applicable. Disable one producer: its leg must visibly become blocked/idle and the downstream leg must identify the missing input or falling stock. Prove this with a scripted journey asserting the displayed flow states against simulation state plus a gameplay screenshot of the overview.

### Decision

The placement-regression blocker is verified closed by the clean journey. Per-building production attribution is implemented and type-checked, but its runtime and visual proof remains outstanding. **REFERENCE** remains for one product gap only: CivStrategy still presents disconnected per-building rates instead of a readable settlement-wide production chain.
