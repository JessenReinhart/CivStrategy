# Repository Guidelines

## Project Overview

CivStrategy: Ancient Realms — a Civilization-style real-time strategy game. Players build settlements, manage resources/population happiness, train military units, and expand territory across procedurally generated isometric maps.

**Tech stack:** React 18 + Phaser 3 + TypeScript 5.2 + Vite 5 + Tailwind CSS (CDN) + GSAP. Originally scaffolded from Google AI Studio (Gemini app export), now a standalone Vite+React project.

---

## Architecture & Data Flow

### Rendering: Phaser 3 Isometric (2:1 diamond projection)

All game logic uses **cartesian coordinates** internally. `toIso()` / `toCartesian()` in `game/utils/iso.ts` convert only at the rendering boundary. This separation is critical — never mix coordinate systems.

### God-Class Orchestrator: MainScene

`game/MainScene.ts` (~1100 lines) is the central hub:
- Owns **all 21 system instances** as public properties
- Owns all Phaser groups (units, buildings, trees, worldLayer, uiGroup)
- Owns spatial hash instances (treeSpatialHash, unitSpatialHash)
- Runs the main `update()` loop calling systems in fixed order
- Owns all game state (resources, population, happiness, age, diplomacy, game speed)
- Dispatches stats to React via `this.events.emit(EVENTS.UPDATE_STATS, ...)`

`MainScene` is currently a compatibility hub, not the desired long-term home for arbitrary gameplay logic. New cross-system behavior should live in the smallest owning system/service and be wired by `MainScene` rather than implemented there just because `scene.*` is available.

### System List (21 systems)

| System | File | Responsibility |
|---|---|---|
| TerrainSystem | `game/systems/TerrainSystem.ts` | Perlin noise heightmap, movement/combat modifiers, slope |
| MapGenerationSystem | `game/systems/MapGenerationSystem.ts` | World gen (forests, fertile zones, animals, starting resources) |
| EntityFactory | `game/systems/EntityFactory.ts` | Spawns buildings, units, trees; handles damage/death |
| Pathfinder | `game/systems/Pathfinder.ts` | JPS pathfinding + flow fields for mass movement + async queue |
| UnitSystem | `game/systems/UnitSystem.ts` | Military AI (combat, path following, targeting, projectiles) |
| SquadSystem | `game/systems/SquadSystem.ts` | Visual soldier rendering with 4-level LOD |
| FormationSystem | `game/systems/FormationSystem.ts` | Offset calculator (Box/Line/Circle/Skirmish/Wedge) |
| VillagerSystem | `game/systems/VillagerSystem.ts` | Civilian unit management (separate from military) |
| AnimalSystem | `game/systems/AnimalSystem.ts` | Animal wandering behavior |
| BuildingManager | `game/systems/BuildingManager.ts` | Building placement, demolition, territory |
| EconomySystem | `game/systems/EconomySystem.ts` | Resource gen, job assignment, population growth |
| InputManager | `game/systems/InputManager.ts` | Mouse/keyboard input, selection, camera |
| EnemyAISystem | `game/systems/EnemyAISystem.ts` | AI opponent (build, recruit, attack, defend) |
| FogOfWarSystem | `game/systems/FogOfWarSystem.ts` | RenderTexture-based fog of war |
| MinimapSystem | `game/systems/MinimapSystem.ts` | Minimap with dual-layer rendering |
| CullingSystem | `game/systems/CullingSystem.ts` | Viewport culling + tree visual pool management |
| InfiniteMapSystem | `game/systems/InfiniteMapSystem.ts` | Chunk-based infinite map generation |
| AtmosphericSystem | `game/systems/AtmosphericSystem.ts` | Clouds, bloom, tilt-shift, vignette, wind sway |
| ProceduralSoundSystem | `game/systems/ProceduralSoundSystem.ts` | Web Audio API synthesized sounds (zero audio assets) |
| FeedbackSystem | `game/systems/FeedbackSystem.ts` | Floating text indicators |
| ClashSystem | `game/systems/ClashSystem.ts` | Bridges clash events to MeatGrinderEffect |
| LiquidCombatSystem | `game/systems/LiquidCombatSystem.ts` | Pressure grid + contact lines + velocity alignment for liquid mass melee deformation |

All systems are class-based, take a `MainScene` reference, and read/write state directly via `this.scene.*`.

### Update Loop Order

```
InputManager → CullingSystem → VillagerSystem → AnimalSystem
→ LiquidCombatSystem.precompute() → UnitSystem
→ SquadSystem.syncPositions() → SquadSystem.update() → BuildingManager
→ EnemyAISystem → EconomySystem (1s/5s intervals) → Age advancement
→ InfiniteMapSystem → MinimapSystem → FogOfWarSystem → AtmosphericSystem
→ syncVisuals() → emit UPDATE_STATS → ProceduralSoundSystem
```

### React ↔ Phaser Bridge (Dual Channel)

- **Game → React:** `this.events.emit(EVENTS.UPDATE_STATS, ...)` → App.tsx listener → `setStats()`
- **React → Game:** `window.dispatchEvent(CustomEvent)` → App.tsx bridges to `gameInstance.events.emit()`

Event constants are defined in `constants.ts` under the `EVENTS` object. Never use magic strings.

---

## Architecture Guardrails

These rules are mandatory for new agent-driven changes. The full rationale lives in `docs/ARCHITECTURE_GUARDRAILS.md`.

- **Simulation state is authoritative.** Gameplay rules must not depend on Phaser sprite state being correct.
- **Rendering is a projection.** Phaser objects visualize state; they do not become the source of truth for simulation rules.
- **React is presentation/control.** Prefer explicit game events/commands over arbitrary Phaser internals.
- **MainScene is composition, not a dumping ground.** Put new gameplay logic in the smallest owning abstraction and use MainScene for wiring/update order.
- **Do not deepen `system → MainScene → system` coupling unnecessarily.** Prefer narrow dependencies and stable domain data/services when practical.
- **UnitSystem must not absorb every military concern.** New combat features should first identify whether they belong to combat resolution, movement/pathing, formations, deformation, projectile lifecycle, effects, or another focused abstraction.
- **Recurring bugs must be fixed at the abstraction level.** Search for sibling implementations before patching one call site.
- **Performance changes must follow measurements.** Identify whether the bottleneck is simulation/update time, rendering/draw pressure, allocations, or memory before optimizing.
- **Transient high-frequency visuals must be bounded.** Prefer object pools or equivalent reuse for combat feedback and stress-path effects; avoid unbounded `add.*`/`destroy()` churn in hot paths.
- **Completion requires verification.** Run the smallest relevant test first, then the full verification suite before declaring a change done whenever the environment permits.

---

## Key Directories

```
~/CivStrategy/
├── index.html          # Vite SPA entry (Tailwind CDN, fonts, importmap)
├── index.tsx           # React DOM mount point
├── App.tsx             # Top-level React orchestrator, game lifecycle, state, Phaser bridge
├── types.ts            # All enums & interfaces
├── constants.ts        # Game config, stats, event names, damage formula
├── components/         # React UI layer
├── game/               # Phaser game layer
│   ├── MainScene.ts    # Central orchestrator
│   ├── systems/        # Game systems
│   └── utils/          # Utilities and performance helpers
├── assets/textures/    # Sprite/terrain textures and shaders
└── src/                # Only vite-env.d.ts — NOT the source root
```

**Important:** Source files are at project root, not inside `src/`. The `src/` directory only has `vite-env.d.ts`.

---

## Development Commands

| Command | Script | Notes |
|---|---|---|
| `npm run dev` | `vite` | Start Vite dev server. **⚠️ ASK before running — dev server may already be active.** |
| `npm run build` | `vite build` | Production build → `dist/` |
| `npm run preview` | `vite preview` | Preview production build |
| `npm run lint` | `eslint . --max-warnings 0` | ESLint zero-warning policy |
| `npm run lint:fix` | `eslint . --fix` | Auto-fix lint issues |
| `npm run test` | `vitest run` | Single-run Vitest |
| `npm run verify` | full typecheck + lint + tests + Fallow + build | Preferred pre-push verification |

**Git hooks (Husky):** pre-commit → `npm run lint`, pre-push → `npm run build`.

---

## Code Conventions & Common Patterns

### File & Naming

- **PascalCase** for class files and React components (`UnitSystem.ts`, `MainMenu.tsx`)
- **camelCase** for variables, functions, methods
- **No barrel files** — use direct imports
- Systems import from `'../../types'` and `'../../constants'`; components import from `'../types'` and `'../constants'`

### Design Patterns

- **God Class / Mediator:** MainScene is the current compatibility hub; avoid adding new gameplay responsibilities to it unless it is genuinely cross-cutting orchestration.
- **Factory:** EntityFactory creates game entities.
- **Object Pool:** CullingSystem and combat systems pool hot-path visuals/projectiles; follow the same bounded reuse pattern for new high-frequency effects.
- **Spatial Partitioning:** SpatialHash for O(1) neighbor queries.
- **State Machine:** UnitState drives unit behavior.
- **Budgeted Processing:** UnitSystem and SquadSystem process units in per-frame buckets to maintain FPS.
- **Flow Fields:** Pathfinder generates shared flow fields for mass movement (12+ units).

### Combat Model (0 A.D.-style)

Three damage types: Hack, Pierce, Crush. Formula: `effectiveDamage = attack × 10 / (armor + 10)`. Damage/armor profiles per unit type defined in `constants.ts`.

### Owner Convention

`owner=0` → player, `owner=1` → AI enemy, `owner=-1` → neutral. Used consistently across all systems.

### Styling

All styling via Tailwind utility classes — no CSS files. Color palette defined as CSS custom properties in `index.html` (dust-white, parchment, gold-leaf, terracotta, etc.). Google Fonts loaded externally (Cinzel for headings, Inter for body, JetBrains Mono for code).

### Error Handling

- No global error boundary
- Lint errors treated as build failures (`--max-warnings 0`)
- `eslint-disable` directives used for `@typescript-eslint/no-explicit-any` where Phaser APIs require it

---

## Important Files

| File | Purpose |
|---|---|
| `index.html` | SPA shell, Tailwind CDN, fonts, CSS custom properties, ESM importmap |
| `index.tsx` | React mount point |
| `App.tsx` | Top-level React: game lifecycle, state, Phaser bridge |
| `types.ts` | All enums/interfaces |
| `constants.ts` | Game config, unit/building stats, events, damage formula |
| `game/MainScene.ts` | Central orchestrator — systems + authoritative state |
| `game/systems/UnitSystem.ts` | Largest system — combat, movement, pathfinding integration |
| `game/systems/EconomySystem.ts` | Resource generation, job assignment, population |
| `game/systems/EnemyAISystem.ts` | AI opponent logic |
| `game/systems/Pathfinder.ts` | JPS + flow fields + path caching |
| `components/GameUI.tsx` | In-game HUD |
| `components/MainMenu.tsx` | Main menu |
| `eslint.config.js` | ESLint 9 flat config |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript strict config |
| `GEMINI.md` | Deep game mechanics/context |
| `0AD_mechanics_research.md` | 0 A.D. mechanics reference |

---

## Runtime & Tooling Preferences

- **Package manager:** npm
- **Runtime:** Browser (ESM). No Node.js runtime for game code.
- **Module system:** ESM (`"type": "module"`)
- **TypeScript:** Strict mode, ES2020 target, ESNext module, bundler resolution, `noEmit`
- **Build:** Vite 5 with React plugin
- **Lint:** ESLint 9 flat config with TypeScript/React plugins
- **Git hooks:** Husky 9 — pre-commit (lint), pre-push (build)
- **No Prettier** configured
- **No path aliases** — use relative imports
- **No `.env` files** — no environment variables used
- **Styling:** Tailwind via CDN

---

## Testing & QA

- **Framework:** Vitest v2.1.8 (`vitest run`)
- **Test location:** Co-located with source (`<ModuleName>.test.ts`)
- **Coverage:** Minimal; only `ProceduralSoundSystem.test.ts` is currently present in the repository.
- **No integration/E2E test framework is currently configured.**
- **Fallow:** use it to surface dead code, circular dependencies, complexity, duplication, and architecture drift.

The existing `ProceduralSoundSystem.test.ts` is a reference for Phaser/Web Audio mocking patterns.

### Writing New Tests

- Place tests next to source: `game/systems/MySystem.test.ts`
- Mock Phaser with `vi.mock('phaser')` when needed
- Run `npm run test` single-run; do not use watch mode for CI-style validation

---

## Verification Workflow

Before every commit/push, use `npm run verify` when available. Do not truncate compiler or verifier output when diagnosing failures.

`npm run verify` is intended to cover:
1. TypeScript type checking
2. ESLint (zero warnings)
3. Vitest
4. Fallow dead-code analysis
5. Fallow full analysis
6. Production build

Never claim a change is verified solely because a patch was applied. Runtime evidence and test output are the source of truth.

---

## Performance Considerations

The codebase is designed for thousands of concurrent units:

- **SpatialHash** for O(1) neighbor queries
- **Budgeted processing:** UnitSystem and SquadSystem process N units per frame
- **Flow fields:** shared flow fields for mass movement (12+ units)
- **Tree virtualization:** trees are data-only; visual sprites are pooled
- **LOD rendering:** SquadSystem has 4 detail levels
- **CullingSystem:** viewport culling and tree visual pooling
- **Minimap:** dual-layer RenderTexture with throttled updates
- **FogOfWar:** low-res RenderTexture to reduce fill rate

Performance work should prioritize measured hotspots. Current stress evidence indicates CPU/game logic is substantially cheaper than Phaser WebGL rendering, so rendering/draw pressure should be investigated before speculative CPU micro-optimization.
