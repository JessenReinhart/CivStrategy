/* eslint-disable @typescript-eslint/no-explicit-any */
import { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';
import {
  SaveGame, SerializedUnit, SerializedBuilding, SerializedAIState,
  UnitType, UnitState, BuildingType, Age,
  MapSize, FactionType, MapPreset, TechId, UnitStance,
} from '../../types';

export const SAVE_KEY = 'civstrategy-save';
export const PENDING_LOAD_KEY = 'civstrategy-pending-load';

const SAVE_VERSION = 1;

// ─── Serialize ──────────────────────────────────────────────────────────

export function serializeGame(scene: MainScene): SaveGame {
  return {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    // Init params
    faction: scene.faction,
    enemyFaction: scene.enemyFaction,
    mapMode: scene.mapMode,
    mapSize: getMapSizeFromDimensions(scene.mapWidth, scene.mapHeight),
    fowEnabled: scene.isFowEnabled,
    peacefulMode: scene.peacefulMode,
    treatyLength: scene.treatyLength / 60000, // convert ms back to minutes
    aiDisabled: scene.aiDisabled,
    mapSeed: scene.mapSeed,
    mapPreset: scene.mapPreset,
    // Runtime state
    gameTime: scene.gameTime,
    currentAge: scene.currentAge,
    ageProgress: scene.ageProgress,
    isAdvancing: scene.isAdvancing,
    nextAge: scene.nextAge,
    currentSeason: scene.currentSeason,
    seasonTimer: (scene as any).seasonTimer ?? 0,
    resources: { ...scene.resources },
    population: scene.population,
    happiness: scene.happiness,
    gameSpeed: scene.gameSpeed,
    // Entities
    units: serializeUnits(scene),
    buildings: serializeBuildings(scene),
    // Research
    research: serializeResearch(scene),
    // AI
    aiState: serializeAIState(scene),
    // Victory
    dominanceProgress: scene.dominanceProgress,
    playerTerritoryPercent: scene.playerTerritoryPercent,
    gameResult: scene.gameResult,
    victoryType: scene.victoryType,
  };
}

function serializeUnits(scene: MainScene): SerializedUnit[] {
  const units: SerializedUnit[] = [];

  // Military units from scene.units group
  for (const child of scene.units.getChildren()) {
    const u = child as any;
    const type: UnitType | undefined = u.getData('unitType') ?? u.unitType;
    if (!type || type === UnitType.ANIMAL) continue;
    const hp: number = u.getData('hp') ?? 0;
    if (hp <= 0) continue;
    units.push({
      type,
      owner: u.getData('owner') ?? 0,
      x: u.x,
      y: u.y,
      hp,
      maxHp: u.getData('maxHp') ?? hp,
      state: (u.state as UnitState) ?? UnitState.IDLE,
      stance: (u.getData('stance') as UnitStance) ?? UnitStance.HOLD,
    });
  }

  // Villagers from VillagerSystem
  const villagers = scene.villagerSystem?.getAllVillagers() ?? [];
  for (const v of villagers) {
    if (v.state === UnitState.GATHERING || v.state === UnitState.CARRYING) {
      // Reset transient work state to IDLE for clean reload
      units.push({
        type: UnitType.VILLAGER,
        owner: v.owner,
        x: v.x,
        y: v.y,
        hp: 100,
        maxHp: 100,
        state: UnitState.IDLE,
        stance: UnitStance.HOLD,
      });
    } else {
      units.push({
        type: UnitType.VILLAGER,
        owner: v.owner,
        x: v.x,
        y: v.y,
        hp: 100,
        maxHp: 100,
        state: v.state,
        stance: UnitStance.HOLD,
      });
    }
  }

  return units;
}

function serializeBuildings(scene: MainScene): SerializedBuilding[] {
  const buildings: SerializedBuilding[] = [];
  for (const child of scene.buildings.getChildren()) {
    const b = child as any;
    const def = b.getData('def');
    if (!def) continue;
    const hp: number = b.getData('hp') ?? 0;
    if (hp <= 0) continue;
    buildings.push({
      type: def.type as BuildingType,
      owner: b.getData('owner') ?? 0,
      x: b.x,
      y: b.y,
      hp,
      maxHp: b.getData('maxHp') ?? hp,
      workers: b.getData('workers') ?? 0,
      garrison: def.type === BuildingType.CASTLE ? (b.getData('garrison') ?? {}) : undefined,
    });
  }
  return buildings;
}

function serializeResearch(scene: MainScene) {
  const rm = scene.researchManager;
  if (!rm) return { completedPlayer: [] as TechId[], activePlayer: null, completedAI: [] as TechId[] };

  const playerSnap = rm.getSnapshot(0);
  const aiSnap = rm.getSnapshot(1);
  const activePlayer = rm.getActive(0);

  return {
    completedPlayer: [...playerSnap.completed],
    activePlayer: activePlayer
      ? { techId: activePlayer.techId, remainingMs: activePlayer.remainingMs }
      : null,
    completedAI: [...aiSnap.completed],
  };
}

function serializeAIState(scene: MainScene): SerializedAIState {
  const ai = scene.enemyAI;
  if (!ai) {
    return {
      personality: 'balanced',
      currentAge: Age.VILLAGE,
      ageProgress: 0,
      resources: { wood: 500, food: 500, gold: 500 },
      baseX: 200,
      baseY: 200,
      buildIndex: 0,
    };
  }
  return ai.serializeState();
}

function getMapSizeFromDimensions(width: number, _height: number): MapSize {
  if (width <= 1024) return MapSize.SMALL;
  if (width <= 2048) return MapSize.MEDIUM;
  if (width <= 4096) return MapSize.LARGE;
  return MapSize.HUGE;
}

// ─── Deserialize ────────────────────────────────────────────────────────

export function deserializeGame(scene: MainScene, save: SaveGame): void {
  // 1. Destroy all existing entities
  destroyAllEntities(scene);

  // 2. Restore scalar state
  restoreScalarState(scene, save);

  // 3. Restore research state
  restoreResearch(scene, save);

  // 4. Restore AI state
  restoreAIState(scene, save);

  // 5. Respawn buildings (before units, so pathfinder grid is correct)
  respawnBuildings(scene, save);

  // 6. Respawn units (after buildings)
  respawnUnits(scene, save);

  // 7. Recompute economy stats
  scene.economySystem?.updateStats();

  // 8. Force a full update cycle so everything is consistent
  scene.cameras.main.centerOn(
    ...Object.values(getIsoCenter(scene))
  );
}

function destroyAllEntities(scene: MainScene): void {
  // Destroy military units
  const unitChildren = [...scene.units.getChildren()];
  for (const child of unitChildren) {
    const u = child as any;
    // Clean up visual
    if (u.visual) {
      u.visual.destroy();
    }
    scene.unitSpatialHash.remove(u);
    scene.units.remove(u, true, true);
  }

  // Destroy villagers
  const villagers = [...scene.villagerSystem.getAllVillagers()];
  for (const v of villagers) {
    scene.villagerSystem.destroyVillager(v);
  }

  // Destroy buildings (with pathfinder cleanup)
  const buildingChildren = [...scene.buildings.getChildren()];
  for (const child of buildingChildren) {
    const b = child as any;
    const def = b.getData('def');
    if (def) {
      scene.pathfinder.markGrid(b.x, b.y, def.width, def.height, false);
    }
    // Clean up visual container
    if (b.visual) {
      b.visual.destroy();
    }
    scene.buildings.remove(b, true, true);
  }
}

function restoreScalarState(scene: MainScene, save: SaveGame): void {
  scene.gameTime = save.gameTime;
  scene.currentAge = save.currentAge;
  scene.ageProgress = save.ageProgress;
  (scene as any).isAdvancing = save.isAdvancing;
  (scene as any).nextAge = save.nextAge;
  scene.currentSeason = save.currentSeason;
  (scene as any).seasonTimer = save.seasonTimer;
  scene.resources = { ...save.resources };
  scene.population = 0; // Will be rebuilt by spawning units
  scene.maxPopulation = 5; // Base, will be rebuilt by spawning buildings
  scene.happiness = save.happiness;
  scene.gameSpeed = save.gameSpeed;
  scene.dominanceProgress = save.dominanceProgress;
  scene.playerTerritoryPercent = save.playerTerritoryPercent;
  scene.gameResult = save.gameResult;
  (scene as any).victoryType = save.victoryType;

  // Update pathfinding for restored season
  scene.pathfinder?.updateTerrainCosts(scene.terrainSystem, save.currentSeason);
}

function restoreResearch(scene: MainScene, save: SaveGame): void {
  const rm = scene.researchManager;
  if (!rm) return;

  // Player research: set completed techs
  rm.setCompleted(0, save.research.completedPlayer);
  // Player active research
  if (save.research.activePlayer) {
    rm.setActiveResearch(0, save.research.activePlayer.techId, save.research.activePlayer.remainingMs);
  }
  // AI research
  rm.setCompleted(1, save.research.completedAI);
  rm.rebuildSnapshotPublic(0);
  rm.rebuildSnapshotPublic(1);
}

function restoreAIState(scene: MainScene, save: SaveGame): void {
  const ai = scene.enemyAI;
  if (!ai) return;
  ai.restoreState(save.aiState);
}

function respawnBuildings(scene: MainScene, save: SaveGame): void {
  for (const b of save.buildings) {
    const building = scene.entityFactory.spawnBuilding(b.type, b.x, b.y, b.owner);
    // Override HP (spawnBuilding sets HP to max, we want the saved value)
    building.setData('hp', b.hp);
    building.setData('maxHp', b.maxHp);
    if (b.workers > 0) {
      building.setData('workers', b.workers);
    }
    if (b.garrison && b.type === BuildingType.CASTLE) {
      building.setData('garrison', { ...b.garrison });
    }
  }
}

function respawnUnits(scene: MainScene, save: SaveGame): void {
  for (const u of save.units) {
    if (u.type === UnitType.VILLAGER) {
      scene.villagerSystem.spawnVillager(u.x, u.y, u.owner);
    } else {
      const unit = scene.entityFactory.spawnUnit(u.type, u.x, u.y, u.owner);
      if (unit) {
        unit.setData('hp', u.hp);
        unit.setData('maxHp', u.maxHp);
        (unit as any).state = u.state;
        unit.setData('stance', u.stance);
      }
    }
  }
}
function getIsoCenter(scene: MainScene): { x: number; y: number } {
  return toIso(scene.mapWidth / 2, scene.mapHeight / 2);
}

// ─── localStorage ───────────────────────────────────────────────────────

export function saveToLocalStorage(save: SaveGame): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {
    console.error('[SaveSystem] Failed to save:', e);
  }
}

export function loadFromLocalStorage(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveGame;
    if (save.version !== SAVE_VERSION) {
      console.warn('[SaveSystem] Incompatible save version:', save.version);
      return null;
    }
    return save;
  } catch (e) {
    console.error('[SaveSystem] Failed to load:', e);
    return null;
  }
}

export function hasSave(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

export function getSaveMeta(): { timestamp: number; faction: FactionType; mapSeed: number; mapPreset: MapPreset; currentAge: Age } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveGame;
    return {
      timestamp: save.timestamp,
      faction: save.faction,
      mapSeed: save.mapSeed,
      mapPreset: save.mapPreset,
      currentAge: save.currentAge,
    };
  } catch {
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(PENDING_LOAD_KEY);
}

export function setPendingLoad(): void {
  localStorage.setItem(PENDING_LOAD_KEY, 'true');
}

export function isPendingLoad(): boolean {
  return localStorage.getItem(PENDING_LOAD_KEY) === 'true';
}

export function clearPendingLoad(): void {
  localStorage.removeItem(PENDING_LOAD_KEY);
}
