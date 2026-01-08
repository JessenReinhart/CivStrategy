

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
    description: 'Main hub. Expands territory.',
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
    description: 'Gathering point for idle peasants.',
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
    description: 'Increases max population. Spawns a peasant.',
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
    description: 'Cheap, fast food. Depletes local animals.',
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
  REGROW_FOREST: 'regrow-forest'
};
