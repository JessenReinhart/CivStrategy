import type Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import {
  DOMINANCE_CONTROL_THRESHOLD,
  DOMINANCE_HOLD_TIME_MS,
  DOMINANCE_MIN_BUILDINGS,
} from '../../constants';
import { BuildingType, GameResult, MapMode, VictoryType } from '../../types';

export interface DominanceBuildingSnapshot {
  x: number;
  y: number;
  owner: number;
  type: BuildingType;
}

export interface DominanceControlResult {
  playerPercent: number;
  enemyPercent: number;
  playerSectors: number;
  enemySectors: number;
  contestedSectors: number;
  landSectors: number;
}

const BASE_INFLUENCE_RADIUS: Record<BuildingType, number> = {
  [BuildingType.TOWN_CENTER]: 250,
  [BuildingType.BONFIRE]: 110,
  [BuildingType.HOUSE]: 105,
  [BuildingType.BARRACKS]: 145,
  [BuildingType.FARM]: 95,
  [BuildingType.LUMBER_CAMP]: 115,
  [BuildingType.HUNTERS_LODGE]: 105,
  [BuildingType.SMALL_PARK]: 90,
  [BuildingType.MARKET]: 135,
  [BuildingType.WALL]: 55,
  [BuildingType.CATHEDRAL]: 165,
  [BuildingType.CASTLE]: 200,
};

const DOMINANCE_GRID_SIZE = 14;
const CONTEST_MARGIN = 0.08;

function mapRadiusScale(mapWidth: number, mapHeight: number): number {
  const scale = Math.min(mapWidth, mapHeight) / 2048;
  return Math.max(0.8, Math.min(2, scale));
}

/**
 * Calculate geographical control from sampled land sectors.
 *
 * A structure contributes influence by distance. Influence from multiple
 * structures of the same faction does not stack; only the strongest local
 * source counts. This makes spreading across the map valuable and prevents a
 * dense pile of houses in one base from becoming a fake "dominance" victory.
 */
export function calculateDominanceControl(params: {
  mapWidth: number;
  mapHeight: number;
  buildings: DominanceBuildingSnapshot[];
  isLand: (x: number, y: number) => boolean;
  gridSize?: number;
}): DominanceControlResult {
  const gridSize = Math.max(4, params.gridSize ?? DOMINANCE_GRID_SIZE);
  const radiusScale = mapRadiusScale(params.mapWidth, params.mapHeight);

  let landSectors = 0;
  let playerSectors = 0;
  let enemySectors = 0;
  let contestedSectors = 0;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x = ((gx + 0.5) / gridSize) * params.mapWidth;
      const y = ((gy + 0.5) / gridSize) * params.mapHeight;
      if (!params.isLand(x, y)) continue;

      landSectors++;
      let playerInfluence = 0;
      let enemyInfluence = 0;

      for (const building of params.buildings) {
        if (building.owner !== 0 && building.owner !== 1) continue;
        const radius = BASE_INFLUENCE_RADIUS[building.type] * radiusScale;
        const distance = Math.hypot(building.x - x, building.y - y);
        if (distance >= radius) continue;

        const influence = 1 - distance / radius;
        if (building.owner === 0) playerInfluence = Math.max(playerInfluence, influence);
        else enemyInfluence = Math.max(enemyInfluence, influence);
      }

      const lead = playerInfluence - enemyInfluence;
      if (playerInfluence <= 0 && enemyInfluence <= 0) continue;
      if (Math.abs(lead) < CONTEST_MARGIN) {
        contestedSectors++;
      } else if (lead > 0) {
        playerSectors++;
      } else {
        enemySectors++;
      }
    }
  }

  return {
    playerPercent: landSectors > 0 ? playerSectors / landSectors : 0,
    enemyPercent: landSectors > 0 ? enemySectors / landSectors : 0,
    playerSectors,
    enemySectors,
    contestedSectors,
    landSectors,
  };
}

function resetDominance(scene: MainScene): void {
  scene.dominanceProgress = 0;
  scene.playerTerritoryPercent = 0;
}

/** Run once per progression second. */
export function checkSpatialDominance(scene: MainScene): void {
  if (scene.gameResult !== GameResult.PLAYING) return;

  // Infinite Realm has no finite denominator, so a percentage-of-map victory
  // is undefined there. Conquest remains available.
  if (scene.mapMode !== MapMode.FIXED) {
    resetDominance(scene);
    return;
  }

  const living = scene.buildings.getChildren().filter(building => building.getData('hp') > 0);
  const playerExpansionBuildings = living.filter(building => {
    if (building.getData('owner') !== 0) return false;
    const type = building.getData('def')?.type as BuildingType | undefined;
    return type !== BuildingType.TOWN_CENTER && type !== BuildingType.BONFIRE;
  });

  // Keep the existing minimum-investment guard, but it is no longer the thing
  // that determines territory share.
  if (playerExpansionBuildings.length < DOMINANCE_MIN_BUILDINGS) {
    resetDominance(scene);
    return;
  }

  const snapshots: DominanceBuildingSnapshot[] = living.flatMap(building => {
    const type = building.getData('def')?.type as BuildingType | undefined;
    const owner = building.getData('owner') as number;
    if (!type || (owner !== 0 && owner !== 1)) return [];
    const image = building as Phaser.GameObjects.Image;
    return [{ x: image.x, y: image.y, owner, type }];
  });

  const waterLevel = scene.terrainSystem.getWaterLevel();
  const control = calculateDominanceControl({
    mapWidth: scene.mapWidth,
    mapHeight: scene.mapHeight,
    buildings: snapshots,
    isLand: (x, y) => scene.terrainSystem.getHeightAt(x, y) > waterLevel,
  });

  scene.playerTerritoryPercent = control.playerPercent;

  if (control.playerPercent < DOMINANCE_CONTROL_THRESHOLD) {
    scene.dominanceProgress = 0;
    return;
  }

  scene.dominanceProgress += 1000;
  if (scene.dominanceProgress >= DOMINANCE_HOLD_TIME_MS) {
    scene.victoryType = VictoryType.DOMINANCE;
    scene.gameResult = GameResult.WON;
    scene.feedbackSystem.addNotification('🏆 Dominance Victory! You control the realm!', 'success', 30000);
    return;
  }

  const halfway = DOMINANCE_HOLD_TIME_MS * 0.5;
  if (scene.dominanceProgress >= halfway && scene.dominanceProgress < halfway + 1000) {
    const secondsRemaining = Math.ceil((DOMINANCE_HOLD_TIME_MS - scene.dominanceProgress) / 1000);
    scene.feedbackSystem.addNotification(
      `⚠️ Dominance: ${secondsRemaining} seconds until victory!`,
      'warning',
      5000,
    );
  }
}
