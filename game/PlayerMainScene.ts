import { UnitType } from '../types';
import { MainScene } from './MainScene';
import { handlePlayerTrainingRequest } from './playerTrainingRequest';

export class PlayerMainScene extends MainScene {
  override handleUnitSpawnRequest(type: UnitType): void {
    handlePlayerTrainingRequest({
      population: this.population,
      maxPopulation: this.maxPopulation,
      onPopulationCap: () => {
        this.feedbackSystem.showFloatingText(
          this.cameras.main.worldView.centerX,
          this.cameras.main.worldView.centerY,
          'Population cap reached! Build a House.',
          '#ff6b6b',
        );
      },
      train: () => super.handleUnitSpawnRequest(type),
    });
  }
}
