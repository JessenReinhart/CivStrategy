import { UnitType } from '../types';
import { dispatchGameLoadProgress } from '../utils/gameLoading';
import { bootstrapPlayerScene } from './bootstrap/PlayerSceneBootstrap';
import { MainScene } from './MainScene';
import { handlePlayerTrainingRequest } from './playerTrainingRequest';

export class PlayerMainScene extends MainScene {
  override create(): void {
    void bootstrapPlayerScene(this).catch((error: unknown) => {
      console.error('[PlayerMainScene] World bootstrap failed:', error);
      dispatchGameLoadProgress({
        progress: 0.99,
        phase: 'World generation failed',
        detail: error instanceof Error ? error.message : 'Unexpected startup error',
      });
    });
  }

  override update(time: number, delta: number): void {
    // Phaser does not await an async create lifecycle. Keep the simulation
    // dormant while cooperative bootstrap yields to the browser.
    if (!this.isReady) return;
    super.update(time, delta);
  }

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
