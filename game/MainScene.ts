
import Phaser from 'phaser';
import groundImg from '../assets/textures/ground.jpg';
import fieldImg from '../assets/textures/field.png';
import lumberImg from '../assets/textures/lumber.png';
import townhallImg from '../assets/textures/townhall.png';
import flareImg from '../assets/textures/flare.png';
import treeImg from '../assets/textures/tree.png';
import stumpImg from '../assets/textures/stump.png';
import houseImg from '../assets/textures/house.png';
import lodgeImg from '../assets/textures/lodge.png';
import smokeImg from '../assets/textures/smoke.png';
import { EVENTS, INITIAL_RESOURCES, MAP_SIZES, FACTION_COLORS, AGE_CONFIGS, getNextAge, TERRAIN_CONFIG } from '../constants';
import { BuildingType, FactionType, Resources, UnitType, MapMode, MapSize, FormationType, UnitStance, Age, GameStats } from '../types';
import { toIso } from './utils/iso';
import { SpatialHash } from './utils/SpatialHash';
import { Pathfinder } from './systems/Pathfinder';
import { EntityFactory } from './systems/EntityFactory';
import { EconomySystem } from './systems/EconomySystem';
import { UnitSystem } from './systems/UnitSystem';
import { BuildingManager } from './systems/BuildingManager';
import { InputManager } from './systems/InputManager';
import { InfiniteMapSystem } from './systems/InfiniteMapSystem';
import { FogOfWarSystem } from './systems/FogOfWarSystem';
import { EnemyAISystem } from './systems/EnemyAISystem';
import { MinimapSystem } from './systems/MinimapSystem';
import { SquadSystem } from './systems/SquadSystem';
import { MapGenerationSystem } from './systems/MapGenerationSystem';
import { CullingSystem } from './systems/CullingSystem';
import { FeedbackSystem } from './systems/FeedbackSystem';
import { AtmosphericSystem } from './systems/AtmosphericSystem';
import { VillagerSystem } from './systems/VillagerSystem';
import { AnimalSystem } from './systems/AnimalSystem';
import { ProceduralSoundSystem } from './systems/ProceduralSoundSystem';
import { ClashSystem } from './systems/ClashSystem';
import { TerrainSystem } from './systems/TerrainSystem';

export class MainScene extends Phaser.Scene {


  // Game State
  public resources: Resources = { ...INITIAL_RESOURCES };
  public population = 0;
  public maxPopulation = 10;
  public happiness = 100;
  public faction: FactionType = FactionType.ROMANS;
  public enemyFaction: FactionType = FactionType.GAULS; // Default Fallback
  public mapMode: MapMode = MapMode.FIXED;
  public mapWidth: number = 2048;
  public mapHeight: number = 2048;
  public taxRate: number = 0;
  public bloomIntensity: number = 1.0;
  public isFowEnabled: boolean = true;

  // Age System
  public currentAge: Age = Age.VILLAGE;
  public ageProgress: number = 0; // 0–1 during advancement
  public isAdvancing: boolean = false;
  public nextAge: Age | null = null;

  // Diplomacy
  public peacefulMode: boolean = false;
  public treatyLength: number = 0; // ms
  public aiDisabled: boolean = false;

  // Debug
  public debugMode: boolean = false;
  public showUnitIndicators: boolean = true;
  private debugText!: Phaser.GameObjects.Text;

  // Game Speed & Time
  public gameSpeed: number = 0.5;
  public gameTime: number = 0;
  private accumulatedTime: number = 0;
  private accumulatedPopTime: number = 0;

  // Core Groups
  public units!: Phaser.GameObjects.Group;
  public buildings!: Phaser.GameObjects.Group;
  public trees!: Phaser.GameObjects.Group;
  public fertileZones: Phaser.Geom.Circle[] = [];

  // Rendering Layer (for PostFX)
  public worldLayer!: Phaser.GameObjects.Layer;

  // Ground Layer
  private groundLayer!: Phaser.GameObjects.TileSprite;
  private readonly groundScale = 0.08;

  // Systems
  public pathfinder!: Pathfinder;
  public treeSpatialHash!: SpatialHash;
  public unitSpatialHash!: SpatialHash;
  public entityFactory!: EntityFactory;
  public economySystem!: EconomySystem;
  public unitSystem!: UnitSystem;
  public buildingManager!: BuildingManager;
  public inputManager!: InputManager;
  public infiniteMapSystem!: InfiniteMapSystem;
  public fogOfWar!: FogOfWarSystem | null;
  public enemyAI!: EnemyAISystem;
  public minimapSystem!: MinimapSystem;
  public squadSystem!: SquadSystem;
  public mapGenerationSystem!: MapGenerationSystem;
  public cullingSystem!: CullingSystem;
  public feedbackSystem!: FeedbackSystem;
  public atmosphericSystem!: AtmosphericSystem;
  public villagerSystem!: VillagerSystem;
  public animalSystem!: AnimalSystem;
  public proceduralSound!: ProceduralSoundSystem;
  public clashSystem!: ClashSystem;
  public terrainSystem!: TerrainSystem;
  // Water layer (FIXED map only). Null in INFINITE mode so update() no-ops.
  private waterRT: Phaser.GameObjects.RenderTexture | null = null;
    private _waterGfx: Phaser.GameObjects.Graphics | null = null;
    private _waterRTOx = 0; private _waterRTOy = 0; // RT top-left world origin
  private waterTimeLogged: boolean = false; // one-time wave log guard
  private waterAnimFrame: number = 0;
  /** Prebuilt iso water polygons (marching-squares shoreline, not solid tiles). */
  private waterPolys: { pts: { x: number; y: number }[]; depth: number; shore: boolean; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  /** Pre-computed sine lookup table (256 entries, one full cycle). */
  private readonly sinLUT = new Float32Array(256);

  public uiGroup!: Phaser.GameObjects.Group;
  public uiCamera!: Phaser.Cameras.Scene2D.Camera;

  public treeVisuals!: Phaser.GameObjects.Group; // Pool for tree visuals
  public worldVisuals!: Phaser.GameObjects.Group; // General visuals

  // Input Keys
  public cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  public wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  public getFactionColor(owner: number): number {
    if (owner === 0) return FACTION_COLORS[this.faction];
    if (owner === 1) return FACTION_COLORS[this.enemyFaction];
    return 0xffffff;
  }

  constructor() {
    super('MainScene');
  }

  preload() {
    // Dispatch progress to React
    this.load.on('progress', (value: number) => {
      window.dispatchEvent(new CustomEvent('game-load-progress', { detail: value }));
    });

    this.load.on('complete', () => {
      window.dispatchEvent(new CustomEvent('game-load-complete'));
    });

    this.load.image('ground', groundImg);
    this.load.image('lumber', lumberImg);
    this.load.image('townhall', townhallImg);
    this.load.image('field', fieldImg);
    this.load.image('flare', flareImg);
    this.load.image('tree', treeImg);
    this.load.image('stump', stumpImg);
    this.load.image('house', houseImg);
    this.load.image('lodge', lodgeImg);
    this.load.image('smoke', smokeImg);
  }

  public stressTestConfig: { unitCount: number; enableEnemies?: boolean } | null = null;

  init(data: { faction?: FactionType, mapMode?: MapMode, fowEnabled?: boolean, peacefulMode?: boolean, treatyLength?: number, mapSize?: MapSize, aiDisabled?: boolean, stressTestConfig?: { unitCount: number; enableEnemies?: boolean } | null }) {
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;

    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    this.peacefulMode = data.peacefulMode === true;
    this.treatyLength = (data.treatyLength || 0) * 60 * 1000;
    this.stressTestConfig = data.stressTestConfig || null;

    // Pick a random enemy faction that is NOT the player's faction
    const allFactions = Object.values(FactionType) as FactionType[];
    const available = allFactions.filter((f) => f !== this.faction);
    this.enemyFaction = available[Phaser.Math.Between(0, available.length - 1)];

    if (this.mapMode === MapMode.FIXED) {
      const sizePx = MAP_SIZES[(data.mapSize || MapSize.MEDIUM) as MapSize];
      this.mapWidth = sizePx;
      this.mapHeight = sizePx;
    } else {
      this.mapWidth = 2048;
      this.mapHeight = 2048;
    }
    this.resources = { ...INITIAL_RESOURCES };
    this.population = 0;
    this.maxPopulation = 5;
    this.happiness = 100;
    this.taxRate = 0;
    this.gameSpeed = 0.5;
    this.aiDisabled = data.aiDisabled === true;
    this.currentAge = Age.VILLAGE;
    this.ageProgress = 0;
    this.isAdvancing = false;
    this.nextAge = null;
  }

  create() {
    this.game.canvas.oncontextmenu = (e) => e.preventDefault();

    // Generate robust textures
    if (!this.textures.exists('white_flare')) {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(4, 4, 4);
      graphics.generateTexture('white_flare', 8, 8);
    }
    this.pathfinder = new Pathfinder();
    this.treeSpatialHash = new SpatialHash(250); // 250px cells (approx 1-2 trees width)
    this.unitSpatialHash = new SpatialHash(150); // 150px cells for unit queries
    this.entityFactory = new EntityFactory(this);
    this.squadSystem = new SquadSystem(this);

    // Create World Layer for PostFX
    this.worldLayer = this.add.layer();

    this.groundLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'ground');
    this.groundLayer.setOrigin(0, 0);
    this.groundLayer.setDepth(-20000);
    this.worldLayer.add(this.groundLayer); // Add ground to layer
    this.groundLayer.setTileScale(this.groundScale);

    this.units = this.add.group({ runChildUpdate: true });
    // Hook into unit group to maintain spatial hash
    this.units.on('create', (item: Phaser.GameObjects.GameObject) => this.unitSpatialHash.insert(item));
    this.units.on('remove', (item: Phaser.GameObjects.GameObject) => this.unitSpatialHash.remove(item));
    this.buildings = this.add.group();
    this.trees = this.add.group();
    this.treeVisuals = this.add.group(); // Visual pool
    this.worldVisuals = this.add.group(); // General visuals (units, buildings)


    // Hook into tree group to maintain spatial hash
    this.trees.on('create', (item: Phaser.GameObjects.GameObject) => this.treeSpatialHash.insert(item));
    this.trees.on('remove', (item: Phaser.GameObjects.GameObject) => this.treeSpatialHash.remove(item));


    this.unitSystem = new UnitSystem(this);
    this.buildingManager = new BuildingManager(this);
    this.economySystem = new EconomySystem(this);
    this.inputManager = new InputManager(this);
    this.enemyAI = new EnemyAISystem(this);
    this.mapGenerationSystem = new MapGenerationSystem(this);
    this.cullingSystem = new CullingSystem(this);
    this.feedbackSystem = new FeedbackSystem(this);
    this.atmosphericSystem = new AtmosphericSystem(this);
    this.villagerSystem = new VillagerSystem(this);
    this.animalSystem = new AnimalSystem(this);
    this.proceduralSound = new ProceduralSoundSystem(this);
    this.clashSystem = new ClashSystem(this);
    
    // Initialize Terrain System
    this.terrainSystem = new TerrainSystem(this, this.mapWidth, this.mapHeight);
    this.terrainSystem.generateHeightMap();
    this.terrainSystem.applyVisualTinting();

    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
      // ── Water layer (FIXED map only) ─────────────────────────────────────
      // Iso world: shore clipped with marching-squares so edges follow height,
      // not solid 32px diamonds (Minecraft look).
      const dim = this.terrainSystem.getGridDimensions();
      const grid = this.terrainSystem.getHeightMapData();
      const cellSize = dim.cellSize;
      const level = TERRAIN_CONFIG.WATER_LEVEL;
      this.waterPolys = [];
      // Pre-compute sine lookup for drawWater performance (avoids Math.sin per-poly)
      const TWO_PI = Math.PI * 2;
      for (let i = 0; i < 256; i++) this.sinLUT[i] = Math.sin(i * TWO_PI / 256);
      let minV = Infinity, maxV = -Infinity;
      for (let i = 0; i < grid.length; i++) {
        const h = grid[i];
        if (h < minV) minV = h;
        if (h > maxV) maxV = h;
      }

      const sample = (wx: number, wy: number) => this.terrainSystem.getHeightInterpolated(wx, wy);
      const edgeIso = (
        ax: number, ay: number, ha: number,
        bx: number, by: number, hb: number
      ) => {
        const t = (level - ha) / (hb - ha);
        return toIso(ax + (bx - ax) * t, ay + (by - ay) * t);
      };

      for (let gy = 0; gy < dim.height; gy++) {
        for (let gx = 0; gx < dim.width; gx++) {
          const wx = gx * cellSize;
          const wy = gy * cellSize;
          // Corners NW, NE, SE, SW (world cartesian)
          const h0 = sample(wx, wy);
          const h1 = sample(wx + cellSize, wy);
          const h2 = sample(wx + cellSize, wy + cellSize);
          const h3 = sample(wx, wy + cellSize);
          const m0 = h0 < level ? 1 : 0;
          const m1 = h1 < level ? 1 : 0;
          const m2 = h2 < level ? 1 : 0;
          const m3 = h3 < level ? 1 : 0;
          const mask = m0 | (m1 << 1) | (m2 << 2) | (m3 << 3);
          if (mask === 0) continue;

          const c0 = toIso(wx, wy);
          const c1 = toIso(wx + cellSize, wy);
          const c2 = toIso(wx + cellSize, wy + cellSize);
          const c3 = toIso(wx, wy + cellSize);
          // Edge crossings only when adjacent corners disagree
          const e0 = () => edgeIso(wx, wy, h0, wx + cellSize, wy, h1);
          const e1 = () => edgeIso(wx + cellSize, wy, h1, wx + cellSize, wy + cellSize, h2);
          const e2 = () => edgeIso(wx + cellSize, wy + cellSize, h2, wx, wy + cellSize, h3);
          const e3 = () => edgeIso(wx, wy + cellSize, h3, wx, wy, h0);

          let depthSum = 0;
          let wetCount = 0;
          for (const h of [h0, h1, h2, h3]) {
            if (h < level) {
              depthSum += (level - h) / level;
              wetCount++;
            }
          }
          const depth = Math.min(1, depthSum / Math.max(1, wetCount));

          // Saddle cases (5, 10): two tris — one fillPath would self-cross.
          if (mask === 5) {
            this.waterPolys.push({ pts: [c0, e0(), e3()], depth, shore: true });
            this.waterPolys.push({ pts: [c2, e1(), e2()], depth, shore: true });
            continue;
          }
          if (mask === 10) {
            this.waterPolys.push({ pts: [c1, e0(), e1()], depth, shore: true });
            this.waterPolys.push({ pts: [c3, e2(), e3()], depth, shore: true });
            continue;
          }

          let pts: { x: number; y: number }[];
          switch (mask) {
            case 1:  pts = [c0, e0(), e3()]; break;
            case 2:  pts = [c1, e1(), e0()]; break;
            case 3:  pts = [c0, c1, e1(), e3()]; break;
            case 4:  pts = [c2, e2(), e1()]; break;
            case 6:  pts = [c1, c2, e2(), e0()]; break;
            case 7:  pts = [c0, c1, c2, e2(), e3()]; break;
            case 8:  pts = [c3, e3(), e2()]; break;
            case 9:  pts = [c0, e0(), e2(), c3]; break;
            case 11: pts = [c0, c1, e1(), e2(), c3]; break;
            case 12: pts = [c2, c3, e3(), e1()]; break;
            case 13: pts = [c0, e0(), e1(), c2, c3]; break;
            case 14: pts = [c1, c2, c3, e3(), e0()]; break;
            default: pts = [c0, c1, c2, c3]; break; // 15
          }

          { // Compute AABB for viewport culling
            let bx0 = pts[0].x, by0 = pts[0].y, bx1 = bx0, by1 = by0;
            for (let k = 1; k < pts.length; k++) {
              if (pts[k].x < bx0) bx0 = pts[k].x; else if (pts[k].x > bx1) bx1 = pts[k].x;
              if (pts[k].y < by0) by0 = pts[k].y; else if (pts[k].y > by1) by1 = pts[k].y;
            }
            this.waterPolys.push({ pts, depth, shore: mask !== 15, minX: bx0, minY: by0, maxX: bx1, maxY: by1 });
          }
        }
      }

      // Compute global AABB for RT placement
            let globalMinX = Infinity, globalMinY = Infinity, globalMaxX = -Infinity, globalMaxY = -Infinity;
            for (const p of this.waterPolys) {
              if (p.minX < globalMinX) globalMinX = p.minX;
              if (p.minY < globalMinY) globalMinY = p.minY;
              if (p.maxX > globalMaxX) globalMaxX = p.maxX;
              if (p.maxY > globalMaxY) globalMaxY = p.maxY;
            }
            const rtW = Math.ceil(globalMaxX - globalMinX) + 2;
            const rtH = Math.ceil(globalMaxY - globalMinY) + 2;
            this.waterRT = this.add.renderTexture(globalMinX - 1, globalMinY - 1, rtW, rtH);
            this._waterRTOx = globalMinX - 1;
            this._waterRTOy = globalMinY - 1;
            this.waterRT.setDepth(-9000);
            this.worldLayer.add(this.waterRT);
      this._waterGfx = this.add.graphics();
      this._waterGfx.setVisible(false); // hidden — geometry builder only
      this.drawWater(0);
      // eslint-disable-next-line no-console
      console.log(
        '[Water] MS polys:', this.waterPolys.length, '/', grid.length,
        '(', (100 * this.waterPolys.length / grid.length).toFixed(1), '%)',
        '| height range:', minV.toFixed(3), '..', maxV.toFixed(3),
        '| WATER_LEVEL:', level,
        '| depth:', 
      );
      // Permanent water impassable mask (dual-layer; demolish won't open water)
      this.pathfinder.applyWaterMask(
        (wx, wy) => this.terrainSystem.getHeightAt(wx, wy),
        level
      );
      this.waterTimeLogged = false;
      this.waterAnimFrame = 0;
      this.mapGenerationSystem.createEnvironment();
      this.mapGenerationSystem.generateFertileZones();
      this.mapGenerationSystem.generateForestsAndAnimals();
    } else {
      this.physics.world.setBounds(-100000, -100000, 200000, 200000);
      this.infiniteMapSystem = new InfiniteMapSystem(this);
    }

    const centerX = this.mapMode === MapMode.FIXED ? this.mapWidth / 2 : 400;
    const centerY = this.mapMode === MapMode.FIXED ? this.mapHeight / 2 : 400;

    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX, centerY, 0);
    this.entityFactory.spawnBuilding(BuildingType.BONFIRE, centerX + 80, centerY, 0);
    this.villagerSystem.spawnVillager(centerX + 50, centerY + 50, 0);
    this.villagerSystem.spawnVillager(centerX - 50, centerY + 50, 0);
    this.entityFactory.spawnUnit(UnitType.PIKESMAN, centerX, centerY + 90, 0);

    // Spawn Slingers (Village Age ranged unit)
    for (let i = 0; i < 3; i++) {
      this.entityFactory.spawnUnit(UnitType.SLINGER, centerX - 60 + (i * 15), centerY + 80, 0);
    }

    // Spawn guaranteed trees near player's starting Town Center for early wood harvesting
    this.mapGenerationSystem.spawnStartingForest(centerX, centerY);

    const startIso = toIso(centerX, centerY);
    this.cameras.main.centerOn(startIso.x, startIso.y);
    this.cameras.main.setBackgroundColor('#0d1117');

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; };

    this.debugText = this.add.text(10, 80, '', {
      font: '14px monospace', color: '#00ff00', backgroundColor: '#000000bb', padding: { x: 10, y: 10 }
    }).setScrollFactor(0).setDepth(99999).setVisible(false);

    this.input.keyboard!.on('keydown-F3', () => {
      this.debugMode = !this.debugMode;
      this.debugText.setVisible(this.debugMode);
    });

    this.input.keyboard!.on('keydown-I', () => {
      this.showUnitIndicators = !this.showUnitIndicators;
    });

    this.game.events.on('request-unit-spawn', this.handleUnitSpawnRequest, this);
    this.game.events.on(EVENTS.SET_TAX_RATE, (rate: number) => { this.taxRate = rate; this.economySystem.updateStats(); }, this);
    this.game.events.on(EVENTS.CENTER_CAMERA, this.centerCameraOnTownCenter, this);
    this.game.events.on(EVENTS.SET_GAME_SPEED, (speed: number) => {
      this.gameSpeed = speed;
      this.physics.world.timeScale = 1 / speed;
      this.tweens.timeScale = speed;
    }, this);

    this.game.events.on(EVENTS.SET_BLOOM_INTENSITY, (intensity: number) => {
      this.bloomIntensity = intensity;
      this.atmosphericSystem.setBloomIntensity(intensity);
      this.economySystem.updateStats(); // Update React state
    });

    this.physics.world.timeScale = 1 / this.gameSpeed;
    this.economySystem.updateStats();

    if (this.isFowEnabled) { this.fogOfWar = new FogOfWarSystem(this); } else { this.fogOfWar = null; }
    this.minimapSystem = new MinimapSystem(this);

    const minimapClickHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.handleMinimapClick(detail.x, detail.y);
    };
    window.addEventListener('minimap-click-ui', minimapClickHandler);

    this.game.events.on('set-bloom-intensity-ui', (intensity: number) => {
      this.atmosphericSystem.setBloomIntensity(intensity);
      this.economySystem.updateStats(); // Update React state
    });

    // Render performance tracking
    if (this.game.renderer && this.game.renderer.on) {
      this.game.renderer.on('prerender', () => {
        this._renderStart = performance.now();
      });
      this.game.renderer.on('postrender', () => {
        const elapsed = performance.now() - (this._renderStart || 0);
        this.profileTimings['__render'] = (this.profileTimings['__render'] || 0) + elapsed;
      });
    }

    this.game.events.on('request-set-formation', (type: FormationType) => {
      if (this.unitSystem) {
        this.unitSystem.setFormation(type);
        this.economySystem.updateStats();
      }
    }, this);

    this.game.events.on('request-set-stance', (stance: UnitStance) => {
      if (this.unitSystem) {
        this.unitSystem.setStance(stance);
        this.economySystem.updateStats();
      }
    }, this);

    // --- STRESS TEST SETUP ---
    if (this.stressTestConfig) {
      this.setupStressTest();
    }

    // --- UI CAMERA SETUP (Must be done AFTER systems init) ---
    this.uiGroup = this.add.group({ runChildUpdate: true });
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.cameras.main.ignore(this.uiGroup);

    // Careful exclusions for UI Camera
    // With worldLayer, we can just ignore that layer
    if (this.worldLayer) {
      this.uiCamera.ignore(this.worldLayer);
    }
    // Still ignore loose groups just in case, or if they are NOT in worldLayer
    this.uiCamera.ignore(this.trees); // Physics objects (invisible)
    this.uiCamera.ignore(this.buildings); // Physics objects (invisible)
    this.uiCamera.ignore(this.units); // Physics objects (invisible)
    this.uiCamera.ignore(this.atmosphericSystem.clouds); // These are now in worldLayer, but safe to keep ignore if they were in main display list

    if (this.fogOfWar) { this.uiCamera.ignore(this.fogOfWar.screenRT); }

    // Listen for age advancement requests from React UI
    this.events.on(EVENTS.ADVANCE_AGE, () => {
      this.startAgeAdvancement();
    });
    this.proceduralSound.startAmbientWind();

    // Lifecycle teardown: close the AudioContext and detach the clash listener
    // on scene shutdown so neither leaks across scene restarts (P2a / P3b).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.proceduralSound.destroy();
        this.clashSystem.destroy();
    });
  }


  private lastTcIndex = -1;

  public centerCameraOnTownCenter() {
    const tcs = this.buildings.getChildren().filter((b: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
    ) as Phaser.GameObjects.Rectangle[];
    if (tcs.length === 0) return;
    this.lastTcIndex = (this.lastTcIndex + 1) % tcs.length;
    const target = tcs[this.lastTcIndex];
    if (target) {
      const iso = toIso(target.x, target.y);
      this.cameras.main.pan(iso.x, iso.y, 1000, 'Power2');
    }
  }

  public handleMinimapClick(mx: number, my: number) {
    if (!this.minimapSystem) return;
    const worldPos = this.minimapSystem.getWorldFromMinimap(mx, my);
    const iso = toIso(worldPos.x, worldPos.y);
    this.cameras.main.pan(iso.x, iso.y, 500, 'Power2');
  }

  // Performance profiling accumulators (reset every PROFILING_REPORT_INTERVAL frames)
  private profileFrameCount: number = 0;
  private _renderStart: number = 0;
  private profileTimings: Record<string, number> = {};
  private static readonly PROFILING_REPORT_INTERVAL = 120; // report every ~2s at 60fps

  /** Redraw water polys. Phase-driven color only — geometry is static MS shoreline. */
  private drawWater(phase: number): void {
    const g = this._waterGfx;
    if (!g || this.waterPolys.length === 0) return;
    g.clear();
    g.setPosition(-this._waterRTOx, -this._waterRTOy);
    const shallow = { r: 51, g: 140, b: 179 };
    const deep = { r: 5, g: 48, b: 107 };
    const globalSwell = 0.97 + 0.03 * this.lookupSin(phase * 0.7);
    const wv = this.cameras.main.worldView;
    const vx = wv.x;
    const vy = wv.y;
    const vRight = wv.x + wv.width;
    const vBottom = wv.y + wv.height;
    const PAD = 100;
    const foamPad = 50;
    const polys = this.waterPolys;
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i];
      if (poly.maxX < vx - PAD || poly.minX > vRight + PAD ||
          poly.maxY < vy - PAD || poly.minY > vBottom + PAD) continue;
      const pts = poly.pts;
      if (pts.length < 3) continue;
      const t = poly.depth;
      let wave = globalSwell;
      let glint = 0;
      let w2 = 0;
      if (poly.shore) {
        const px = pts[0].x;
        const py = pts[0].y;
        const w1 = this.lookupSin(phase * 1.5 + px * 0.035 + py * 0.028);
        w2 = this.lookupSin(phase * 2.3 + px * 0.07 - py * 0.05);
        const w3 = this.lookupSin(phase * 0.9 + (px + py) * 0.018);
        wave = 0.92 + 0.08 * w1 + 0.03 * w2 + 0.02 * w3;
        glint = Math.max(0, w1 + w2 * 0.5) * 0.12 * (1 - t * 0.5);
      }
      const r = Math.min(255, Math.floor((shallow.r + (deep.r - shallow.r) * t) * wave + glint * 40));
      const gg = Math.min(255, Math.floor((shallow.g + (deep.g - shallow.g) * t) * wave + glint * 50));
      const b = Math.min(255, Math.floor((shallow.b + (deep.b - shallow.b) * t) * wave + glint * 30));
      const alpha = (poly.shore ? 0.58 : 0.74) + 0.18 * t;
      g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), alpha);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let p = 1; p < pts.length; p++) g.lineTo(pts[p].x, pts[p].y);
      g.closePath();
      g.fillPath();
      if (poly.shore) {
        const nearEdge = poly.maxX - foamPad < vx || poly.minX + foamPad > vRight ||
                         poly.maxY - foamPad < vy || poly.minY + foamPad > vBottom;
        if (!nearEdge) {
          const foamA = 0.18 + 0.18 * Math.max(0, w2);
          g.lineStyle(1.25, 0xc8e8f0, foamA);
          g.beginPath();
          g.moveTo(pts[0].x, pts[0].y);
          for (let p = 1; p < pts.length; p++) g.lineTo(pts[p].x, pts[p].y);
          g.closePath();
          g.strokePath();
        }
      }
    }
    // Blit geometry to RenderTexture — single texture draw between updates
    this.waterRT!.clear();
    this.waterRT!.draw(g);
  }

  /** Fast sine via pre-computed LUT. Angle can be any value. */
  private lookupSin(angle: number): number {
    const TWO_PI = Math.PI * 2;
    const idx = (((angle % TWO_PI) + TWO_PI) % TWO_PI) * (256 / TWO_PI);
    return this.sinLUT[idx | 0];
  }

  private profileStart(_label: string): number {
    return performance.now();
  }

  private profileEnd(label: string, startTime: number): void {
    const elapsed = performance.now() - startTime;
    this.profileTimings[label] = (this.profileTimings[label] || 0) + elapsed;
  }

  update(time: number, delta: number) {
    const frameStart = performance.now();
    const dt = delta * this.gameSpeed;
    this.gameTime += dt;
    // Animate water color (geometry is static). Throttle redraws.
    if (this.waterRT && this.waterPolys.length > 0) {
      this.waterAnimFrame++;
      if (this.waterAnimFrame % 6 === 0) {
        this.drawWater(time * 0.001);
      }
      if (!this.waterTimeLogged) {
        // eslint-disable-next-line no-console
        console.log('[Water] animating', this.waterPolys.length, 'MS polys');
        this.waterTimeLogged = true;
      }
    }

    if (this.debugMode) {
      // const treatySecs = Math.max(0, Math.ceil((this.treatyLength - this.gameTime) / 1000));
      this.debugText.setText([
        `FPS: ${this.game.loop.actualFps.toFixed(1)}`,
        `Speed: ${this.gameSpeed}x`,
        // Fix: Cast GameObject to any to access 'visible' property for debug HUD reporting
        `Units: ${this.units.getLength()} | Visible: ${this.units.getChildren().filter(u => (u as unknown as Phaser.GameObjects.Components.Visible).visible).length}`,
        `Trees: ${this.trees.getLength()} | Visible: ${this.trees.getChildren().filter(t => (t as unknown as Phaser.GameObjects.Components.Visible).visible).length}`,
        `AI: ${this.enemyAI.getDebugInfo()}`
      ]);
    }

    let t0: number;

    t0 = this.profileStart('inputManager');
    this.inputManager.update(delta);
    this.profileEnd('inputManager', t0);

    const cam = this.cameras.main;
    const topLeft = cam.getWorldPoint(0, 0);
    const bottomRight = cam.getWorldPoint(cam.width, cam.height);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    this.groundLayer.setPosition(topLeft.x, topLeft.y);
    this.groundLayer.setSize(width, height);
    this.groundLayer.tilePositionX = topLeft.x / this.groundScale;
    this.groundLayer.tilePositionY = topLeft.y / this.groundScale;

    this.groundLayer.tilePositionY = topLeft.y / this.groundScale;

    t0 = this.profileStart('cullingSystem');
    this.cullingSystem.update(this.gameTime, dt);
    this.profileEnd('cullingSystem', t0);

    // Optimized spatial hash: skip if no moving units
    t0 = this.profileStart('updateUnitSpatialHash');
    if (!this.stressTestConfig || this.units.getLength() < 2000) {
      this.updateUnitSpatialHash();
    } else {
      // With 2000+ units in stress test, most are stationary at any given moment.
      // Only update the hash for units that actually moved (their body velocity > 1).
      // The spatial hash is only used for separation (which we already skip for flow field)
      // and target scanning (which doesn't happen in peaceful stress test mode).
      // So we can skip entirely for stress test with >2000 units.
      // For smaller counts, still update to keep separation working.
    }
    this.profileEnd('updateUnitSpatialHash', t0);

    t0 = this.profileStart('villagerSystem');
    this.villagerSystem.update(this.gameTime, dt);
    this.profileEnd('villagerSystem', t0);

    t0 = this.profileStart('animalSystem');
    this.animalSystem.update(this.gameTime, dt);
    this.profileEnd('animalSystem', t0);

    t0 = this.profileStart('unitSystem');
    this.unitSystem.update(this.gameTime, dt);
    this.profileEnd('unitSystem', t0);

    // Sync ALL squad container positions to physics body (cheap pass, prevents stutter)
    this.squadSystem.syncPositions();

    t0 = this.profileStart('squadSystem');
    this.squadSystem.update(dt);
    this.profileEnd('squadSystem', t0);

    // Skip non-critical systems in stress test mode
    if (!this.stressTestConfig) {
      t0 = this.profileStart('buildingManager');
      this.buildingManager.update();
      this.profileEnd('buildingManager', t0);

      if (!this.aiDisabled) {
        t0 = this.profileStart('enemyAI');
        this.enemyAI.update(this.gameTime, dt);
        this.profileEnd('enemyAI', t0);
      }

      this.accumulatedTime += dt;
      if (this.accumulatedTime >= 1000) {
        this.economySystem.tickEconomy();
        this.accumulatedTime -= 1000;
      }

      this.accumulatedPopTime += dt;
      if (this.accumulatedPopTime >= 5000) {
        this.economySystem.tickPopulation();
        this.accumulatedPopTime -= 5000;
      }

      this.economySystem.assignJobs();

      // Age advancement progress ticking (player only)
      if (this.isAdvancing && this.nextAge) {
        const config = AGE_CONFIGS[this.nextAge];
        if (config && config.advancementTime > 0) {
          this.ageProgress += dt / config.advancementTime;
          if (this.ageProgress >= 1) {
            this.completeAgeAdvancement();
          }
        }
      }
    }

    if (this.infiniteMapSystem && !this.stressTestConfig) this.infiniteMapSystem.update();
    if (this.minimapSystem && !this.stressTestConfig) this.minimapSystem.update();
    if (this.fogOfWar && !this.stressTestConfig) this.fogOfWar.update();

    t0 = this.profileStart('atmosphericSystem');
    this.atmosphericSystem.update(this.gameTime, dt);
    this.profileEnd('atmosphericSystem', t0);

    if (!this.stressTestConfig) {
      t0 = this.profileStart('syncVisuals');
      this.syncVisuals();
      this.profileEnd('syncVisuals', t0);
    }

    // Sync UI camera
    this.uiCamera.scrollX = this.cameras.main.scrollX;
    this.uiCamera.scrollY = this.cameras.main.scrollY;
    this.uiCamera.zoom = this.cameras.main.zoom;

    this.proceduralSound.update();

    // --- Performance report ---
    this.profileFrameCount++;
    const frameTime = performance.now() - frameStart;
    this.profileTimings['_totalFrame'] = (this.profileTimings['_totalFrame'] || 0) + frameTime;
    
        // Dev-only: send FPS to terminal via Vite HMR WebSocket (every ~0.5s)
        if (this.profileFrameCount % 30 === 0) {
          try {
            // @ts-expect-error — import.meta.hot is only available in Vite dev mode
            import.meta.hot?.send('game:fps', {
              fps: this.game.loop.actualFps,
              units: this.units.getLength(),
              frameMs: frameTime,
            });
          } catch { /* not in dev mode */ }
        }

    if (this.profileFrameCount >= MainScene.PROFILING_REPORT_INTERVAL) {
      const fps = this.game.loop.actualFps.toFixed(1);
      const unitCount = this.units.getLength();
      const reports: string[] = [`[PERF] ${unitCount} units @ ${fps} FPS (avg ${this.profileFrameCount} frames):`];
      const sorted = Object.entries(this.profileTimings)
        .filter(([k]) => k !== '_totalFrame')
        .sort(([, a], [, b]) => b - a);
      for (const [label, total] of sorted) {
        const avgMs = (total / this.profileFrameCount).toFixed(2);
        const pct = ((total / this.profileTimings['_totalFrame']) * 100).toFixed(1);
        reports.push(`  ${label}: ${avgMs}ms/frame (${pct}%)`);
      }
      const avgFrame = (this.profileTimings['_totalFrame'] / this.profileFrameCount).toFixed(2);
      reports.push(`  TOTAL FRAME: ${avgFrame}ms`);
      console.warn(reports.join('\n'));

      // Reset
      this.profileFrameCount = 0;
      this.profileTimings = {};
    }
  }



  public setupStressTest() {
    if (!this.stressTestConfig) return;
    const config = this.stressTestConfig;
    const count = config.unitCount;
    const enableEnemies = config.enableEnemies === true;
    const centerX = this.mapWidth / 2;
    const centerY = this.mapHeight / 2;

    // Spawn a flat open area for the test by clearing trees near center
    const clearRadius = 600;
    const treeArr = this.trees.getChildren() as Phaser.GameObjects.Image[];
    for (let i = treeArr.length - 1; i >= 0; i--) {
      const t = treeArr[i];
      const dx = t.x - centerX;
      const dy = t.y - centerY;
      if (dx * dx + dy * dy < clearRadius * clearRadius) {
        const treeObj = t as unknown as { visual?: Phaser.GameObjects.GameObject };
        if (treeObj.visual) treeObj.visual.destroy();
        this.trees.remove(treeArr[i], true, true);
      }
    }
    this.pathfinder.markGrid(centerX - clearRadius, centerY - clearRadius, clearRadius * 2, clearRadius * 2, false);

    // Spawn player units in a grid formation near the center-left
    const playerCount = enableEnemies ? Math.floor(count / 2) : count;
    const enemyCount = enableEnemies ? count - playerCount : 0;
    const spacing = 20;

    // Player units (owner=0) on the left side
    const pCols = Math.ceil(Math.sqrt(playerCount));
    const pStartX = (centerX - 200) - (pCols * spacing) / 2;
    const pStartY = centerY - (pCols * spacing) / 2;
    let spawned = 0;
    for (let i = 0; i < pCols; i++) {
      for (let j = 0; j < pCols; j++) {
        if (spawned >= playerCount) break;
        const x = pStartX + i * spacing + Phaser.Math.Between(-4, 4);
        const y = pStartY + j * spacing + Phaser.Math.Between(-4, 4);
        // Mix of unit types for visual variety
        const type = spawned % 3 === 0 ? UnitType.ARCHER : (spawned % 3 === 1 ? UnitType.PIKESMAN : UnitType.CAVALRY);
        this.entityFactory.spawnUnit(type, x, y, 0);
        spawned++;
      }
    }

    // Enemy units (owner=1) on the right side
    if (enableEnemies) {
      // Build some basic buildings for the enemy so it looks like a base
      this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX + 400, centerY - 50, 1);
      this.entityFactory.spawnBuilding(BuildingType.BARRACKS, centerX + 350, centerY + 80, 1);
      this.entityFactory.spawnBuilding(BuildingType.HOUSE, centerX + 450, centerY + 50, 1);

      const eCols = Math.ceil(Math.sqrt(enemyCount));
      const eStartX = (centerX + 200) - (eCols * spacing) / 2;
      const eStartY = centerY - (eCols * spacing) / 2;
      let eSpawned = 0;
      for (let i = 0; i < eCols; i++) {
        for (let j = 0; j < eCols; j++) {
          if (eSpawned >= enemyCount) break;
          const x = eStartX + i * spacing + Phaser.Math.Between(-4, 4);
          const y = eStartY + j * spacing + Phaser.Math.Between(-4, 4);
          // Enemies get Pikesman, Legion, and Cavalry for a more intimidating force
          const type = eSpawned % 4 === 0 ? UnitType.LEGION : (eSpawned % 4 === 1 ? UnitType.CAVALRY : UnitType.PIKESMAN);
          this.entityFactory.spawnUnit(type, x, y, 1);
          eSpawned++;
        }
      }

      // Auto-command enemy units to attack the player's nearest unit
      const enemyUnits = this.units.getChildren().filter((u) => u.getData('owner') === 1) as Phaser.GameObjects.GameObject[];
      const playerUnits = this.units.getChildren().filter((u) => u.getData('owner') === 0) as Phaser.GameObjects.GameObject[];
      if (enemyUnits.length > 0 && playerUnits.length > 0) {
        // Find the closest player unit to the center of the enemy blob
        let closestDist = Number.MAX_VALUE;
        let closestTarget: Phaser.GameObjects.GameObject | null = null;
        for (const pu of playerUnits) {
          const d = Phaser.Math.Distance.Between(
            (enemyUnits[0] as Phaser.GameObjects.Image).x, (enemyUnits[0] as Phaser.GameObjects.Image).y,
            (pu as Phaser.GameObjects.Image).x, (pu as Phaser.GameObjects.Image).y
          );
          if (d < closestDist) {
            closestDist = d;
            closestTarget = pu;
          }
        }
        if (closestTarget) {
          this.unitSystem.commandAttack(enemyUnits, closestTarget);
        }
      }

      this.feedbackSystem.showFloatingText(
        centerX + 200,
        centerY - 120,
        `${enemyCount} ENEMIES SPAWNED!`,
        '#ef4444'
      );
    }

    // Auto-select player units (not enemies)
    const allUnits = this.units.getChildren() as Phaser.GameObjects.GameObject[];
    this.inputManager.selectedUnits = [];
    for (const unit of allUnits) {
      if (unit.getData('owner') === 0) {
        const u = unit as unknown as { setSelected?: (sel: boolean) => void };
        if (u.setSelected) u.setSelected(true);
        this.inputManager.selectedUnits.push(unit);
      }
    }
    this.inputManager.emitSelectionChanged();

    // Zoom out to see the whole battlefield
    this.cameras.main.zoomTo(0.35, 1000);

    // Show floating label
    const labelText = enableEnemies
      ? `BATTLE ROYALE: ${playerCount} vs ${enemyCount} — Watch them clash!`
      : `${count} Units Spawned — Right-click to move`;
    this.feedbackSystem.showFloatingText(
      this.cameras.main.worldView.centerX,
      this.cameras.main.worldView.centerY - 100,
      labelText,
      enableEnemies ? '#ef4444' : '#D4AF37'
    );

    console.warn(`[STRESS TEST] Spawned ${count} units. Flow field threshold is ${12}. All units selected. Right-click to command move.`);
  }

  handleUnitSpawnRequest(type: UnitType) {
    const costs: Record<UnitType, { food: number; gold: number }> = {
      [UnitType.PIKESMAN]: { food: 100, gold: 50 },
      [UnitType.ARCHER]: { food: 80, gold: 40 },
      [UnitType.CAVALRY]: { food: 150, gold: 100 },
      [UnitType.VILLAGER]: { food: 0, gold: 0 },
      [UnitType.LEGION]: { food: 500, gold: 300 },
      [UnitType.ANIMAL]: { food: 0, gold: 0 },
      [UnitType.SLINGER]: { food: 40, gold: 20 },
      [UnitType.AXEMAN]: { food: 120, gold: 60 },
      [UnitType.HOPLITE]: { food: 200, gold: 150 },
      [UnitType.CHARIOT]: { food: 250, gold: 200 }
    };

    const cost = costs[type];

    // Check if unit is unlocked at current age
    if (!this.isUnitUnlockedForPlayer(type)) {
      this.feedbackSystem.showFloatingText(
        this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY,
        "Advance to a higher age to train this unit!", "#ff6b6b"
      );
      return;
    }
    if (this.resources.food >= cost.food && this.resources.gold >= cost.gold) {
      // Find selected barracks OR any barracks if nothing selected
      let spawnSource = this.inputManager.selectedBuilding as Phaser.GameObjects.Rectangle;
      if (!spawnSource || spawnSource.getData('def').type !== BuildingType.BARRACKS) {
        const barracks = this.buildings.getChildren().filter((b) => b.getData('def').type === BuildingType.BARRACKS && b.getData('owner') === 0) as Phaser.GameObjects.Rectangle[];
        if (barracks.length > 0) {
          spawnSource = barracks[0];
        } else {
          this.feedbackSystem.showFloatingText(this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY, "Build a Barracks first!", "#ff0000");
          return;
        }
      }

      this.resources.food -= cost.food;
      this.resources.gold -= cost.gold;
      const spawnX = spawnSource.x + 60;
      const spawnY = spawnSource.y + 60;

      const unit = this.entityFactory.spawnUnit(type, spawnX, spawnY, 0);
      this.economySystem.updateStats();

      // Check for waypoint
      if (unit) {
        const waypoint = spawnSource.getData('waypoint');
        if (waypoint) {
          this.time.delayedCall(500, () => {
            this.unitSystem.commandMove([unit], new Phaser.Math.Vector2(waypoint.x, waypoint.y));
          });
        }
      }
    }
  }

  /**
   * Update the unit spatial hash for moving units only.
   * Called each frame to keep the spatial index current.
   * Stationary units (velocity near zero) skip the update since their cell hasn't changed.
   */
  updateUnitSpatialHash() {
    const allUnits = this.units.getChildren();
    for (let i = 0; i < allUnits.length; i++) {
      const u = allUnits[i] as Phaser.GameObjects.Image & { body?: Phaser.Physics.Arcade.Body };
      // Skip stationary units - their spatial cell hasn't changed
      if (u.body && u.body.velocity.length() < 1) continue;
      this.unitSpatialHash.update(u);
    }
  }

  syncVisuals() {
    // Buildings: update visual depth only
    const buildingChildren = this.buildings.getChildren();
    for (let i = 0; i < buildingChildren.length; i++) {
      const b = buildingChildren[i] as Phaser.GameObjects.Image & { visual?: Phaser.GameObjects.Container };
      if (b.visual) {
        const iso = toIso(b.x, b.y);
        b.visual.setDepth(iso.y);
      }
    }

    // Units: only sync non-squad units (villagers, animals)
    const unitChildren = this.units.getChildren();
    for (let i = 0; i < unitChildren.length; i++) {
      const u = unitChildren[i] as Phaser.GameObjects.GameObject & { visual?: Phaser.GameObjects.Container };
      const squadContainer = u.getData('squadContainer');
      if (squadContainer) continue;
      const unit = u as Phaser.GameObjects.Sprite;
      if (u.visual && u.visual.visible) {
        const iso = toIso(unit.x, unit.y);
        u.visual.setPosition(iso.x, iso.y);
        u.visual.setDepth(iso.y);
      }
    }

    this.events.emit(EVENTS.UPDATE_STATS, this.getGameStats());
  }

  // --- Age Advancement ---

  public startAgeAdvancement(): void {
    if (this.isAdvancing) return;
    const next = getNextAge(this.currentAge);
    if (!next) return;
    const config = AGE_CONFIGS[next];
    if (this.resources.food < config.cost.food || this.resources.gold < config.cost.gold) {
      this.feedbackSystem.showFloatingText(
        this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY,
        'Need ' + config.cost.food + 'F ' + config.cost.gold + 'G to advance!', '#ff6b6b'
      );
      return;
    }
    for (const req of config.requiredBuildings) {
      const owned = this.buildings.getChildren().filter(
        (b) => b.getData('owner') === 0 && b.getData('def')?.type === req.type && b.getData('hp') > 0
      ).length;
      if (owned < req.count) {
        this.feedbackSystem.showFloatingText(
          this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY,
          'Need ' + req.count + 'x ' + req.type + ' to advance!', '#ff6b6b'
        );
        return;
      }
    }
    this.resources.food -= config.cost.food;
    this.resources.gold -= config.cost.gold;
    this.isAdvancing = true;
    this.nextAge = next;
    this.ageProgress = 0;
    const tc = this.buildings.getChildren().find(
      (b) => b.getData('owner') === 0 && b.getData('def')?.type === BuildingType.TOWN_CENTER
    ) as Phaser.GameObjects.Image | undefined;
    if (tc) {
      this.proceduralSound.playAgeAdvance(tc.x, tc.y);
      const iso = toIso(tc.x, tc.y);
      this.feedbackSystem.showFloatingText(iso.x, iso.y - 40, 'Researching ' + config.name + '...', '#facc15');
    }
  }

  private completeAgeAdvancement(): void {
    if (!this.nextAge) return;
    this.currentAge = this.nextAge;
    this.isAdvancing = false;
    this.ageProgress = 0;
    this.nextAge = null;
    const config = AGE_CONFIGS[this.currentAge];
    this.events.emit(EVENTS.AGE_ADVANCED, this.currentAge);
    this.economySystem.updateStats();
    const tc = this.buildings.getChildren().find(
      (b) => b.getData('owner') === 0 && b.getData('def')?.type === BuildingType.TOWN_CENTER
    ) as Phaser.GameObjects.Image | undefined;
    if (tc) {
      this.proceduralSound.playAgeAdvance(tc.x, tc.y);
      const iso = toIso(tc.x, tc.y);
      this.feedbackSystem.showFloatingText(iso.x, iso.y - 40, config.name + ' reached!', '#4ade80');
    }
  }

  public getAgeUnlockedUnits(): UnitType[] {
    const config = AGE_CONFIGS[this.currentAge];
    return config ? [...config.unlocksUnits] : [];
  }

  public isUnitUnlockedForPlayer(unitType: UnitType): boolean {
    const config = AGE_CONFIGS[this.currentAge];
    if (!config) return false;
    return config.unlocksUnits.includes(unitType);
  }

  private getGameStats(): GameStats {
    return {
      population: this.population,
      maxPopulation: this.maxPopulation,
      happiness: this.happiness,
      happinessChange: 0,
      resources: { ...this.resources },
      rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
      taxRate: this.taxRate,
      mapMode: this.mapMode,
      peacefulMode: this.peacefulMode,
      treatyTimeRemaining: Math.max(0, this.treatyLength - this.gameTime),
      bloomIntensity: this.bloomIntensity,
      currentFormation: FormationType.BOX,
      currentStance: UnitStance.AGGRESSIVE,
      currentAge: this.currentAge,
      ageProgress: this.ageProgress,
      nextAge: this.nextAge
    };
  }
}
