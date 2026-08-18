import type { MainScene } from '../MainScene';
import { createSimulationContext, type SimulationContext } from './SimulationContext';

/**
 * Coordinates the per-frame simulation pipeline.
 *
 * The runtime now receives a SimulationContext instead of owning the scene
 * reference directly. The context is the migration seam that lets us narrow
 * dependencies as individual systems are extracted from MainScene.
 */
export class SimulationRuntime {
  update(
    scene: MainScene,
    gameTime: number,
    dt: number,
    profile: (label: string, work: () => void) => void,
  ): void {
    this.updateContext(createSimulationContext(scene, gameTime, dt, profile));
  }

  updateContext(context: SimulationContext): void {
    const { scene, now, dt, profile } = context;

    profile('updateUnitSpatialHash', () => {
      if (!scene.stressTestConfig || scene.units.getLength() < 2000) {
        scene.updateUnitSpatialHash();
      }
    });

    profile('villagerSystem', () => {
      scene.villagerSystem.update(now, dt);
    });

    profile('animalSystem', () => {
      scene.animalSystem.update(now, dt);
    });

    // Liquid combat must see fresh spatial data before the unit bucket pass.
    profile('liquidCombat', () => {
      scene.liquidCombat.precompute();
    });

    profile('unitSystem', () => {
      scene.unitSystem.update(now, dt);
    });

    profile('squadSyncPositions', () => {
      scene.squadSystem.syncPositions();
    });

    profile('squadSystem', () => {
      scene.squadSystem.update(dt);
    });
  }
}
