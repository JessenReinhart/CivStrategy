import { UnitType } from '../types';
import { MainScene } from './MainScene';

export class PlayerMainScene extends MainScene {
  override handleUnitSpawnRequest(type: UnitType): void {
    if (this.population >= this.maxPopulation) {
      this.feedbackSystem.showFloatingText(
        this.cameras.main.worldView.centerX,
        this.cameras.main.worldView.centerY,
        'Population cap reached! Build a House.',
        '#ff6b6b',
      );
      return;
    }

    super.handleUnitSpawnRequest(type);
  }
}
