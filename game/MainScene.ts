import Phaser from 'phaser';

import groundImg from '../assets/textures/ground.jpg';
import fieldImg from '../assets/textures/field.png';
import barracksImg from '../assets/textures/barracks.png';
import lumberImg from '../assets/textures/lumber.png';
import townhallImg from '../assets/textures/townhall.png';
import flareImg from '../assets/textures/flare.png';
import treeImg from '../assets/textures/tree.png';
import stumpImg from '../assets/textures/stump.png';
import houseImg from '../assets/textures/house.png';
import lodgeImg from '../assets/textures/lodge.png';
import smokeImg from '../assets/textures/smoke.png';
import terrainSandImg from '../assets/textures/terrain_sand.png';
import terrainSwampImg from '../assets/textures/terrain_swamp.png';
import terrainGrassImg from '../assets/textures/terrain_grass.png';
import terrainJungleImg from '../assets/textures/terrain_jungle.png';
import terrainForestImg from '../assets/textures/terrain_forest.png';
import terrainTundraImg from '../assets/textures/terrain_tundra.png';
import terrainScrubImg from '../assets/textures/terrain_scrub.png';
import terrainStoneImg from '../assets/textures/terrain_stone.png';
import waterFoamImg from '../assets/textures/water-foam.jpg';
import pikesmanImg from '../assets/textures/units/pikesman.png';
import cavalryImg from '../assets/textures/units/cavalry.png';
import legionImg from '../assets/textures/units/legion.png';
import archerImg from '../assets/textures/units/archer.png';
import slingerImg from '../assets/textures/units/slinger.png';
import axemanImg from '../assets/textures/units/axeman.png';
import hopliteImg from '../assets/textures/units/hoplite.png';
import chariotImg from '../assets/textures/units/chariot.png';
import ramImg from '../assets/textures/units/ram.png';
import villagerUnitImg from '../assets/textures/units/villager.png';
import { EVENTS, INITIAL_RESOURCES, MAP_SIZES, FACTION_COLORS, AGE_CONFIGS, getNextAge, SEASON_DURATION_MS, SEASON_CONFIG, SEASON_ORDER, TECH_DEFS, GOLD_MINE_RESPAWN_MS, DOMINANCE_CONTROL_THRESHOLD, DOMINANCE_HOLD_TIME_MS, DOMINANCE_MIN_BUILDINGS, DEFAULT_MAP_SEED, DEFAULT_MAP_PRESET, CASTLE_GARRISON_RANGE, CASTLE_GARRISON_FIRE_INTERVAL, CASTLE_GARRISON_DAMAGE_PER_UNIT, STRESS_RENDER_INTERVAL } from '../constants';
import { BuildingType, FactionType, Resources, UnitType, MapMode, MapSize, MapPreset, FormationType, UnitStance, Age, Season, TechId, GameResult, VictoryType, GameUnit } from '../types';
import { toIso, toIsoElev } from './utils/iso';
import { createSeededRandom } from './utils/seededRandom';
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
import { ResearchManager } from './systems/ResearchManager';
import { LiquidCombatSystem } from './systems/LiquidCombatSystem';
import { serializeGame, saveToLocalStorage, loadFromLocalStorage, deserializeGame, isPendingLoad, clearPendingLoad } from './systems/SaveSystem';

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

  // Water animation control (A/B measurement — not a completed FPS fix)
  public waterAnimationEnabled: boolean = true;

  // Age System
  public currentAge: Age = Age.VILLAGE;
  public ageProgress: number = 0; // 0–1 during advancement
  public isAdvancing: boolean = false;
  public nextAge: Age | null = null;

  // Win/Lose Conditions
  public gameResult: GameResult = GameResult.PLAYING;
  private lastWinLoseCheckTime: number = 0;
  public dominanceProgress: number = 0; // 0 to DOMINANCE_HOLD_TIME_MS, how long player has held ≥60%
  public playerTerritoryPercent: number = 0; // Current % controlled (0–1)
  public victoryType: VictoryType = VictoryType.CONQUEST;

  // Diplomacy
  public peacefulMode: boolean = false;
  public treatyLength: number = 0; // ms
  public aiDisabled: boolean = false;

  // Map Seed
  public mapSeed: number = 0;
  // Map Preset
  public mapPreset: MapPreset = MapPreset.STANDARD;

  // Debug
  public debugMode: boolean = false;
  public showUnitIndicators: boolean = true;
  private debugText!: Phaser.GameObjects.Text;

  // Game Speed & Time
  public gameSpeed: number = 1;
  public gameTime: number = 0;
  private accumulatedTime: number = 0;
  private accumulatedPopTime: number = 0;
  // Seasonal Clock
  public currentSeason: Season = Season.SUMMER;
  private seasonTimer: number = 0;
  private lastAnimalCallTime: number = 0;
  // Auto-save
  private autoSaveTickCounter: number = 0;
  private lastGarrisonFireTime: number = 0;
  private minimapClickHandler: ((e: Event) => void) | null = null;

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
  public researchManager!: ResearchManager;
  public liquidCombat!: LiquidCombatSystem;
  // Water layer (FIXED map only). Null in INFINITE mode so update() no-ops.
  private waterDepthSprite: Phaser.GameObjects.Sprite | null = null;
  private waterWaveSprite: Phaser.GameObjects.TileSprite | null = null;
  private waterMaskBounds: Phaser.Geom.Rectangle | null = null;
  private waterAnimFrame: number = 0;
  private lastFogUpdateTime: number = -Infinity;

  // Precomputed spatial data for shore chains (normals + phase offsets)
  private waterShoreChainData: { px: number; py: number; nx: number; ny: number; ph1: number; ph2: number }[][] = [];

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
    this.load.image('terrain_sand', terrainSandImg);
    this.load.image('terrain_swamp', terrainSwampImg);
    this.load.image('terrain_grass', terrainGrassImg);
    // Unit sprites (48x48, white base for faction tinting)
    this.load.image('unit_pikesman', pikesmanImg);
    this.load.image('unit_cavalry', cavalryImg);
    this.load.image('unit_legion', legionImg);
    this.load.image('unit_archer', archerImg);
    this.load.image('unit_slinger', slingerImg);
    this.load.image('unit_axeman', axemanImg);
    this.load.image('unit_hoplite', hopliteImg);
    this.load.image('unit_chariot', chariotImg);
    this.load.image('unit_ram', ramImg);
    this.load.image('unit_villager', villagerUnitImg);
    this.load.image('terrain_jungle', terrainJungleImg);
    this.load.image('terrain_forest', terrainForestImg);
    this.load.image('terrain_tundra', terrainTundraImg);
    this.load.image('terrain_scrub', terrainScrubImg);
    this.load.image('terrain_stone', terrainStoneImg);
    this.load.image('house', houseImg);
    this.load.image('barracks', barracksImg);
    this.load.image('lodge', lodgeImg);
    this.load.image('smoke', smokeImg);
    this.load.image('waterFoam', waterFoamImg);
  }

  public stressTestConfig: { unitCount: number; enableEnemies?: boolean } | null = null;

  init(data: { faction?: FactionType, mapMode?: MapMode, fowEnabled?: boolean, peacefulMode?: boolean, treatyLength?: number, mapSize?: MapSize, aiDisabled?: boolean, stressTestConfig?: { unitCount: number; enableEnemies?: boolean } | null, mapSeed?: number, mapPreset?: MapPreset }) {
    this.waterAnimationEnabled = true;
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;

    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    this.peacefulMode = data.peacefulMode === true;
    this.treatyLength = (data.treatyLength || 0) * 60 * 1000;
    // URL param auto-trigger: ?stress=500 or ?stress=1000 for headless testing
    // Optional: ?enableEnemies=true to enable combat in stress mode
    if (!this.stressTestConfig && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const stressCount = parseInt(params.get('stress') || '0', 10);
      const enableEnemies = params.get('enableEnemies') === 'true';
      if (stressCount > 0) {
        this.stressTestConfig = { unitCount: stressCount, enableEnemies };
      }
    }
    // Stress test with combat: override peaceful mode to ensure enemies fight
    if (this.stressTestConfig && this.stressTestConfig.enableEnemies) {
      this.peacefulMode = false;
    }

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
    this.maxPopulation = 8;
    this.happiness = 100;
    this.taxRate = 0;
    this.gameSpeed = 0.75;
    this.aiDisabled = data.aiDisabled === true;
    this.currentAge = Age.VILLAGE;
    this.ageProgress = 0;
    this.isAdvancing = false;
    this.nextAge = null;
    this.gameResult = GameResult.PLAYING;
    this.lastWinLoseCheckTime = 0;
    this.dominanceProgress = 0;
    this.playerTerritoryPercent = 0;
    this.victoryType = VictoryType.CONQUEST;

    // Map seed: 0 = random, any other value = deterministic
    this.mapSeed = data.mapSeed ?? DEFAULT_MAP_SEED;
    if (this.mapSeed === 0) this.mapSeed = Math.floor(Math.random() * 999999) + 1;
    // Map preset: terrain style (Standard, Island, Desert, etc.)
    this.mapPreset = data.mapPreset ?? DEFAULT_MAP_PRESET;
  }

  create() {
    this.game.canvas.oncontextmenu = (e) => e.preventDefault();

    // Programmatic performance API — agents/evaluate() read this
    if (!window.__perf) {
      const MAX = 60;
      const buffer: PerfSnapshot[] = [];
      let latest: PerfSnapshot | null = null;
      let scene: { gameTime: number; atmosphericSystem?: { setPostFXEnabled(enabled: boolean): void }; waterAnimationEnabled: boolean } | null = null;
      let startTime = 0;
      window.__perf = {
        buffer,
        get latest() { return latest; },
        set latest(v: PerfSnapshot | null) { latest = v; },
        get maxSamples() { return MAX; },
        setPostFX(enabled: boolean) { scene?.atmosphericSystem?.setPostFXEnabled(enabled); },
        setWaterAnimation(enabled: boolean) { if (scene) { scene.waterAnimationEnabled = enabled; } },
        bind(s: { gameTime: number; atmosphericSystem?: { setPostFXEnabled(enabled: boolean): void }; waterAnimationEnabled: boolean }) { scene = s; startTime = s.gameTime; },
        reset() { buffer.length = 0; latest = null; startTime = scene?.gameTime ?? 0; },
        report() {
          const elapsedS = scene ? (scene.gameTime - startTime) / 1000 : 0;
          if (buffer.length === 0) return { buffer: [], summary: null, elapsedS };
          const copy = buffer.map(sample => ({ ...sample, hogs: sample.hogs.map(h => ({ ...h })) }));
          return {
            buffer: copy,
            summary: copy[copy.length - 1],
            elapsedS,
          };
        },
      };
      window.__perf.bind(this);
    } else {
      window.__perf.bind(this);
      window.__perf.reset();
    }

    // Generate robust textures
    if (!this.textures.exists('white_flare')) {
      const graphics = this.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(4, 4, 4);
      graphics.generateTexture('white_flare', 8, 8);
    }
    // LOD Blitter textures: white dot (8x8) and white rect (4x6) — tinted per faction
    if (!this.textures.exists('lod_dot')) {
      const gDot = this.make.graphics({ x: 0, y: 0 });
      gDot.fillStyle(0xffffff, 1);
      gDot.fillCircle(4, 4, 3);
      gDot.generateTexture('lod_dot', 8, 8);
    }
    if (!this.textures.exists('lod_rect')) {
      const gRect = this.make.graphics({ x: 0, y: 0 });
      gRect.fillStyle(0xffffff, 1);
      gRect.fillRect(0, 0, 4, 6);
      gRect.generateTexture('lod_rect', 4, 6);
    }
    this.pathfinder = new Pathfinder(this.mapWidth, this.mapHeight);
    this.treeSpatialHash = new SpatialHash(250); // 250px cells (approx 1-2 trees width)
    this.unitSpatialHash = new SpatialHash(150); // 150px cells for unit queries
    this.entityFactory = new EntityFactory(this);
    this.squadSystem = new SquadSystem(this);

    // Create World Layer for PostFX
    this.worldLayer = this.add.layer();

    this.groundLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'ground');
    this.groundLayer.setOrigin(0, 0);
    this.groundLayer.setDepth(-20000);
    // Green multiply on brown ground tex → grass, not grey dirt
    this.groundLayer.setTint(0xb4e070);
    this.worldLayer.add(this.groundLayer);
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
    const mapRng = createSeededRandom(this.mapSeed);
    this.mapGenerationSystem = new MapGenerationSystem(this, mapRng);
    this.cullingSystem = new CullingSystem(this);
    this.feedbackSystem = new FeedbackSystem(this);
    this.atmosphericSystem = new AtmosphericSystem(this);
    this.villagerSystem = new VillagerSystem(this);
    this.animalSystem = new AnimalSystem(this);
    this.proceduralSound = new ProceduralSoundSystem(this);
    this.clashSystem = new ClashSystem(this);
    this.liquidCombat = new LiquidCombatSystem(this);
    this.researchManager = new ResearchManager(this);
    
    this.terrainSystem = new TerrainSystem(this, this.mapWidth, this.mapHeight, this.mapSeed, this.mapPreset);
    this.terrainSystem.generateHeightMap();
    // Guarantee dry land at faction spawn points — raise terrain above water
    const spawnSafeRadius = 150;
    const spawnMinHeight = this.terrainSystem.getWaterLevel() + 0.05;
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;
    this.terrainSystem.flattenAroundWorld(cx, cy, spawnSafeRadius, spawnMinHeight);
    // Flatten AI base corner
    const aiBaseX = this.mapWidth * 0.15;
    const aiBaseY = this.mapHeight * 0.15;
    this.terrainSystem.flattenAroundWorld(aiBaseX, aiBaseY, spawnSafeRadius, spawnMinHeight);
    this.terrainSystem.flattenAroundWorld(cx + 400, cy - 50, spawnSafeRadius, spawnMinHeight);
    // Generate rivers that follow low terrain valleys (natural chokepoints)
    this.terrainSystem.generateRivers();
    this.terrainSystem.applyVisualTinting();
    // Wire biome pathfinding costs to terrain
    this.pathfinder.updateTerrainCosts(this.terrainSystem, this.currentSeason);

    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
      // ── Water layer: smooth MS shoreline + foam texture ────────────────
      const dim = this.terrainSystem.getGridDimensions();
      const grid = this.terrainSystem.getHeightMapData();
      const cellSize = dim.cellSize;
      const level = this.terrainSystem.getWaterLevel();
      // Punchy teal → deep blue (high sat so water pops vs grass)
      const shallowR = 40, shallowG = 175, shallowB = 210;
      const deepR = 12, deepG = 70, deepB = 145;
      const BLUR_PAD = 4; // room for soft edge blur

      const sample = (wx: number, wy: number) => this.terrainSystem.getHeightInterpolated(wx, wy);
      const edgePt = (
        ax: number, ay: number, ha: number,
        bx: number, by: number, hb: number
      ) => {
        const t = (level - ha) / (hb - ha || 1e-6);
        return toIso(ax + (bx - ax) * t, ay + (by - ay) * t);
      };

      // Marching-squares polys in iso world space + depth
      type WaterPoly = { pts: { x: number; y: number }[]; depth: number; shore: boolean; isCross: boolean[] };
      const waterPolys: WaterPoly[] = [];
      let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
      const expand = (pts: { x: number; y: number }[]) => {
        for (const p of pts) {
          if (p.x < wMinX) wMinX = p.x; if (p.x > wMaxX) wMaxX = p.x;
          if (p.y < wMinY) wMinY = p.y; if (p.y > wMaxY) wMaxY = p.y;
        }
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
          const mask = m0 | (m1 << 1) | (m2 << 2) | (m3 << 3);
          if (mask === 0) continue;

          const c0 = toIso(wx, wy);
          const c1 = toIso(wx + cellSize, wy);
          const c2 = toIso(wx + cellSize, wy + cellSize);
          const c3 = toIso(wx, wy + cellSize);
          const e0 = () => edgePt(wx, wy, h0, wx + cellSize, wy, h1);
          const e1 = () => edgePt(wx + cellSize, wy, h1, wx + cellSize, wy + cellSize, h2);
          const e2 = () => edgePt(wx + cellSize, wy + cellSize, h2, wx, wy + cellSize, h3);
          const e3 = () => edgePt(wx, wy + cellSize, h3, wx, wy, h0);

          let depthSum = 0, wetCount = 0;
          for (const h of [h0, h1, h2, h3]) {
            if (h < level) { depthSum += (level - h) / level; wetCount++; }
          }
          const depth = Math.min(1, depthSum / Math.max(1, wetCount));

          // Saddle cases: two separate tris (self-crossing if merged)
          if (mask === 5) {
            const a = [c0, e0(), e3()]; const b = [c2, e1(), e2()];
            waterPolys.push({ pts: a, depth, shore: true, isCross: [false, true, true] });
            waterPolys.push({ pts: b, depth, shore: true, isCross: [false, true, true] });
            expand(a); expand(b); continue;
          }
          if (mask === 10) {
            const a = [c1, e0(), e1()]; const b = [c3, e2(), e3()];
            waterPolys.push({ pts: a, depth, shore: true, isCross: [false, true, true] });
            waterPolys.push({ pts: b, depth, shore: true, isCross: [false, true, true] });
            expand(a); expand(b); continue;
          }

          let pts: { x: number; y: number }[];
          let isCross: boolean[];
          switch (mask) {
            case 1:  pts = [c0, e0(), e3()]; isCross = [false, true, true]; break;
            case 2:  pts = [c1, e1(), e0()]; isCross = [false, true, true]; break;
            case 3:  pts = [c0, c1, e1(), e3()]; isCross = [false, false, true, true]; break;
            case 4:  pts = [c2, e2(), e1()]; isCross = [false, true, true]; break;
            case 6:  pts = [c1, c2, e2(), e0()]; isCross = [false, false, true, true]; break;
            case 7:  pts = [c0, c1, c2, e2(), e3()]; isCross = [false, false, false, true, true]; break;
            case 8:  pts = [c3, e3(), e2()]; isCross = [false, true, true]; break;
            case 9:  pts = [c0, e0(), e2(), c3]; isCross = [false, true, true, false]; break;
            case 11: pts = [c0, c1, e1(), e2(), c3]; isCross = [false, false, true, true, false]; break;
            case 12: pts = [c2, c3, e3(), e1()]; isCross = [false, false, true, true]; break;
            case 13: pts = [c0, e0(), e1(), c2, c3]; isCross = [false, true, true, false, false]; break;
            case 14: pts = [c1, c2, c3, e3(), e0()]; isCross = [false, false, false, true, true]; break;
            default: pts = [c0, c1, c2, c3]; isCross = [false, false, false, false]; break;
          }
          waterPolys.push({ pts, depth, shore: mask !== 15, isCross });
          expand(pts);
        }
      }

      if (waterPolys.length === 0) {
        // No water on this map — still run map gen
        this.pathfinder.applyWaterMask(
          (wx, wy) => this.terrainSystem.getHeightAt(wx, wy), level
        );
        this.waterAnimFrame = 0;
        this.mapGenerationSystem.createEnvironment();
        this.mapGenerationSystem.generateFertileZones();
        this.mapGenerationSystem.generateForestsAndAnimals();
      } else {
      this.waterMaskBounds = new Phaser.Geom.Rectangle(
        wMinX - BLUR_PAD, wMinY - BLUR_PAD,
        Math.ceil(wMaxX - wMinX) + BLUR_PAD * 2,
        Math.ceil(wMaxY - wMinY) + BLUR_PAD * 2
      );
      const wb = this.waterMaskBounds;

      // Depth canvas: solid MS body + thin soft rim (not whole-body fade)
      const depthCvs = document.createElement('canvas');
      depthCvs.width = Math.max(1, Math.ceil(wb.width));
      depthCvs.height = Math.max(1, Math.ceil(wb.height));
      const dCtx = depthCvs.getContext('2d')!;

      for (const poly of waterPolys) {
        const t = poly.depth;
        // Interior solid; only edge MS polys get mid alpha for soft ground→water
        const alpha = poly.shore ? (0.65 + 0.25 * t) : (0.92 + 0.08 * t);
        const r = Math.floor(shallowR + (deepR - shallowR) * t);
        const gg = Math.floor(shallowG + (deepG - shallowG) * t);
        const b = Math.floor(shallowB + (deepB - shallowB) * t);
        dCtx.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
        dCtx.beginPath();
        const p0 = poly.pts[0];
        dCtx.moveTo(p0.x - wb.x, p0.y - wb.y);
        for (let i = 1; i < poly.pts.length; i++) {
          dCtx.lineTo(poly.pts[i].x - wb.x, poly.pts[i].y - wb.y);
        }
        dCtx.closePath();
        dCtx.fill();
      }
      // Reset arrays before one-time init (supports scene re-init)
      const waterShoreChains: number[][] = [];
      // ── Extract shore edge chains + glint points (one-time init) ──
      {
        const segSet = new Set<string>();
        const segments: [number, number, number, number][] = [];
        for (const poly of waterPolys) {
          const n = poly.pts.length;
          for (let i = 0; i < n; i++) {
            const ni = (i + 1) % n;
            if (!(poly.isCross[i] && poly.isCross[ni])) continue;
            const p1 = poly.pts[i], p2 = poly.pts[ni];
            const lx1 = p1.x - wb.x, ly1 = p1.y - wb.y;
            const lx2 = p2.x - wb.x, ly2 = p2.y - wb.y;
            const key = lx1 < lx2 || (lx1 === lx2 && ly1 < ly2)
              ? `${(lx1*10|0)},${(ly1*10|0)},${(lx2*10|0)},${(ly2*10|0)}`
              : `${(lx2*10|0)},${(ly2*10|0)},${(lx1*10|0)},${(ly1*10|0)}`;
            if (segSet.has(key)) continue;
            segSet.add(key);
            segments.push([lx1, ly1, lx2, ly2]);
          }
        }
        // Merge into chains
        const used = new Uint8Array(segments.length);
        const epMap = new Map<string, number[]>();
        const ek = (x: number, y: number) => `${(x * 10 | 0)},${(y * 10 | 0)}`;
        for (let i = 0; i < segments.length; i++) {
          const [x1, y1, x2, y2] = segments[i];
          let a = epMap.get(ek(x1, y1)); if (!a) { a = []; epMap.set(ek(x1, y1), a); } a.push(i);
          let b = epMap.get(ek(x2, y2)); if (!b) { b = []; epMap.set(ek(x2, y2), b); } b.push(i);
        }
        for (let i = 0; i < segments.length; i++) {
          if (used[i]) continue;
          used[i] = 1;
          const chain: number[] = [segments[i][0], segments[i][1], segments[i][2], segments[i][3]];
          let cx = segments[i][2], cy = segments[i][3];
          let fwd = true;
          while (fwd) {
            fwd = false;
            for (const ni of (epMap.get(ek(cx, cy)) || [])) {
              if (used[ni]) continue;
              used[ni] = 1;
              const [sx, sy, ex, ey] = segments[ni];
              if (Math.abs(sx - cx) < 0.2 && Math.abs(sy - cy) < 0.2) {
                chain.push(ex, ey); cx = ex; cy = ey; fwd = true; break;
              } else if (Math.abs(ex - cx) < 0.2 && Math.abs(ey - cy) < 0.2) {
                chain.push(sx, sy); cx = sx; cy = sy; fwd = true; break;
              }
            }
          }
          if (chain.length >= 6) waterShoreChains.push(chain);
        }
        // Cache static spatial terms; time-dependent sine evaluation remains per frame.
        this.waterShoreChainData = waterShoreChains.map(chain => {
          const points: { px: number; py: number; nx: number; ny: number; ph1: number; ph2: number }[] = [];
          for (let i = 0; i < chain.length; i += 2) {
            const px = chain[i], py = chain[i + 1];
            const dx = wb.width * 0.5 - px, dy = wb.height * 0.5 - py;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            points.push({ px, py, nx: dx / len, ny: dy / len, ph1: px * 0.015 + py * 0.01, ph2: px * 0.007 - py * 0.013 });
          }
          return points;
        });
        console.warn('[Water] shore segments:', segments.length, 'epMap keys:', epMap.size, 'chains:', waterShoreChains.length);
        if (segments.length > 0 && waterShoreChains.length === 0) {
          console.warn('[Water] ALL chains dropped — segments exist but none linked into chains >= 6 pts');
        }
      }

      // 1px blur = thin AA rim at shoreline only (not whole-body washout)
      const softCvs = document.createElement('canvas');
      softCvs.width = depthCvs.width;
      softCvs.height = depthCvs.height;
      const sCtx = softCvs.getContext('2d')!;
      sCtx.filter = 'blur(1px)';
      sCtx.drawImage(depthCvs, 0, 0);
      sCtx.filter = 'none';

      if (this.textures.exists('_waterDepth')) this.textures.remove('_waterDepth');
      this.textures.addCanvas('_waterDepth', softCvs);
      this.waterDepthSprite = this.add.sprite(wb.x, wb.y, '_waterDepth').setOrigin(0);
      this.waterDepthSprite.setDepth(-9000);
      this.waterDepthSprite.setDisplaySize(softCvs.width, softCvs.height);
      this.worldLayer.add(this.waterDepthSprite);

      // Sea foam texture: tileScale y*0.5 matches iso ground compress
      this.waterWaveSprite = this.add.tileSprite(wb.x, wb.y, wb.width, wb.height, 'waterFoam').setOrigin(0);
      this.waterWaveSprite.setDepth(-8999);
      this.waterWaveSprite.setAlpha(0.12); // subtle surface grain
      this.waterWaveSprite.setTileScale(0.35, 0.175);
      this.worldLayer.add(this.waterWaveSprite);

      // Static shoreline highlight (drawn once from chains, 0ms/frame)
      if (this.waterShoreChainData.length > 0) {
        const shoreCvs = document.createElement('canvas');
        shoreCvs.width = wb.width;
        shoreCvs.height = wb.height;
        const sctx = shoreCvs.getContext('2d')!;
        sctx.strokeStyle = 'rgba(255,255,255,0.18)';
        sctx.lineWidth = 2;
        sctx.lineCap = 'round';
        sctx.lineJoin = 'round';
        for (const points of this.waterShoreChainData) {
          sctx.beginPath();
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (i === 0) sctx.moveTo(p.px, p.py);
            else sctx.lineTo(p.px, p.py);
          }
          sctx.stroke();
        }
        if (this.textures.exists('_waterShore')) this.textures.remove('_waterShore');
        this.textures.addCanvas('_waterShore', shoreCvs);
        const shoreSprite = this.add.sprite(wb.x, wb.y, '_waterShore').setOrigin(0);
        shoreSprite.setDepth(-8998);
        this.worldLayer.add(shoreSprite);
      }

      const maskSprite = this.add.sprite(wb.x, wb.y, '_waterDepth').setOrigin(0).setVisible(false);
      this.waterWaveSprite.setMask(maskSprite.createBitmapMask());

      this.pathfinder.applyWaterMask(
        (wx, wy) => this.terrainSystem.getHeightAt(wx, wy),
        level
      );
      this.waterAnimFrame = 0;
      this.mapGenerationSystem.createEnvironment();
      this.mapGenerationSystem.generateFertileZones();
      this.mapGenerationSystem.generateForestsAndAnimals();
      // eslint-disable-next-line no-console
      console.log('[Water] smooth MS polys + soft shore:', waterPolys.length, '/', grid.length);
      } // end waterPolys.length > 0
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
    // Spawn gold mines near player's starting TC
    this.mapGenerationSystem.spawnStartingGoldMines(centerX, centerY);

    // Pre-spawn AI base (TC + villagers + resources) to prevent 3s instant-win window
    // and ensure AI never bricks on water/stone spawn
    if (!isPendingLoad()) {
      const aiTC = this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, this.enemyAI.baseX, this.enemyAI.baseY, 1);
      this.enemyAI.buildings[0] = aiTC; // Mark slot 0 as built
      this.enemyAI.buildIndex = 1; // Start tickBuild from slot 1
      // Deduct TC cost from AI resources
      this.enemyAI.resources.wood -= 300;
      this.enemyAI.resources.gold -= 100;
      // Spawn starting villagers
      this.villagerSystem.spawnVillager(this.enemyAI.baseX + 50, this.enemyAI.baseY + 50, 1);
      this.villagerSystem.spawnVillager(this.enemyAI.baseX - 50, this.enemyAI.baseY + 50, 1);
      // Spawn guaranteed resources
      this.mapGenerationSystem.spawnStartingForest(this.enemyAI.baseX, this.enemyAI.baseY);
      this.mapGenerationSystem.spawnStartingGoldMines(this.enemyAI.baseX, this.enemyAI.baseY);
    }

    const startIso = toIso(centerX, centerY);
    this.cameras.main.centerOn(startIso.x, startIso.y);
    this.cameras.main.setBackgroundColor('#3a4d5c');

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

    // Stress test debug keybindings: spawn N units and command move
    const stressKeys: Record<string, number> = { 'F5': 500, 'F6': 1000, 'F7': 2000 };
    for (const [key, count] of Object.entries(stressKeys)) {
      this.input.keyboard!.on(`keydown-${key}`, () => {
        const cx = this.mapWidth / 2;
        const cy = this.mapHeight / 2;
        const cols = Math.ceil(Math.sqrt(count));
        const spacing = 24;
        const startX = cx - (cols * spacing) / 2;
        const startY = cy - (cols * spacing) / 2;
        const units: Phaser.GameObjects.GameObject[] = [];
        for (let i = 0; i < count; i++) {
          const x = startX + (i % cols) * spacing + Phaser.Math.Between(-4, 4);
          const y = startY + Math.floor(i / cols) * spacing + Phaser.Math.Between(-4, 4);
          const type = i % 3 === 0 ? UnitType.ARCHER : (i % 3 === 1 ? UnitType.PIKESMAN : UnitType.CAVALRY);
          const u = this.entityFactory.spawnUnit(type, x, y, 0);
          if (u) units.push(u as unknown as Phaser.GameObjects.GameObject);
        }
        // Command move toward enemy AI base — triggers flow field (≥12 units)
        const tx = this.enemyAI.baseX ?? cx + 400;
        const ty = this.enemyAI.baseY ?? cy - 50;
        this.unitSystem.commandMove(units, new Phaser.Math.Vector2(tx, ty));
        this.debugMode = true;
        this.debugText.setVisible(true);
        console.warn(`[STRESS] Spawned ${units.length} units, commanding move to (${tx.toFixed(0)}, ${ty.toFixed(0)})`);
      });
    }

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

    this.minimapClickHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.handleMinimapClick(detail.x, detail.y);
    };
    window.addEventListener('minimap-click-ui', this.minimapClickHandler);

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
      const config = this.stressTestConfig;
      const peacefulStress = !config.enableEnemies;
      // Hide environment to reduce fill-rate (applies to both peaceful and combat stress)
      this.waterAnimationEnabled = false;
      this.atmosphericSystem.setPostFXEnabled(false);
      if (this.terrainSystem.visualSprite) {
        this.terrainSystem.visualSprite.setVisible(false);
      }
      this.groundLayer.setVisible(false);
      this.waterDepthSprite?.setVisible(false);
      this.waterWaveSprite?.setVisible(false);
      this.setupStressTest();
      // Detach static fill-rate sprites; combat stress keeps unit visuals in worldLayer.
      if (peacefulStress) {
        const stressDot = this.squadSystem.lodDotBlitter;
        this.worldLayer.removeAll(false);
        this.worldLayer.add(stressDot);
      }
    }

    // --- UI CAMERA SETUP (Must be done AFTER systems init) ---
    this.uiGroup = this.add.group({ runChildUpdate: true });
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    if (this.stressTestConfig) {
      this.uiCamera.visible = false;
      this.fogOfWar?.screenRT.setVisible(false);
      this.atmosphericSystem.clouds.forEach(cloud => cloud.setVisible(false));
    }
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
    this.game.events.on(EVENTS.ADVANCE_AGE, () => {
      this.startAgeAdvancement();
    });
    // Listen for research requests from React UI
    this.game.events.on(EVENTS.START_RESEARCH, (techId: TechId) => {
      const def = TECH_DEFS[techId];
      if (def && this.researchManager.tryStart(0, techId, this.currentAge, def.hostBuildingTypes[0])) {
        this.economySystem.updateStats();
      }
    });
    // Listen for research completion — notify player
    this.events.on(EVENTS.RESEARCH_COMPLETED, (data: { playerId: number; techId: TechId }) => {
      const def = TECH_DEFS[data.techId];
      if (def) this.feedbackSystem.notifyResearchComplete(def.name);
      if (data.playerId === 0) {
        const cam = this.cameras.main;
        this.proceduralSound.playResearchComplete(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2);
      }
      // Immediately update GameStats to ensure React UI reflects completed research
      if (this.economySystem) {
        this.economySystem.updateStats();
      }
    });
    // Listen for season changes — update visuals, sound, and feedback
    this.events.on(EVENTS.SEASON_CHANGED, (data: { season: Season }) => {
      this.atmosphericSystem.applySeasonalTint(data.season);
      this.proceduralSound.setSeasonalWind(data.season);
    });
    this.events.on(EVENTS.AI_AGE_ADVANCED, (age: Age) => {
      const name = AGE_CONFIGS[age]?.name ?? age;
      this.feedbackSystem.addNotification(`⚔️ Enemy entered ${name}!`, 'warning', 6000);
    });
    // Listen for garrison release requests from React UI
    this.game.events.on('release-garrison', () => {
      const selBuilding = this.inputManager.selectedBuilding as Phaser.GameObjects.Image | null;
      if (!selBuilding) return;
      const def = selBuilding.getData('def');
      if (!def || def.type !== BuildingType.CASTLE) return;
      const garrison: Record<string, number> = selBuilding.getData('garrison') || {};
      const total = Object.values(garrison).reduce((s, n) => s + n, 0);
      if (total === 0) return;

      // Spawn units near the castle
      let offset = 0;
      for (const [typeStr, count] of Object.entries(garrison)) {
        for (let i = 0; i < count; i++) {
          const angle = (offset / total) * Math.PI * 2;
          const spawnX = selBuilding.x + Math.cos(angle) * 60;
          const spawnY = selBuilding.y + Math.sin(angle) * 60;
          this.entityFactory.spawnUnit(typeStr as UnitType, spawnX, spawnY, 0);
          offset++;
        }
      }
      selBuilding.setData('garrison', {});
      this.feedbackSystem.showFloatingText(selBuilding.x, selBuilding.y - 40, `${total} units released`, '#4ade80');
      this.economySystem.updateStats();
    });

    // ─── Save/Load event listeners ───────────────────────────────────
    this.game.events.on('save-game', () => {
      this.saveGame();
    });
    this.game.events.on('load-game', () => {
      this.loadGame();
    });

    // Check for pending load (from Continue Game in main menu)
    if (isPendingLoad()) {
      clearPendingLoad();
      const save = loadFromLocalStorage();
      if (save) {
        // Delay to let terrain/visuals finish settling, then load and mark ready
        this.time.delayedCall(500, () => {
          deserializeGame(this, save);
          this.feedbackSystem.addNotification('💾 Game loaded!', 'success', 3000);
          this.isReady = true;
        });
      } else {
        // Save was cleared or corrupt; fall through to normal game
        this.isReady = true;
      }
    } else {
      // Normal game: no pending load, ready immediately after setup
      this.isReady = true;
    }
    this.proceduralSound.startAmbientWind();

    // Lifecycle teardown: close the AudioContext and detach the clash listener
    // on scene shutdown so neither leaks across scene restarts (P2a / P3b).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.proceduralSound.destroy();
        this.clashSystem.destroy();
        if (this.minimapClickHandler) {
            window.removeEventListener('minimap-click-ui', this.minimapClickHandler);
            this.minimapClickHandler = null;
        }
    });
  }


  public isReady = false;
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

  public checkWinLose(): void {
    if (this.gameResult !== GameResult.PLAYING) return;

    // WIN: AI Town Center destroyed (owner=1 TC missing or dead)
    // Skip conquest win if AI is disabled or in peaceful mode
    if (!this.aiDisabled && !this.peacefulMode) {
      const aiTC = this.buildings.getChildren().find(
        (b: any) => b.getData('owner') === 1 && b.getData('def')?.type === BuildingType.TOWN_CENTER && b.getData('hp') > 0 // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      if (!aiTC) {
        this.victoryType = VictoryType.CONQUEST;
        this.dominanceProgress = 0;
        this.playerTerritoryPercent = 0;
        this.gameResult = GameResult.WON;
        this.feedbackSystem.addNotification('🏆 Victory! The enemy falls!', 'success', 30000);
        return;
      }
    }

    // LOSE: Player Town Center destroyed
    const playerTC = this.buildings.getChildren().find(
      (b: any) => b.getData('owner') === 0 && b.getData('def')?.type === BuildingType.TOWN_CENTER && b.getData('hp') > 0 // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    if (!playerTC) {
      this.dominanceProgress = 0;
      this.playerTerritoryPercent = 0;
      this.gameResult = GameResult.LOST;
      this.events.emit(EVENTS.GAME_OVER, GameResult.LOST);
      this.feedbackSystem.addNotification('💀 Defeat... Your civilization falls.', 'danger', 30000);
    }
  }

  public checkDominance(): void {
    if (this.gameResult !== GameResult.PLAYING) return;

    // Count buildings by owner to estimate territory control (exclude TCs for fairness)
    const totalBuildings = this.buildings.getChildren().filter(
      (b) => b.getData('hp') > 0 && b.getData('def')?.type !== BuildingType.TOWN_CENTER
    );
    if (totalBuildings.length === 0) return;
    if (totalBuildings.length < DOMINANCE_MIN_BUILDINGS) {
      this.dominanceProgress = 0;
      this.playerTerritoryPercent = 0;
      return;
    }

    // Require minimum enemy presence: at least 1 non-TC building by AI
    const enemyNonTCBuildings = totalBuildings.filter((b) => b.getData('owner') === 1).length;
    if (enemyNonTCBuildings === 0) {
      // AI has no non-TC buildings; no dominance victory yet
      this.dominanceProgress = 0;
      this.playerTerritoryPercent = 0;
      return;
    }

    const playerBuildings = totalBuildings.filter((b) => b.getData('owner') === 0).length;
    this.playerTerritoryPercent = playerBuildings / totalBuildings.length;

    if (this.playerTerritoryPercent >= DOMINANCE_CONTROL_THRESHOLD) {
      this.dominanceProgress += 1000; // 1 second at a time (called every 1s tick)
      if (this.dominanceProgress >= DOMINANCE_HOLD_TIME_MS) {
        this.victoryType = VictoryType.DOMINANCE;
        this.gameResult = GameResult.WON;
        this.feedbackSystem.addNotification('🏆 Dominance Victory! You control the realm!', 'success', 30000);
      } else if (this.dominanceProgress >= DOMINANCE_HOLD_TIME_MS * 0.5 && this.dominanceProgress < DOMINANCE_HOLD_TIME_MS * 0.5 + 1000) {
        // Notify at 50% progress
        this.feedbackSystem.addNotification('⚠️ Dominance: 30 seconds until victory!', 'warning', 5000);
      }
    } else {
      this.dominanceProgress = 0; // Reset if control lost
    }
  }

  // Performance profiling accumulators (reset every PROFILING_REPORT_INTERVAL frames)
  private profileFrameCount: number = 0;
  private _renderStart: number = 0;
  private _lastWallUpdate: number = 0; // True wall timing; 0 = uninitialized
  private profileTimings: Record<string, number> = {};
  private profileSnapshot: Record<string, number> = {};
  private profileSnapshotFrameCount: number = 0;
  private static readonly PROFILING_REPORT_INTERVAL = 120; // report every ~2s at 60fps


  private resetProfiling(): void {
    this.profileFrameCount = 0;
    this.profileTimings = {};
    this.profileSnapshot = {};
    this.profileSnapshotFrameCount = 0;
    this._lastWallUpdate = 0;
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
    const wallDelta = this._lastWallUpdate === 0 ? 0 : frameStart - this._lastWallUpdate;
    this._lastWallUpdate = frameStart;
    if (wallDelta > 0) this.profileTimings['_wallTime'] = (this.profileTimings['_wallTime'] || 0) + wallDelta;
    this.profileTimings['_wallDelta'] = (this.profileTimings['_wallDelta'] || 0) + delta;
    let t0: number;
    t0 = this.profileStart('pathfinderBeginFrame');
    this.pathfinder.beginFrame();
    this.profileEnd('pathfinderBeginFrame', t0);
    const dt = delta * this.gameSpeed;
    this.gameTime += dt;
    // Scroll foam texture with scene time (NOT gameTime) — pause/speed immune
    if (this.waterWaveSprite && this.waterAnimationEnabled) {
      this.waterWaveSprite.tilePositionX += delta * 0.03;
      this.waterWaveSprite.tilePositionY += delta * 0.015;
    }
    t0 = this.profileStart('inputManager');
    this.inputManager.update(delta);
    this.profileEnd('inputManager', t0);
    const cam = this.cameras.main;
    const topLeft = cam.getWorldPoint(0, 0);
    if (this.debugMode) {
      // const treatySecs = Math.max(0, Math.ceil((this.treatyLength - this.gameTime) / 1000));
      // Estimate GPU draw calls: visible containers + visible graphics + tilemap layers
      const visUnits = this.units.getChildren().filter(u => (u as unknown as Phaser.GameObjects.Components.Visible).visible).length;
      const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
      const pipelineCount = renderer?.pipelines?.pipelines?.size ?? 0;
      this.debugText.setText([
        `FPS: ${this.game.loop.actualFps.toFixed(1)}`,
        `Speed: ${this.gameSpeed}x`,
        `Units: ${this.units.getLength()} | Visible: ${visUnits}`,
        `Trees: ${this.trees.getLength()} | Visible: ${this.units.getLength() > 100 ? '-' : this.trees.getChildren().filter(t => (t as unknown as Phaser.GameObjects.Components.Visible).visible).length}`,
        `Path: ${this.pathfinder.frameStats.pathMs.toFixed(1)}ms | ${this.pathfinder.frameStats.jpsCalls} JPS | q:${this.pathfinder.getCacheStats().queueDepth}`,
        `AI: ${this.enemyAI.getDebugInfo()}`,
        `Pipelines: ${pipelineCount}`
      ]);
    }

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

    // Liquid combat: precompute pressure grid + contact lines before unit bucket pass.
    // Must run after spatial hash update so `spatialKey` data is fresh for pressure cells.
    t0 = this.profileStart('liquidCombat');
    this.liquidCombat.precompute();
    this.profileEnd('liquidCombat', t0);

    t0 = this.profileStart('unitSystem');
    this.unitSystem.update(this.gameTime, dt);
    this.profileEnd('unitSystem', t0);

    // Sync ALL squad container positions to physics body (cheap pass, prevents stutter)
    t0 = this.profileStart('squadSyncPositions');
    this.squadSystem.syncPositions();
    this.profileEnd('squadSyncPositions', t0);

    t0 = this.profileStart('squadSystem');
    this.squadSystem.update(dt);
    this.profileEnd('squadSystem', t0);

    // Skip non-critical systems in stress test mode
    if (!this.stressTestConfig) {
      t0 = this.profileStart('buildingManager');
      this.buildingManager.update();
      this.profileEnd('buildingManager', t0);

      if (!this.aiDisabled && this.gameResult === GameResult.PLAYING) {
        t0 = this.profileStart('enemyAI');
        this.enemyAI.update(this.gameTime, dt);
        this.profileEnd('enemyAI', t0);
      }

      this.accumulatedTime += dt;
      if (this.accumulatedTime >= 1000) {
        // Check win/lose conditions once per second
        this.checkWinLose();
        this.checkDominance();

        if (this.gameResult === GameResult.PLAYING) {
          this.economySystem.tickEconomy();
          if (this.researchManager) this.researchManager.tick(1000);
          this.economySystem.assignJobs();
        }
        this.accumulatedTime -= 1000;

        // Seasonal clock (1-second tick aligned with economy)
        this.seasonTimer += 1000;
        if (this.seasonTimer >= SEASON_DURATION_MS) {
          this.seasonTimer -= SEASON_DURATION_MS;
          const idx = SEASON_ORDER.indexOf(this.currentSeason);
          this.currentSeason = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length];
          this.events.emit(EVENTS.SEASON_CHANGED, { season: this.currentSeason });
          this.feedbackSystem.notifySeasonChanged(SEASON_CONFIG[this.currentSeason].label);
          // Update pathfinding costs for new season
          this.pathfinder.updateTerrainCosts(this.terrainSystem, this.currentSeason);
        }

        // Respawn depleted gold mines
        this.trees.getChildren().forEach((t) => {
          if (t.getData('isGoldMine') && t.getData('isDepleted')) {
            const depletedAt = t.getData('depletedAt') || 0;
            if (this.gameTime - depletedAt >= GOLD_MINE_RESPAWN_MS) {
              t.setData('isDepleted', false);
              t.setData('goldRemaining', 200);
              t.setData('isChopped', false);
              t.setData('visualTexture', 'flare');
              t.setData('visualTint', 0xFFD700);
              t.setData('visualScale', 0.1);
              t.setData('visualOriginY', 0.95);
              // Update live visual if currently visible
              const visual = (t as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
              if (visual && visual.active) {
                visual.setTexture('flare');
                visual.setScale(0.1);
                visual.setTint(0xFFD700);
              }
            }
          }
        });

        // ─── Castle Garrison Firing ───────────────────────────────────────
        if (this.gameResult === GameResult.PLAYING && this.gameTime - this.lastGarrisonFireTime >= CASTLE_GARRISON_FIRE_INTERVAL) {
          this.lastGarrisonFireTime = this.gameTime;
          this.buildings.getChildren().forEach((b) => {
            const def = b.getData('def');
            if (!def || def.type !== BuildingType.CASTLE) return;
            const garrison: Record<string, number> = b.getData('garrison') || {};
            const totalGarrisoned = Object.values(garrison).reduce((s, n) => s + n, 0);
            if (totalGarrisoned === 0) return;

            // Find nearest enemy unit within range
            const cx = (b as Phaser.GameObjects.Image).x;
            const cy = (b as Phaser.GameObjects.Image).y;
            const range2 = CASTLE_GARRISON_RANGE * CASTLE_GARRISON_RANGE;
            let nearest: Phaser.GameObjects.GameObject | null = null;
            let nearestDist2 = Infinity;
            this.units.getChildren().forEach((u) => {
              if (u.getData('owner') === 0) return; // Skip player units
              const dx = (u as Phaser.GameObjects.Image).x - cx;
              const dy = (u as Phaser.GameObjects.Image).y - cy;
              const d2 = dx * dx + dy * dy;
              if (d2 <= range2 && d2 < nearestDist2) {
                nearestDist2 = d2;
                nearest = u;
              }
            });

            if (nearest && (nearest as GameUnit).takeDamage) {
              this.unitSystem.showProjectile(
                { x: cx, y: cy },
                { x: (nearest as Phaser.GameObjects.Image).x, y: (nearest as Phaser.GameObjects.Image).y, scene: this }
              );
              const dmg = totalGarrisoned * CASTLE_GARRISON_DAMAGE_PER_UNIT;
              (nearest as GameUnit).takeDamage!(dmg);
              this.feedbackSystem.showDamageNumber(
                (nearest as Phaser.GameObjects.Image).x,
                (nearest as Phaser.GameObjects.Image).y,
                dmg, 'Pierce'
              );
            }
          });
        }

        // Auto-save every 60 seconds
        this.autoSaveTickCounter++;
        if (this.autoSaveTickCounter >= 60) {
          this.autoSaveTickCounter = 0;
          this.saveGame();
        }
      }

      if (this.gameResult === GameResult.PLAYING) {
        this.accumulatedPopTime += dt;
        if (this.accumulatedPopTime >= 8000) {
          this.economySystem.tickPopulation();
          this.accumulatedPopTime -= 8000;
        }

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
    }

    if (this.infiniteMapSystem && !this.stressTestConfig) {
      t0 = this.profileStart('infiniteMapSystem');
      this.infiniteMapSystem.update();
      this.profileEnd('infiniteMapSystem', t0);
    }
    if (this.minimapSystem && !this.stressTestConfig) {
      t0 = this.profileStart('minimapSystem');
      this.minimapSystem.update();
      this.profileEnd('minimapSystem', t0);
    }
    if (this.fogOfWar && !this.stressTestConfig && this.gameTime - this.lastFogUpdateTime >= 100) {
      t0 = this.profileStart('fogOfWar');
      this.fogOfWar.update();
      this.profileEnd('fogOfWar', t0);
      this.lastFogUpdateTime = this.gameTime;
    }

    t0 = this.profileStart('atmosphericSystem');
    this.atmosphericSystem.update(this.gameTime, dt);
    this.profileEnd('atmosphericSystem', t0);
    // Update feedback/notification system
    t0 = this.profileStart('feedbackSystem');
    this.feedbackSystem.update(this.gameTime, dt);
    this.profileEnd('feedbackSystem', t0);

    // Periodic ambient animal calls (every ~8 seconds if camera near animals)
    const seasonAnimalMod = this.currentSeason === Season.WINTER ? 0 : this.currentSeason === Season.AUTUMN ? 0.5 : 1;
    const animalCallInterval = seasonAnimalMod === 0 ? 999999 : Math.round(8000 / seasonAnimalMod);
    if (this.gameTime - this.lastAnimalCallTime > animalCallInterval) {
      this.lastAnimalCallTime = this.gameTime;
      const animals = this.animalSystem.getAnimals();
      if (animals.length > 0) {
        const cam = this.cameras.main;
        const camCenterX = cam.scrollX + cam.width / 2;
        const camCenterY = cam.scrollY + cam.height / 2;
        // Pick a random animal and play its call if it's roughly on screen
        const animal = animals[Math.floor(Math.random() * animals.length)];
        if (animal.visual) {
          const dx = animal.visual.x - camCenterX;
          const dy = animal.visual.y - camCenterY;
          if (Math.abs(dx) < cam.width && Math.abs(dy) < cam.height) {
            this.proceduralSound.playAnimalCall(animal.species, animal.x, animal.y);
          }
        }
      }
    }

    if (!this.stressTestConfig) {
      t0 = this.profileStart('syncVisuals');
      this.syncVisuals();
      this.profileEnd('syncVisuals', t0);
    }

    // Sync UI camera
    this.uiCamera.scrollX = this.cameras.main.scrollX;
    this.uiCamera.scrollY = this.cameras.main.scrollY;
    this.uiCamera.zoom = this.cameras.main.zoom;

    t0 = this.profileStart('proceduralSound');
    this.proceduralSound.update();
    this.profileEnd('proceduralSound', t0);

    // --- Performance report ---
    this.profileFrameCount++;
    const frameTime = performance.now() - frameStart;
    this.profileTimings['_totalFrame'] = (this.profileTimings['_totalFrame'] || 0) + frameTime;

      // Publish performance sample immediately for stress tests (no 30-frame window at 2 FPS)
      if (this.stressTestConfig || this.profileFrameCount % 30 === 0) {
      const intervalFrames = this.profileFrameCount - this.profileSnapshotFrameCount;
      const n = Math.max(1, intervalFrames);
      const delta = (key: string): number => Math.max(0,
        (this.profileTimings[key] || 0) - (this.profileSnapshot[key] || 0));
      const avgUpdate = delta('_totalFrame') / n;
      const avgRender = delta('__render') / n;
      const avgFrame = avgUpdate + avgRender;
      const hogs = Object.entries(this.profileTimings)
        .filter(([key]) => !key.startsWith('_'))
        .map(([name]) => {
          const ms = delta(name) / n;
          return { name, ms, pct: avgFrame > 0 ? (ms / avgFrame) * 100 : 0 };
        })
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 6);
      const wallMs = delta('_wallTime') / n;
      const phaserDeltaMs = delta('_wallDelta') / n;
      this.profileSnapshot = { ...this.profileTimings };
      this.profileSnapshotFrameCount = this.profileFrameCount;

      // Publish to window.__perf for programmatic/agentic measurement
      const snapshot: PerfSnapshot = {
        timestamp: performance.now(),
        // Use frame time-derived FPS (Phaser's actualFps is a 60-frame rolling window,
        // still poisoned by ~1 FPS startup frames in stress tests)
        fps: avgFrame > 0 ? 1000 / avgFrame : 0,
        frameMs: avgFrame,
        updateMs: avgUpdate,
        renderMs: avgRender,
        wallMs,
        phaserDeltaMs,
        units: this.units.getLength(),
        hogs,
      };
      const perf = window.__perf;
      perf.latest = snapshot;
      perf.buffer.push(snapshot);
      if (perf.buffer.length > perf.maxSamples) perf.buffer.shift();

      // Also publish via HMR for Vite terminal dashboard
      try {
        import.meta.hot?.send('game:fps', {
          fps: this.game.loop.actualFps,
          units: this.units.getLength(),
          frameMs: avgFrame,
          updateMs: avgUpdate,
          renderMs: avgRender,
          hogs,
        });
      } catch { /* not in dev mode */ }
    }

    if (this.profileFrameCount >= MainScene.PROFILING_REPORT_INTERVAL) {
      const fps = this.game.loop.actualFps.toFixed(1);
      const unitCount = this.units.getLength();
      const visCount = this.units.getChildren().filter(u => (u as unknown as Phaser.GameObjects.Components.Visible).visible).length;
      const n = this.profileFrameCount;
      const avgUpdate = (this.profileTimings['_totalFrame'] || 0) / n;
      const avgRender = (this.profileTimings['__render'] || 0) / n;
      const avgFrame = avgUpdate + avgRender;
      const reports: string[] = [
        `[PERF] ${unitCount} units (${visCount} visible) @ ${fps} FPS | ${avgFrame.toFixed(1)}ms/frame ` +
        `(upd ${avgUpdate.toFixed(1)} + ren ${avgRender.toFixed(1)}) over ${n} frames:`,
      ];
      const sorted = Object.entries(this.profileTimings)
        .filter(([k]) => k !== '_totalFrame')
        .sort(([, a], [, b]) => b - a);
      for (const [label, total] of sorted) {
        const avgMs = total / n;
        const pct = avgFrame > 0 ? ((avgMs / avgFrame) * 100).toFixed(1) : '0.0';
        reports.push(`  ${label}: ${avgMs.toFixed(2)}ms/frame (${pct}%)`);
      }
      reports.push(`  TOTAL (upd+ren): ${avgFrame.toFixed(2)}ms`);
      const pf = this.pathfinder.getPerfReport();
      const pfCache = this.pathfinder.getCacheStats();
      reports.push(`  pathfinder: ${pf.avgPathMs.toFixed(2)}ms/frame (${pf.avgJpsCalls.toFixed(0)} JPS/frame, ${pf.avgFlowMs.toFixed(2)}ms flow)` +
        ` | queue: ${pfCache.queueDepth} depth, ${pf.avgQueueProcessed.toFixed(0)}/frame, ${pf.avgQueueDropped} dropped` +
        ` | cache: ${pfCache.flowFieldCaches}, v${pfCache.gridVersion}`);
      console.warn(reports.join('\n'));

      this.resetProfiling();
    }
  }




  // ─── Animated Water Surface (CPU multi-sine, throttled 50ms) ────────

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
    const pStartX = (centerX - 130) - (pCols * spacing) / 2;
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
      this.mapGenerationSystem.spawnStartingGoldMines(centerX + 400, centerY - 50);

      const eCols = Math.ceil(Math.sqrt(enemyCount));
      const eStartX = (centerX + 130) - (eCols * spacing) / 2;
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
        const closestEnemy = enemyUnits[0] ?? null;
        if (closestEnemy) {
          this.unitSystem.commandAttack(playerUnits, closestEnemy);
        }
      }

      this.feedbackSystem.showFloatingText(
        centerX + 200,
        centerY - 120,
        `${enemyCount} ENEMIES SPAWNED!`,
        '#ef4444'
      );
    }
    // Peaceful stress: hide visuals and disable physics for stationary units.
    // Combat stress: keep physics + visuals enabled so liquid combat runs.
    const peacefulStress = !enableEnemies;
    if (peacefulStress) {
      for (const unit of this.units.getChildren() as Phaser.GameObjects.GameObject[]) {
        const container = unit.getData('squadContainer');
        if (container) {
          container.setVisible(true);
        }
        const unitVisual = (unit as any).visual as Phaser.GameObjects.Container | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (unitVisual) {
          unitVisual.setVisible(false);
        }
        const body = (unit as Phaser.GameObjects.Arc).body as Phaser.Physics.Arcade.Body | undefined;
        if (body) {
          body.enable = false;
          body.checkCollision.none = true;
        }
        (unit as Phaser.GameObjects.Arc).setVisible(false);
      }
    }
    // Pre-allocate stress DOT bobs ONLY for peaceful stress — combat stress uses full rendering.
    if (peacefulStress) {
      const blitter = this.squadSystem.lodDotBlitter;
      const stressUnits = this.units.getChildren() as GameUnit[];
      for (let i = 0; i < stressUnits.length; i++) {
        if (i % STRESS_RENDER_INTERVAL !== 0) continue;
        const unit = stressUnits[i];
        const bob = blitter.create(unit.x, unit.y);
        bob.tint = this.getFactionColor(unit.getData('owner') as number);
        unit.setData('stressBob', bob);
      }
    }
    // Skip auto-selection in stress mode — avoids selection-ring Graphics draws.
    if (!this.stressTestConfig) {
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
    }

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
  // ─── Save / Load ─────────────────────────────────────────────────────
  public saveGame(): void {
    if (this.stressTestConfig) return; // Don't save stress tests
    if (this.gameResult !== GameResult.PLAYING) return; // Don't save finished games
    try {
      const save = serializeGame(this);
      saveToLocalStorage(save);
      this.feedbackSystem.addNotification('💾 Game saved', 'info', 2000);
    } catch (e) {
      console.error('[MainScene] Save failed:', e);
      this.feedbackSystem.addNotification('⚠️ Save failed!', 'danger', 3000);
    }
  }

  public loadGame(): boolean {
    const save = loadFromLocalStorage();
    if (!save) return false;
    try {
      deserializeGame(this, save);
      this.feedbackSystem.addNotification('💾 Game loaded!', 'success', 3000);
      return true;
    } catch (e) {
      console.error('[MainScene] Load failed:', e);
      this.feedbackSystem.addNotification('⚠️ Load failed!', 'danger', 3000);
      return false;
    }
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
      [UnitType.CHARIOT]: { food: 250, gold: 200 },
      [UnitType.RAM]: { food: 100, gold: 80 }
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

      const unit = this.entityFactory.spawnUnit(type, spawnX, spawnY, 0) as GameUnit | null | undefined;
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
        const h = this.terrainSystem.getHeightAt(b.x, b.y);
        const iso = toIsoElev(b.x, b.y, h);
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
        const h = this.terrainSystem.getHeightAt(unit.x, unit.y);
        const iso = toIsoElev(unit.x, unit.y, h);
        u.visual.setPosition(iso.x, iso.y);
        u.visual.setDepth(iso.y);
      }
    }
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
    this.feedbackSystem.addNotification(`🏛️ ${config.name} begins!`, 'info', 6000);
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

}
