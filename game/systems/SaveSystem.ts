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
type SerializedBuildingRuntimeState = SerializedBuildingWithWaypoint & {
  constructionComplete?: boolean;
  constructionRemainingMs?: number;
  workforceTarget?: number;
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
    faction: scene.faction,
    enemyFaction: scene.enemyFaction,
    mapMode: scene.mapMode,
    mapSize: getMapSizeFromDimensions(scene.mapWidth, scene.mapHeight),
    fowEnabled: scene.isFowEnabled,
    peacefulMode: scene.peacefulMode,
    treatyLength: scene.treatyLength / 60000,
    aiDisabled: scene.aiDisabled,
    mapSeed: scene.mapSeed,
    mapPreset: scene.mapPreset,
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
    units: serializeUnits(scene),
    buildings: serializeBuildings(scene),
    resourceNodes: serializeResourceNodes(scene),
    research: serializeResearch(scene),
    aiState: serializeAIState(scene),
    dominanceProgress: scene.dominanceProgress,
    playerTerritoryPercent: scene.playerTerritoryPercent,
    gameResult: scene.gameResult,
    victoryType: scene.victoryType,
  };
  return save;
}

function serializeUnits(scene: MainScene): SerializedUnit[] {
  const units: SerializedUnit[] = [];
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

  const villagers = scene.villagerSystem?.getAllVillagers() ?? [];
  for (const v of villagers) {
    const carryAmount = Number.isFinite(v.carryAmount) && v.carryAmount > 0 ? v.carryAmount : 0;
    const carryType = carryAmount > 0 && v.carryType ? v.carryType : null;
    const jobDef = v.jobBuilding?.getData?.('def');
    const jobImage = v.jobBuilding ? v.jobBuilding as Phaser.GameObjects.Image : null;
    const jobBuilding = jobImage && jobDef?.type
      ? { type: jobDef.type as BuildingType, x: jobImage.x, y: jobImage.y }
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
    const workforceTarget = b.getData('workforceTarget');
    const constructionComplete = b.getData('constructionComplete');
    const constructionCompletesAt = b.getData('constructionCompletesAt');
    const isUnfinishedPlayerHouse = def.type === BuildingType.HOUSE
      && (b.getData('owner') ?? 0) === 0
      && constructionComplete === false;
    const constructionRemainingMs = isUnfinishedPlayerHouse
      && typeof constructionCompletesAt === 'number'
      && Number.isFinite(constructionCompletesAt)
      ? Math.max(0, constructionCompletesAt - scene.gameTime)
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
      workforceTarget: typeof workforceTarget === 'number' && Number.isFinite(workforceTarget)
        ? workforceTarget
        : undefined,
      constructionComplete: isUnfinishedPlayerHouse ? false : undefined,
      constructionRemainingMs,
    } as SerializedBuildingRuntimeState);
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
    activePlayer: activePlayer ? { techId: activePlayer.techId, remainingMs: activePlayer.remainingMs } : null,
    completedAI: [...aiSnap.completed],
    activeAI: activeAI ? { techId: activeAI.techId, remainingMs: activeAI.remainingMs } : null,
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
  scene.inputManager?.clearSelection();
  scene.inputManager?.deselectBuilding();
  destroyAllEntities(scene);
  restoreScalarState(scene, save);
  restoreResourceNodes(scene, save);
  restoreResearch(scene, save);
  respawnBuildings(scene, save);
  scene.happiness = save.happiness;
  restoreAIState(scene, save);
  const restoredVillagers = respawnUnits(scene, save);
  scene.squadSystem?.syncPositions();
  reconnectVillagerJobs(scene, restoredVillagers);
  scene.economySystem?.assignJobs?.();
  scene.economySystem?.updateStats();
  const center = getIsoCenter(scene);
  scene.cameras.main.centerOn(center.x, center.y);
}

function destroyAllEntities(scene: MainScene): void {
  const unitChildren = [...scene.units.getChildren()];
  for (const child of unitChildren) {
    const u = child as any;
    if (u.visual) u.visual.destroy();
    scene.unitSpatialHash.remove(u);
    scene.units.remove(u, true, true);
  }
  const villagers = [...scene.villagerSystem.getAllVillagers()];
  for (const v of villagers) scene.villagerSystem.destroyVillager(v);
  const buildingChildren = [...scene.buildings.getChildren()];
  for (const child of buildingChildren) {
    const b = child as any;
    const def = b.getData('def');
    if (def) scene.pathfinder.markGrid(b.x, b.y, def.width, def.height, false);
    if (b.visual) b.visual.destroy();
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
  scene.population = 0;
  scene.maxPopulation = 8;
  scene.happiness = save.happiness;
  scene.gameSpeed = save.gameSpeed;
  if (scene.physics?.world) scene.physics.world.timeScale = 1 / scene.gameSpeed;
  if (scene.tweens) scene.tweens.timeScale = scene.gameSpeed;
  scene.taxRate = save.taxRate ?? 0;
  scene.bloomIntensity = save.bloomIntensity ?? 1.0;
  scene.enemyFaction = save.enemyFaction;
  scene.dominanceProgress = save.dominanceProgress;
  scene.playerTerritoryPercent = save.playerTerritoryPercent;
  scene.gameResult = save.gameResult;
  (scene as any).victoryType = save.victoryType;
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
  rm.setCompleted(0, save.research.completedPlayer);
  if (save.research.activePlayer) {
    rm.setActiveResearch(0, save.research.activePlayer.techId, save.research.activePlayer.remainingMs);
  } else {
    rm.clearActiveResearch(0);
  }
  rm.setCompleted(1, save.research.completedAI);
  if (save.research.activeAI) {
    rm.setActiveResearch(1, save.research.activeAI.techId, save.research.activeAI.remainingMs);
  } else {
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
    if (b.workers !== undefined) building.setData('workers', b.workers);
    if (b.type === BuildingType.CASTLE && b.garrison !== undefined) building.setData('garrison', b.garrison);
    const runtimeState = b as SerializedBuildingRuntimeState;
    if (typeof runtimeState.workforceTarget === 'number' && Number.isFinite(runtimeState.workforceTarget)) {
      building.setData('workforceTarget', runtimeState.workforceTarget);
    }
    const waypoint = runtimeState.waypoint;
    if (b.type === BuildingType.BARRACKS && waypoint) {
      building.setData('waypoint', { x: waypoint.x, y: waypoint.y });
    }
    if (b.type === BuildingType.HOUSE && b.owner === 0 && runtimeState.constructionComplete === false) {
      scene.buildingManager.beginPlayerHouseConstruction(building, runtimeState.constructionRemainingMs);
    }
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
      villager.state = carry.amount > 0 ? UnitState.CARRYING : normalizeVillagerStateForSaveLoad(u.state);
      restoredVillagers.push({ villager, saved });
    } else {
      const unit = scene.entityFactory.spawnUnit(u.type, u.x, u.y, u.owner);
      if (unit) {
        unit.setData('hp', u.hp);
        unit.setData('maxHp', u.maxHp);
        unit.setData('stance', u.stance);
      }
    }
  }
  return restoredVillagers;
}

function reconnectVillagerJobs(scene: MainScene, restoredVillagers: RestoredVillager[]): void {
  const compatibleBuildingType: Record<VillagerCarryType, BuildingType> = {
    wood: BuildingType.LUMBER_CAMP,
    food: BuildingType.FARM,
    gold: BuildingType.TOWN_CENTER,
  };
  const buildings = scene.buildings.getChildren() as Phaser.GameObjects.Image[];
  for (const { villager, saved } of restoredVillagers) {
    if (villager.jobBuilding) continue;
    const savedJob = saved.jobBuilding;
    const exact = savedJob
      ? buildings.find((building) => {
        const def = building.getData('def');
        return building.getData('owner') === villager.owner
          && def?.type === savedJob.type
          && Math.abs(building.x - savedJob.x) <= 0.5
          && Math.abs(building.y - savedJob.y) <= 0.5
          && !building.getData('assignedWorker');
      }) ?? null
      : null;
    if (exact) {
      exact.setData('assignedWorker', villager);
      villager.jobBuilding = exact;
      if (villager.state !== UnitState.CARRYING) villager.state = UnitState.WORKING;
      continue;
    }
    if (villager.state !== UnitState.CARRYING || !villager.carryType || villager.carryAmount <= 0) continue;
    const targetType = compatibleBuildingType[villager.carryType as VillagerCarryType];
    let closest: Phaser.GameObjects.Image | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasFiniteResources(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.wood)
    && isFiniteNumber(value.food)
    && isFiniteNumber(value.gold);
}

/**
 * Keep the storage boundary fail-closed. Version equality alone does not make
 * arbitrary JSON safe to feed into scene initialization and deserialization.
 * Nested entity details remain owned by their subsystem restore paths, but all
 * top-level state those paths unconditionally consume must exist here.
 */
export function isCurrentSaveShape(value: unknown): value is SaveGame {
  if (!isRecord(value) || value.version !== SAVE_VERSION) return false;
  return isFiniteNumber(value.timestamp)
    && typeof value.faction === 'string'
    && typeof value.enemyFaction === 'string'
    && typeof value.mapMode === 'string'
    && typeof value.mapSize === 'string'
    && typeof value.fowEnabled === 'boolean'
    && typeof value.peacefulMode === 'boolean'
    && isFiniteNumber(value.treatyLength)
    && typeof value.aiDisabled === 'boolean'
    && isFiniteNumber(value.mapSeed)
    && typeof value.mapPreset === 'string'
    && isFiniteNumber(value.gameTime)
    && typeof value.currentAge === 'string'
    && isFiniteNumber(value.ageProgress)
    && typeof value.isAdvancing === 'boolean'
    && (value.nextAge === null || typeof value.nextAge === 'string')
    && typeof value.currentSeason === 'string'
    && isFiniteNumber(value.seasonTimer)
    && hasFiniteResources(value.resources)
    && isFiniteNumber(value.population)
    && isFiniteNumber(value.happiness)
    && isFiniteNumber(value.gameSpeed)
    && value.gameSpeed > 0
    && Array.isArray(value.units)
    && Array.isArray(value.buildings)
    && isRecord(value.research)
    && Array.isArray(value.research.completedPlayer)
    && Array.isArray(value.research.completedAI)
    && isRecord(value.aiState)
    && isFiniteNumber(value.dominanceProgress)
    && isFiniteNumber(value.playerTerritoryPercent)
    && typeof value.gameResult === 'string'
    && typeof value.victoryType === 'string';
}

function parseStoredSave(raw: string): SaveGame | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isCurrentSaveShape(parsed)) {
    if (isRecord(parsed) && parsed.version !== SAVE_VERSION) {
      console.warn('[SaveSystem] Incompatible save version:', parsed.version);
    } else {
      console.warn('[SaveSystem] Invalid save structure.');
    }
    return null;
  }
  return parsed;
}

export function saveToLocalStorage(save: SaveGame): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

export function loadFromLocalStorage(): SaveGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return parseStoredSave(raw);
  } catch (e) {
    console.error('[SaveSystem] Failed to load:', e);
    return null;
  }
}

export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? parseStoredSave(raw) !== null : false;
  } catch {
    return false;
  }
}

export function getSaveMeta(): { timestamp: number; faction: FactionType; mapSeed: number; mapPreset: MapPreset; currentAge: Age } | null {
  const save = loadFromLocalStorage();
  if (!save) return null;
  return {
    timestamp: save.timestamp,
    faction: save.faction,
    mapSeed: save.mapSeed,
    mapPreset: save.mapPreset,
    currentAge: save.currentAge,
  };
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(PENDING_LOAD_KEY);
  } catch {}
}

export function setPendingLoad(): void {
  try {
    localStorage.setItem(PENDING_LOAD_KEY, 'true');
  } catch {}
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
  } catch {}
}
