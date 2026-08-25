import Phaser from 'phaser';

import { MainScene } from '../MainScene';
import { Pathfinder } from '../systems/Pathfinder';
import { EntityFactory } from '../systems/EntityFactory';
import { SquadSystem } from '../systems/SquadSystem';
import { UnitSystem } from '../systems/UnitSystem';
import { SpriteGhostBuildingManager } from '../systems/SpriteGhostBuildingManager';
import { EconomySystem } from '../systems/EconomySystem';
import { InputManager } from '../systems/InputManager';
import { EnemyAISystem } from '../systems/EnemyAISystem';
import { MapGenerationSystem } from '../systems/MapGenerationSystem';
import { CullingSystem } from '../systems/CullingSystem';
import { FeedbackSystem } from '../systems/FeedbackSystem';
import { AtmosphericSystem } from '../systems/AtmosphericSystem';
import { VillagerSystem } from '../systems/VillagerSystem';
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
import { MapMode } from '../../types';
import { installLegacyVillagerSpawnBridge } from './VillagerSpawnBridge';

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
    scene.enemyAI = new EnemyAISystem(scene);

    const mapRng = createSeededRandom(scene.mapSeed);
    scene.mapGenerationSystem = new MapGenerationSystem(scene, mapRng);

    scene.cullingSystem = new CullingSystem(scene);
    scene.feedbackSystem = new FeedbackSystem(scene);
    scene.atmosphericSystem = new AtmosphericSystem(scene);
    scene.villagerSystem = new VillagerSystem(scene);
    installLegacyVillagerSpawnBridge(scene);
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

    // Guarantee dry land at faction spawn points — raise terrain above water
    const spawnSafeRadius = 150;
    const spawnMinHeight = scene.terrainSystem.getWaterLevel() + 0.05;
    const cx = scene.mapWidth / 2;
    const cy = scene.mapHeight / 2;
    scene.terrainSystem.flattenAroundWorld(cx, cy, spawnSafeRadius, spawnMinHeight);
    // Flatten AI base corner
    const aiBaseX = scene.mapWidth * 0.15;
    const aiBaseY = scene.mapHeight * 0.15;
    scene.terrainSystem.flattenAroundWorld(aiBaseX, aiBaseY, spawnSafeRadius, spawnMinHeight);
    scene.terrainSystem.flattenAroundWorld(cx + 400, cy - 50, spawnSafeRadius, spawnMinHeight);
    // Generate rivers that follow low terrain valleys (natural chokepoints)
    scene.terrainSystem.generateRivers();
    scene.terrainSystem.applyVisualTinting();
    // Wire biome pathfinding costs to terrain
    scene.pathfinder.updateTerrainCosts(scene.terrainSystem, scene.currentSeason);
  }

  private initializeMapBounds(): void {
    const scene = this.scene;

    if (scene.mapMode === MapMode.FIXED) {
      scene.physics.world.setBounds(0, 0, scene.mapWidth, scene.mapHeight);
      // Water rendering + map environment generation remain in MainScene.create()
      // (they are part of the future WaterRenderer slice).
    } else {
      scene.physics.world.setBounds(-100000, -100000, 200000, 200000);
      scene.infiniteMapSystem = new InfiniteMapSystem(scene);
    }
  }
}
