export enum FactionType {
  ROMANS = 'Romans',
  GAULS = 'Gauls',
  CARTHAGE = 'Carthage'
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

export interface GameStats {
  population: number;
  maxPopulation: number;
  happiness: number;
  resources: Resources;
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
  LUMBER_CAMP = 'Lumber Camp'
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  cost: BuildingCost;
  width: number;
  height: number;
  color: number;
  description: string;
  territoryRadius?: number; // If it expands territory
  effectRadius?: number; // Range of effect (e.g. gathering range)
  populationBonus?: number;
  happinessBonus?: number;
  workerNeeds?: number; // Number of population required to operate
}

export enum UnitType {
  VILLAGER = 'Villager',
  SOLDIER = 'Soldier'
}

export enum UnitState {
  IDLE = 'idle',
  MOVING_TO_WORK = 'moving_to_work',
  WORKING = 'working',
  MOVING_TO_RALLY = 'moving_to_rally'
}

export interface EntityData {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  owner: number; // 0 = Player, 1 = AI/Neutral
  type: string;
  selected?: boolean;
}