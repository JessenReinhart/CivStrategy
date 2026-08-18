import type { MainScene } from '../MainScene';

/**
 * Capabilities consumed by the simulation coordinator.
 *
 * This is deliberately an adapter boundary for the first extraction pass.
 * The implementations remain the existing scene-owned systems, but the
 * runtime can now depend on a small service surface instead of reaching into
 * arbitrary MainScene state.
 */
export interface SimulationServices {
  readonly spatial: {
    readonly unitCount: () => number;
    updateUnitSpatialHash(): void;
  };

  readonly villagers: {
    update(time: number, delta: number): void;
  };

  readonly animals: {
    update(time: number, delta: number): void;
  };

  readonly liquidCombat: {
    precompute(): void;
  };

  readonly units: {
    update(time: number, delta: number): void;
  };

  readonly squads: {
    syncPositions(): void;
    update(delta: number): void;
  };
}

/**
 * Temporary scene adapter. Keeping this conversion in one place makes the
 * next step mechanical: each capability can be moved out of MainScene and
 * replaced independently without changing SimulationRuntime.
 */
export function createSimulationServices(scene: MainScene): SimulationServices {
  return {
    spatial: {
      unitCount: () => scene.units.getLength(),
      updateUnitSpatialHash: () => scene.updateUnitSpatialHash(),
    },
    villagers: scene.villagerSystem,
    animals: scene.animalSystem,
    liquidCombat: scene.liquidCombat,
    units: scene.unitSystem,
    squads: scene.squadSystem,
  };
}
