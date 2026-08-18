import { MainScene } from '../MainScene';

/**
 * Coordinates the per-frame simulation pipeline.
 *
 * MainScene remains the Phaser lifecycle owner, but simulation ordering lives
 * here so the scene does not also have to know how individual gameplay systems
 * are sequenced. The order is intentional: spatial data → world actors →
 * liquid combat pressure → unit simulation → squad presentation.
 */
export class SimulationRuntime {
  constructor(private readonly scene: MainScene) {}

  update(gameTime: number, dt: number, profile: (label: string, work: () => void) => void): void {
    const scene = this.scene;

    profile('updateUnitSpatialHash', () => {
      if (!scene.stressTestConfig || scene.units.getLength() < 2000) {
        scene.updateUnitSpatialHash();
      }
    });

    profile('villagerSystem', () => {
      scene.villagerSystem.update(gameTime, dt);
    });

    profile('animalSystem', () => {
      scene.animalSystem.update(gameTime, dt);
    });

    // Liquid combat must see fresh spatial data before the unit bucket pass.
    profile('liquidCombat', () => {
      scene.liquidCombat.precompute();
    });

    profile('unitSystem', () => {
      scene.unitSystem.update(gameTime, dt);
    });

    profile('squadSyncPositions', () => {
      scene.squadSystem.syncPositions();
    });

    profile('squadSystem', () => {
      scene.squadSystem.update(dt);
    });
  }
}
