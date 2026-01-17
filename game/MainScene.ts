
import Phaser from 'phaser';
import { EVENTS, INITIAL_RESOURCES, MAP_SIZES, FACTION_COLORS } from '../constants';
import { BuildingType, FactionType, Resources, UnitType, MapMode, MapSize, FormationType, UnitStance } from '../types';
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

    this.load.image('ground', 'https://i.imgur.com/4P6C0Q3.jpeg');
    this.load.image('lumber', 'https://i.imgur.com/SyKc69J.png');
    this.load.image('townhall', 'https://i.imgur.com/kMBtb9W.png');
    this.load.image('field', 'https://i.imgur.com/uPjycje.png');
    this.load.image('flare', 'https://labs.phaser.io/assets/particles/flare.png');
    this.load.image('tree', 'https://i.imgur.com/tYIgx0v.png');
    this.load.image('stump', 'https://i.imgur.com/bEjOzbv.png');
    this.load.image('house', 'https://i.imgur.com/Ix1nDUv.png');
    this.load.image('lodge', 'https://i.ibb.co.com/4nGGymPZ/hunterslodge.png');
    this.load.image('smoke', 'https://labs.phaser.io/assets/particles/smoke-puff.png');
  }

  init(data: { faction?: FactionType, mapMode?: MapMode, fowEnabled?: boolean, peacefulMode?: boolean, treatyLength?: number, mapSize?: MapSize, aiDisabled?: boolean }) {
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;
    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    this.peacefulMode = data.peacefulMode === true;
    this.treatyLength = (data.treatyLength || 0) * 60 * 1000;

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

    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
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
    this.entityFactory.spawnUnit(UnitType.CAVALRY, centerX, centerY + 90, 0);

    // Spawn a squad of Archers
    for (let i = 0; i < 5; i++) {
      this.entityFactory.spawnUnit(UnitType.ARCHER, centerX - 60 + (i * 15), centerY + 80, 0);
    }

    // DEBUG: Spawn Enemy Barracks for Target Practice
    this.entityFactory.spawnBuilding(BuildingType.BARRACKS, centerX + 300, centerY, 1);

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

  update(time: number, delta: number) {
    const dt = delta * this.gameSpeed;
    this.gameTime += dt;

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

    this.inputManager.update(delta);

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

    this.cullingSystem.update(this.gameTime, dt);

    this.villagerSystem.update(this.gameTime, dt);
    this.animalSystem.update(this.gameTime, dt);
    this.unitSystem.update(this.gameTime, dt);
    this.squadSystem.update(dt);
    this.buildingManager.update();
    if (!this.aiDisabled) {
      this.enemyAI.update(this.gameTime, dt);
    }

    if (this.infiniteMapSystem) this.infiniteMapSystem.update();
    if (this.minimapSystem) this.minimapSystem.update();
    if (this.fogOfWar) this.fogOfWar.update();

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
    this.atmosphericSystem.update(this.gameTime, dt);
    this.syncVisuals();

    // Sync UI camera
    this.uiCamera.scrollX = this.cameras.main.scrollX;
    this.uiCamera.scrollY = this.cameras.main.scrollY;
    this.uiCamera.zoom = this.cameras.main.zoom;
  }



  handleUnitSpawnRequest(type: UnitType) {
    const costs: Record<UnitType, { food: number; gold: number }> = {
      [UnitType.PIKESMAN]: { food: 100, gold: 50 },
      [UnitType.ARCHER]: { food: 80, gold: 40 },
      [UnitType.CAVALRY]: { food: 150, gold: 100 },
      [UnitType.VILLAGER]: { food: 0, gold: 0 },
      [UnitType.LEGION]: { food: 500, gold: 300 },
      [UnitType.ANIMAL]: { food: 0, gold: 0 }
    };

    const cost = costs[type];
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

  syncVisuals() {
    this.units.getChildren().forEach((u) => {
      // Fix: Use any-cast to safely check 'visible' property
      const unit = u as Phaser.GameObjects.Sprite;
      const visual = (u as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (visual && (visual as Phaser.GameObjects.Components.Visible).visible) {
        const iso = toIso(unit.x, unit.y);
        visual.setPosition(iso.x, iso.y);
        visual.setDepth(iso.y);
      }
    });
    this.buildings.getChildren().forEach((b) => {
      const visual = (b as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (visual) {
        const iso = toIso((b as Phaser.GameObjects.Image).x, (b as Phaser.GameObjects.Image).y);
        visual.setDepth(iso.y);
      }
    });
  }
}
