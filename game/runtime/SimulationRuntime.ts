import type { SimulationContext } from './SimulationContext';

/** Coordinates the per-frame simulation pipeline without depending on MainScene. */
export class SimulationRuntime {
  update(context: SimulationContext): void {
    const { services, now, dt, profile } = context;

    if (services.spatial.shouldUpdate) {
      profile('updateUnitSpatialHash', () => {
        services.spatial.updateUnitSpatialHash();
      });
    }

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
