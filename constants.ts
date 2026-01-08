import { BuildingDef, BuildingType, FactionType } from "./types";

export const TILE_SIZE = 32;
export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 2000;

export const FACTION_COLORS = {
  [FactionType.ROMANS]: 0x3b82f6, // Blue
  [FactionType.GAULS]: 0x22c55e, // Green
  [FactionType.CARTHAGE]: 0xef4444 // Red
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  [BuildingType.TOWN_CENTER]: {
    type: BuildingType.TOWN_CENTER,
    name: 'Town Center',
    cost: { wood: 300, food: 0, gold: 100 },
    width: 96,
    height: 96,
    color: 0x2563eb,
    description: 'Main hub. Expands territory. Peasants gather here.',
    territoryRadius: 600, // Increased from 300
    populationBonus: 5
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
    width: 64,
    height: 64,
    color: 0x8b4513,
    description: 'Cheap, fast food. Depletes local animals.',
    effectRadius: 300,
    workerNeeds: 1
  },
  [BuildingType.BARRACKS]: {
    type: BuildingType.BARRACKS,
    name: 'Barracks',
    cost: { wood: 150, food: 0, gold: 50 },
    width: 96,
    height: 96,
    color: 0xb91c1c,
    description: 'Allows training of soldiers.',
    happinessBonus: -5
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
  BUILD_MODE_TOGGLED: 'build-mode-toggled',
  TOGGLE_DEMOLISH: 'toggle-demolish'
};