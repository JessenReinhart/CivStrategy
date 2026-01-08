
import { BuildingDef, BuildingType, FactionType, UnitType } from "./types";

export const TILE_SIZE = 32;
export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 2048;
export const CHUNK_SIZE = 512; // For infinite mode

export const FACTION_COLORS = {
  [FactionType.ROMANS]: 0x3b82f6,
  [FactionType.GAULS]: 0x22c55e,
  [FactionType.CARTHAGE]: 0xef4444
};

// Vision range for units used by the Fog of War system
export const UNIT_VISION = {
  [UnitType.VILLAGER]: 150,
  [UnitType.SOLDIER]: 250,
  [UnitType.ANIMAL]: 50
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  [BuildingType.TOWN_CENTER]: {
    type: BuildingType.TOWN_CENTER,
    name: 'Town Center',
    cost: { wood: 300, food: 0, gold: 100 },
    width: 96,
    height: 96,
    color: 0x2563eb,
    description: 'Main hub. Large territory range.',
    territoryRadius: 600, 
    populationBonus: 5
  },
  [BuildingType.BONFIRE]: {
    type: BuildingType.BONFIRE,
    name: 'Village Fire',
    cost: { wood: 10, food: 0, gold: 0 },
    width: 64,
    height: 64,
    color: 0xea580c,
    description: 'Gathering point. Provides light.',
    territoryRadius: 200,
    happinessBonus: 2
  },
  [BuildingType.HOUSE]: {
    type: BuildingType.HOUSE,
    name: 'House',
    cost: { wood: 50, food: 0, gold: 0 },
    width: 64,
    height: 64,
    color: 0x92400e,
    description: 'Increases max population.',
    populationBonus: 8
  },
  [BuildingType.FARM]: {
    type: BuildingType.FARM,
    name: 'Farm',
    cost: { wood: 50, food: 0, gold: 0 },
    width: 64,
    height: 64,
    color: 0xfacc15,
    description: 'Requires a peasant to generate food.',
    workerNeeds: 1
  },
  [BuildingType.LUMBER_CAMP]: {
    type: BuildingType.LUMBER_CAMP,
    name: 'Lumber Camp',
    cost: { wood: 100, food: 0, gold: 0 },
    width: 64,
    height: 64,
    color: 0x166534,
    description: 'Requires a peasant to generate wood.',
    effectRadius: 200,
    workerNeeds: 1
  },
  [BuildingType.HUNTERS_LODGE]: {
    type: BuildingType.HUNTERS_LODGE,
    name: 'Hunter\'s Lodge',
    cost: { wood: 25, food: 0, gold: 0 },
    width: 32,
    height: 32,
    color: 0x8b4513,
    description: 'Cheap food source.',
    effectRadius: 300,
    workerNeeds: 1
  },
  [BuildingType.SMALL_PARK]: {
    type: BuildingType.SMALL_PARK,
    name: 'Small Park',
    cost: { wood: 25, food: 0, gold: 10 },
    width: 32,
    height: 32,
    color: 0x4ade80,
    description: 'Increases global happiness.',
    happinessBonus: 5
  },
  [BuildingType.BARRACKS]: {
    type: BuildingType.BARRACKS,
    name: 'Barracks',
    cost: { wood: 150, food: 0, gold: 50 },
    width: 96,
    height: 96,
    color: 0xb91c1c,
    description: 'Allows training of soldiers.',
    happinessBonus: -2
  }
};

export const INITIAL_RESOURCES = {
  wood: 200,
  food: 200,
  gold: 100
};

export const EVENTS = {
  UPDATE_STATS: 'update-stats',
  SELECTION_CHANGED: 'selection-changed',
  BUILDING_SELECTED: 'building-selected',
  BUILD_MODE_TOGGLED: 'build-mode-toggled',
  TOGGLE_DEMOLISH: 'toggle-demolish',
  SET_TAX_RATE: 'set-tax-rate',
  REGROW_FOREST: 'regrow-forest',
  CENTER_CAMERA: 'center-camera'
};
