
import Phaser from 'phaser';

export enum FactionType {
  ROMANS = 'Romans',
  GAULS = 'Gauls',
  CARTHAGE = 'Carthage'
}

export interface FactionBonus {
  buildingHpMult?: number;    // Building HP multiplier
  wallHpMult?: number;        // Wall HP multiplier
  meleeAttackMult?: number;   // Melee attack multiplier
  rangedArmorMult?: number;   // Ranged armor multiplier (0.9 = -10%)
  goldPerTick?: number;       // Passive gold income bonus
  gatherRateMult?: number;    // Gather rate multiplier
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

export enum MapPreset {
  STANDARD = 'standard',      // Current balanced terrain
  ISLAND = 'island',          // Water-heavy, naval focus
  RIVER_VALLEY = 'river_valley', // Rivers create chokepoints
  DESERT = 'desert',          // Sand-heavy, scarce resources
  HIGHLANDS = 'highlands',    // Mountain-heavy, stone abundance
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

export enum GameResult {
  PLAYING = 'playing',
  WON = 'won',
  LOST = 'lost'
}

export enum VictoryType {
  CONQUEST = 'conquest',
  DOMINANCE = 'dominance',
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
  currentSeason: Season;
  notifications: readonly { id: number; text: string; severity: 'info' | 'warning' | 'danger' | 'success'; timestamp: number; duration: number; personality?: string; senderName?: string }[];
  activeResearch: { techId: TechId; progress: number; duration: number } | null;
  completedTechs: TechId[];
  selectedBuildingInfo?: { type: BuildingType; hasWorker: boolean; nearbyResources: number; resourceLabel: string; garrisonCount?: number } | null;
  gameResult?: GameResult;
  victoryType?: VictoryType;
  dominanceProgress?: number;
  playerTerritoryPercent?: number;
  aiTaunt?: { senderName: string; message: string; personality: string } | null;
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
  SMALL_PARK = 'Small Park',
  MARKET = 'Market',
  WALL = 'Wall',
  CATHEDRAL = 'Cathedral',
  CASTLE = 'Castle'
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
  CHARIOT = 'Chariot', // Elite ranged cavalry (City-State Age)
  RAM = 'Battering Ram' // Siege unit: high CRUSH vs buildings, slow and fragile
}

export enum UnitState {
  IDLE = 'idle',
  MOVING_TO_WORK = 'moving_to_work',
  WORKING = 'working',
  GATHERING = 'gathering',
  CARRYING = 'carrying',
  MOVING_TO_RALLY = 'moving_to_rally',
  WANDERING = 'wandering',
  CHASING = 'chasing',
  ATTACKING = 'attacking'
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
  // Spatial economy carry state
  carryAmount: number;
  carryType: 'wood' | 'food' | 'gold' | null;
  gatherTimer: number;
  targetResource?: Phaser.GameObjects.GameObject;
}

export enum AnimalSpecies {
  DEER = 'deer',
  WOLF = 'wolf',
  BOAR = 'boar',
  RABBIT = 'rabbit',
}

export enum Season {
  SPRING = 'spring',
  SUMMER = 'summer',
  AUTUMN = 'autumn',
  WINTER = 'winter',
}

export interface AnimalData {
  id: string;
  x: number;
  y: number;
  state: UnitState;
  species: AnimalSpecies;
  hp: number;
  maxHp: number;
  speed: number;
  owner: number;        // -1 neutral
  fearRange: number;    // flee distance
  attackRange: number;  // attack distance (0 = passive)
  attackDamage: number; // damage per hit (0 = passive)
  foodValue: number;    // food dropped on death
  herdId: number;       // group id for herding (-1 = no herd)
  breedCooldown: number; // ms remaining until can breed
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

// ─── Unit Abilities ──────────────────────────────────────────────────────
export enum UnitAbility {
  SHIELD_WALL = 'shield_wall',      // Pikeman: +50% armor for 5s, can't move
  RAIN_FIRE = 'rain_fire',           // Archer: volley attack hitting area
  CHARGE = 'charge',                 // Cavalry: 2x damage on first hit after sprinting
}

// ─── Research System ─────────────────────────────────────────────────────
export enum TechId {
  WOODCUTTING_I = 'woodcutting_i',
  FORAGING_I = 'foraging_i',
  IRON_WORKING = 'iron_working',
  CARRIAGE = 'carriage',
  FORTIFICATION = 'fortification',
  LOGISTICS = 'logistics',
  SIEGE_ENGINEERING = 'siege_engineering',
  CIVIL_SERVICE = 'civil_service',
}

export interface TechDef {
  id: TechId;
  name: string;
  description: string;
  requiredAge: Age;
  hostBuildingTypes: BuildingType[];
  prereqs: TechId[];
  cost: BuildingCost;
  researchTimeMs: number;
  modifications: { path: string; multiply?: number; add?: number }[];
}

export interface ActiveResearch {
  techId: TechId;
  remainingMs: number;
  totalMs: number;
  hostBuildingKey: string | null;
  escrow: BuildingCost;
}

export interface PlayerTechSnapshot {
  completed: Set<TechId>;
  active: ActiveResearch | null;
  gatherMult: { wood: number; food: number; gold: number };
  damageMult: number;
  armorAdd: number;
  movementSpeedMult: number;
  buildingHpMult: number;
  siegeBuildingDmgMult?: number;   // multiplier vs buildings (siege engineering)
  popGrowthMult?: number;           // population growth rate multiplier (civil service)
  happinessDecayMult?: number;     // happiness decay multiplier (0.7 = 30% less)
}

// ─── Save/Load System ──────────────────────────────────────────────────
export interface SaveGame {
  version: number;
  timestamp: number;
  // Scene init params (needed to restart with same map)
  faction: FactionType;
  enemyFaction: FactionType;
  mapMode: MapMode;
  mapSize: MapSize;
  fowEnabled: boolean;
  peacefulMode: boolean;
  treatyLength: number; // minutes
  aiDisabled: boolean;
  mapSeed: number;
  mapPreset: MapPreset;
  // Runtime game state
  gameTime: number;
  currentAge: Age;
  ageProgress: number;
  isAdvancing: boolean;
  nextAge: Age | null;
  currentSeason: Season;
  seasonTimer: number;
  resources: Resources;
  population: number;
  happiness: number;
  gameSpeed: number;
  // Entities
  units: SerializedUnit[];
  buildings: SerializedBuilding[];
  // Research
  research: {
    completedPlayer: TechId[];
    activePlayer: { techId: TechId; remainingMs: number } | null;
    completedAI: TechId[];
  };
  // AI
  aiState: SerializedAIState;
  // Victory
  dominanceProgress: number;
  playerTerritoryPercent: number;
  gameResult: GameResult;
  victoryType: VictoryType;
}

export interface SerializedUnit {
  type: UnitType;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: UnitState;
  stance: UnitStance;
}

export interface SerializedBuilding {
  type: BuildingType;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  workers: number;
  garrison?: Record<string, number>;
}

export interface SerializedAIState {
  personality: string;
  currentAge: Age;
  ageProgress: number;
  resources: Resources;
  baseX: number;
  baseY: number;
  buildIndex: number;
}