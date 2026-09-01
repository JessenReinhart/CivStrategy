import { UnitType } from '../types';
import { createGameLoadFailureDetail, dispatchGameLoadProgress } from '../utils/gameLoading';
import { bootstrapPlayerScene } from './bootstrap/PlayerSceneBootstrap';
import { MainScene } from './MainScene';
import { handlePlayerTrainingRequest } from './playerTrainingRequest';
import { treatyMinutesToMilliseconds } from './treatyDuration';

export class PlayerMainScene extends MainScene {
  override init(data: Parameters<MainScene['init']>[0]): void {
    super.init(data);
    // Match setup's public contract: treatyLength is supplied in minutes,
    // while combat systems consume the live scene value in milliseconds.
    this.treatyLength = treatyMinutesToMilliseconds(data.treatyLength);
  }

  override create(): void {
    // React owns the loading UI. Rendering the half-built Phaser world during
    // every cooperative yield wastes the main thread and can freeze low-memory
    // browsers even though generation itself is time-sliced. Keep this scene
    // out of the render pass until bootstrap has completed.
    this.scene.setVisible(false);

    void bootstrapPlayerScene(this)
      .then(() => {
        this.scene.setVisible(true);
      })
      .catch((error: unknown) => {
        console.error('[PlayerMainScene] World bootstrap failed:', error);
        dispatchGameLoadProgress(createGameLoadFailureDetail(error));
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
