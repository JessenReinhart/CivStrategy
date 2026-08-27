import Phaser from 'phaser';

import { MAP_SIZES } from '../../constants';
import { MapMode, MapSize } from '../../types';
import { LoadingWorkProgress, yieldToBrowser } from '../../utils/gameLoading';
import { MainScene } from '../MainScene';
import { Pathfinder } from '../systems/Pathfinder';
import { EntityFactory } from '../systems/EntityFactory';
import { SquadSystem } from '../systems/SquadSystem';
import { UnitSystem } from '../systems/UnitSystem';
import { SpriteGhostBuildingManager } from '../systems/SpriteGhostBuildingManager';
import { EconomySystem } from '../systems/EconomySystem';
import { InputManager } from '../systems/InputManager';
import { ProactiveEnemyAISystem } from '../systems/ProactiveEnemyAISystem';
import { MapGenerationSystem } from '../systems/MapGenerationSystem';
import { CullingSystem } from '../systems/CullingSystem';
import { FeedbackSystem } from '../systems/FeedbackSystem';
import { AtmosphericSystem } from '../systems/AtmosphericSystem';
import { VillagerSystem } from '../systems/VillagerSystem';
import { installVillagerWorkforceInput } from '../systems/VillagerWorkforceInput';
import { AnimalSystem } from '../systems/AnimalSystem';
import { AmbientPopulationSystem } from '../systems/AmbientPopulationSystem';
import { ProceduralSoundSystem } from '../systems/ProceduralSoundSystem';
import { DynamicMusicSystem } from '../systems/DynamicMusicSystem';
import { ClashSystem } from '../systems/ClashSystem';
import { LiquidCombatSystem } from '../systems/LiquidCombatSystem';
import { ResearchManager } from '../systems/ResearchManager';
import { TerrainSystem } from '../systems/TerrainSystem';
import { InfiniteMapSystem } from '../systems/InfiniteMapSystem';
import { SpatialHash } from '../utils/SpatialHash';
import { createSeededRandom } from '../utils/seededRandom';
import { applyAdaptiveTerrainTextureDetailPass } from './AdaptiveTerrainTextureDetailPass';
import { applyAdaptiveTerrainVisuals } from './AdaptiveTerrainVisualBootstrap';
import { installLegacyVillagerSpawnBridge } from './VillagerSpawnBridge';

export interface WorldBootstrapProgress extends LoadingWorkProgress {
  progress: number;
  phase: string;
}

/**
 * Owns the construction and dependency assembly of the world/system layer
 * for MainScene. Keeps behavior identical to the original MainScene.create()
 * ordering: infrastructure → systems → terrain → map bounds.
 *
 * Water rendering, UI/event bindings, save/load, stress-test and profiler
 * setup intentionally remain in MainScene for later decomposition slices.
 */
export class WorldBootstrap {
  constructor(private readonly scene: MainScene) {}

  initialize(): void {
    this.createWorldInfrastructure();
    this.createSystems();
    this.initializeTerrain();
    this.initializeMapBounds();
  }

  async initializeAsync(onProgress?: (progress: WorldBootstrapProgress) => void): Promise<void> {
    this.createWorldInfrastructure();
    onProgress?.({
      progress: 0.04,
      phase: 'Building world systems',
      detail: 'Allocating world layers and spatial indexes',
      processed: 1,
      total: 4,
    });
    await yieldToBrowser();

    this.createSystems();
    onProgress?.({
      progress: 0.10,
      phase: 'Building world systems',
      detail: 'Starting simulation systems',
      processed: 2,
      total: 4,
    });
    await yieldToBrowser();

    await this.initializeTerrainAsync(onProgress);

    this.initializeMapBounds();
    onProgress?.({
      progress: 1,
      phase: 'Terrain ready',
      detail: 'World bounds and pathfinding are ready',
      processed: 4,
      total: 4,
    });
    await yieldToBrowser();
  }

  private createWorldInfrastructure(): void {
    const scene = this.scene;

    scene.pathfinder = new Pathfinder(scene.mapWidth, scene.mapHeight);
    scene.treeSpatialHash = new SpatialHash(250); // 250px cells (approx 1-2 trees width)
    scene.unitSpatialHash = new SpatialHash(150); // 150px cells for unit queries

    // Create World Layer for PostFX
    scene.worldLayer = scene.add.layer();

    scene.groundLayer = scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, 'ground');
    scene.groundLayer.setOrigin(0, 0);
    scene.groundLayer.setDepth(-20000);
    // Green multiply on brown ground tex → grass, not grey dirt
    scene.groundLayer.setTint(0xb4e070);
    scene.worldLayer.add(scene.groundLayer);
    scene.groundLayer.setTileScale(scene.groundScale);

    scene.units = scene.add.group({ runChildUpdate: true });
    // Hook into unit group to maintain spatial hash
    scene.units.on('create', (item: Phaser.GameObjects.GameObject) => scene.unitSpatialHash.insert(item));
    scene.units.on('remove', (item: Phaser.GameObjects.GameObject) => scene.unitSpatialHash.remove(item));
    scene.buildings = scene.add.group();
    scene.trees = scene.add.group();
    scene.treeVisuals = scene.add.group(); // Visual pool
    scene.worldVisuals = scene.add.group(); // General visuals (units, buildings)

    // Hook into tree group to maintain spatial hash
    scene.trees.on('create', (item: Phaser.GameObjects.GameObject) => scene.treeSpatialHash.insert(item));
    scene.trees.on('remove', (item: Phaser.GameObjects.GameObject) => scene.treeSpatialHash.remove(item));
  }

  private createSystems(): void {
    const scene = this.scene;

    scene.entityFactory = new EntityFactory(scene);
    scene.squadSystem = new SquadSystem(scene);
    scene.unitSystem = new UnitSystem(scene);
    scene.buildingManager = new SpriteGhostBuildingManager(scene);
    scene.economySystem = new EconomySystem(scene);
    scene.inputManager = new InputManager(scene);
    scene.enemyAI = new ProactiveEnemyAISystem(scene);

    const mapRng = createSeededRandom(scene.mapSeed);
    scene.mapGenerationSystem = new MapGenerationSystem(scene, mapRng);

    scene.cullingSystem = new CullingSystem(scene);
    scene.feedbackSystem = new FeedbackSystem(scene);
    scene.atmosphericSystem = new AtmosphericSystem(scene);
    scene.villagerSystem = new VillagerSystem(scene);
    installLegacyVillagerSpawnBridge(scene);
    installVillagerWorkforceInput(scene);
    scene.animalSystem = new AnimalSystem(scene);
    // Render-only civilian crowd. It self-registers with scene UPDATE/SHUTDOWN
    // and never enters the units group, physics, spatial hash, or pathfinder.
    new AmbientPopulationSystem(scene);
    scene.proceduralSound = new ProceduralSoundSystem(scene);
    new DynamicMusicSystem(scene);
    scene.clashSystem = new ClashSystem(scene);
    scene.liquidCombat = new LiquidCombatSystem(scene);
    scene.researchManager = new ResearchManager(scene);

    scene.terrainSystem = new TerrainSystem(scene, scene.mapWidth, scene.mapHeight, scene.mapSeed, scene.mapPreset);
  }

  private initializeTerrain(): void {
    const scene = this.scene;

    scene.terrainSystem.generateHeightMap();
    this.prepareTerrainSpawnAreas();
    scene.terrainSystem.generateTerrainTexture();
    applyAdaptiveTerrainVisuals(scene);
    applyAdaptiveTerrainTextureDetailPass(scene);
  }

  private async initializeTerrainAsync(onProgress?: (progress: WorldBootstrapProgress) => void): Promise<void> {
    const scene = this.scene;
    const subProgress = (progress: LoadingWorkProgress) => {
      onProgress?.({
        ...progress,
        progress: 0.10 + progress.progress * 0.86,
      });
    };

    await scene.terrainSystem.generateHeightMapAsync(subProgress);
    await this.prepareTerrainSpawnAreasAsync(subProgress);
    await scene.terrainSystem.generateTerrainTextureAsync(subProgress);
    applyAdaptiveTerrainVisuals(scene);
    await yieldToBrowser();
    await applyAdaptiveTerrainTextureDetailPass(scene, subProgress);
  }

  private initializeMapBounds(): void {
    const scene = this.scene;
    if (scene.mapMode === MapMode.INFINITE) {
      scene.infiniteMapSystem = new InfiniteMapSystem(scene, scene.mapSeed);
      scene.infiniteMapSystem.init();
      return;
    }

    const bounds = MAP_SIZES[scene.mapSize as MapSize] ?? MAP_SIZES[MapSize.MEDIUM];
    scene.physics.world.setBounds(0, 0, bounds.width, bounds.height);
    scene.cameras.main.setBounds(0, 0, bounds.width, bounds.height);
  }

  private prepareTerrainSpawnAreas(): void {
    this.scene.mapGenerationSystem.prepareSpawnAreas();
  }

  private async prepareTerrainSpawnAreasAsync(onProgress?: (progress: LoadingWorkProgress) => void): Promise<void> {
    await this.scene.mapGenerationSystem.prepareSpawnAreasAsync(onProgress);
  }
}
