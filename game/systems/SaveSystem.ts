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

type SerializedBuildingWithWaypoint = SerializedBuilding & {
  waypoint?: { x: number; y: number };
};

type VillagerCarryType = 'wood' | 'food' | 'gold';
type SerializedVillagerJobBuilding = {
  type: BuildingType;
  x: number;
  y: number;
};
type SerializedVillagerUnit = SerializedUnit & {
  carryAmount?: number;
  carryType?: VillagerCarryType | null;
  jobBuilding?: SerializedVillagerJobBuilding;
};
type RestoredVillager = {
  villager: any;
  saved: SerializedVillagerUnit;
};

type SerializedGoldMineState = {
  x: number;
  y: number;
  goldRemaining: number;
  isDepleted: boolean;
  isChopped: boolean;
  depletedAt?: number;
};

type SaveGameWithResourceNodes = SaveGame & {
  resourceNodes?: {
    goldMines: SerializedGoldMineState[];
  };
};

const VILLAGER_CARRY_TYPES = new Set<VillagerCarryType>(['wood', 'food', 'gold']);
const VILLAGER_TRANSIENT_STATES = new Set<UnitState>([
  UnitState.MOVING_TO_WORK,
  UnitState.WORKING,
  UnitState.GATHERING,
  UnitState.CARRYING,
  UnitState.MOVING_TO_RALLY,
]);

/**
 * Villager work/navigation states depend on runtime-only references such as a
 * path, jobBuilding, targetResource, or rallyPoint. Those references are not
 * part of the save format, so restoring the state without them can leave the
 * villager pathless and stuck. Restart those states from IDLE after a round
 * trip while preserving states that do not require transient work context.
 */
export function normalizeVillagerStateForSaveLoad(state: UnitState): UnitState {
  return VILLAGER_TRANSIENT_STATES.has(state) ? UnitState.IDLE : state;
}

function readSerializedVillagerCarry(unit: SerializedUnit): { amount: number; type: VillagerCarryType | null } {
  const saved = unit as SerializedVillagerUnit;
  const amount = typeof saved.carryAmount === 'number' && Number.isFinite(saved.carryAmount) && saved.carryAmount > 0
    ? saved.carryAmount
    : 0;
  const type = saved.carryType && VILLAGER_CARRY_TYPES.has(saved.carryType)
    ? saved.carryType
    : null;
  return amount > 0 && type ? { amount, type } : { amount: 0, type: null };
}

// ─── Serialize ──────────────────────────────────────────────────────────

export function serializeGame(scene: MainScene): SaveGame {
  const save: SaveGameWithResourceNodes = {
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
    taxRate: scene.taxRate,
    bloomIntensity: scene.bloomIntensity,
    // Entities
    units: serializeUnits(scene),
    buildings: serializeBuildings(scene),
    resourceNodes: serializeResourceNodes(scene),
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
  return save;
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

  // Work/navigation references are runtime-only, but gathered resources are
  // durable economy state. Persist valid carry and resume it as CARRYING after
  // load so it can be reconnected to the same dropsite before jobs resume.
  const villagers = scene.villagerSystem?.getAllVillagers() ?? [];
  for (const v of villagers) {
    const carryAmount = Number.isFinite(v.carryAmount) && v.carryAmount > 0 ? v.carryAmount : 0;
    const carryType = carryAmount > 0 && v.carryType ? v.carryType : null;
    const jobDef = carryType ? v.jobBuilding?.getData?.('def') : undefined;
    const jobBuilding = carryType && v.jobBuilding && jobDef?.type
      ? {
        type: jobDef.type as BuildingType,
        x: v.jobBuilding.x,
        y: v.jobBuilding.y,
      }
      : undefined;
    units.push({
      type: UnitType.VILLAGER,
      owner: v.owner,
      x: v.x,
      y: v.y,
      hp: 100,
      maxHp: 100,
      state: carryType ? UnitState.CARRYING : normalizeVillagerStateForSaveLoad(v.state),
      stance: UnitStance.HOLD,
      carryAmount,
      carryType,
      jobBuilding,
    } as SerializedVillagerUnit);
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
    const waypoint = def.type === BuildingType.BARRACKS
      ? b.getData('waypoint') as { x: number; y: number } | undefined
      : undefined;
    buildings.push({
      type: def.type as BuildingType,
      owner: b.getData('owner') ?? 0,
      x: b.x,
      y: b.y,
      hp,
      maxHp: b.getData('maxHp') ?? hp,
      workers: b.getData('workers') ?? 0,
      garrison: def.type === BuildingType.CASTLE ? (b.getData('garrison') ?? {}) : undefined,
      waypoint: waypoint ? { x: waypoint.x, y: waypoint.y } : undefined,
    } as SerializedBuildingWithWaypoint);
  }
  return buildings;
}

function serializeResourceNodes(scene: MainScene): SaveGameWithResourceNodes['resourceNodes'] {
  const goldMines: SerializedGoldMineState[] = [];
  const resourceNodes = scene.trees?.getChildren?.() ?? [];
  for (const child of resourceNodes) {
    const mine = child as any;
    if (!mine.getData?.('isGoldMine')) continue;
    const rawRemaining = mine.getData('goldRemaining');
    const goldRemaining = typeof rawRemaining === 'number' && Number.isFinite(rawRemaining)
      ? Math.max(0, rawRemaining)
      : 0;
    const rawDepletedAt = mine.getData('depletedAt');
    goldMines.push({
      x: mine.x,
      y: mine.y,
      goldRemaining,
      isDepleted: mine.getData('isDepleted') === true,
      isChopped: mine.getData('isChopped') === true,
      depletedAt: typeof rawDepletedAt === 'number' && Number.isFinite(rawDepletedAt)
        ? rawDepletedAt
        : undefined,
    });
  }
  return { goldMines };
}

function serializeResearch(scene: MainScene) {
  const rm = scene.researchManager;
  if (!rm) {
    return {
      completedPlayer: [] as TechId[],
      activePlayer: null,
      completedAI: [] as TechId[],
      activeAI: null,
    };
  }

  const playerSnap = rm.getSnapshot(0);
  const aiSnap = rm.getSnapshot(1);
  const activePlayer = rm.getActive(0);
  const activeAI = rm.getActive(1);

  return {
    completedPlayer: [...playerSnap.completed],
    activePlayer: activePlayer
      ? { techId: activePlayer.techId, remainingMs: activePlayer.remainingMs }
      : null,
    completedAI: [...aiSnap.completed],
    activeAI: activeAI
      ? { techId: activeAI.techId, remainingMs: activeAI.remainingMs }
      : null,
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
      selectedBlueprint: [],
      nextAttackTime: 0,
      lastEconomyTick: 0,
      lastBuildTick: 0,
      lastRecruitTick: 0,
      lastDefenseTick: 0,
      lastThreatCheck: 0,
      lastAttackTick: 0,
      lastTauntTime: 0,
      hasSpawnedStartingForest: false,
      personalityBonusBuildings: 0,
      aiCurrentAge: Age.VILLAGE,
      aiAgeProgress: 0,
      aiIsAdvancing: false,
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
  // Selection owns live Phaser object references. Release them before replacing
  // the world so post-load commands cannot target entities from the old session.
  scene.inputManager?.clearSelection();
  scene.inputManager?.deselectBuilding();

  // 1. Destroy all existing entities
  destroyAllEntities(scene);

  // 2. Restore scalar state
  restoreScalarState(scene, save);

  // 3. Restore mutable finite resource nodes generated by the seeded world.
  // Older version-1 saves do not have this optional payload and keep the
  // generated defaults, preserving backward compatibility.
  restoreResourceNodes(scene, save);

  // 4. Restore research state
  restoreResearch(scene, save);

  // 5. Respawn buildings (before units, so pathfinder grid is correct)
  respawnBuildings(scene, save);

  // Normal building spawn intentionally applies live construction bonuses.
  // During load, keep those side effects for derived state (for example max
  // population), but restore the authoritative serialized happiness afterward
  // so repeated save/load cycles do not compound building happiness bonuses.
  scene.happiness = save.happiness;

  // 6. Restore AI state (after buildings are respawned so AI building array repopulates)
  restoreAIState(scene, save);
  // 7. Respawn units (after buildings and AI state)
  const restoredVillagers = respawnUnits(scene, save);

  // 8. Rebuild runtime-only workforce references before ordinary assignment.
  // Carrying villagers are not idle, so without this pass a paused save can
  // reload with a permanently vacant worker building until simulation resumes.
  reconnectCarryingVillagers(scene, restoredVillagers);
  scene.economySystem?.assignJobs?.();

  // 9. Recompute economy stats
  scene.economySystem?.updateStats();

  // 10. Force a full update cycle so everything is consistent
  const center = getIsoCenter(scene);
  scene.cameras.main.centerOn(center.x, center.y);
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
  scene.maxPopulation = 8; // Match MainScene.init(); buildings rebuild derived bonuses.
  scene.happiness = save.happiness;
  scene.gameSpeed = save.gameSpeed;
  scene.taxRate = save.taxRate ?? 0;
  scene.bloomIntensity = save.bloomIntensity ?? 1.0;
  scene.enemyFaction = save.enemyFaction;
  scene.dominanceProgress = save.dominanceProgress;
  scene.playerTerritoryPercent = save.playerTerritoryPercent;
  scene.gameResult = save.gameResult;
  (scene as any).victoryType = save.victoryType;

  // Update pathfinding for restored season
  scene.pathfinder?.updateTerrainCosts(scene.terrainSystem, save.currentSeason);
}

function restoreResourceNodes(scene: MainScene, save: SaveGame): void {
  const savedMines = (save as SaveGameWithResourceNodes).resourceNodes?.goldMines;
  if (!savedMines?.length) return;

  const liveMines = (scene.trees?.getChildren?.() ?? []).filter(
    (child) => (child as any).getData?.('isGoldMine') === true,
  ) as any[];

  for (const saved of savedMines) {
    const mine = liveMines.find((candidate) =>
      Math.abs(candidate.x - saved.x) <= 0.5 && Math.abs(candidate.y - saved.y) <= 0.5,
    );
    if (!mine) continue;

    const remaining = Number.isFinite(saved.goldRemaining) ? Math.max(0, saved.goldRemaining) : 0;
    mine.setData('goldRemaining', remaining);
    mine.setData('isDepleted', saved.isDepleted === true);
    mine.setData('isChopped', saved.isChopped === true);
    mine.setData('depletedAt', Number.isFinite(saved.depletedAt) ? saved.depletedAt : 0);

    if (saved.isDepleted || saved.isChopped || remaining <= 0) {
      mine.setData('visualTexture', 'stump');
      mine.setData('visualTint', 0xffffff);
      mine.setData('visualScale', 0.075);
      const visual = mine.visual;
      if (visual?.active) {
        visual.setTexture('stump');
        visual.setTint(0xffffff);
        visual.setScale(0.075);
      }
    }
  }
}

function restoreResearch(scene: MainScene, save: SaveGame): void {
  const rm = scene.researchManager;
  if (!rm) return;

  // Player research: set completed techs
  rm.setCompleted(0, save.research.completedPlayer);
  // Player active research
  if (save.research.activePlayer) {
    rm.setActiveResearch(0, save.research.activePlayer.techId, save.research.activePlayer.remainingMs);
  } else {
    rm.clearActiveResearch(0);
  }
  // AI research
  rm.setCompleted(1, save.research.completedAI);
  if (save.research.activeAI) {
    rm.setActiveResearch(1, save.research.activeAI.techId, save.research.activeAI.remainingMs);
  } else {
    // `activeAI` is optional so older version-1 saves remain loadable. Treat a
    // missing field the same as no active AI research and clear stale runtime state.
    rm.clearActiveResearch(1);
  }
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
    building.setData('hp', b.hp);
    building.setData('maxHp', b.maxHp);
    if (b.workers !== undefined) {
      building.setData('workers', b.workers);
    }
    if (b.type === BuildingType.CASTLE && b.garrison !== undefined) {
      building.setData('garrison', b.garrison);
    }
    const waypoint = (b as SerializedBuildingWithWaypoint).waypoint;
    if (b.type === BuildingType.BARRACKS && waypoint) {
      building.setData('waypoint', { x: waypoint.x, y: waypoint.y });
    }
    // assignedWorker is a runtime object reference and is rebuilt after villagers respawn.
  }
}

function respawnUnits(scene: MainScene, save: SaveGame): RestoredVillager[] {
  const restoredVillagers: RestoredVillager[] = [];
  for (const u of save.units) {
    if (u.type === UnitType.VILLAGER) {
      const villager = scene.villagerSystem.spawnVillager(u.x, u.y, u.owner);
      const saved = u as SerializedVillagerUnit;
      const carry = readSerializedVillagerCarry(u);
      villager.carryAmount = carry.amount;
      villager.carryType = carry.type;
      // Preserve already-gathered carry across the round trip. Its old object
      // references are rebuilt separately before normal job assignment.
      villager.state = carry.amount > 0 ? UnitState.CARRYING : normalizeVillagerStateForSaveLoad(u.state);
      restoredVillagers.push({ villager, saved });
      // VillagerData doesn't have hp or stance, skip
    } else {
      const unit = scene.entityFactory.spawnUnit(u.type, u.x, u.y, u.owner);
      if (unit) {
        unit.setData('hp', u.hp);
        unit.setData('maxHp', u.maxHp);
        unit.setData('stance', u.stance);
        // State is handled by UnitSystem, defaults to IDLE
      }
    }
  }
  return restoredVillagers;
}

function reconnectCarryingVillagers(scene: MainScene, restoredVillagers: RestoredVillager[]): void {
  const compatibleBuildingType: Record<VillagerCarryType, BuildingType> = {
    wood: BuildingType.LUMBER_CAMP,
    food: BuildingType.FARM,
    gold: BuildingType.TOWN_CENTER,
  };
  const buildings = scene.buildings.getChildren() as Phaser.GameObjects.Image[];

  for (const { villager, saved } of restoredVillagers) {
    if (villager.state !== UnitState.CARRYING || !villager.carryType || villager.carryAmount <= 0 || villager.jobBuilding) {
      continue;
    }

    const targetType = compatibleBuildingType[villager.carryType as VillagerCarryType];
    const savedJob = saved.jobBuilding;
    let closest = savedJob
      ? buildings.find((building) => {
        const def = building.getData('def');
        return building.getData('owner') === villager.owner
          && def?.type === savedJob.type
          && Math.abs(building.x - savedJob.x) <= 0.5
          && Math.abs(building.y - savedJob.y) <= 0.5
          && !building.getData('assignedWorker');
      }) ?? null
      : null;
    let closestDistance = Number.POSITIVE_INFINITY;

    // Older version-1 saves have no dropsite locator. If the exact saved site
    // no longer exists, fall back to the nearest compatible owned building so
    // durable carry still remains recoverable instead of becoming orphaned.
    if (!closest) {
      for (const building of buildings) {
        const def = building.getData('def');
        if (building.getData('owner') !== villager.owner || def?.type !== targetType || building.getData('assignedWorker')) {
          continue;
        }
        const dx = building.x - villager.x;
        const dy = building.y - villager.y;
        const distance = dx * dx + dy * dy;
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = building;
        }
      }
    }

    if (closest) {
      closest.setData('assignedWorker', villager);
      villager.jobBuilding = closest;
    }
  }
}

function getIsoCenter(scene: MainScene): { x: number; y: number } {
  return toIso(scene.mapWidth / 2, scene.mapHeight / 2);
}

// ─── localStorage ───────────────────────────────────────────────────────

export function saveToLocalStorage(save: SaveGame): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
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
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function getSaveMeta(): { timestamp: number; faction: FactionType; mapSeed: number; mapPreset: MapPreset; currentAge: Age } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveGame;
    if (save.version !== SAVE_VERSION) return null;
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
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(PENDING_LOAD_KEY);
  } catch {
    // Storage can be unavailable under browser privacy/security policies.
  }
}

export function setPendingLoad(): void {
  try {
    localStorage.setItem(PENDING_LOAD_KEY, 'true');
  } catch {
    // Loading cannot be queued when storage is unavailable.
  }
}

export function isPendingLoad(): boolean {
  try {
    return localStorage.getItem(PENDING_LOAD_KEY) === 'true';
  } catch {
    return false;
  }
}

export function clearPendingLoad(): void {
  try {
    localStorage.removeItem(PENDING_LOAD_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}