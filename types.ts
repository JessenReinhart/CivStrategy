
export enum FactionType {
  ROMANS = 'Romans',
  GAULS = 'Gauls',
  CARTHAGE = 'Carthage'
}

export enum MapMode {
  FIXED = 'Fixed Map',
  INFINITE = 'Infinite Realm'
}

export enum MapSize {
  SMALL = 'Small',
  MEDIUM = 'Medium',
  LARGE = 'Large'
}

export enum ResourceType {
  WOOD = 'Wood',
  FOOD = 'Food',
  GOLD = 'Gold'
}

export interface Resources {
  wood: number;
  food: number;
  gold: number;
}

export interface ResourceRates {
  wood: number;
  food: number;
  gold: number;
  foodConsumption: number;
}

export interface GameStats {
  population: number;
  maxPopulation: number;
  happiness: number;
  happinessChange: number;
  resources: Resources;
  rates: ResourceRates;
  taxRate: number;
  mapMode: MapMode;
  peacefulMode: boolean; // NEW
  treatyTimeRemaining: number; // NEW (ms)
}

export interface BuildingCost {
  wood: number;
  food: number;
  gold: number;
}

export enum BuildingType {
  TOWN_CENTER = 'Town Center',
  HOUSE = 'House',
  BARRACKS = 'Barracks',
  FARM = 'Farm',
  LUMBER_CAMP = 'Lumber Camp',
  HUNTERS_LODGE = 'Hunter\'s Lodge',
  BONFIRE = 'Bonfire',
  SMALL_PARK = 'Small Park'
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  cost: BuildingCost;
  width: number;
  height: number;
  color: number;
  description: string;
  maxHp: number; // NEW
  territoryRadius?: number;
  effectRadius?: number;
  populationBonus?: number;
  happinessBonus?: number;
  workerNeeds?: number;
}

export enum UnitType {
  VILLAGER = 'Villager',
  SOLDIER = 'Soldier',
  CAVALRY = 'Cavalry',
  ANIMAL = 'Animal'
}

export enum UnitState {
  IDLE = 'idle',
  MOVING_TO_WORK = 'moving_to_work',
  WORKING = 'working',
  MOVING_TO_RALLY = 'moving_to_rally',
  WANDERING = 'wandering',
  CHASING = 'chasing', // NEW
  ATTACKING = 'attacking' // NEW
}

export interface UnitStats { // NEW
    maxHp: number;
    attack: number;
    range: number;
    attackSpeed: number; // ms
    speed: number;
}

export interface EntityData {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  owner: number;
  type: string;
  selected?: boolean;
}