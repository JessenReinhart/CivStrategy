
import Phaser from 'phaser';

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

export enum FormationType {
  BOX = 'Box',
  LINE = 'Line',
  CIRCLE = 'Circle',
  SKIRMISH = 'Skirmish',
  WEDGE = 'Wedge'
}

export enum UnitStance {
  AGGRESSIVE = 'Aggressive', // Chase indefinitely
  DEFENSIVE = 'Defensive',   // Chase briefly, return to anchor
  HOLD = 'Hold'              // Stand ground, attack in range only
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
  bloomIntensity: number; // Intensity of sunlit bloom effect
  currentFormation: FormationType; // NEW
  currentStance: UnitStance; // NEW - Global default for new orders/units
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
  PIKESMAN = 'Pikesman', // Standard Infantry (Medium Squad)
  CAVALRY = 'Cavalry', // Fast, Heavy (Small Squad)
  LEGION = 'Legion', // Massive Infantry (Large Squad)
  ARCHER = 'Archer', // Ranged Unit
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

export interface UnitStats {
  maxHp: number;
  attack: number;
  range: number;
  attackSpeed: number; // ms
  speed: number;
  // Squad System
  squadSize: number; // Max visual soldiers
  squadSpacing: number; // Distance between soldiers
  squadColor: number;
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

export interface GameUnit extends Phaser.GameObjects.Image {
  unitType: UnitType;
  state: UnitState;
  target: Phaser.GameObjects.GameObject | null;
  path: Phaser.Math.Vector2[] | null;
  pathStep: number;
  pathCreatedAt: number;
  visual?: Phaser.GameObjects.Container;
  lastAttackTime?: number;
  takeDamage?: (amount: number) => void;
  // Custom data properties that might be accessed via direct property or getData
  // But we extend Image so standard props are there.
  // We'll trust the specific props we need.
}

export interface VillagerData {
  id: string;
  x: number;
  y: number;
  owner: number;
  state: UnitState;
  jobBuilding?: Phaser.GameObjects.GameObject;
  path?: Phaser.Math.Vector2[];
  pathStep?: number;
  visual?: Phaser.GameObjects.Container;
}