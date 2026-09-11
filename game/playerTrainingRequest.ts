import { BuildingType } from '../types';

export interface PlayerTrainingRequest {
  population: number;
  maxPopulation: number;
  onPopulationCap: () => void;
  train: () => void;
}

export interface TrainingBuildingSelection {
  active?: boolean;
  getData: (key: string) => unknown;
}

/**
 * Keeps the population-cap invariant at the synchronous player request boundary.
 * This prevents multiple rapid training requests from relying on delayed UI stats.
 */
export function handlePlayerTrainingRequest(request: PlayerTrainingRequest): boolean {
  if (request.population >= request.maxPopulation) {
    request.onPopulationCap();
    return false;
  }

  request.train();
  return true;
}

/**
 * A selected Barracks is only a valid fast-path source while the Phaser object
 * is still active. Destroyed buildings can remain referenced by InputManager
 * after combat or demolition, but training must fall back to a live player
 * Barracks instead of spawning from that stale object.
 */
export function getPlayerTrainingSelectedBuilding<T extends TrainingBuildingSelection>(
  selectedBuilding: T | null,
): T | null {
  if (!selectedBuilding || selectedBuilding.active === false) return null;

  const definition = selectedBuilding.getData('def') as { type?: BuildingType } | undefined;
  const owner = selectedBuilding.getData('owner');

  return definition?.type === BuildingType.BARRACKS && owner === 0
    ? selectedBuilding
    : null;
}