CivStrategy: Ancient Realms — historical RTS/Kingdom Builder (React 18, Phaser 3, TypeScript 5.2, Vite 5). Iterative design audit cycle: 5 parallel scouts → synthesize → fix → repeat. 5 cycles completed.

## Current State (v2.3 + Cycle 5 fixes)

Spatial Economy: villager carry loop (IDLE→GATHERING→CARRYING→deposit), deposit-based income, building upkeep (Barracks -2G, Lodge -1G; farm removed from upkeep), population food cost (30). Wildlife: 4 animal species (deer/wolf/boar/rabbit) with flee/herd/hunt/breed AI, seasonal modifiers, respawn timer (30s, species caps). Seasons: 5-min cycles (SPRING→SUMMER→AUTUMN→WINTER) affecting farms, breeding, pathfinding, tree regrowth, sounds, tint. Combat: 0 A.D. damage model (hack/pierce/crush), 8 unit types, research mult per-owner. AI: proportional economy (base + per-building - upkeep), terrain-aware building. Research: 6 techs, ResearchManager wired to combat/economy. Feedback: toasts, season HUD, building info panel, efficiency rings.

## Cycle 5 Critical Fixes
- Farm upkeep double-count removed (was making farms net negative)
- depositResource applies gatherMult to all 3 resource types (was wood-only)
- AI has real friction (upkeep + pop food cost)
- Research getSnapshot uses unit owner (was hardcoded player(0))
- Villagers targetable by enemy units (economy raiding possible)
- X button bridge fixed (SELECTION_CHANGED window→game bridge)
- handleQuit resets all v2.3 fields
- Animal respawn prevents extinction (30s timer, species caps, winter blocked)

## Key Files
MainScene.ts (~1190 lines, god-class orchestrator), UnitSystem.ts (largest, combat), EconomySystem.ts (deposit-based), VillagerSystem.ts (carry FSM), AnimalSystem.ts (4 species + respawn), constants.ts (config/stats), types.ts (enums/interfaces).

## Tests & Quality
26 tests (combatPath.test.ts, ProceduralSoundSystem.test.ts). 0 lint warnings. Clean build.

## Remaining HIGH Gaps (next cycle)
1. Blob targeting — all units stack on single closest enemy (no spread)
2. Gold carry loop — no gold resource nodes (gold passive-only)
3. Net rate labels — UI shows gross not net
4. Keyboard shortcuts — zero beyond camera
5. Terrain-agnostic building — no biome affinity bonuses

## Design Pillars
Every villager has purpose, economy drives warfare, cities feel alive, logistics matter, terrain/castles matter, player solves problems, AI creates stories, historical authenticity, simplicity on surface/depth underneath.

## Managed Skill
game-design-audit at ~/.omp/agent/managed-skills/game-design-audit/SKILL.md
