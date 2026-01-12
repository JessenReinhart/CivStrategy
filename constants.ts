


import { BuildingDef, BuildingType, FactionType, UnitType, MapSize, UnitStats } from "./types";

export const TILE_SIZE = 32;
// Default Fallback
export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 2048;

export const CHUNK_SIZE = 512; // For infinite mode

export const MAP_SIZES: Record<MapSize, number> = {
  [MapSize.SMALL]: 1024,
  [MapSize.MEDIUM]: 2048,
  [MapSize.LARGE]: 4096
};

export const FACTION_COLORS = {
  [FactionType.ROMANS]: 0x3b82f6,
  [FactionType.GAULS]: 0x22c55e,
  [FactionType.CARTHAGE]: 0xef4444
};

// Vision range for units used by the Fog of War system
export const UNIT_VISION = {
  [UnitType.VILLAGER]: 150,
  [UnitType.PIKESMAN]: 250,
  [UnitType.ARCHER]: 300,
  [UnitType.CAVALRY]: 350,
  [UnitType.LEGION]: 300,
  [UnitType.ANIMAL]: 50
};

// Centralized Unit Stats
export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.VILLAGER]: {
    maxHp: 50, attack: 3, range: 30, attackSpeed: 1000, speed: 80,
    squadSize: 1, squadSpacing: 0, squadColor: 0xcccccc
  },
  [UnitType.PIKESMAN]: {
    maxHp: 200, attack: 15, range: 40, attackSpeed: 1200, speed: 100,
    squadSize: 16, squadSpacing: 8, squadColor: 0xef4444
  },
  [UnitType.CAVALRY]: {
    maxHp: 400, attack: 20, range: 40, attackSpeed: 1000, speed: 160,
    squadSize: 6, squadSpacing: 12, squadColor: 0x8D6E63
  },
  [UnitType.LEGION]: {
    maxHp: 2000, attack: 10, range: 40, attackSpeed: 1500, speed: 70,
    squadSize: 100, squadSpacing: 4, squadColor: 0x3b82f6 // 100 soldiers for massive feel
  },
  [UnitType.ARCHER]: {
    maxHp: 150, attack: 12, range: 200, attackSpeed: 1000, speed: 90,
    squadSize: 10, squadSpacing: 10, squadColor: 0x10b981
  },
  [UnitType.ANIMAL]: {
    maxHp: 30, attack: 0, range: 0, attackSpeed: 1000, speed: 40,
    squadSize: 1, squadSpacing: 0, squadColor: 0x795548
  }
};

export const UNIT_SPEED = {
  [UnitType.VILLAGER]: UNIT_STATS[UnitType.VILLAGER].speed,
  [UnitType.PIKESMAN]: UNIT_STATS[UnitType.PIKESMAN].speed,
  [UnitType.ARCHER]: UNIT_STATS[UnitType.ARCHER].speed,
  [UnitType.CAVALRY]: UNIT_STATS[UnitType.CAVALRY].speed,
  [UnitType.LEGION]: UNIT_STATS[UnitType.LEGION].speed,
  [UnitType.ANIMAL]: UNIT_STATS[UnitType.ANIMAL].speed
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  [BuildingType.TOWN_CENTER]: {
    type: BuildingType.TOWN_CENTER,
    name: 'Town Center',
    cost: { wood: 300, food: 0, gold: 100 },
    width: 80,
    height: 80,
    color: 0x2563eb,
    description: 'Main hub. Large territory range.',
    maxHp: 2000,
    territoryRadius: 600,
    populationBonus: 5
  },
  [BuildingType.BONFIRE]: {
    type: BuildingType.BONFIRE,
    name: 'Village Fire',
    cost: { wood: 10, food: 0, gold: 0 },
    width: 32,
    height: 32,
    color: 0xea580c,
    description: 'Gathering point. Provides light.',
    maxHp: 100,
    territoryRadius: 200,
    happinessBonus: 2
  },
  [BuildingType.HOUSE]: {
    type: BuildingType.HOUSE,
    name: 'House',
    cost: { wood: 50, food: 0, gold: 0 },
    width: 48,
    height: 48,
    color: 0x92400e,
    description: 'Increases max population.',
    maxHp: 300,
    populationBonus: 8
  },
  [BuildingType.FARM]: {
    type: BuildingType.FARM,
    name: 'Farm',
    cost: { wood: 50, food: 0, gold: 0 },
    width: 48,
    height: 48,
    color: 0xfacc15,
    description: 'Requires a peasant to generate food.',
    maxHp: 200,
    workerNeeds: 1
  },
  [BuildingType.LUMBER_CAMP]: {
    type: BuildingType.LUMBER_CAMP,
    name: 'Lumber Camp',
    cost: { wood: 100, food: 0, gold: 0 },
    width: 48,
    height: 48,
    color: 0x166534,
    description: 'Requires a peasant to generate wood.',
    maxHp: 250,
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
    maxHp: 150,
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
    maxHp: 50,
    happinessBonus: 5
  },
  [BuildingType.BARRACKS]: {
    type: BuildingType.BARRACKS,
    name: 'Barracks',
    cost: { wood: 150, food: 0, gold: 50 },
    width: 72,
    height: 72,
    color: 0xb91c1c,
    description: 'Allows training of pikesmen, archers and cavalry.',
    maxHp: 800,
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
  CENTER_CAMERA: 'center-camera',
  SET_GAME_SPEED: 'set-game-speed',
  MINIMAP_CLICK: 'minimap-click',
  DEMOLISH_SELECTED: 'demolish-selected'
};