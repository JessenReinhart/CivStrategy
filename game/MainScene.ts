
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

export class MainScene extends Phaser.Scene {
  // Explicitly declare inherited properties to resolve type errors
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
  public gameSpeed: number = 1.0;
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
  private readonly groundScale = 0.08; // Significantly reduced from 0.3 for finer detail

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
    // --- MEDIEVAL LOADING SCREEN ---
    const width = this.scale.width;
    const height = this.scale.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // 1. Parchment Background
    const bg = this.add.graphics();
    bg.fillStyle(0xe6d5ac, 1); // Parchment beige
    bg.fillRect(0, 0, width, height);
    // Vignette (Dark corners)
    const vignette = this.add.graphics();
    vignette.fillGradientStyle(0x1a0f0a, 0x1a0f0a, 0x1a0f0a, 0x1a0f0a, 0.8, 0.8, 0.2, 0.2);
    vignette.fillRect(0, 0, width, height);

    // 2. Central Crest / Emblem
    const crestY = centerY - 60;
    const crest = this.add.graphics();
    
    // Outer Gold Ring
    crest.lineStyle(6, 0xc5a059, 1); // Gold
    crest.strokeCircle(centerX, crestY, 80);
    // Inner Blue Shield Background
    crest.fillStyle(0x1e3a8a, 1); // Royal Blue
    crest.fillCircle(centerX, crestY, 78);
    
    // Decorative Inner Pattern
    crest.lineStyle(2, 0xc5a059, 0.3);
    crest.strokeCircle(centerX, crestY, 60);
    crest.strokeCircle(centerX, crestY, 40);
    
    // Simple Crown Icon (Procedural)
    crest.fillStyle(0xffd700, 1);
    crest.beginPath();
    const crownY = crestY + 10;
    crest.moveTo(centerX - 30, crownY);
    crest.lineTo(centerX - 30, crownY - 30);
    crest.lineTo(centerX - 15, crownY - 15);
    crest.lineTo(centerX, crownY - 40); // Peak
    crest.lineTo(centerX + 15, crownY - 15);
    crest.lineTo(centerX + 30, crownY - 30);
    crest.lineTo(centerX + 30, crownY);
    crest.closePath();
    crest.fillPath();
    
    // 3. Loading Bar Container (Ornate)
    const barWidth = Math.min(500, width * 0.8);
    const barHeight = 24;
    const barX = centerX - barWidth / 2;
    const barY = centerY + 80;

    const barBg = this.add.graphics();
    barBg.fillStyle(0x2c1810, 1); // Dark brown wood
    barBg.fillRoundedRect(barX, barY, barWidth, barHeight, 8);
    barBg.lineStyle(3, 0x8b6f4e, 1); // Light wood border
    barBg.strokeRoundedRect(barX, barY, barWidth, barHeight, 8);

    const progressBar = this.add.graphics();

    // 4. Text Elements
    const statusText = this.add.text(centerX, barY - 25, 'Forging World...', {
        fontFamily: 'serif',
        fontSize: '18px',
        color: '#4a3728',
        fontStyle: 'bold'
    }).setOrigin(0.5);

    const percentText = this.add.text(centerX + barWidth / 2 + 35, barY + 12, '0%', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#2c1810',
        fontStyle: 'bold'
    }).setOrigin(0.5);

    // Gameplay Tips
    const tips = [
        "Construct Watchtowers to reveal the Fog of War.",
        "Farmers perform best on fertile land (Dark Brown Soil).",
        "Build Housing to increase your Population cap.",
        "Soldiers require Gold upkeep. Tax your people wisely.",
        "Forests can be regrown at the Lumber Camp.",
        "Keep Happiness high to boost resource production."
    ];
    const tipIndex = Phaser.Math.Between(0, tips.length - 1);
    
    const tipTitle = this.add.text(centerX, height - 80, '— HINT —', {
        fontFamily: 'serif',
        fontSize: '14px',
        color: '#8b6f4e',
        fontStyle: 'bold'
    }).setOrigin(0.5);

    const tipText = this.add.text(centerX, height - 55, tips[tipIndex], {
        fontFamily: 'serif',
        fontSize: '16px',
        color: '#4a3728',
        fontStyle: 'italic',
        align: 'center',
        wordWrap: { width: width * 0.8 }
    }).setOrigin(0.5);

    // 5. Load Logic
    this.load.on('progress', (value: number) => {
        percentText.setText(Math.floor(value * 100) + '%');
        
        progressBar.clear();
        // Gold Fill
        progressBar.fillStyle(0xd4af37, 1); 
        const w = (barWidth - 6) * value;
        if (w > 0) {
            progressBar.fillRoundedRect(barX + 3, barY + 3, w, barHeight - 6, 4);
            
            // Shine Effect (Top half lighter)
            progressBar.fillStyle(0xfff5d1, 0.3);
            progressBar.fillRect(barX + 3, barY + 3, w, (barHeight - 6) / 2);
        }
    });

    this.load.on('fileprogress', (file: any) => {
        const key = file.key;
        // Beautify the asset names for display
        let display = key;
        if (key.includes('ground')) display = "Mapping Terrain";
        else if (key.includes('tree')) display = "Planting Forests";
        else if (key.includes('house')) display = "Designing Architecture";
        else if (key.includes('sound')) display = "Composing Audio";
        else display = `Loading Asset: ${key}`;

        statusText.setText(display + "...");
    });

    this.load.on('complete', () => {
        // Fade out animation
        this.tweens.add({
            targets: [bg, vignette, crest, barBg, progressBar, statusText, percentText, tipTitle, tipText],
            alpha: 0,
            duration: 800,
            onComplete: () => {
                bg.destroy();
                vignette.destroy();
                crest.destroy();
                barBg.destroy();
                progressBar.destroy();
                statusText.destroy();
                percentText.destroy();
                tipTitle.destroy();
                tipText.destroy();
            }
        });
    });

    // ------------------

    // Ground Texture
    this.load.image('ground', 'https://i.imgur.com/4P6C0Q3.jpeg');

    this.load.image('lumber', 'https://i.imgur.com/SyKc69J.png');
    this.load.image('townhall', 'https://i.imgur.com/kMBtb9W.png');
    this.load.image('field', 'https://i.imgur.com/uPjycje.png');
    this.load.image('flare', 'https://labs.phaser.io/assets/particles/flare.png');
    
    // New Assets
    this.load.image('tree', 'https://i.imgur.com/tYIgx0v.png');
    this.load.image('stump', 'https://i.imgur.com/bEjOzbv.png');
    this.load.image('house', 'https://i.imgur.com/Ix1nDUv.png');
    this.load.image('lodge', 'https://i.ibb.co.com/4nGGymPZ/hunterslodge.png');
  }

  init(data: { faction: FactionType, mapMode: MapMode, mapSize: MapSize, fowEnabled: boolean, peacefulMode: boolean, treatyLength: number }) {
    console.log("MainScene Init Data:", data);
    
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;
    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    
    // Ensure boolean type safety
    this.peacefulMode = data.peacefulMode === true;
    this.treatyLength = (data.treatyLength || 0) * 60 * 1000; // Convert minutes to ms

    // Determine Map Size
    if (this.mapMode === MapMode.FIXED) {
        const sizePx = MAP_SIZES[data.mapSize || MapSize.MEDIUM];
        this.mapWidth = sizePx;
        this.mapHeight = sizePx;
    } else {
        this.mapWidth = 2048; // Default for logic, though infinite overrides physics
        this.mapHeight = 2048;
    }

    this.resources = { ...INITIAL_RESOURCES };
    this.population = 2;
    this.maxPopulation = 10;
    this.happiness = 100;
    this.taxRate = 0;
    
    // Reset Time
    this.gameSpeed = 1.0;
    this.gameTime = 0;
    this.accumulatedTime = 0;
    this.accumulatedPopTime = 0;
  }

  create() {
    // Core Systems First
    this.pathfinder = new Pathfinder();
    this.entityFactory = new EntityFactory(this);

    // Initialize Infinite Scrolling Ground
    // We place it in world space (default scrollFactor) so it scales with zoom naturally.
    // In update(), we will resize and reposition it to always cover the visible camera area.
    this.groundLayer = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'ground');
    this.groundLayer.setOrigin(0, 0);
    this.groundLayer.setDepth(-20000);
    this.groundLayer.setTileScale(this.groundScale);
    
    // Groups
    this.units = this.add.group({ runChildUpdate: true });
    this.buildings = this.add.group();
    this.trees = this.add.group();
    
    // Logic Systems
    this.unitSystem = new UnitSystem(this);
    this.buildingManager = new BuildingManager(this);
    this.economySystem = new EconomySystem(this);
    this.inputManager = new InputManager(this);
    this.enemyAI = new EnemyAISystem(this);

    // Map Specific Setup
    if (this.mapMode === MapMode.FIXED) {
      this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
      this.createEnvironment();
      this.generateFertileZones(); 
      this.generateForestsAndAnimals();
    } else {
      this.physics.world.setBounds(-100000, -100000, 200000, 200000);
      this.infiniteMapSystem = new InfiniteMapSystem(this);
    }

    // Initial Spawns (Center of map)
    const centerX = this.mapMode === MapMode.FIXED ? this.mapWidth / 2 : 400;
    const centerY = this.mapMode === MapMode.FIXED ? this.mapHeight / 2 : 400;

    // Player Spawn
    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX, centerY, 0);
    this.entityFactory.spawnBuilding(BuildingType.BONFIRE, centerX + 80, centerY, 0); 
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX + 50, centerY + 50, 0);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX - 50, centerY + 50, 0);
    // Initial Cavalry Unit
    this.entityFactory.spawnUnit(UnitType.CAVALRY, centerX, centerY + 90, 0);

    // Camera Setup
    const startIso = toIso(centerX, centerY);
    this.cameras.main.centerOn(startIso.x, startIso.y);
    this.cameras.main.setZoom(1);
    this.cameras.main.setBackgroundColor('#0d1117');

    // Input Keys
    this.input.mouse?.disableContextMenu();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as any;

    // DEBUG OVERLAY
    this.debugText = this.add.text(10, 80, '', {
        font: '14px monospace',
        color: '#00ff00',
        backgroundColor: '#000000bb',
        padding: { x: 10, y: 10 }
    }).setScrollFactor(0).setDepth(99999).setVisible(false);

    this.input.keyboard!.on('keydown-F3', () => {
        this.debugMode = !this.debugMode;
        this.debugText.setVisible(this.debugMode);
    });

    // Global Events
    this.game.events.on('request-soldier-spawn', this.handleSoldierSpawnRequest, this);
    
    this.game.events.on(EVENTS.SET_TAX_RATE, (rate: number) => {
        this.taxRate = rate;
        this.economySystem.updateStats();
    }, this);
    
    this.game.events.on(EVENTS.CENTER_CAMERA, this.centerCameraOnTownCenter, this);

    this.game.events.on(EVENTS.SET_GAME_SPEED, (speed: number) => {
        this.gameSpeed = speed;
        // Physics timescale is inverted (higher value = slower)
        // 0.5 speed -> 2.0 timescale
        // 2.0 speed -> 0.5 timescale
        this.physics.world.timeScale = 1.0 / speed;
        this.tweens.timeScale = speed;
    }, this);

    this.economySystem.updateStats();

    // Initialize Fog of War if Enabled
    if (this.isFowEnabled) {
        this.fogOfWar = new FogOfWarSystem(this);
    } else {
        this.fogOfWar = null;
    }
  }

  public centerCameraOnTownCenter() {
      // Find Player TC (Owner 0)
      const tc = this.buildings.getChildren().find((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0) as Phaser.GameObjects.Rectangle;
      if (tc) {
          const iso = toIso(tc.x, tc.y);
          this.cameras.main.pan(iso.x, iso.y, 1000, 'Power2');
      }
  }

  update(time: number, delta: number) {
    // Calculate Game Delta based on Speed
    const dt = delta * this.gameSpeed;
    this.gameTime += dt;

    if (this.debugMode) {
        const treatySecs = Math.max(0, Math.ceil((this.treatyLength - this.gameTime) / 1000));
        this.debugText.setText([
            `FPS: ${this.game.loop.actualFps.toFixed(1)}`,
            `------------------`,
            `Mode: ${this.peacefulMode ? "PEACEFUL (ATTACKS BLOCKED)" : "WAR"}`,
            `Treaty: ${treatySecs > 0 ? treatySecs + "s remaining" : "EXPIRED"}`,
            `GameTime: ${(this.gameTime/1000).toFixed(1)}s`,
            `------------------`,
            `Units: ${this.units.getLength()}`,
            `Buildings: ${this.buildings.getLength()}`,
            `AI Info: ${this.enemyAI.getDebugInfo()}`
        ]);
    }

    // Input Manager handles Camera movement
    this.inputManager.update(delta);

    // Sync Ground Layer with Camera
    // We calculate the exact world bounds visible to the camera
    const cam = this.cameras.main;
    const topLeft = cam.getWorldPoint(0, 0);
    const bottomRight = cam.getWorldPoint(cam.width, cam.height);
    
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    
    // Position the tile sprite to cover the visible world area
    this.groundLayer.setPosition(topLeft.x, topLeft.y);
    this.groundLayer.setSize(width, height);
    
    // Sync the texture offset to match world coordinates
    // This locks the texture to the world grid, preventing "sliding"
    // Apply inverse scale to match world movement
    this.groundLayer.tilePositionX = topLeft.x / this.groundScale;
    this.groundLayer.tilePositionY = topLeft.y / this.groundScale;
    
    // Unit Logic uses Game Time
    this.unitSystem.update(this.gameTime, dt);
    
    // Building Manager handles visual updates (hover etc) - mostly real time inputs
    this.buildingManager.update();

    // Enemy AI Tick
    this.enemyAI.update(this.gameTime, dt);
    
    // Infinite Map loading (throttled real time to avoid lag)
    if (this.infiniteMapSystem) this.infiniteMapSystem.update();
    
    // Update Fog last to ensure it overlays everything correctly (Visuals follow camera)
    if (this.fogOfWar) this.fogOfWar.update();

    // Economy Ticks based on Accumulated Game Time
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

  createEnvironment() {
    // Draw Map Bounds
    const p1 = toIso(0, 0); // Top
    const p2 = toIso(this.mapWidth, 0); // Right
    const p3 = toIso(this.mapWidth, this.mapHeight); // Bottom
    const p4 = toIso(0, this.mapHeight); // Left

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

    // Draw Grid Lines (Subtle)
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
        // Find Player Barracks (Owner 0)
        const barracks = this.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.BARRACKS && b.getData('owner') === 0) as Phaser.GameObjects.Rectangle[];
        
        if (barracks.length > 0) {
            const spawnSource = barracks[Phaser.Math.Between(0, barracks.length - 1)];
            this.resources.food -= 100;
            this.resources.gold -= 50;
            
            const offsetX = Phaser.Math.Between(-30, 30);
            const offsetY = Phaser.Math.Between(-30, 30);
            const spawnX = spawnSource.x + (offsetX >= 0 ? 60 : -60);
            const spawnY = spawnSource.y + (offsetY >= 0 ? 60 : -60);
            
            this.entityFactory.spawnUnit(UnitType.SOLDIER, spawnX, spawnY, 0);
            this.showFloatingText(spawnSource.x, spawnSource.y, "-100 Food, -50 Gold", "#ffff00");
            this.economySystem.updateStats();
        } else {
            const cam = this.cameras.main;
            this.showFloatingText(cam.worldView.centerX, cam.worldView.centerY, "Build a Barracks first!", "#ff0000");
        }
    } else {
        const cam = this.cameras.main;
        this.showFloatingText(cam.worldView.centerX, cam.worldView.centerY, "Not enough resources!", "#ff0000");
    }
  }

  syncVisuals() {
    this.units.getChildren().forEach((u: any) => {
        if (u.visual) {
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
          fontFamily: 'Arial',
          fontSize: '14px',
          color: color,
          stroke: '#000000',
          strokeThickness: 3
      });
      text.setOrigin(0.5);
      text.setDepth(Number.MAX_VALUE);

      this.tweens.add({
          targets: text,
          y: iso.y - 100,
          alpha: 0,
          duration: 1500,
          onComplete: () => text.destroy()
      });
  }

  showFloatingResource(x: number, y: number, amount: number, type: string) {
      const colorMap: Record<string, string> = {
          'Wood': '#4ade80',
          'Food': '#facc15',
          'Gold': '#fbbf24'
      };
      const color = colorMap[type] || '#ffffff';
      this.showFloatingText(x, y, `+${amount} ${type}`, color);
  }

  generateFertileZones() {
    // Scale zone count with map size
    const zoneCount = Math.floor((this.mapWidth * this.mapHeight) / (500 * 500)); 

    for (let i = 0; i < zoneCount; i++) {
        const x = Phaser.Math.Between(150, this.mapWidth - 150);
        const y = Phaser.Math.Between(150, this.mapHeight - 150);
        const radius = Phaser.Math.Between(100, 180);
        this.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
        const iso = toIso(x, y);

        // Fallback to Graphics (No Texture)
        const graphics = this.add.graphics();
        graphics.setDepth(-9500); 
        graphics.fillStyle(0x3e2723, 0.4); 
        graphics.fillEllipse(iso.x, iso.y, radius * 2, radius);
    }
  }

  generateForestsAndAnimals() {
    // Generate forests procedurally based on map bounds
    const forestCount = Math.floor((this.mapWidth * this.mapHeight) / (800 * 800));
    
    for (let i = 0; i < forestCount; i++) {
        const fx = Phaser.Math.Between(100, this.mapWidth - 100);
        const fy = Phaser.Math.Between(100, this.mapHeight - 100);
        const fRadius = Phaser.Math.Between(200, 450);
        const fDensity = Phaser.Math.FloatBetween(0.6, 0.85);

        const treeCount = Math.floor(fRadius * fDensity * 0.5);
        
        // Spawn trees in this forest
        for(let j=0; j<treeCount; j++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * fRadius;
            const tx = fx + Math.cos(angle) * dist;
            const ty = fy + Math.sin(angle) * dist;
            
            // Avoid spawn area center
            if (Phaser.Math.Distance.Between(tx, ty, this.mapWidth/2, this.mapHeight/2) > 250) {
                 if (tx > 50 && tx < this.mapWidth-50 && ty > 50 && ty < this.mapHeight-50) {
                     this.entityFactory.spawnTree(tx, ty);
                 }
            }
        }

        // Spawn animals in forest
        const animalCount = Phaser.Math.Between(2, 5);
        for(let k=0; k<animalCount; k++) {
             const angle = Math.random() * Math.PI * 2;
             const dist = Math.sqrt(Math.random()) * (fRadius * 0.8);
             const ax = fx + Math.cos(angle) * dist;
             const ay = fy + Math.sin(angle) * dist;
             
             if (Phaser.Math.Distance.Between(ax, ay, this.mapWidth/2, this.mapHeight/2) > 300) {
                 if (ax > 50 && ax < this.mapWidth-50 && ay > 50 && ay < this.mapHeight-50) {
                     this.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay, 0);
                 }
             }
        }
    }
  }
}
