import type { SimulationContext } from './SimulationContext';
import { createSimulationServices } from './SimulationServices';
import type { MainScene } from '../MainScene';

/**
 * Coordinates the per-frame simulation pipeline.
 *
 * The runtime only consumes SimulationContext. MainScene is referenced solely
 * by the temporary adapter used while the scene is being dismantled.
 */
export class SimulationRuntime {
  update(
    scene: MainScene,
    gameTime: number,
    dt: number,
    profile: (label: string, work: () => void) => void,
  ): void {
    this.updateContext({
      services: createSimulationServices(scene),
      now: gameTime,
      dt,
      profile,
    });
  }

  updateContext(context: SimulationContext): void {
    const { services, now, dt, profile } = context;

    profile('updateUnitSpatialHash', () => {
      if (services.spatial.unitCount() < 2000) {
        services.spatial.updateUnitSpatialHash();
      }
    });

    profile('villagerSystem', () => {
      services.villagers.update(now, dt);
    });

    profile('animalSystem', () => {
      services.animals.update(now, dt);
    });

    // Liquid combat must see fresh spatial data before the unit bucket pass.
    profile('liquidCombat', () => {
      services.liquidCombat.precompute();
    });

    profile('unitSystem', () => {
      services.units.update(now, dt);
    });

    profile('squadSyncPositions', () => {
      services.squads.syncPositions();
    });

    profile('squadSystem', () => {
      services.squads.update(dt);
    });
  }
}
