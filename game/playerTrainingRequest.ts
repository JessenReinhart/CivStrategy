export interface PlayerTrainingRequest {
  population: number;
  maxPopulation: number;
  onPopulationCap: () => void;
  train: () => void;
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
