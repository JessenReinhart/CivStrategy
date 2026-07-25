
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
  private waterDepthSprite: Phaser.GameObjects.Sprite | null = null;
  private waterWaveSprite: Phaser.GameObjects.TileSprite | null = null;
  private waterMaskGraphics: Phaser.GameObjects.Graphics | null = null;
  private waterMask: Phaser.Display.Masks.GeometryMask | null = null;
  private waterMaskBounds: Phaser.Geom.Rectangle | null = null;
  private waterAnimFrame: number = 0;

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
    // Guarantee dry land at faction spawn points — raise terrain above water
    const spawnSafeRadius = 150;
    const spawnMinHeight = TERRAIN_CONFIG.WATER_LEVEL + 0.05;
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;
    this.terrainSystem.flattenAroundWorld(cx, cy, spawnSafeRadius, spawnMinHeight);
    this.terrainSystem.flattenAroundWorld(cx + 400, cy - 50, spawnSafeRadius, spawnMinHeight);
    this.terrainSystem.applyVisualTinting();

    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
      // ── Water layer: depth canvas + scrolling wave texture ──────────────
      const dim = this.terrainSystem.getGridDimensions();
      const grid = this.terrainSystem.getHeightMapData();
      const cellSize = dim.cellSize;
      const level = TERRAIN_CONFIG.WATER_LEVEL;
      const shallowR = 51, shallowG = 140, shallowB = 179;
      const deepR = 5, deepG = 48, deepB = 107;

      // Collect water cells + marching-squares outline for geometry mask
      let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
      const waterCells: { gx: number; gy: number; depth: number }[] = [];
      const maskPoints: { x: number; y: number }[] = [];
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
          const h0 = sample(wx, wy);
          const h1 = sample(wx + cellSize, wy);
          const h2 = sample(wx + cellSize, wy + cellSize);
          const h3 = sample(wx, wy + cellSize);
          const m0 = h0 < level ? 1 : 0;
          const m1 = h1 < level ? 1 : 0;
          const m2 = h2 < level ? 1 : 0;
          const m3 = h3 < level ? 1 : 0;
          const mk = m0 | (m1 << 1) | (m2 << 2) | (m3 << 3);
          if (mk === 0) continue;
          const avgH = (h0 + h1 + h2 + h3) / 4;
          const depth = Math.min(1, (level - avgH) / level);
          const iso = toIso(wx + cellSize / 2, wy + cellSize / 2);
          waterCells.push({ gx, gy, depth });
          if (iso.x < wMinX) wMinX = iso.x; if (iso.x > wMaxX) wMaxX = iso.x;
          if (iso.y < wMinY) wMinY = iso.y; if (iso.y > wMaxY) wMaxY = iso.y;
          // Marching-squares outline segments for geometry mask
          const c0 = toIso(wx, wy);
          const c1 = toIso(wx + cellSize, wy);
          const c2 = toIso(wx + cellSize, wy + cellSize);
          const c3 = toIso(wx, wy + cellSize);
          const e0 = edgeIso(wx, wy, h0, wx + cellSize, wy, h1);
          const e1 = edgeIso(wx + cellSize, wy, h1, wx + cellSize, wy + cellSize, h2);
          const e2 = edgeIso(wx + cellSize, wy + cellSize, h2, wx, wy + cellSize, h3);
          const e3 = edgeIso(wx, wy + cellSize, h3, wx, wy, h0);
          const push = (a: {x:number;y:number}, b: {x:number;y:number}) => { maskPoints.push(a, b); };
          if (mk === 1 || mk === 14) push(c0, mk === 1 ? e0 : e3);
          if (mk === 2 || mk === 13) push(c1, mk === 2 ? e1 : e0);
          if (mk === 4 || mk === 11) push(c2, mk === 4 ? e2 : e1);
          if (mk === 8 || mk === 7) push(c3, mk === 8 ? e3 : e2);
          if (mk === 3) push(e3, e1); if (mk === 12) push(e1, e3);
          if (mk === 6) push(e0, e2); if (mk === 9) push(e2, e0);
          if (mk === 5) { push(c0, e0); push(e3, c2); push(c2, e1); push(e2, c0); }
          if (mk === 10) { push(c1, e1); push(e0, c3); push(c3, e2); push(e3, c1); }
        }
      }
      this.waterMaskBounds = new Phaser.Geom.Rectangle(
        wMinX - 1, wMinY - 1, Math.ceil(wMaxX - wMinX) + 2, Math.ceil(wMaxY - wMinY) + 2
      );
      const wb = this.waterMaskBounds;
      // Render depth gradient to offscreen canvas (drawn once)
      const depthCvs = document.createElement('canvas');
      depthCvs.width = Math.ceil(wb.width);
      depthCvs.height = Math.ceil(wb.height);
      const dCtx = depthCvs.getContext('2d')!;
      for (const wc of waterCells) {
        const px = Math.floor(wc.gx * cellSize * 0.5 - wb.x);
        const py = Math.floor(wc.gy * cellSize - wb.y);
        const t = wc.depth;
        const r = Math.floor(shallowR + (deepR - shallowR) * t);
        const gg = Math.floor(shallowG + (deepG - shallowG) * t);
        const b = Math.floor(shallowB + (deepB - shallowB) * t);
        dCtx.fillStyle = `rgba(${r},${gg},${b},${0.58 + 0.34 * t})`;
        dCtx.fillRect(px, py, 4, 4);
      }
      if (this.textures.exists('_waterDepth')) this.textures.remove('_waterDepth');
      this.textures.addCanvas('_waterDepth', depthCvs);
      this.waterDepthSprite = this.add.sprite(wb.x, wb.y, '_waterDepth').setOrigin(0);
      this.waterDepthSprite.setDepth(-9000);
      this.worldLayer.add(this.waterDepthSprite);
      // Procedural tiling wave texture (overlapping sine waves, seamless)
      const TW = 128;
      const waveCvs = document.createElement('canvas');
      waveCvs.width = TW; waveCvs.height = TW;
      const wCtx = waveCvs.getContext('2d')!;
      const wData = wCtx.createImageData(TW, TW);
      for (let wy = 0; wy < TW; wy++) {
        for (let wx = 0; wx < TW; wx++) {
          const i = (wy * TW + wx) * 4;
          const v1 = Math.sin(wx * Math.PI / 8) * Math.sin(wy * Math.PI / 6);
          const v2 = Math.sin((wx + wy) * Math.PI / 10);
          const v3 = Math.sin(wx * Math.PI / 4) * Math.sin(wy * Math.PI / 3) * 0.5;
          const v = (v1 + v2 + v3) / 2.5;
          wData.data[i] = wData.data[i + 1] = wData.data[i + 2] = Math.floor((v + 1) * 0.5 * 255);
          wData.data[i + 3] = 40;
        }
      }
      wCtx.putImageData(wData, 0, 0);
      if (this.textures.exists('_waterWave')) this.textures.remove('_waterWave');
      this.textures.addCanvas('_waterWave', waveCvs);
      this.waterWaveSprite = this.add.tileSprite(wb.x, wb.y, wb.width, wb.height, '_waterWave').setOrigin(0);
      this.waterWaveSprite.setDepth(-8999);
      this.worldLayer.add(this.waterWaveSprite);
      // Geometry mask from marching-squares outline — clips depth + wave to water shape
      this.waterMaskGraphics = this.add.graphics();
      this.waterMaskGraphics.fillStyle(0xffffff);
      this.waterMaskGraphics.beginPath();
      for (let i = 0; i < maskPoints.length; i += 2) {
        const a = maskPoints[i], b = maskPoints[i + 1];
        this.waterMaskGraphics.moveTo(a.x, a.y);
        this.waterMaskGraphics.lineTo(b.x, b.y);
      }
      this.waterMaskGraphics.closePath();
      this.waterMaskGraphics.fillPath();
      this.waterMask = this.waterMaskGraphics.createGeometryMask();
      this.waterMaskGraphics.setVisible(false);
      this.waterDepthSprite.setMask(this.waterMask);
      this.waterWaveSprite.setMask(this.waterMask);
      // eslint-disable-next-line no-console
      console.log('[Water] depth canvas + wave texture, cells:', waterCells.length, '/', grid.length);
      this.waterAnimFrame = 0;
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
    // Scroll wave texture for animated water surface
    if (this.waterWaveSprite) {
      this.waterWaveSprite.tilePositionX += dt * 0.3;
      this.waterWaveSprite.tilePositionY += dt * 0.12;
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
