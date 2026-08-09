
import { AnimalSpecies, Season } from "./types";

import { BuildingDef, BuildingType, FactionType, FactionBonus, UnitType, MapSize, MapPreset, UnitStats, FormationType, Age, AgeConfig, DamageType, DamageProfile, ArmorProfile, TechId, TechDef, UnitAbility } from "./types";

export const TILE_SIZE = 32;
// Default Fallback
export const MAP_WIDTH = 2048;
export const MAP_HEIGHT = 2048;

export const STANCE_TETHER_RADIUS = 300; // Max distance to chase from anchor in Defensive stance
// Stress benchmark: render every Nth unit's DOT bob to cap GPU draw count.
// All 5k units remain active and moving; only the visual density is reduced.
export const STRESS_RENDER_INTERVAL = 30; // 30 => 167 visible bobs out of 5k

export const CHUNK_SIZE = 512; // For infinite mode

export const MAP_SIZES: Record<MapSize, number> = {
  [MapSize.SMALL]: 1024,
  [MapSize.MEDIUM]: 2048,
  [MapSize.LARGE]: 4096,
  [MapSize.HUGE]: 8192
};

export const FACTION_COLORS = {
  [FactionType.ROMANS]: 0x3b82f6,
  [FactionType.GAULS]: 0x22c55e,
  [FactionType.CARTHAGE]: 0xef4444
};

export const FACTION_BONUSES: Record<string, FactionBonus> = {
  [FactionType.ROMANS]: {
    buildingHpMult: 1.10,
    wallHpMult: 1.20,
  },
  [FactionType.GAULS]: {
    meleeAttackMult: 1.15,
    rangedArmorMult: 0.90,
  },
  [FactionType.CARTHAGE]: {
    goldPerTick: 1,
    gatherRateMult: 1.10,
  },
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
  [UnitType.CHARIOT]: 380,
  [UnitType.RAM]: 150
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
  },
  [UnitType.RAM]: {
    maxHp: 150, attack: 50, range: 40, attackSpeed: 2000, speed: 25,
    squadSize: 1, squadSpacing: 0, squadColor: 0x8B4513
  }
};

// Auto-derived from UNIT_STATS for convenience
export const UNIT_SPEED: Record<UnitType, number> = {} as Record<UnitType, number>;
for (const type of Object.values(UnitType)) {
  const stats = UNIT_STATS[type as UnitType];
  if (stats) (UNIT_SPEED as Record<string, number>)[type] = stats.speed;
}

// Human-readable unit names for UI and notifications
export const UNIT_NAMES: Record<string, string> = {
  [UnitType.VILLAGER]: 'Villager',
  [UnitType.SLINGER]: 'Slinger',
  [UnitType.PIKESMAN]: 'Pikeman',
  [UnitType.ARCHER]: 'Archer',
  [UnitType.CAVALRY]: 'Cavalry',
  [UnitType.LEGION]: 'Legion',
  [UnitType.AXEMAN]: 'Axeman',
  [UnitType.HOPLITE]: 'Hoplite',
  [UnitType.CHARIOT]: 'Chariot',
  [UnitType.RAM]: 'Battering Ram',
  [UnitType.ANIMAL]: 'Animal',
};

// ─── Damage Types & Armor (Hack / Pierce / Crush) ────────────────────────────
// Smooth per-type reduction, 0 A.D.-style:  reducedFraction = K / (armor + K)
//   armor 0  -> 0% reduction,   armor 10 -> 50%,   armor 30 -> 75%,   armor 50 -> 83%
const ARMOR_REDUCTION_K = 10;

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
  [UnitType.ANIMAL]:    {},
  [UnitType.RAM]:       { [DamageType.CRUSH]: 50 }
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
  [UnitType.ANIMAL]:    { [DamageType.HACK]: 0, [DamageType.PIERCE]: 0, [DamageType.CRUSH]: 0 },
  [UnitType.RAM]:       { [DamageType.HACK]: 2, [DamageType.PIERCE]: 10, [DamageType.CRUSH]: 1 }
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
  [BuildingType.BARRACKS]:     { [DamageType.HACK]: 10, [DamageType.PIERCE]: 10, [DamageType.CRUSH]: 2 },
  [BuildingType.MARKET]:    { [DamageType.HACK]: 4, [DamageType.PIERCE]: 4, [DamageType.CRUSH]: 1 },
  [BuildingType.WALL]:      { [DamageType.HACK]: 15, [DamageType.PIERCE]: 15, [DamageType.CRUSH]: 1 },
  [BuildingType.CATHEDRAL]: { [DamageType.HACK]: 8, [DamageType.PIERCE]: 8, [DamageType.CRUSH]: 2 },
  [BuildingType.CASTLE]:    { [DamageType.HACK]: 15, [DamageType.PIERCE]: 12, [DamageType.CRUSH]: 8 }
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
    workerNeeds: 1,
    effectRadius: 150
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
  },
  [BuildingType.MARKET]: {
    type: BuildingType.MARKET,
    name: 'Market',
    cost: { wood: 100, food: 0, gold: 50 },
    width: 48,
    height: 48,
    color: 0xf59e0b,
    description: 'Enables trade routes with the AI. Earns gold over time.',
    maxHp: 400,
    effectRadius: 200,
  },
  [BuildingType.WALL]: {
    type: BuildingType.WALL,
    name: 'Wall',
    cost: { wood: 20, food: 0, gold: 0 },
    width: 16,
    height: 16,
    color: 0x78716c,
    description: 'Blocks enemy movement.',
    maxHp: 500,
  },
  [BuildingType.CATHEDRAL]: {
    type: BuildingType.CATHEDRAL,
    name: 'Cathedral',
    cost: { wood: 200, food: 0, gold: 200 },
    width: 72,
    height: 72,
    color: 0xa78bfa,
    description: 'Grand monument. Boosts happiness and trade income.',
    maxHp: 1500,
    happinessBonus: 5,
    effectRadius: 300,
  },
  [BuildingType.CASTLE]: {
    type: BuildingType.CASTLE,
    name: 'Castle',
    cost: { wood: 300, food: 0, gold: 200 },
    width: 96,
    height: 96,
    color: 0x71717a,
    description: 'Ultimate fortress. Can garrison units for protection.',
    maxHp: 3000,
    effectRadius: 250,
  },
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
  AI_AGE_ADVANCED: 'ai-age-advanced',
  TOGGLE_SOUND: 'toggle-sound',
  SET_SOUND_VOLUME: 'set-sound-volume',
  CLASH_START: 'clash-start',
  RESEARCH_COMPLETED: 'research-completed',
  START_RESEARCH: 'start-research',
  SEASON_CHANGED: 'season-changed',
  NOTIFICATION: 'notification',
  GAME_OVER: 'game-over',
  DOMINANCE_PROGRESS: 'dominance-progress',
};

// ─── Age Configuration ─────────────────────────────────────────────────────
export const AGE_CONFIGS: Record<Age, AgeConfig> = {
  [Age.VILLAGE]: {
    name: 'Village Age',
    cost: { wood: 0, food: 0, gold: 0 },
    requiredBuildings: [],
    unlocksUnits: [UnitType.VILLAGER, UnitType.SLINGER, UnitType.PIKESMAN],
    unlocksBuildings: [],
    advancementTime: 0 // Village age is the starting age, no research needed
  },
  [Age.TOWN]: {
    name: 'Town Age',
    cost: { wood: 0, food: 600, gold: 400 },
    requiredBuildings: [{ type: BuildingType.BARRACKS, count: 1 }, { type: BuildingType.HOUSE, count: 1 }],
    unlocksUnits: [UnitType.ARCHER, UnitType.CAVALRY, UnitType.AXEMAN, UnitType.RAM],
    unlocksBuildings: [BuildingType.SMALL_PARK, BuildingType.MARKET],
    advancementTime: 60000 // 60s of game time
  },
  [Age.CITY_STATE]: {
    name: 'City-State Age',
    cost: { wood: 0, food: 1200, gold: 800 },
    requiredBuildings: [{ type: BuildingType.BARRACKS, count: 2 }, { type: BuildingType.HOUSE, count: 3 }],
    unlocksUnits: [UnitType.LEGION, UnitType.HOPLITE, UnitType.CHARIOT],
    unlocksBuildings: [BuildingType.CATHEDRAL, BuildingType.CASTLE],
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
  HEIGHT_DIFF_THRESHOLD: 0.08, // Height difference required for high-ground combat bonus
  HIGH_GROUND_ATTACK_BONUS: 0.10,   // +10% attack from high ground
  HIGH_GROUND_DEFENSE_BONUS: 0.05,  // +5% defense on high ground
  // Visual — biome-based terrain tiles
  // Each biome: { color, minHeight, label }
  BIOMES: [
    { color: { r: 60, g: 60, b: 50 }, minHeight: -Infinity, label: 'deep' },       // below water, unused
    { color: { r: 194, g: 178, b: 128 }, minHeight: 0.38, label: 'sand' },          // shore
    { color: { r: 72, g: 98, b: 52 }, minHeight: 0.42, label: 'swamp' },            // wetlands
    { color: { r: 62, g: 148, b: 58 }, minHeight: 0.46, label: 'grass' },           // lowland
    { color: { r: 38, g: 115, b: 50 }, minHeight: 0.53, label: 'jungle' },          // tropical dense
    { color: { r: 45, g: 122, b: 42 }, minHeight: 0.60, label: 'forest' },          // mid
    { color: { r: 148, g: 158, b: 152 }, minHeight: 0.68, label: 'tundra' },        // cold plateau
    { color: { r: 107, g: 95, b: 67 }, minHeight: 0.75, label: 'scrub' },           // highland
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
  // 768 = 48 cells of smooth repeating grit texture. No visible grid seams.
  TEX_PERIOD: 768,

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

  // River crossing mechanics
  RIVER_CROSSING_SPEED_PENALTY: 0.5,  // Half speed crossing rivers
  RIVER_COMBAT_PENALTY: 0.20,         // -20% attack in rivers
  RIVER_PATH_COST: 2.0,               // Pathfinding cost multiplier for river cells
  RIVER_COUNT: 2,                     // Number of rivers per map
  RIVER_WIDTH_CELLS: 2,               // Width of river in grid cells
  RIVER_MIN_HEIGHT: 0.40,             // Rivers form in terrain above this height
  RIVER_MAX_HEIGHT: 0.65,             // Rivers form in terrain below this height
};

// ─── Research Tech Tree ──────────────────────────────────────────────────
export const TECH_DEFS: Record<TechId, TechDef> = {
    [TechId.WOODCUTTING_I]: {
        id: TechId.WOODCUTTING_I,
        name: 'Improved Woodcutting',
        description: 'Lumber Camp output +25%',
        requiredAge: Age.VILLAGE,
        hostBuildingTypes: [BuildingType.TOWN_CENTER],
        prereqs: [],
        cost: { wood: 100, food: 0, gold: 50 },
        researchTimeMs: 30000,
        modifications: [{ path: 'Gather/Wood', multiply: 1.25 }]
    },
    [TechId.FORAGING_I]: {
        id: TechId.FORAGING_I,
        name: 'Wild Foraging',
        description: 'Farm output near fertile zones +25%',
        requiredAge: Age.VILLAGE,
        hostBuildingTypes: [BuildingType.TOWN_CENTER],
        prereqs: [],
        cost: { wood: 50, food: 0, gold: 50 },
        researchTimeMs: 30000,
        modifications: [{ path: 'Gather/Food', multiply: 1.25 }]
    },
    [TechId.IRON_WORKING]: {
        id: TechId.IRON_WORKING,
        name: 'Iron Working',
        description: 'All military units +15% damage',
        requiredAge: Age.TOWN,
        hostBuildingTypes: [BuildingType.BARRACKS],
        prereqs: [TechId.WOODCUTTING_I],
        cost: { wood: 200, food: 0, gold: 100 },
        researchTimeMs: 45000,
        modifications: [{ path: 'Combat/Damage', multiply: 1.15 }]
    },
    [TechId.CARRIAGE]: {
        id: TechId.CARRIAGE,
        name: 'Cartography',
        description: 'Villager carry capacity +30%',
        requiredAge: Age.TOWN,
        hostBuildingTypes: [BuildingType.TOWN_CENTER],
        prereqs: [TechId.FORAGING_I],
        cost: { wood: 150, food: 0, gold: 100 },
        researchTimeMs: 45000,
        modifications: [{ path: 'Movement/Speed', multiply: 1.10 }]
    },
    [TechId.FORTIFICATION]: {
        id: TechId.FORTIFICATION,
        name: 'Fortification',
        description: 'All buildings +20% HP',
        requiredAge: Age.CITY_STATE,
        hostBuildingTypes: [BuildingType.BARRACKS, BuildingType.TOWN_CENTER],
        prereqs: [TechId.IRON_WORKING],
        cost: { wood: 300, food: 100, gold: 200 },
        researchTimeMs: 60000,
        modifications: [{ path: 'Building/HP', multiply: 1.25 }]
    },
    [TechId.LOGISTICS]: {
        id: TechId.LOGISTICS,
        name: 'Logistics Corps',
        description: 'Dropsite radius +50px, Watchtower range +100',
        requiredAge: Age.CITY_STATE,
        hostBuildingTypes: [BuildingType.TOWN_CENTER],
        prereqs: [TechId.CARRIAGE],
        cost: { wood: 200, food: 100, gold: 300 },
        researchTimeMs: 60000,
        modifications: [{ path: 'Gather/All', multiply: 1.15 }]
    },
    [TechId.SIEGE_ENGINEERING]: {
        id: TechId.SIEGE_ENGINEERING,
        name: 'Siege Engineering',
        description: 'Siege units deal +25% damage to buildings.',
        requiredAge: Age.CITY_STATE,
        hostBuildingTypes: [BuildingType.BARRACKS],
        prereqs: [],
        cost: { wood: 200, food: 0, gold: 300 },
        researchTimeMs: 90000,
        modifications: []
    },
    [TechId.CIVIL_SERVICE]: {
        id: TechId.CIVIL_SERVICE,
        name: 'Civil Service',
        description: 'Population growth +50% and happiness decay -30%.',
        requiredAge: Age.CITY_STATE,
        hostBuildingTypes: [BuildingType.CATHEDRAL],
        prereqs: [],
        cost: { wood: 0, food: 300, gold: 400 },
        researchTimeMs: 120000,
        modifications: []
    }
};
// ─── Animal Species Stats ─────────────────────────────────────────────
export interface AnimalSpeciesStat {
  maxHp: number;
  speed: number;
  fearRange: number;      // flee when unit within this distance (0 = no flee)
  attackRange: number;    // attack when unit within this distance (0 = passive)
  attackDamage: number;
  foodValue: number;      // food dropped on death
  breedCooldownMs: number;
  color: number;          // visual color
  scaleX: number;         // visual width scale
  scaleY: number;         // visual height scale
  label: string;
}

export const ANIMAL_SPECIES_STATS: Record<AnimalSpecies, AnimalSpeciesStat> = {
  [AnimalSpecies.DEER]: {
    maxHp: 30, speed: 60, fearRange: 150, attackRange: 0, attackDamage: 0,
    foodValue: 50, breedCooldownMs: 120000, color: 0x8B6914, scaleX: 14, scaleY: 8, label: 'Deer'
  },
  [AnimalSpecies.WOLF]: {
    maxHp: 40, speed: 90, fearRange: 0, attackRange: 100, attackDamage: 15,
    foodValue: 0, breedCooldownMs: 180000, color: 0x607D8B, scaleX: 13, scaleY: 7, label: 'Wolf'
  },
  [AnimalSpecies.BOAR]: {
    maxHp: 60, speed: 50, fearRange: 0, attackRange: 80, attackDamage: 25,
    foodValue: 80, breedCooldownMs: 150000, color: 0x4E342E, scaleX: 15, scaleY: 9, label: 'Boar'
  },
  [AnimalSpecies.RABBIT]: {
    maxHp: 10, speed: 100, fearRange: 100, attackRange: 0, attackDamage: 0,
    foodValue: 15, breedCooldownMs: 60000, color: 0xECEFF1, scaleX: 8, scaleY: 5, label: 'Rabbit'
  },
};

// ─── Biome Pathfinding Costs ──────────────────────────────────────────
export const BIOME_PATH_COSTS: Record<string, number> = {
  'deep': 999,    // impassable
  'sand': 0.9,    // firm beach
  'swamp': 1.5,   // wet sticky ground
  'grass': 1.0,   // baseline
  'jungle': 1.6,  // dense tropical undergrowth
  'forest': 1.4,  // dense undergrowth
  'tundra': 1.3,  // frozen hard ground
  'scrub': 1.2,   // highland scrub
  'stone': 1.6,   // rocky peaks
};

// ─── Spatial Economy ──────────────────────────────────────────────────
export const VILLAGER_SPEED = 80;

export const TRADE_INCOME = 2; // gold per tick when both sides have a Market and peace/treaty is active
export const CATHEDRAL_TRADE_BONUS_MULTIPLIER = 2; // Cathedral doubles trade income (2→4 gold/tick)
export const VILLAGER_CARRY_CAPACITY: Record<string, number> = {
  wood: 5,
  food: 8,
  gold: 3,
};

export const VILLAGER_GATHER_RATE_MS = 2000; // ms per resource unit gathered

export const VILLAGER_BUILDING_UPKEEP: Partial<Record<BuildingType, { food?: number; gold?: number }>> = {
  [BuildingType.BARRACKS]: { gold: 2 },
  [BuildingType.HUNTERS_LODGE]: { gold: 1 },
};

export const POPULATION_FOOD_COST = 30; // food to grow one villager

// ─── Gold Mine Resource Nodes ────────────────────────────────────────
export const GOLD_MINE_RESPAWN_MS = 60000;  // 60s respawn after depletion
export const GOLD_MINE_SEARCH_RADIUS = 300; // px radius to find nearest gold mine
export const GOLD_MINE_COUNT = 4;           // mines spawned per faction start

// ─── Farm Terrain Affinity ─────────────────────────────────────────────
export const FARM_TERRAIN_YIELD: Record<string, number> = {
  'grass': 1.3,   // fertile lowland bonus
  'forest': 1.0,  // forest floor is OK
  'jungle': 1.1,  // rich tropical soil
  'swamp': 0.9,   // waterlogged but fertile
  'sand': 0.6,    // arid penalty
  'tundra': 0.4,  // frozen, poor yield
  'scrub': 0.8,   // highland penalty
  'stone': 0.3,   // near-impossible
  'deep': 0,      // underwater = no farm
};

// ─── Seasonal Configuration ───────────────────────────────────────────
export const SEASON_DURATION_MS = 300000; // 5 minutes real time

export interface SeasonModifiers {
  farmFertility: number;     // multiplier on farm food production
  breedRate: number;         // multiplier on animal breeding speed
  treeRegrowth: number;      // multiplier on tree regrowth chance
  movementCostMult: number;  // multiplier on ALL pathfinding costs
  label: string;
}

export const SEASON_CONFIG: Record<Season, SeasonModifiers> = {
  [Season.SPRING]: {
    farmFertility: 1.25, breedRate: 1.5, treeRegrowth: 1.25, movementCostMult: 1.0, label: 'Spring'
  },
  [Season.SUMMER]: {
    farmFertility: 1.0, breedRate: 1.0, treeRegrowth: 1.0, movementCostMult: 1.0, label: 'Summer'
  },
  [Season.AUTUMN]: {
    farmFertility: 0.85, breedRate: 0.5, treeRegrowth: 0.75, movementCostMult: 1.0, label: 'Autumn'
  },
  [Season.WINTER]: {
    farmFertility: 0.5, breedRate: 0.0, treeRegrowth: 0.0, movementCostMult: 1.3, label: 'Winter'
  },
};

export const SEASON_ORDER: Season[] = [Season.SPRING, Season.SUMMER, Season.AUTUMN, Season.WINTER];

// ─── Dominance Victory Condition ─────────────────────────────────────
export const DOMINANCE_CONTROL_THRESHOLD = 0.60; // 60% of map buildings
export const DOMINANCE_HOLD_TIME_MS = 60000;     // 60 seconds
export const DOMINANCE_MIN_BUILDINGS = 5;        // minimum non-TC buildings before dominance can trigger
export const DEFAULT_MAP_SEED = 0;                // 0 = random, any other value = deterministic

// ─── Map Presets ──────────────────────────────────────────────────────
export const DEFAULT_MAP_PRESET = MapPreset.STANDARD;

export const MAP_PRESETS: Record<MapPreset, {
  name: string;
  description: string;
  heightMultiplier: number;  // Affects terrain roughness
  waterLevel: number;        // Water level override
  biomeWeights: Partial<Record<string, number>>;  // Biome probability weights
  resourceMultiplier: number; // Resource spawn rate
  riverCount: number;        // Number of rivers
}> = {
  [MapPreset.STANDARD]: {
    name: 'Standard',
    description: 'Balanced terrain with mixed biomes',
    heightMultiplier: 1.0,
    waterLevel: 0.38,
    biomeWeights: {},
    resourceMultiplier: 1.0,
    riverCount: 2,
  },
  [MapPreset.ISLAND]: {
    name: 'Island',
    description: 'Archipelago with limited land — naval expansion critical',
    heightMultiplier: 0.8,
    waterLevel: 0.45,
    biomeWeights: { sand: 2.0 },
    resourceMultiplier: 0.8,
    riverCount: 0,
  },
  [MapPreset.RIVER_VALLEY]: {
    name: 'River Valley',
    description: 'Rivers divide the map — bridges and crossings matter',
    heightMultiplier: 1.2,
    waterLevel: 0.38,
    biomeWeights: { grass: 1.5 },
    resourceMultiplier: 1.1,
    riverCount: 6,
  },
  [MapPreset.DESERT]: {
    name: 'Desert',
    description: 'Harsh desert with scarce resources — survival focus',
    heightMultiplier: 0.9,
    waterLevel: 0.30,
    biomeWeights: { sand: 3.0, grass: 0.3 },
    resourceMultiplier: 0.6,
    riverCount: 1,
  },
  [MapPreset.HIGHLANDS]: {
    name: 'Highlands',
    description: 'Mountainous terrain with stone abundance — elevation advantage key',
    heightMultiplier: 1.5,
    waterLevel: 0.30,
    biomeWeights: { stone: 2.0, scrub: 1.5 },
    resourceMultiplier: 1.2,
    riverCount: 3,
  },
};

// ─── Unit Abilities ─────────────────────────────────────────────────────
export const ABILITY_CONFIG: Record<UnitAbility, { cooldown: number; duration: number; description: string }> = {
  [UnitAbility.SHIELD_WALL]: { cooldown: 15000, duration: 5000, description: 'Form shield wall: +50% armor, immobile' },
  [UnitAbility.RAIN_FIRE]: { cooldown: 20000, duration: 0, description: 'Arrow volley: hit all enemies in area' },
  [UnitAbility.CHARGE]: { cooldown: 12000, duration: 3000, description: 'Cavalry charge: 2x damage on first hit' },
};

export const UNIT_ABILITIES: Partial<Record<UnitType, UnitAbility>> = {
  [UnitType.PIKESMAN]: UnitAbility.SHIELD_WALL,
  [UnitType.ARCHER]: UnitAbility.RAIN_FIRE,
  [UnitType.CAVALRY]: UnitAbility.CHARGE,
};


// ─── AI Personality Taunts ─────────────────────────────────────────────
/** Maps AIPersonality keys to event-triggered taunt arrays. */
export const AI_TAUNTS: Record<string, string[]> = {
  aggressor: [
    'My cavalry will overrun you!',
    'Your walls are meaningless!',
    'Surrender or be destroyed!',
    'The Wolf hungers for battle!',
    'Blood and iron will decide this!',
  ],
  defender: [
    'My defenses are impenetrable.',
    'Patience wins wars.',
    'Attack if you dare.',
    'Every stone you break was planned.',
    'You will spend your army upon my walls.',
  ],
  economist: [
    'My economy grows while yours stagnates.',
    'I have plans within plans.',
    'You fight; I prosper.',
    'Gold is the true weapon of kings.',
    'My granaries overflow while your people starve.',
  ],
  balanced: [
    'We meet on the battlefield!',
    'Strength through unity!',
    'For glory!',
    'The Boar charges — stand aside or fall!',
    'Unity, discipline, victory.',
  ],
};

/** Cooldown in ms between AI taunts to prevent spam. */
export const TAUNT_COOLDOWN_MS = 45000;

/** Display names for AI personalities. */
export const AI_PERSONALITY_NAMES: Record<string, string> = {
  aggressor: 'Warlord Kael',
  defender: 'Sentinel Marcus',
  economist: 'Merchant Helena',
  balanced: 'Chieftain Brennus',
};

// ─── Siege Warfare ────────────────────────────────────────────────────
export const WALL_DEFENSE_BONUS = 0.4;           // 40% less damage to units near walls
export const WALL_MELEE_PENALTY = 0.5;            // Melee attackers deal 50% damage to units behind walls
export const WALL_PROXIMITY_RADIUS = 30;          // px — unit is "behind wall" if within this radius
export const RAM_VS_WALL_MULTIPLIER = 3.0;        // Rams deal 3x damage to walls
export const CASTLE_GARRISON_RANGE = 200;          // Garrisoned units fire at enemies within this range
export const CASTLE_GARRISON_FIRE_INTERVAL = 3000; // ms between garrison volleys
export const CASTLE_GARRISON_DAMAGE_PER_UNIT = 3;  // damage per garrisoned unit per volley

// ─── Soldier-Level Combat (Total War-style melee) ──────────────────────
/** Max soldiers per squad that actually engage an enemy in melee (front-rank lock). */
export const MAX_ATTACKERS = 3;
/** Separation radius scale for combat-mode soldiers (boid spacing → dempet). */
export const SEP_COMBAT = 0.5;
/** Charge impulse applied to a soldier on first contact with an enemy (px/s). */
export const CHARGE_IMPULSE = 180;
/** Charge impulse duration (ms) — how long the soldier keeps the boost. */
export const CHARGE_IMPULSE_DURATION_MS = 250;
/** Distance from squad center at which a soldier is considered "front rank". */
export const FRONT_RANK_RADIUS = 24;
/** Crowd-push scale: rear ranks push their slot forward through the front line. */
export const CROWD_PUSH_SCALE = 0.6;
