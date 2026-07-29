
import { BuildingDef, BuildingType, FactionType, UnitType, MapSize, UnitStats, FormationType, Age, AgeConfig, DamageType, DamageProfile, ArmorProfile } from "./types";

export const TILE_SIZE = 32;
// Default Fallback
export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 2048;

export const STANCE_TETHER_RADIUS = 300; // Max distance to chase from anchor in Defensive stance

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
export const UNIT_VISION: Record<UnitType, number> = {
  [UnitType.VILLAGER]: 150,
  [UnitType.PIKESMAN]: 250,
  [UnitType.ARCHER]: 300,
  [UnitType.CAVALRY]: 350,
  [UnitType.LEGION]: 300,
  [UnitType.ANIMAL]: 50,
  [UnitType.SLINGER]: 280,
  [UnitType.AXEMAN]: 220,
  [UnitType.HOPLITE]: 280,
  [UnitType.CHARIOT]: 380
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
  },
  [UnitType.SLINGER]: {
    maxHp: 80, attack: 8, range: 180, attackSpeed: 1100, speed: 100,
    squadSize: 8, squadSpacing: 9, squadColor: 0xa89984
  },
  [UnitType.AXEMAN]: {
    maxHp: 250, attack: 25, range: 40, attackSpeed: 1400, speed: 85,
    squadSize: 10, squadSpacing: 8, squadColor: 0xd4a373
  },
  [UnitType.HOPLITE]: {
    maxHp: 600, attack: 22, range: 40, attackSpeed: 1100, speed: 80,
    squadSize: 20, squadSpacing: 6, squadColor: 0xb8860b
  },
  [UnitType.CHARIOT]: {
    maxHp: 500, attack: 22, range: 180, attackSpeed: 1200, speed: 180,
    squadSize: 4, squadSpacing: 14, squadColor: 0xd4af37
  }
};

// Auto-derived from UNIT_STATS for convenience
export const UNIT_SPEED: Record<UnitType, number> = {} as Record<UnitType, number>;
for (const type of Object.values(UnitType)) {
  const stats = UNIT_STATS[type as UnitType];
  if (stats) (UNIT_SPEED as Record<string, number>)[type] = stats.speed;
}

// ─── Damage Types & Armor (Hack / Pierce / Crush) ────────────────────────────
// Smooth per-type reduction, 0 A.D.-style:  reducedFraction = K / (armor + K)
//   armor 0  -> 0% reduction,   armor 10 -> 50%,   armor 30 -> 75%,   armor 50 -> 83%
export const ARMOR_REDUCTION_K = 10;

// Each unit's damage split by type. Values sum to the legacy flat `attack` so
// overall combat power is preserved, while enabling rock-paper-scissors counters.
export const UNIT_DAMAGE: Record<UnitType, DamageProfile> = {
  [UnitType.VILLAGER]:  { [DamageType.HACK]: 3 },
  [UnitType.PIKESMAN]:  { [DamageType.PIERCE]: 15 },
  [UnitType.CAVALRY]:   { [DamageType.HACK]: 20 },
  [UnitType.LEGION]:    { [DamageType.HACK]: 10 },
  [UnitType.ARCHER]:    { [DamageType.PIERCE]: 12 },
  [UnitType.SLINGER]:   { [DamageType.CRUSH]: 8 },
  [UnitType.AXEMAN]:    { [DamageType.HACK]: 25 },
  [UnitType.HOPLITE]:   { [DamageType.PIERCE]: 22 },
  [UnitType.CHARIOT]:   { [DamageType.PIERCE]: 22 },
  [UnitType.ANIMAL]:    {}
};

// Per-type armor. Infantry soak Hack (shields), archers are squishy, and
// BUILDINGS are deliberately weak to Crush so siege has a clear role.
export const UNIT_ARMOR: Record<UnitType, ArmorProfile> = {
  [UnitType.VILLAGER]:  { [DamageType.HACK]: 0, [DamageType.PIERCE]: 0, [DamageType.CRUSH]: 0 },
  [UnitType.PIKESMAN]:  { [DamageType.HACK]: 6, [DamageType.PIERCE]: 1, [DamageType.CRUSH]: 2 },
  [UnitType.CAVALRY]:   { [DamageType.HACK]: 3, [DamageType.PIERCE]: 3, [DamageType.CRUSH]: 1 },
  [UnitType.LEGION]:    { [DamageType.HACK]: 8, [DamageType.PIERCE]: 2, [DamageType.CRUSH]: 4 },
  [UnitType.ARCHER]:    { [DamageType.HACK]: 1, [DamageType.PIERCE]: 1, [DamageType.CRUSH]: 0 },
  [UnitType.SLINGER]:   { [DamageType.HACK]: 1, [DamageType.PIERCE]: 1, [DamageType.CRUSH]: 0 },
  [UnitType.AXEMAN]:    { [DamageType.HACK]: 4, [DamageType.PIERCE]: 2, [DamageType.CRUSH]: 2 },
  [UnitType.HOPLITE]:   { [DamageType.HACK]: 10, [DamageType.PIERCE]: 2, [DamageType.CRUSH]: 3 },
  [UnitType.CHARIOT]:   { [DamageType.HACK]: 2, [DamageType.PIERCE]: 4, [DamageType.CRUSH]: 1 },
  [UnitType.ANIMAL]:    { [DamageType.HACK]: 0, [DamageType.PIERCE]: 0, [DamageType.CRUSH]: 0 }
};

// Buildings resist Hack/Pierce (walls, stone) but are vulnerable to Crush (siege).
export const BUILDING_ARMOR: Record<BuildingType, ArmorProfile> = {
  [BuildingType.TOWN_CENTER]:  { [DamageType.HACK]: 12, [DamageType.PIERCE]: 12, [DamageType.CRUSH]: 2 },
  [BuildingType.BONFIRE]:      { [DamageType.HACK]: 2, [DamageType.PIERCE]: 2, [DamageType.CRUSH]: 1 },
  [BuildingType.HOUSE]:        { [DamageType.HACK]: 4, [DamageType.PIERCE]: 4, [DamageType.CRUSH]: 1 },
  [BuildingType.FARM]:         { [DamageType.HACK]: 3, [DamageType.PIERCE]: 3, [DamageType.CRUSH]: 1 },
  [BuildingType.LUMBER_CAMP]:  { [DamageType.HACK]: 4, [DamageType.PIERCE]: 4, [DamageType.CRUSH]: 1 },
  [BuildingType.HUNTERS_LODGE]:{ [DamageType.HACK]: 3, [DamageType.PIERCE]: 3, [DamageType.CRUSH]: 1 },
  [BuildingType.SMALL_PARK]:   { [DamageType.HACK]: 1, [DamageType.PIERCE]: 1, [DamageType.CRUSH]: 0 },
  [BuildingType.BARRACKS]:     { [DamageType.HACK]: 10, [DamageType.PIERCE]: 10, [DamageType.CRUSH]: 2 }
};

// Scale every component of a damage profile by `mult`.
export function scaleDamageProfile(profile: DamageProfile, mult: number): DamageProfile {
  const out: DamageProfile = {};
  for (const t of Object.values(DamageType)) {
    const v = profile[t];
    if (v && v > 0) out[t] = v * mult;
  }
  return out;
}

// Apply the smooth per-type armor reduction and return the final flat damage.
export function computeDamage(damage: DamageProfile, armor: ArmorProfile): number {
  let total = 0;
  for (const t of Object.values(DamageType)) {
    const d = damage[t] ?? 0;
    if (d <= 0) continue;
    const a = armor[t] ?? 0;
    total += d * (ARMOR_REDUCTION_K / (a + ARMOR_REDUCTION_K));
  }
  return total;
}

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
    description: 'Trains military units. Unlocks more units as you advance ages.',
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
  DEMOLISH_SELECTED: 'demolish-selected',
  SET_BLOOM_INTENSITY: 'set-bloom-intensity',
  ADVANCE_AGE: 'advance-age',
  AGE_ADVANCED: 'age-advanced',
  TOGGLE_SOUND: 'toggle-sound',
  SET_SOUND_VOLUME: 'set-sound-volume',
  CLASH_START: 'clash-start',
};

// ─── Age Configuration ─────────────────────────────────────────────────────
export const AGE_CONFIGS: Record<Age, AgeConfig> = {
  [Age.VILLAGE]: {
    name: 'Village Age',
    cost: { wood: 0, food: 0, gold: 0 },
    requiredBuildings: [],
    unlocksUnits: [UnitType.VILLAGER, UnitType.SLINGER, UnitType.PIKESMAN],
    unlocksBuildings: [],
    advancementTime: 0
  },
  [Age.TOWN]: {
    name: 'Town Age',
    cost: { wood: 0, food: 600, gold: 400 },
    requiredBuildings: [{ type: BuildingType.BARRACKS, count: 1 }, { type: BuildingType.HOUSE, count: 1 }],
    unlocksUnits: [UnitType.ARCHER, UnitType.CAVALRY, UnitType.AXEMAN],
    unlocksBuildings: [BuildingType.SMALL_PARK],
    advancementTime: 60000 // 60s of game time
  },
  [Age.CITY_STATE]: {
    name: 'City-State Age',
    cost: { wood: 0, food: 1200, gold: 800 },
    requiredBuildings: [{ type: BuildingType.BARRACKS, count: 2 }, { type: BuildingType.HOUSE, count: 3 }],
    unlocksUnits: [UnitType.LEGION, UnitType.HOPLITE, UnitType.CHARIOT],
    unlocksBuildings: [],
    advancementTime: 90000 // 90s of game time
  }
};

// Helper: get the next age in the progression
export function getNextAge(current: Age): Age | null {
  const progression: Age[] = [Age.VILLAGE, Age.TOWN, Age.CITY_STATE];
  const idx = progression.indexOf(current);
  if (idx < 0 || idx >= progression.length - 1) return null;
  return progression[idx + 1];
}

// Helper: check if a unit type is unlocked at a given age
export function isUnitUnlocked(unitType: UnitType, age: Age): boolean {
  const config = AGE_CONFIGS[age];
  if (!config) return false;
  return config.unlocksUnits.includes(unitType);
}

export const FORMATION_BONUSES: Record<FormationType, { attack: number; defense: number; speed: number }> = {
  [FormationType.BOX]: { attack: 1.0, defense: 0.0, speed: 1.0 },
  [FormationType.LINE]: { attack: 1.2, defense: 0.0, speed: 0.8 },      // +20% Dmg, -20% Speed
  [FormationType.CIRCLE]: { attack: 1.0, defense: 0.25, speed: 0.7 },   // +25% Def, -30% Speed
  [FormationType.SKIRMISH]: { attack: 1.0, defense: 0.15, speed: 1.1 }, // +15% Def (Dodge), +10% Speed
  [FormationType.WEDGE]: { attack: 1.1, defense: 0.0, speed: 1.2 }      // +10% Dmg, +20% Speed
};

// Terrain System Configuration
export const TERRAIN_CONFIG = {
  CELL_SIZE: 16,
  MIN_HEIGHT: 0.0,
  MAX_HEIGHT: 1.0,
  MAX_BUILDABLE_SLOPE: 0.15,  // Buildings can't be placed on slopes > 15%
  
  // Movement modifiers
  DOWNHILL_SPEED_BONUS: 1.3,   // 30% faster downhill
  UPHILL_SPEED_PENALTY: 0.7,   // 30% slower uphill
  SLOPE_THRESHOLD: 0.05,       // Minimum slope to trigger modifier
  
  // Combat modifiers
  HIGH_GROUND_ATTACK_BONUS: 0.10,   // +10% attack from high ground
  HIGH_GROUND_DEFENSE_BONUS: 0.05,  // +5% defense on high ground
  // Visual — biome-based terrain tiles
  // Each biome: { color, minHeight, label }
  BIOMES: [
    { color: { r: 60, g: 60, b: 50 }, minHeight: -Infinity, label: 'deep' },       // below water, unused
    { color: { r: 194, g: 178, b: 128 }, minHeight: 0.38, label: 'sand' },          // shore
    { color: { r: 62, g: 148, b: 58 }, minHeight: 0.44, label: 'grass' },           // lowland
    { color: { r: 45, g: 122, b: 42 }, minHeight: 0.58, label: 'forest' },          // mid
    { color: { r: 107, g: 95, b: 67 }, minHeight: 0.72, label: 'scrub' },           // highland
    { color: { r: 130, g: 124, b: 115 }, minHeight: 0.86, label: 'stone' },         // peak
  ],
  // Directional slope lighting (N·L). Baked as multiply — overlay alpha was invisible on photo textures.
  // Light from NW/high — typical iso sun; normalized in bake.
  LIGHT_DIR_X: -0.65,
  LIGHT_DIR_Y: -0.4,
  LIGHT_DIR_Z: 0.65,
  LIGHT_AMBIENT: 0.35,
  LIGHT_DIFFUSE: 0.75,
  NORMAL_STRENGTH: 48,
  // Extra darken/lighten from absolute height (valleys vs peaks) even on flat plateaus.
  HEIGHT_SHADE: 0.28,
  // Pixels of screen-Y lift per unit height above sea level. Reads as elevation.
  // With HEIGHT_EXPONENT 0.5: mid grass (0.50) → 0.70 scrub gives ~64px lift,
  // peaks (0.95) give ~114px. Bump to 200 for dramatic visual cliffs.
  HEIGHT_LIFT: 200,
  // Legacy ridge multiplier (unused; kept for any external refs)
  SLOPE_TINT: 0.7,
  // Steep hillsides turn rocky. Slope = sqrt(dx²+dy²) of height/cell (see getSlopeAt).
  // Soft rock starts past gentle hills; full stone only on sheer faces.
  CLIFF_SLOPE_START: 0.18,
  CLIFF_SLOPE_FULL: 0.38,
  // Min neighbor drop before rock cliff face. Low values paint dark cracks on every slope.
  CLIFF_FACE_MIN_DROP: 0.10,

  // Pattern tile size in world px. Larger = continuous tile across many cells (less Minecraft).
  // 16 = 1 cell = 1 tile (blocky). 128 tiles smoothly over ~8 cells.
  TEX_PERIOD: 128,

  BIOME_VARIANCE: 12,         // per-cell random color variance (±)
  // Soft-blend half-width around biome thresholds (smoothstep). Wider = less Minecraft.
  BIOME_DITHER: 0.12,

  // Water layer: cells with height < WATER_LEVEL get animated water surface.
   // Shoreline follows the heightmap via marching squares, not flat rects.
   // Raised from 0.30 to 0.38 + macro octave added to TerrainSystem so water
   // forms connected bodies (lakes, ponds, rivers, coastal sea) instead of
   // isolated puddles.
   WATER_LEVEL: 0.38,

  // Generation — multi-octave noise (world coords; lower scale = larger features)
  // Feature wavelength ≈ 2π / scale. Medium map 2048: base ~ half-map ridges, macro ~ full map sea.
  BASE_SCALE: 0.0018,        // was 0.004 — wider valleys / mountain ranges
  DETAIL_SCALE: 0.012,       // was 0.03 — coarser roughness, less freckle
  BASE_AMPLITUDE: 1.0,
  DETAIL_AMPLITUDE: 0.18,    // was 0.3 — less high-freq chop so macro/base dominate
  // Macro continental basin — ~1–1.5 cycles across 2048 map → big sea + highlands
  MACRO_SCALE: 0.0007,       // was 0.0015
  MACRO_AMPLITUDE: 0.38,      // was 0.25 — stronger sea / continent contrast

  // Post-process power stretch: remap above-water heights so mid-range values
  // push up toward peaks, giving mountains and visible elevation variety
  // instead of everything clustering in the 0.4-0.6 band.
  // Typical values: 0.5 (aggressive) - 0.7 (moderate) - 1.0 (no stretch)
  // With 0.5: height 0.50 (grass) → 0.70 (scrub),    0.60 (forest) → 0.80 (stone approach)
  HEIGHT_EXPONENT: 0.5,       // valleys stay low, mid values push to scrub/stone
 };
