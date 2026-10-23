import type { AmbientPopulationSystem } from '../systems/AmbientPopulationSystem';
import type { AnimalSystem } from '../systems/AnimalSystem';
import type { AtmosphericSystem } from '../systems/AtmosphericSystem';
import type { BuildingManager } from '../systems/BuildingManager';
import type { ClashSystem } from '../systems/ClashSystem';
import type { CullingSystem } from '../systems/CullingSystem';
import type { DayNightSystem } from '../systems/DayNightSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { EnemyAISystem } from '../systems/EnemyAISystem';
import type { EntityFactory } from '../systems/EntityFactory';
import type { FeedbackSystem } from '../systems/FeedbackSystem';
import type { FogOfWarSystem } from '../systems/FogOfWarSystem';
import type { InfiniteMapSystem } from '../systems/InfiniteMapSystem';
import type { InputManager } from '../systems/InputManager';
import type { LiquidCombatSystem } from '../systems/LiquidCombatSystem';
import type { MapGenerationSystem } from '../systems/MapGenerationSystem';
import type { MinimapSystem } from '../systems/MinimapSystem';
import type { Pathfinder } from '../systems/Pathfinder';
import type { ProceduralSoundSystem } from '../systems/ProceduralSoundSystem';
import type { ResearchManager } from '../systems/ResearchManager';
import type { SquadSystem } from '../systems/SquadSystem';
import type { TerrainSystem } from '../systems/TerrainSystem';
import type { UnitSystem } from '../systems/UnitSystem';
import type { VillagerSystem } from '../systems/VillagerSystem';

/**
 * Owns the runtime system instances that MainScene previously declared as
 * scattered public fields (Phase 8, A1).
 *
 * Backing fields are assigned by MainScene and its bootstrap passes during
 * `create()`; getters expose them to the rest of the simulation.
 */
export class SystemRegistry {
  public pathfinder: Pathfinder = undefined!;
  public entityFactory: EntityFactory = undefined!;
  public economySystem: EconomySystem = undefined!;
  public unitSystem: UnitSystem = undefined!;
  public buildingManager: BuildingManager = undefined!;
  public inputManager: InputManager = undefined!;
  public infiniteMapSystem: InfiniteMapSystem = undefined!;
  public fogOfWar: FogOfWarSystem | null = null;
  public enemyAI: EnemyAISystem = undefined!;
  public minimapSystem: MinimapSystem = undefined!;
  public squadSystem: SquadSystem = undefined!;
  public mapGenerationSystem: MapGenerationSystem = undefined!;
  public cullingSystem: CullingSystem = undefined!;
  public feedbackSystem: FeedbackSystem = undefined!;
  public atmosphericSystem: AtmosphericSystem = undefined!;
  public dayNightSystem: DayNightSystem = undefined!;
  public villagerSystem: VillagerSystem = undefined!;
  public animalSystem: AnimalSystem = undefined!;
  public proceduralSound: ProceduralSoundSystem = undefined!;
  public ambientSystem: AmbientPopulationSystem = undefined!;
  public clashSystem: ClashSystem = undefined!;
  public terrainSystem: TerrainSystem = undefined!;
  public researchManager: ResearchManager = undefined!;
  public liquidCombat: LiquidCombatSystem = undefined!;

  public getPathfinder(): Pathfinder { return this.pathfinder; }
  public getEntityFactory(): EntityFactory { return this.entityFactory; }
  public getEconomySystem(): EconomySystem { return this.economySystem; }
  public getUnitSystem(): UnitSystem { return this.unitSystem; }
  public getBuildingManager(): BuildingManager { return this.buildingManager; }
  public getInputManager(): InputManager { return this.inputManager; }
  public getInfiniteMapSystem(): InfiniteMapSystem { return this.infiniteMapSystem; }
  public getFogOfWar(): FogOfWarSystem | null { return this.fogOfWar; }
  public getEnemyAI(): EnemyAISystem { return this.enemyAI; }
  public getMinimapSystem(): MinimapSystem { return this.minimapSystem; }
  public getSquadSystem(): SquadSystem { return this.squadSystem; }
  public getMapGenerationSystem(): MapGenerationSystem { return this.mapGenerationSystem; }
  public getCullingSystem(): CullingSystem { return this.cullingSystem; }
  public getFeedbackSystem(): FeedbackSystem { return this.feedbackSystem; }
  public getAtmosphericSystem(): AtmosphericSystem { return this.atmosphericSystem; }
  public getDayNightSystem(): DayNightSystem { return this.dayNightSystem; }
  public getVillagerSystem(): VillagerSystem { return this.villagerSystem; }
  public getAnimalSystem(): AnimalSystem { return this.animalSystem; }
  public getProceduralSound(): ProceduralSoundSystem { return this.proceduralSound; }
  public getAmbientSystem(): AmbientPopulationSystem { return this.ambientSystem; }
  public getClashSystem(): ClashSystem { return this.clashSystem; }
  public getTerrainSystem(): TerrainSystem { return this.terrainSystem; }
  public getResearchManager(): ResearchManager { return this.researchManager; }
  public getLiquidCombat(): LiquidCombatSystem { return this.liquidCombat; }
}
