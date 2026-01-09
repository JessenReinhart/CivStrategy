
import Phaser from 'phaser';
import { BUILDINGS, EVENTS, INITIAL_RESOURCES, MAP_SIZES, TILE_SIZE } from '../constants';
import { BuildingType, FactionType, Resources, UnitType, MapMode, MapSize } from '../types';
import { toIso } from './utils/iso';
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

export class MainScene extends Phaser.Scene {
  // Explicitly declare inherited properties
  load!: Phaser.Loader.LoaderPlugin;
  add!: Phaser.GameObjects.GameObjectFactory;
  make!: Phaser.GameObjects.GameObjectCreator;
  scene!: Phaser.Scenes.ScenePlugin;
  cameras!: Phaser.Cameras.Scene2D.CameraManager;
  input!: Phaser.Input.InputPlugin;
  events!: Phaser.Events.EventEmitter;
  scale!: Phaser.Scale.ScaleManager;
  game!: Phaser.Game;
  physics!: Phaser.Physics.Arcade.ArcadePhysics;
  tweens!: Phaser.Tweens.TweenManager;
  time!: Phaser.Time.Clock;
  textures!: Phaser.Textures.TextureManager;

  // Game State
  public resources: Resources = { ...INITIAL_RESOURCES };
  public population = 0;
  public maxPopulation = 10;
  public happiness = 100;
  public faction: FactionType = FactionType.ROMANS;
  public mapMode: MapMode = MapMode.FIXED;
  public mapWidth: number = 2048;
  public mapHeight: number = 2048;
  public taxRate: number = 0; 
  public isFowEnabled: boolean = true;
  
  // Diplomacy
  public peacefulMode: boolean = false;
  public treatyLength: number = 0; // ms

  // Debug
  public debugMode: boolean = false;
  private debugText: Phaser.GameObjects.Text;

  // Game Speed & Time
  public gameSpeed: number = 0.5;
  public gameTime: number = 0;
  private accumulatedTime: number = 0;
  private accumulatedPopTime: number = 0;

  // Core Groups
  public units: Phaser.GameObjects.Group;
  public buildings: Phaser.GameObjects.Group;
  public trees: Phaser.GameObjects.Group;
  public fertileZones: Phaser.Geom.Circle[] = [];

  // Ground Layer
  private groundLayer: Phaser.GameObjects.TileSprite;
  private readonly groundScale = 0.08;

  // Systems
  public pathfinder: Pathfinder;
  public entityFactory: EntityFactory;
  public economySystem: EconomySystem;
  public unitSystem: UnitSystem;
  public buildingManager: BuildingManager;
  public inputManager: InputManager;
  public infiniteMapSystem: InfiniteMapSystem;
  public fogOfWar: FogOfWarSystem | null;
  public enemyAI: EnemyAISystem;
  public minimapSystem: MinimapSystem;
  public squadSystem: SquadSystem;

  // Performance throttling
  private cullTimer = 0;

  // Input Keys
  public cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  public wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

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
  }

  init(data: any) {
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;
    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    this.peacefulMode = data.peacefulMode === true;
    this.treatyLength = (data.treatyLength || 0) * 60 * 1000;

    if (this.mapMode === MapMode.FIXED) {
        const sizePx = MAP_SIZES[data.mapSize || MapSize.MEDIUM];
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
  }

  create() {
    this.pathfinder = new Pathfinder();
    this.entityFactory = new EntityFactory(this);
    this.squadSystem = new SquadSystem(this);

    this.groundLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'ground');
    this.groundLayer.setOrigin(0, 0);
    this.groundLayer.setDepth(-20000);
    this.groundLayer.setTileScale(this.groundScale);
    
    this.units = this.add.group({ runChildUpdate: true });
    this.buildings = this.add.group();
    this.trees = this.add.group();
    
    this.unitSystem = new UnitSystem(this);
    this.buildingManager = new BuildingManager(this);
    this.economySystem = new EconomySystem(this);
    this.inputManager = new InputManager(this);
    this.enemyAI = new EnemyAISystem(this);

    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
      this.createEnvironment();
      this.generateFertileZones(); 
      this.generateForestsAndAnimals();
    } else {
      this.physics.world.setBounds(-100000, -100000, 200000, 200000);
      this.infiniteMapSystem = new InfiniteMapSystem(this);
    }

    const centerX = this.mapMode === MapMode.FIXED ? this.mapWidth / 2 : 400;
    const centerY = this.mapMode === MapMode.FIXED ? this.mapHeight / 2 : 400;

    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX, centerY, 0);
    this.entityFactory.spawnBuilding(BuildingType.BONFIRE, centerX + 80, centerY, 0); 
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX + 50, centerY + 50, 0);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX - 50, centerY + 50, 0);
    this.entityFactory.spawnUnit(UnitType.CAVALRY, centerX, centerY + 90, 0);

    const startIso = toIso(centerX, centerY);
    this.cameras.main.centerOn(startIso.x, startIso.y);
    this.cameras.main.setBackgroundColor('#0d1117');

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as any;

    this.debugText = this.add.text(10, 80, '', {
        font: '14px monospace', color: '#00ff00', backgroundColor: '#000000bb', padding: { x: 10, y: 10 }
    }).setScrollFactor(0).setDepth(99999).setVisible(false);

    this.input.keyboard!.on('keydown-F3', () => {
        this.debugMode = !this.debugMode;
        this.debugText.setVisible(this.debugMode);
    });

    this.game.events.on('request-soldier-spawn', this.handleSoldierSpawnRequest, this);
    this.game.events.on(EVENTS.SET_TAX_RATE, (rate: number) => { this.taxRate = rate; this.economySystem.updateStats(); }, this);
    this.game.events.on(EVENTS.CENTER_CAMERA, this.centerCameraOnTownCenter, this);
    this.game.events.on(EVENTS.SET_GAME_SPEED, (speed: number) => {
        this.gameSpeed = speed;
        this.physics.world.timeScale = 1 / speed;
        this.tweens.timeScale = speed;
    }, this);

    this.physics.world.timeScale = 1 / this.gameSpeed;
    this.economySystem.updateStats();

    if (this.isFowEnabled) { this.fogOfWar = new FogOfWarSystem(this); } else { this.fogOfWar = null; }
    this.minimapSystem = new MinimapSystem(this);

    const minimapClickHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        this.handleMinimapClick(detail.x, detail.y);
    };
    window.addEventListener('minimap-click-ui', minimapClickHandler);
  }

  private lastTcIndex = -1;

  public centerCameraOnTownCenter() {
      const tcs = this.buildings.getChildren().filter((b: any) => 
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
        const treatySecs = Math.max(0, Math.ceil((this.treatyLength - this.gameTime) / 1000));
        this.debugText.setText([
            `FPS: ${this.game.loop.actualFps.toFixed(1)}`,
            `Speed: ${this.gameSpeed}x`,
            // Fix: Cast GameObject to any to access 'visible' property for debug HUD reporting
            `Units: ${this.units.getLength()} | Visible: ${this.units.getChildren().filter(u => (u as any).visible).length}`,
            `Trees: ${this.trees.getLength()} | Visible: ${this.trees.getChildren().filter(t => (t as any).visible).length}`,
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
    
    // Performance: Throttle culling to every few frames
    this.cullTimer += delta;
    if (this.cullTimer > 100) {
        this.cullObjects();
        this.cullTimer = 0;
    }

    this.unitSystem.update(this.gameTime, dt);
    this.squadSystem.update(dt);
    this.buildingManager.update();
    this.enemyAI.update(this.gameTime, dt);
    
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
    this.syncVisuals();
  }

  private cullObjects() {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const padding = 200; // Extra buffer outside viewport
    
    const cullBounds = new Phaser.Geom.Rectangle(
        view.x - padding,
        view.y - padding,
        view.width + padding * 2,
        view.height + padding * 2
    );

    // Cull Trees
    this.trees.getChildren().forEach((tObj: any) => {
        const visual = tObj.visual;
        if (visual) {
            visual.visible = cullBounds.contains(visual.x, visual.y);
        }
    });

    // Cull Units (Their squad containers)
    this.units.getChildren().forEach((uObj: any) => {
        const visual = uObj.visual;
        const squad = uObj.getData('squadContainer');
        // Fix: Cast visual and squad to any to access/set 'visible' property as GameObjects might not expose it directly in all TS configs
        if (visual && (visual as any).visible !== undefined) {
             (visual as any).visible = cullBounds.contains(visual.x, visual.y);
        }
        if (squad) {
            (squad as any).visible = cullBounds.contains(squad.x, squad.y);
        }
    });
  }

  createEnvironment() {
    const p1 = toIso(0, 0); 
    const p2 = toIso(this.mapWidth, 0); 
    const p3 = toIso(this.mapWidth, this.mapHeight); 
    const p4 = toIso(0, this.mapHeight); 

    const border = this.add.graphics();
    border.lineStyle(8, 0x000000, 0.4);
    border.beginPath();
    border.moveTo(p1.x, p1.y);
    border.lineTo(p2.x, p2.y);
    border.lineTo(p3.x, p3.y);
    border.lineTo(p4.x, p4.y);
    border.closePath();
    border.strokePath();
    border.setDepth(-19000);

    const grid = this.add.graphics();
    grid.lineStyle(2, 0x000000, 0.15); 
    const gridSpacing = TILE_SIZE * 4; 
    for (let x = 0; x <= this.mapWidth; x += gridSpacing) {
        const start = toIso(x, 0);
        const end = toIso(x, this.mapHeight);
        grid.moveTo(start.x, start.y);
        grid.lineTo(end.x, end.y);
    }
    for (let y = 0; y <= this.mapHeight; y += gridSpacing) {
        const start = toIso(0, y);
        const end = toIso(this.mapWidth, y);
        grid.moveTo(start.x, start.y);
        grid.lineTo(end.x, end.y);
    }
    grid.strokePath();
    grid.setDepth(-9999);
  }

  handleSoldierSpawnRequest() {
    if (this.resources.food >= 100 && this.resources.gold >= 50) {
        const barracks = this.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.BARRACKS && b.getData('owner') === 0) as Phaser.GameObjects.Rectangle[];
        if (barracks.length > 0) {
            const spawnSource = barracks[Phaser.Math.Between(0, barracks.length - 1)];
            this.resources.food -= 100;
            this.resources.gold -= 50;
            const spawnX = spawnSource.x + 60;
            const spawnY = spawnSource.y + 60;
            this.entityFactory.spawnUnit(UnitType.SOLDIER, spawnX, spawnY, 0);
            this.economySystem.updateStats();
        } else {
            this.showFloatingText(this.cameras.main.worldView.centerX, this.cameras.main.worldView.centerY, "Build a Barracks first!", "#ff0000");
        }
    }
  }

  syncVisuals() {
    this.units.getChildren().forEach((u: any) => {
        // Fix: Use any-cast to safely check 'visible' property on generic units
        if (u.visual && (u as any).visible) {
            const iso = toIso(u.x, u.y);
            u.visual.setPosition(iso.x, iso.y);
            u.visual.setDepth(iso.y);
        }
    });
    this.buildings.getChildren().forEach((b: any) => {
        if (b.visual) {
           const iso = toIso(b.x, b.y);
           b.visual.setDepth(iso.y); 
        }
    });
  }

  showFloatingText(x: number, y: number, message: string, color: string = '#ffffff') {
      const iso = toIso(x, y);
      const text = this.add.text(iso.x, iso.y - 50, message, {
          fontFamily: 'Arial', fontSize: '14px', color: color, stroke: '#000000', strokeThickness: 3
      });
      text.setOrigin(0.5).setDepth(Number.MAX_VALUE);
      this.tweens.add({ targets: text, y: iso.y - 100, alpha: 0, duration: 1500, onComplete: () => text.destroy() });
  }

  showFloatingResource(x: number, y: number, amount: number, type: string) {
      const colorMap: Record<string, string> = { 'Wood': '#4ade80', 'Food': '#facc15', 'Gold': '#fbbf24' };
      this.showFloatingText(x, y, `+${amount} ${type}`, colorMap[type] || '#ffffff');
  }

  generateFertileZones() {
    const zoneCount = Math.floor((this.mapWidth * this.mapHeight) / (500 * 500)); 
    for (let i = 0; i < zoneCount; i++) {
        const x = Phaser.Math.Between(150, this.mapWidth - 150);
        const y = Phaser.Math.Between(150, this.mapHeight - 150);
        const radius = Phaser.Math.Between(100, 180);
        this.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
        const iso = toIso(x, y);
        const graphics = this.add.graphics();
        graphics.setDepth(-9500); 
        graphics.fillStyle(0x3e2723, 0.4); 
        graphics.fillEllipse(iso.x, iso.y, radius * 2, radius);
    }
  }

  generateForestsAndAnimals() {
    const forestCount = Math.floor((this.mapWidth * this.mapHeight) / (800 * 800));
    for (let i = 0; i < forestCount; i++) {
        const fx = Phaser.Math.Between(100, this.mapWidth - 100);
        const fy = Phaser.Math.Between(100, this.mapHeight - 100);
        const fRadius = Phaser.Math.Between(200, 450);
        const treeCount = Math.floor(fRadius * 0.4);
        for(let j=0; j<treeCount; j++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * fRadius;
            const tx = fx + Math.cos(angle) * dist;
            const ty = fy + Math.sin(angle) * dist;
            if (Phaser.Math.Distance.Between(tx, ty, this.mapWidth/2, this.mapHeight/2) > 250) {
                 if (tx > 50 && tx < this.mapWidth-50 && ty > 50 && ty < this.mapHeight-50) {
                     this.entityFactory.spawnTree(tx, ty);
                 }
            }
        }
        const animalCount = Phaser.Math.Between(2, 5);
        for(let k=0; k<animalCount; k++) {
             // Fix: Define local angle for animal positioning to resolve 'Cannot find name angle' error
             const angle = Math.random() * Math.PI * 2;
             const ax = fx + Math.cos(angle) * (fRadius * 0.8);
             const ay = fy + Math.sin(angle) * (fRadius * 0.8);
             if (Phaser.Math.Distance.Between(ax, ay, this.mapWidth/2, this.mapHeight/2) > 300) {
                 if (ax > 50 && ax < this.mapWidth-50 && ay > 50 && ay < this.mapHeight-50) {
                     this.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay, -1);
                 }
             }
        }
    }
  }
}
