
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

// Per-type damage model (0 A.D.-style Hack / Pierce / Crush)
export enum DamageType {
  HACK = 'Hack',     // Slashing melee (swords, axes, spears thrusting)
  PIERCE = 'Pierce', // Projectiles (arrows, javelins, sling bullets)
  CRUSH = 'Crush'    // Blunt / siege (clubs, stones, wheels, rams)
}

// How much damage of each type an attack deals
export type DamageProfile = Partial<Record<DamageType, number>>;

// How much armor an entity has against each damage type
export type ArmorProfile = Partial<Record<DamageType, number>>;

export enum Age {
  VILLAGE = 'Village',
  TOWN = 'Town',
  CITY_STATE = 'City-State'
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

export interface AgeConfig {
  name: string;
  cost: BuildingCost;
  requiredBuildings: { type: BuildingType; count: number }[];
  unlocksUnits: UnitType[];
  unlocksBuildings: BuildingType[];
  advancementTime: number; // ms of game time to research
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
  peacefulMode: boolean;
  treatyTimeRemaining: number; // (ms)
  bloomIntensity: number;
  currentFormation: FormationType;
  currentStance: UnitStance;
  currentAge: Age;
  ageProgress: number; // 0–1 during advancement research
  nextAge: Age | null; // target age if advancing, null otherwise
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
  ANIMAL = 'Animal',
  SLINGER = 'Slinger', // Cheap early ranged (Village Age)
  AXEMAN = 'Axeman', // Anti-building melee (Town Age)
  HOPLITE = 'Hoplite', // Elite shielded spearman (City-State Age)
  CHARIOT = 'Chariot' // Elite ranged cavalry (City-State Age)
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
  isSelected?: boolean;
  flowTarget?: { x: number; y: number };
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

export interface AnimalData {
  id: string;
  x: number;
  y: number;
  state: UnitState;
  visual?: Phaser.GameObjects.Container;
  wanderDest?: Phaser.Math.Vector2;
}

export interface TerrainModifiers {
  movementSpeed: number;  // 0.7 (uphill) to 1.3 (downhill)
  attackBonus: number;    // +10% on high ground
  defenseBonus: number;   // +5% on high ground
}

export interface SlopeInfo {
  slope: number;          // 0.0 (flat) to 1.0+ (steep)
  isBuildable: boolean;   // false if slope > MAX_BUILDABLE_SLOPE
}