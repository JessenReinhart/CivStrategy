import {
  DOMINANCE_CONTROL_THRESHOLD,
  DOMINANCE_HOLD_TIME_MS,
  DOMINANCE_MIN_BUILDINGS,
  MAP_PRESETS,
} from '../../constants';
import { BuildingType, GameResult, MapMode, VictoryType } from '../../types';
import type { MainScene } from '../MainScene';

const DOMINANCE_SAMPLE_SIZE = 128;
const DEFAULT_BUILDING_INFLUENCE_RADIUS = 256;
const DISTANCE_TIE_EPSILON = 0.0001;

type InfluenceBuilding = {
  x: number;
  y: number;
  getData(key: string): unknown;
};

type BuildingDefinition = {
  type?: BuildingType;
  territoryRadius?: number;
};

function resetDominance(scene: MainScene): void {
  scene.dominanceProgress = 0;
  scene.playerTerritoryPercent = 0;
}

function getBuildingInfluenceRadius(building: InfluenceBuilding): number {
  const def = building.getData('def') as BuildingDefinition | undefined;
  return Math.max(def?.territoryRadius ?? 0, DEFAULT_BUILDING_INFLUENCE_RADIUS);
}

/**
 * Measures finite-map territorial dominance using unique land samples rather
 * than building counts. Overlapping structures therefore cannot multiply the
 * same patch of control, and water never inflates the controllable denominator.
 */
export function checkSpatialDominance(scene: MainScene): void {
  if (scene.gameResult !== GameResult.PLAYING) return;

  if (scene.mapMode === MapMode.INFINITE) {
    resetDominance(scene);
    return;
  }

  // Progression can be exercised by lightweight bridge hosts before world groups
  // exist. An incomplete world must never be able to advance a victory state.
  const buildingGroup = scene.buildings;
  if (!buildingGroup) {
    resetDominance(scene);
    return;
  }

  const buildings = (buildingGroup.getChildren() as unknown as InfluenceBuilding[]).filter((building) => {
    const owner = building.getData('owner');
    const hp = building.getData('hp');
    return (owner === 0 || owner === 1) && typeof hp === 'number' && hp > 0;
  });

  if (buildings.length === 0) {
    resetDominance(scene);
    return;
  }

  // Preserve the existing anti-rush gate: geographical control only becomes a
  // victory condition after the realm contains enough non-Town-Center expansion.
  const expansionBuildingCount = buildings.filter((building) => {
    const def = building.getData('def') as BuildingDefinition | undefined;
    return def?.type !== BuildingType.TOWN_CENTER;
  }).length;
  if (expansionBuildingCount < DOMINANCE_MIN_BUILDINGS) {
    resetDominance(scene);
    return;
  }

  const cols = Math.max(1, Math.ceil(scene.mapWidth / DOMINANCE_SAMPLE_SIZE));
  const rows = Math.max(1, Math.ceil(scene.mapHeight / DOMINANCE_SAMPLE_SIZE));
  const sampleCount = cols * rows;
  const land = new Uint8Array(sampleCount);
  const ownerBySample = new Int8Array(sampleCount);
  ownerBySample.fill(-1);
  const nearestDistanceSq = new Float64Array(sampleCount);
  nearestDistanceSq.fill(Number.POSITIVE_INFINITY);

  const waterLevel = MAP_PRESETS[scene.mapPreset].waterLevel;
  let landSamples = 0;

  for (let gy = 0; gy < rows; gy++) {
    const y = Math.min(scene.mapHeight - 1, gy * DOMINANCE_SAMPLE_SIZE + DOMINANCE_SAMPLE_SIZE / 2);
    for (let gx = 0; gx < cols; gx++) {
      const x = Math.min(scene.mapWidth - 1, gx * DOMINANCE_SAMPLE_SIZE + DOMINANCE_SAMPLE_SIZE / 2);
      const index = gy * cols + gx;
      if (scene.terrainSystem.getHeightAt(x, y) < waterLevel) continue;
      land[index] = 1;
      landSamples++;
    }
  }

  if (landSamples === 0) {
    resetDominance(scene);
    return;
  }

  for (const building of buildings) {
    const owner = building.getData('owner') as 0 | 1;
    const radius = getBuildingInfluenceRadius(building);
    const radiusSq = radius * radius;
    const minGX = Math.max(0, Math.floor((building.x - radius) / DOMINANCE_SAMPLE_SIZE));
    const maxGX = Math.min(cols - 1, Math.floor((building.x + radius) / DOMINANCE_SAMPLE_SIZE));
    const minGY = Math.max(0, Math.floor((building.y - radius) / DOMINANCE_SAMPLE_SIZE));
    const maxGY = Math.min(rows - 1, Math.floor((building.y + radius) / DOMINANCE_SAMPLE_SIZE));

    for (let gy = minGY; gy <= maxGY; gy++) {
      const y = Math.min(scene.mapHeight - 1, gy * DOMINANCE_SAMPLE_SIZE + DOMINANCE_SAMPLE_SIZE / 2);
      for (let gx = minGX; gx <= maxGX; gx++) {
        const index = gy * cols + gx;
        if (!land[index]) continue;

        const x = Math.min(scene.mapWidth - 1, gx * DOMINANCE_SAMPLE_SIZE + DOMINANCE_SAMPLE_SIZE / 2);
        const dx = x - building.x;
        const dy = y - building.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > radiusSq) continue;

        const nearest = nearestDistanceSq[index];
        if (distanceSq + DISTANCE_TIE_EPSILON < nearest) {
          nearestDistanceSq[index] = distanceSq;
          ownerBySample[index] = owner;
        } else if (
          Math.abs(distanceSq - nearest) <= DISTANCE_TIE_EPSILON &&
          ownerBySample[index] !== owner
        ) {
          ownerBySample[index] = -1;
        }
      }
    }
  }

  let playerControlledSamples = 0;
  for (let index = 0; index < sampleCount; index++) {
    if (land[index] && ownerBySample[index] === 0) playerControlledSamples++;
  }

  scene.playerTerritoryPercent = playerControlledSamples / landSamples;

  if (scene.playerTerritoryPercent < DOMINANCE_CONTROL_THRESHOLD) {
    scene.dominanceProgress = 0;
    return;
  }

  scene.dominanceProgress += 1000;
  if (scene.dominanceProgress >= DOMINANCE_HOLD_TIME_MS) {
    scene.victoryType = VictoryType.DOMINANCE;
    scene.gameResult = GameResult.WON;
    scene.feedbackSystem.addNotification('🏆 Dominance Victory! You control the realm!', 'success', 30000);
  } else if (
    scene.dominanceProgress >= DOMINANCE_HOLD_TIME_MS * 0.5 &&
    scene.dominanceProgress < DOMINANCE_HOLD_TIME_MS * 0.5 + 1000
  ) {
    scene.feedbackSystem.addNotification('⚠️ Dominance: 30 seconds until victory!', 'warning', 5000);
  }
}
