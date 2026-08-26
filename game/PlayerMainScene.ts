import { UnitType } from '../types';
import { MainScene } from './MainScene';
import { handlePlayerTrainingRequest } from './playerTrainingRequest';

export class PlayerMainScene extends MainScene {
  private worldBootstrapReady = false;
  private readonly suppressAssetCompletion = (event: Event): void => {
    event.stopImmediatePropagation();
  };

  override preload(): void {
    // MainScene historically reports `game-load-complete` when Phaser assets
    // finish loading. World generation happens later in create(), so that event
    // hides the loading UI too early on large maps. Capture the asset-only
    // completion and publish the same public event after the world is ready.
    window.addEventListener('game-load-complete', this.suppressAssetCompletion, { capture: true });
    super.preload();
  }

  override create(): void {
    // Let React paint the loading screen once after asset loading before the
    // synchronous world bootstrap begins. The update loop stays dormant until
    // MainScene.create() has initialized every gameplay system.
    window.dispatchEvent(new CustomEvent('game-load-progress', { detail: 0.2 }));

    requestAnimationFrame(() => {
      try {
        super.create();
        this.worldBootstrapReady = true;
        window.dispatchEvent(new CustomEvent('game-load-progress', { detail: 1 }));
        window.dispatchEvent(new CustomEvent('game-load-complete'));
      } finally {
        window.removeEventListener('game-load-complete', this.suppressAssetCompletion, { capture: true });
      }
    });
  }

  override update(time: number, delta: number): void {
    if (!this.worldBootstrapReady) return;
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
