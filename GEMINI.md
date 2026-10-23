# GEMINI.md - CivStrategy RTS Technical Specification

> **Purpose**: This document provides LLMs with essential technical context about the CivStrategy RTS game project to minimize token waste and maximize development efficiency.

---

## Project Overview

**CivStrategy** is a Civilization-style Real-Time Strategy (RTS) game built with **Phaser 3**, **React**, and **TypeScript**. It features:
- Faction-based gameplay (Romans, Gauls, Carthage)
- Resource management (Wood, Food, Gold)
- Building construction and economy systems
- Combat units with formations and stances
- Fog of War, infinite/fixed map modes, AI opponents
- Atmospheric effects (bloom, particles, vignette)

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Game Engine** | Phaser 3 | ^3.80.0 |
| **Frontend** | React | ^18.2.0 |
| **Language** | TypeScript | ^5.2.2 |
| **Build Tool** | Vite | ^5.2.0 |
| **Styling** | Tailwind CSS | ^3.4.3 |
| **Linting** | ESLint 9 | ^9.39.2 |
| **UI Icons** | lucide-react | ^0.562.0 |

---

## Project Structure

```
CivStrategy/
├── game/                          # Phaser game logic (core engine)
│   ├── MainScene.ts              # Main Phaser scene (coordinates all systems)
│   ├── systems/                  # Game systems (24 MainScene-owned classes + auxiliary managers)
│   │   ├── AtmosphericSystem.ts  # Bloom, particles, atmospheric effects
│   │   ├── BuildingManager.ts    # Building placement, demolition, territory
│   │   ├── CullingSystem.ts      # Performance: off-screen entity culling
│   │   ├── EconomySystem.ts      # Resource gathering, production rates
│   │   ├── EnemyAISystem.ts      # AI faction logic
│   │   ├── EntityFactory.ts      # Spawning combat units & buildings
│   │   ├── FeedbackSystem.ts     # Visual feedback (selection circles, etc.)
│   │   ├── FogOfWarSystem.ts     # Vision & fog rendering
│   │   ├── FormationSystem.ts    # Unit formation calculations
│   │   ├── InfiniteMapSystem.ts  # Infinite map chunk generation
│   │   ├── InputManager.ts       # Mouse/keyboard input handling
│   │   ├── MapGenerationSystem.ts# Procedural terrain generation
│   │   ├── MinimapSystem.ts      # Minimap rendering & interaction
│   │   ├── Pathfinder.ts         # A* pathfinding
│   │   ├── SquadSystem.ts        # Visual squad rendering (soldiers)
│   │   ├── UnitSystem.ts         # Combat unit movement, combat, AI
│   │   └── VillagerSystem.ts     # Villager management (static resources)
│   └── utils/
│       ├── iso.ts                # Isometric coordinate conversion
│       ├── Noise.ts              # Perlin noise for terrain
│       └── SpatialHash.ts        # Spatial partitioning for performance
├── components/                   # React UI components
│   ├── GameUI.tsx                # Main in-game HUD
│   ├── LoadingScreen.tsx         # Loading screen
│   ├── MainMenu.tsx              # Main menu & game settings
│   └── PhaserGame.tsx            # React wrapper for Phaser game
├── App.tsx                       # React app entry point
├── index.tsx                     # DOM mount point
├── types.ts                      # TypeScript type definitions
├── constants.ts                  # Game constants (stats, costs, etc.)
├── *.png                         # Asset files (sprites, textures)
├── package.json                  # Dependencies & scripts
├── tsconfig.json                 # TypeScript configuration
├── vite.config.ts                # Vite bundler config
└── eslint.config.js              # ESLint rules
```

---

## Core Architecture

### 1. System-Based Design (ECS-like)

The game follows a **system-based architecture** where each system manages a specific domain:

- **MainScene.ts**: Orchestrates runtime loops; delegates 24 systems to `SystemRegistry`, 6 entity groups + 2 spatial hashes to `EntityRegistryService`, and state to `GameStateService`
- **GameStateService**: Authoritative owner of game state (resources, population, happiness, age, diplomacy, game speed, seasons)
- **SystemRegistry / EntityRegistryService**: Typed containers decoupling system instances and entity groups from scene state
- **Systems** (`game/systems/`): Independent modules that handle specific responsibilities
- **Communication**: Systems communicate via Phaser events (see `EVENTS` in `constants.ts`)

### 2. Data Flow

```
User Input (React UI) 
    → Phaser Events (EVENTS)
    → MainScene (state container)
    → Systems (game logic)
    → Phaser Scene (rendering)
    → React UI (stats update via events)
```

**Example**: Building a house
1. User clicks "Build House" in `GameUI.tsx`
2. `App.tsx` emits `EVENTS.BUILD_MODE_TOGGLED` event
3. `BuildingManager` listens and enters build mode
4. On click, `BuildingManager.tryBuild()` validates placement
5. `EntityFactory.spawnBuilding()` creates the building
6. `EconomySystem` updates resource rates
7. `MainScene.syncVisuals()` emits `EVENTS.UPDATE_STATS`
8. `GameUI.tsx` re-renders with new stats

### 3. Coordinate System

The game uses **isometric coordinates**:
- **World Coordinates**: Cartesian (x, y) for game logic
- **Screen Coordinates**: Isometric projection for rendering
- **Conversion**: `toIso(x, y)` and `toCartesian(isoX, isoY)` in `game/utils/iso.ts`

---

## Key Files & Their Responsibilities

### 📁 Core Game Files

| File | Purpose | Key Exports/Features |
|------|---------|---------------------|
| **types.ts** | Type definitions | `FactionType`, `UnitType`, `BuildingType`, `GameStats`, `UnitState`, `FormationType`, `UnitStance`, `GameUnit`, `VillagerData` interfaces |
| **constants.ts** | Game configuration | `BUILDINGS`, `UNIT_STATS`, `FACTION_COLORS`, `EVENTS`, `TILE_SIZE`, `FORMATION_BONUSES` |
| **MainScene.ts** | Game coordinator | Initializes all systems, manages resources/population/happiness, handles game speed, emits UI updates |

### 📁 Critical Systems

| System | Responsibility | Key Methods |
|--------|---------------|-------------|
| **UnitSystem** | Combat unit movement, combat, formations, stances | `commandMove()`, `commandAttack()`, `setFormation()`, `setStance()`, `updateUnitLogic()` |
| **VillagerSystem** | Villager management (static resources) | `spawnVillager()`, `assignJob()`, `getIdleVillagers()`, `sendToRallyPoint()` |
| **BuildingManager** | Building placement, demolition, territory | `enterBuildMode()`, `tryBuild()`, `demolishBuilding()`, `drawTerritory()` |
| **EconomySystem** | Resource gathering, worker assignment | `tickEconomy()`, `tickPopulation()`, `assignJobs()` (queries VillagerSystem) |
| **EntityFactory** | Spawning combat units & buildings | `spawnBuilding()`, `spawnUnit()` (combat units only) |
| **InputManager** | User input | Handles drag selection, right-click movement, attack commands, waypoints |
| **SquadSystem** | Visual squads | Renders individual soldiers for units (e.g., 16 soldiers for Pikesman) |
| **FogOfWarSystem** | Vision & fog | Manages explored/visible areas, reveals fog based on unit vision |
| **MinimapSystem** | Minimap | Renders minimap, handles minimap clicks for camera navigation |

### 📁 React Components

| Component | Purpose |
|-----------|---------|
| **App.tsx** | Main React component, bridges Phaser ↔ React, manages game lifecycle |
| **GameUI.tsx** | In-game HUD (resources, building menu, unit training, formations, stances) |
| **MainMenu.tsx** | Faction selection, map mode/size, fog of war, peaceful mode, AI toggle |
| **PhaserGame.tsx** | Phaser game container (mounts Phaser into React) |

---

## Game Mechanics

### Resources
- **Wood**: From Lumber Camps (requires worker)
- **Food**: From Farms (requires worker) or Hunter's Lodges (requires worker, gathers animals)
- **Gold**: From tax rate (% of population)

### Units

| Unit Type | HP | Attack | Range | Speed | Squad Size | Role | Type |
|-----------|----|----|-------|-------|------------|------|------|
| **Villager** | N/A | N/A | N/A | 80 | 1 | Resource gathering | Static Resource |
| **Pikesman** | 200 | 15 | 40 | 100 | 16 | Standard infantry | Combat Unit |
| **Cavalry** | 400 | 20 | 40 | 160 | 6 | Fast, heavy cavalry | Combat Unit |
| **Legion** | 2000 | 10 | 40 | 70 | 100 | Massive infantry | Combat Unit |
| **Archer** | 150 | 12 | 200 | 90 | 10 | Ranged unit | Combat Unit |
| **Animal** | N/A | N/A | N/A | 40 | 1 | Resource (food) | Static Resource |

### Formations

| Formation | Attack Bonus | Defense Bonus | Speed Multiplier |
|-----------|--------------|---------------|------------------|
| **Box** | +0% | +0% | 1.0x |
| **Line** | +20% | +0% | 0.8x |
| **Circle** | +0% | +25% | 0.7x |
| **Skirmish** | +0% | +15% | 1.1x |
| **Wedge** | +10% | +0% | 1.2x |

### Unit Stances

| Stance | Behavior |
|--------|----------|
| **Aggressive** | Chase enemies indefinitely |
| **Defensive** | Chase briefly, return to anchor point |
| **Hold** | Stand ground, only attack in range |

### Buildings

- **Town Center**: Main hub, provides territory & population
- **House**: +8 max population
- **Farm**: Requires worker, generates food
- **Lumber Camp**: Requires worker, generates wood
- **Hunter's Lodge**: Requires worker, gathers nearby animals for food
- **Barracks**: Trains combat units (Pikesman, Archer, Cavalry)
- **Bonfire**: Provides territory & happiness
- **Small Park**: +5 happiness

---

## Events System

**Location**: `constants.ts → EVENTS`

All Phaser ↔ React communication happens via custom events:

```typescript
export const EVENTS = {
  UPDATE_STATS: 'update-stats',           // MainScene → GameUI (stats update)
  SELECTION_CHANGED: 'selection-changed', // InputManager → GameUI (units selected)
  BUILDING_SELECTED: 'building-selected', // BuildingManager → GameUI (building selected)
  BUILD_MODE_TOGGLED: 'build-mode-toggled', // GameUI → BuildingManager
  TOGGLE_DEMOLISH: 'toggle-demolish',     // GameUI → BuildingManager
  SET_TAX_RATE: 'set-tax-rate',           // GameUI → MainScene
  REGROW_FOREST: 'regrow-forest',         // GameUI → BuildingManager
  CENTER_CAMERA: 'center-camera',         // GameUI → MainScene
  SET_GAME_SPEED: 'set-game-speed',       // GameUI → MainScene
  MINIMAP_CLICK: 'minimap-click',         // MinimapSystem → MainScene
  DEMOLISH_SELECTED: 'demolish-selected', // GameUI → BuildingManager
  SET_BLOOM_INTENSITY: 'set-bloom-intensity' // GameUI → AtmosphericSystem
};
```

**Usage Example**:
```typescript
// React → Phaser
scene.events.emit(EVENTS.SET_TAX_RATE, newTaxRate);

// Phaser → React
scene.events.emit(EVENTS.UPDATE_STATS, gameStats);
```

---

## Important Patterns & Conventions

### 1. Unit State Machine

Units (`UnitSystem.ts`) follow a state machine:

```typescript
export enum UnitState {
  IDLE = 'idle',
  MOVING_TO_WORK = 'moving_to_work',
  WORKING = 'working',
  MOVING_TO_RALLY = 'moving_to_rally',
  WANDERING = 'wandering',
  CHASING = 'chasing',
  ATTACKING = 'attacking'
}
```

State transitions happen in `UnitSystem.updateUnitLogic()`.

### 2. Entity Data Storage

Phaser GameObjects store custom data via:
- **Method 1**: `obj.setData('key', value)` / `obj.getData('key')`
- **Method 2**: Direct properties (e.g., `unit.unitType`, `unit.state`)

**GameUnit Interface** (`types.ts`): Extends `Phaser.GameObjects.Image` with typed properties.

### 3. Squad System

Combat units are visually represented as squads:
- **Main Unit**: Invisible Phaser.Image (holds logic, HP, position)
- **Visual Container**: `unit.visual` (Phaser.Container with soldier sprites)
- **SquadSystem**: Updates visual soldier positions in formations

### 4. Pathfinding

- **Pathfinder.ts**: A* implementation
- **Obstacles**: Trees, buildings
- **Dynamic Paths**: Units recalculate paths if blocked

---

## Build & Development

### NPM Scripts

```bash
npm run dev        # Start Vite dev server
npm run build      # Build for production
npm run lint       # Run ESLint
npm run lint:fix   # Auto-fix ESLint errors
```

**Important**: The user has requested **NOT** to run `npm run build` or `npm run dev` automatically unless explicitly asked.

### Key Files for Configuration

- **tsconfig.json**: TypeScript compiler options (strict mode enabled)
- **eslint.config.js**: ESLint rules (`@typescript-eslint/no-explicit-any` enforced)
- **vite.config.ts**: Vite bundler configuration
- **package.json**: Dependencies, scripts, Husky pre-commit hooks

---

## Common Tasks for LLMs

### Adding a New Building Type

1. Add enum to `BuildingType` in `types.ts`
2. Add definition to `BUILDINGS` in `constants.ts`
3. Add UI button in `GameUI.tsx` (use `getBuildingsByCategory()`)
4. Handle special logic in `BuildingManager.ts` if needed

### Adding a New Unit Type

1. Add enum to `UnitType` in `types.ts`
2. Add stats to `UNIT_STATS` and `UNIT_VISION` in `constants.ts`
3. Update `EntityFactory.spawnUnit()` to handle spawning
4. Add training UI in `GameUI.tsx` (barracks section)
5. Handle unit-specific logic in `UnitSystem.ts`

### Modifying Unit Behavior

- **Movement**: `UnitSystem.commandMove()`, `UnitSystem.updateUnitLogic()`
- **Combat**: `UnitSystem.commandAttack()`, `UnitSystem.performAttack()`
- **AI**: `UnitSystem.scanForTargets()`, `UnitSystem.handleCombatState()`

### Adding New Events

1. Add event name to `EVENTS` in `constants.ts`
2. Emit event: `scene.events.emit(EVENTS.YOUR_EVENT, data)`
3. Listen in relevant system/component: `scene.events.on(EVENTS.YOUR_EVENT, handler)`

### Fixing Lint Errors

- **No Explicit Any**: Replace `any` with proper types (use `GameUnit`, `BuildingDef`, etc.)
- **Unused Variables**: Remove or prefix with `_` (e.g., `_delta`)
- **Type Assertions**: Use `as Type` sparingly, prefer type guards

---

## Performance Considerations

1. **CullingSystem**: Disables off-screen entities to save CPU
2. **SpatialHash**: Spatial partitioning for fast collision queries
3. **Squad Visuals**: Soldiers are lightweight sprites, not full units
4. **Pathfinding**: Cached, time-limited (paths expire after 5s)
5. **Fog of War**: Rendered to RenderTexture for efficiency

---

## Debugging Tips

- **Enable Debug Visuals**: 
  - `UnitSystem.drawUnitPaths()`: Shows unit paths
  - `BuildingManager.updateHighlights()`: Shows building placement validity
- **Console Logs**: Most systems have commented `console.log()` for debugging
- **Phaser Inspector**: Use browser devtools + Phaser debug draw

---

## Known Quirks & Gotchas

1. **Isometric Rendering**: Always convert world → iso coords before rendering
2. **Unit Selection**: Combat units use `setData('selected', true)` for selection state
3. **Squad HP**: HP is stored on main unit object, not individual soldiers
4. **Barracks Waypoints**: Each barracks has its own waypoint (stored in `customWaypoint` data)
5. **Static Resources**: Villagers and Animals are lightweight static resources (not physics objects, non-selectable, non-targetable)
6. **Villager Management**: Villagers are managed by `VillagerSystem`, not `UnitSystem`
7. **Formation Bonuses**: Applied in `UnitSystem.performAttack()` calculations for combat units only

---

## Future Considerations

- **Technologies**: Currently uses Phaser 3, React, TypeScript, Vite
- **Modularity**: Systems are loosely coupled via events
- **Extensibility**: Easy to add new unit types, buildings, formations
- **Testing**: Vitest 2.1.9 — 69 test files / 510 tests; `npm run coverage` uses v8 coverage with a ~39% lines floor on `game/**`

---

## Quick Reference: File Sizes

| Category | File Count | Notes |
|----------|-----------|-------|
| **Systems** | 17 | All in `game/systems/` (includes VillagerSystem) |
| **Utilities** | 3 | `iso.ts`, `Noise.ts`, `SpatialHash.ts` |
| **React Components** | 4 | `GameUI.tsx` is largest (~36KB) |
| **Total LoC** | ~3700+ | Excluding node_modules |

---

## Conclusion

This document provides a **high-level technical map** of the CivStrategy RTS codebase. When working on this project:

1. **Check `types.ts` and `constants.ts` first** for data structures and configuration
2. **Follow the event-driven architecture** for Phaser ↔ React communication
3. **Use the system-based design** to isolate changes to specific domains
4. **Respect the isometric coordinate system** for rendering
5. **Refer to existing systems** for patterns (e.g., `UnitSystem` for complex logic)

By following these guidelines, LLMs can efficiently navigate and modify the codebase without unnecessary token expenditure.
