# Repository Guidelines

## Project Overview

CivStrategy: Ancient Realms — a Civilization-style real-time strategy game. Players build settlements, manage resources/population happiness, train military units, and expand territory across procedurally generated isometric maps.

**Tech stack:** React 18 + Phaser 3 + TypeScript 5.2 + Vite 5 + Tailwind CSS (local Vite/PostCSS build) + GSAP. Originally scaffolded from Google AI Studio (Gemini app export), now a standalone Vite+React project.

---

## Architecture & Data Flow

### Rendering: Phaser 3 Isometric (2:1 diamond projection)

All game logic uses **cartesian coordinates** internally. `toIso()` / `toCartesian()` in `game/utils/iso.ts` convert only at the rendering boundary. This separation is critical — never mix coordinate systems.

### God-Class Orchestrator: MainScene

`game/MainScene.ts` (~2100 lines) is the orchestrator and Phaser binding layer:
- Delegates **all 24 runtime systems** to `SystemRegistry` (`game/runtime/SystemRegistry.ts`)
- Delegates Phaser groups (`units`, `buildings`, `trees`, `treeVisuals`, `worldVisuals`, `uiGroup`) and spatial hashes to `EntityRegistryService` (`game/runtime/EntityRegistryService.ts`)
- Delegates authoritative state (resources, population, happiness, age, diplomacy, game speed, seasons) to `GameStateService` (`game/runtime/GameStateService.ts`) via delegating getters/setters
- Runs the main `update()` loop via `SimulationRuntimeHost`, `ProgressionRuntime`, and `WorldRuntime`
- Dispatches stats to React via `this.events.emit(EVENTS.UPDATE_STATS, ...)`

### System List (MainScene-owned; 24 runtime system fields)

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
Pathfinder.beginFrame → DayNightSystem.update → InputManager.update
→ CullingSystem.update → SimulationRuntime (VillagerSystem, AnimalSystem,
  LiquidCombat.precompute, UnitSystem, SquadSystem.syncPositions, SquadSystem.update)
→ BuildingManager.update → EnemyAISystem.update
→ ProgressionRuntime (economy/research/victory/season/age/population)
→ WorldRuntime (InfiniteMapSystem, MinimapSystem, FogOfWarSystem)
→ AtmosphericSystem.update → FeedbackSystem.update → syncVisuals
```
Runtime adapters (`simulationHost`, `progressionHost`, `worldHost`) own the internal
ordering of their sub-systems; the scene still calls them in the above fixed order.

### React ↔ Phaser Bridge (Dual Channel)

- **Game → React:** `this.events.emit(EVENTS.UPDATE_STATS, ...)` → App.tsx listener → `setStats()`
- **React → Game:** `window.dispatchEvent(CustomEvent)` → App.tsx bridges to `gameInstance.events.emit()`

Event constants are defined in `constants.ts` under the `EVENTS` object. Never use magic strings.

---

## Key Directories

```
~/CivStrategy/
├── index.html              # Vite SPA entry (local Tailwind build, fonts, importmap)
├── index.tsx               # React DOM mount point
├── App.tsx                 # Top-level React orchestrator
├── types.ts                # All enums & interfaces
├── constants.ts            # Game config, stats, event names, damage formula
├── components/             # React UI layer (5 components)
│   ├── MainMenu.tsx        # Main menu (3 screens, GSAP animations)
│   ├── GameUI.tsx          # In-game HUD overlay
│   ├── PhaserGame.tsx      # Phaser.Game React wrapper
│   ├── LoadingScreen.tsx   # Animated loading screen
│   └── StressTestOverlay.tsx
├── game/                   # Phaser game layer
│   ├── MainScene.ts        # Central orchestrator (god-class)
│   ├── systems/            # 24 MainScene-owned system classes
│   └── utils/              # Utilities (iso.ts, SpatialHash.ts, Noise.ts, MeatGrinderEffect.ts)
├── assets/textures/        # Sprite/texture PNGs + water.frag shader
├── src/                    # ⚠️ Only vite-env.d.ts + tailwind.css entry — NOT the source root
└── [*.png at root]         # Large game sprites (townhall, lumber, ground, field)
```

**Important:** Source files are at project root, not inside `src/`. The `src/` directory only has `vite-env.d.ts`.

---

## Development Commands

| Command | Script | Notes |
|---|---|---|
| `npm run dev` | `vite` | Dev server. **⚠️ ASK before running — dev server may already be active.** |
| `npm run build` | `vite build` | Production build → `dist/` |
| `npm run preview` | `vite preview` | Preview production build |
| `npm run lint` | `eslint . --max-warnings 0` | Zero-warning lint policy |
| `npm run lint:fix` | `eslint . --fix` | Auto-fix lint issues |
| `npm run test` | `vitest run` | Single-run Vitest (no watch mode) |

**Git hooks (Husky):** pre-commit → `npm run lint`, pre-push → `npm run build`.

---

## Code Conventions & Common Patterns

### File & Naming

- **PascalCase** for class files and React components (`UnitSystem.ts`, `MainMenu.tsx`)
- **camelCase** for variables, functions, methods
- **No barrel files** — all imports use direct paths (`'../../types'`, `'../constants'`)
- Systems import from `'../../types'` and `'../../constants'` (two levels up from `game/systems/`)
- Components import from `'../types'` and `'../constants'` (one level up from `components/`)

### Design Patterns

- **God Class / Mediator:** MainScene is the central hub; all systems hold a reference to it
- **Factory:** `EntityFactory` creates all game entities
- **Object Pool:** `CullingSystem` uses Phaser.Group pool for tree visuals; `UnitSystem` pools projectiles
- **Spatial Partitioning:** `SpatialHash` for O(1) neighbor queries (trees + units)
- **State Machine:** `UnitState` enum drives unit behavior (IDLE → MOVING_TO_WORK → WORKING, etc.)
- **Budgeted Processing:** `UnitSystem` and `SquadSystem` process units in per-frame buckets to maintain FPS
- **Flow Fields:** `Pathfinder` generates shared flow fields for mass movement (12+ units)

### Combat Model (0 A.D.-style)

Three damage types: Hack, Pierce, Crush. Formula: `effectiveDamage = attack × 10 / (armor + 10)`. Damage/armor profiles per unit type defined in `constants.ts`.

### Owner Convention

`owner=0` → player, `owner=1` → AI enemy, `owner=-1` → neutral. Used consistently across all systems.

### Styling

All styling via **Tailwind utility classes** — no CSS files. Color palette defined as CSS custom properties in `index.html` (dust-white, parchment, gold-leaf, terracotta, etc.). Fonts are self-hosted/system fallback (no blocking external `@import`).

### Error Handling

- No global error boundary
- Lint errors treated as build failures (`--max-warnings 0`)
- `eslint-disable` directives used for `@typescript-eslint/no-explicit-any` in places where Phaser APIs demand `any`

---

## Important Files

| File | Purpose |
|---|---|
| `index.html` | SPA shell, local Tailwind build, fonts, CSS custom properties, ESM importmap |
| `index.tsx` | React DOM mount (StrictMode) |
| `App.tsx` | Top-level React: game lifecycle, state, Phaser bridge |
| `types.ts` | All TypeScript enums and interfaces |
| `constants.ts` | Game config, unit/building stats, event names, damage formula |
| `game/MainScene.ts` | Central orchestrator — owns all systems and game state |
| `game/systems/UnitSystem.ts` | Largest system (53KB) — combat, movement, pathfinding integration |
| `game/systems/EconomySystem.ts` | Resource generation, job assignment, population |
| `game/systems/EnemyAISystem.ts` | AI opponent logic |
| `game/systems/Pathfinder.ts` | JPS + flow fields + path caching |
| `components/GameUI.tsx` | In-game HUD (resources, build menu, unit controls) |
| `components/MainMenu.tsx` | Main menu with faction selection, map config |
| `eslint.config.js` | ESLint 9 flat config |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript strict config (ES2020, ESNext module) |
| `GEMINI.md` | Comprehensive 400-line AI context document (read this for deep game mechanics) |
| `0AD_mechanics_research.md` | Research on 0 A.D. game mechanics used as design reference |

---

## Runtime & Tooling Preferences

- **Package manager:** npm (lockfile: `package-lock.json`)
- **Runtime:** Browser (ESM). No Node.js runtime for game code.
- **Module system:** ESM throughout (`"type": "module"` in package.json)
- **TypeScript:** Strict mode, ES2020 target, ESNext module, bundler resolution, `noEmit` (Vite handles emit)
- **Build:** Vite 5 with `@vitejs/plugin-react`, output to `dist/`
- **Lint:** ESLint 9 flat config with `typescript-eslint`, `react-hooks`, `react-refresh` plugins
- **Git hooks:** Husky 9 — pre-commit (lint), pre-push (build)
- **No Prettier** configured
- **No path aliases** — use relative imports
- **No `.env` files** — no environment variables used
- **Styling:** Tailwind via local Vite/PostCSS build (see `tailwind.config.js`, `postcss.config.js`, `src/tailwind.css`)

---

## Testing & QA

- **Framework:** Vitest v2.1.9 (runs via `npm run test` → `vitest run`; coverage via `npm run coverage`)
- **Test location:** Co-located with source (`<ModuleName>.test.ts`)
- **Current suite:** 69 test files / 510 tests; `game/**` v8 coverage measured at ~39% lines, ~72% branches, ~52% functions
- **Coverage script:** `vitest run --coverage` with low reachable thresholds (lines 35, statements 35, branches 50, functions 45)
- **No integration/E2E tests** — no Playwright, Cypress, or Puppeteer
- **No test helpers/fixtures/mocks directory** — all mocks are inline
- **No snapshot testing**

Use the existing co-located tests as the reference pattern; most mocks are inline `vi.mock('phaser')` stubs.

### Writing New Tests

- Place test files next to source: `game/systems/MySystem.test.ts`
- Mock Phaser with `vi.mock('phaser')` (see `ProceduralSoundSystem.test.ts` for pattern)
- Run `npm run test` to execute (single-run, no watch)
- No coverage reports available without adding `@vitest/coverage-v8`


---

## Verification Workflow

A comprehensive verification workflow prevents type errors, lint violations, and unused code from reaching production. **Run before every commit/push.**

### Quick Check

```bash
npm run verify
```

This runs the full verification suite locally:
1. **TypeScript type check** (strict, filters known-safe errors like `vite.config.d.ts`)
2. **ESLint** (zero-warning policy)
3. **Unit tests** (Vitest)
4. **Fallow dead code detection** (finds unused exports, files, circular deps)
5. **Fallow full analysis** (complexity, duplication, architecture drift)
6. **Production build** (ensures `vite build` succeeds)

### Fallow — Unused Code Detection

[Fallow](https://github.com/fallow-rs/fallow) is a static analysis tool for TypeScript/JavaScript that finds:
- Dead code (unused files, exports, class members)
- Circular dependencies
- Duplicate code fragments
- Complexity hotspots
- Architecture drift

```bash
# Quick dead-code check
npx fallow dead-code

# Full analysis
npx fallow

# Type-aware mode (slower, more accurate)
npx fallow dead-code --type-aware

# JSON output for CI
npx fallow dead-code --format json
```

Currently **non-blocking** (warnings only) — review findings but won't fail CI. Can be made blocking once codebase is cleaned up.

### CI/CD Integration

GitHub Actions workflow at `.github/workflows/verify.yml` runs the same checks on every push/PR to `main`, `develop`, and `feat/**` branches.

### Git Hooks

Husky pre-commit: runs `npm run lint`  
Husky pre-push: runs `npm run build`

**Recommended:** Update `.husky/pre-push` to run `npm run verify` instead of just build:

```bash
#!/bin/sh
npm run verify
```

This catches type errors before push (like `this.isPendingLoad()` vs `isPendingLoad()`).

### Why This Matters

TypeScript caught the `this.isPendingLoad()` error, but incomplete verification output (`| head -30`) hid it. The runtime error surfaced immediately when tested. This workflow ensures:
- **Full tsc output** is checked (no truncation)
- **Known-safe errors** are filtered (e.g., `vite.config.d.ts`)
- **New errors block CI/push** before they reach production
- **Dead code is surfaced** so the codebase stays lean

Always run `npm run verify` before claiming "done" on any task.

---

## Performance Considerations

The codebase is designed for thousands of concurrent units:

- **SpatialHash** for O(1) neighbor queries (both tree and unit spatial hashes)
- **Budgeted processing:** UnitSystem and SquadSystem process N units per frame, not all at once
- **Flow fields:** Pathfinder generates shared flow fields for mass movement (12+ units) instead of individual A* paths
- **Tree virtualization:** Trees are data-only; visual sprites are pooled (acquired/released on viewport entry/exit)
- **LOD rendering:** SquadSystem has 4 detail levels based on camera distance
- **CullingSystem:** Runs on 200ms interval, toggles visibility of off-screen entities
- **Minimap:** Dual-layer RenderTexture with 15-frame update interval
- **FogOfWar:** Low-res (0.25x) RenderTexture to minimize fill rate

Performance profiling is built into MainScene's update loop with per-system timing.
