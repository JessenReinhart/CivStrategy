
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

export class MainScene extends Phaser.Scene {
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
  // Track whether Fog of War is enabled
  public isFowEnabled: boolean = true;

  // Core Groups
  public units: Phaser.GameObjects.Group;
  public buildings: Phaser.GameObjects.Group;
  public trees: Phaser.GameObjects.Group;
  public fertileZones: Phaser.Geom.Circle[] = [];

  // Systems
  public pathfinder: Pathfinder;
  public entityFactory: EntityFactory;
  public economySystem: EconomySystem;
  public unitSystem: UnitSystem;
  public buildingManager: BuildingManager;
  public inputManager: InputManager;
  public infiniteMapSystem: InfiniteMapSystem;
  public fogOfWar: FogOfWarSystem | null;

  // Input Keys
  public cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  public wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  private lastTick = 0;
  private lastPopCheck = 0;

  constructor() {
    super('MainScene');
  }

  init(data: { faction: FactionType, mapMode: MapMode, mapSize: MapSize, fowEnabled: boolean }) {
    this.faction = data.faction || FactionType.ROMANS;
    this.mapMode = data.mapMode || MapMode.FIXED;
    this.isFowEnabled = data.fowEnabled !== undefined ? data.fowEnabled : true;
    
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
  }

  create() {
    // Core Systems First
    this.pathfinder = new Pathfinder();
    this.entityFactory = new EntityFactory(this);
    
    // Groups
    this.units = this.add.group({ runChildUpdate: true });
    this.buildings = this.add.group();
    this.trees = this.add.group();
    
    // Logic Systems
    this.unitSystem = new UnitSystem(this);
    this.buildingManager = new BuildingManager(this);
    this.economySystem = new EconomySystem(this);
    this.inputManager = new InputManager(this);

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

    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX, centerY);
    this.entityFactory.spawnBuilding(BuildingType.BONFIRE, centerX + 80, centerY); 
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX + 50, centerY + 50);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, centerX - 50, centerY + 50);

    // Camera Setup
    const startIso = toIso(centerX, centerY);
    this.cameras.main.centerOn(startIso.x, startIso.y);
    this.cameras.main.setZoom(1);
    this.cameras.main.setBackgroundColor('#0d1117');

    // Input Keys
    this.input.mouse?.disableContextMenu();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as any;

    // Global Events
    this.game.events.on('request-soldier-spawn', this.handleSoldierSpawnRequest, this);
    this.game.events.on(EVENTS.SET_TAX_RATE, (rate: number) => {
        this.taxRate = rate;
        this.economySystem.updateStats();
    }, this);
    this.game.events.on(EVENTS.CENTER_CAMERA, this.centerCameraOnTownCenter, this);

    this.economySystem.updateStats();

    // Initialize Fog of War if Enabled
    if (this.isFowEnabled) {
        this.fogOfWar = new FogOfWarSystem(this);
    } else {
        this.fogOfWar = null;
    }
  }

  public centerCameraOnTownCenter() {
      const tc = this.buildings.getChildren().find((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER) as Phaser.GameObjects.Rectangle;
      if (tc) {
          const iso = toIso(tc.x, tc.y);
          this.cameras.main.pan(iso.x, iso.y, 1000, 'Power2');
      }
  }

  update(time: number, delta: number) {
    this.inputManager.update(delta);
    this.unitSystem.update(time, delta);
    this.buildingManager.update();
    if (this.infiniteMapSystem) this.infiniteMapSystem.update();
    
    // Update Fog last to ensure it overlays everything correctly
    if (this.fogOfWar) this.fogOfWar.update();

    if (time > this.lastTick + 1000) {
      this.economySystem.tickEconomy();
      this.lastTick = time;
    }

    if (time > this.lastPopCheck + 5000) {
      this.economySystem.tickPopulation();
      this.lastPopCheck = time;
    }

    this.economySystem.assignJobs();
    this.syncVisuals();
  }

  generateFertileZones() {
    const graphics = this.add.graphics();
    graphics.setDepth(-9500); 
    
    // Scale zone count with map size
    const zoneCount = Math.floor((this.mapWidth * this.mapHeight) / (500 * 500)); 

    for (let i = 0; i < zoneCount; i++) {
        const x = Phaser.Math.Between(150, this.mapWidth - 150);
        const y = Phaser.Math.Between(150, this.mapHeight - 150);
        const radius = Phaser.Math.Between(100, 180);
        this.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
        const iso = toIso(x, y);
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

        // Spawn animals in this forest
        const animalCount = Phaser.Math.Between(8, 14); 
        for(let k=0; k<animalCount; k++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * fRadius;
            const ax = fx + Math.cos(angle) * dist;
            const ay = fy + Math.sin(angle) * dist;
            if (ax > 50 && ax < this.mapWidth-50 && ay > 50 && ay < this.mapHeight-50) {
                this.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay);
            }
        }
    }

    // Scattered trees
    const scatteredCount = Math.floor((this.mapWidth * this.mapHeight) / (50000));
    for (let i = 0; i < scatteredCount; i++) {
        const tx = Phaser.Math.Between(50, this.mapWidth - 50);
        const ty = Phaser.Math.Between(50, this.mapHeight - 50);
        if (Phaser.Math.Distance.Between(tx, ty, this.mapWidth/2, this.mapHeight/2) > 250) {
            this.entityFactory.spawnTree(tx, ty);
        }
    }
  }

  createEnvironment() {
    const groundGraphics = this.add.graphics();
    groundGraphics.fillStyle(0x2d6a4f, 1); 
    const p1 = toIso(0, 0);
    const p2 = toIso(this.mapWidth, 0);
    const p3 = toIso(this.mapWidth, this.mapHeight);
    const p4 = toIso(0, this.mapHeight);
    groundGraphics.beginPath();
    groundGraphics.moveTo(p1.x, p1.y);
    groundGraphics.lineTo(p2.x, p2.y);
    groundGraphics.lineTo(p3.x, p3.y);
    groundGraphics.lineTo(p4.x, p4.y);
    groundGraphics.closePath();
    groundGraphics.fillPath();
    groundGraphics.setDepth(-10000); 

    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x000000, 0.1);
    for (let x = 0; x <= this.mapWidth; x += TILE_SIZE) {
        const start = toIso(x, 0);
        const end = toIso(x, this.mapHeight);
        gridGraphics.moveTo(start.x, start.y);
        gridGraphics.lineTo(end.x, end.y);
    }
    for (let y = 0; y <= this.mapHeight; y += TILE_SIZE) {
        const start = toIso(0, y);
        const end = toIso(this.mapWidth, y);
        gridGraphics.moveTo(start.x, start.y);
        gridGraphics.lineTo(end.x, end.y);
    }
    gridGraphics.setDepth(-9000);
  }

  private handleSoldierSpawnRequest() {
      const barracks = this.buildings.getChildren().find((b: any) => b.getData('def').type === BuildingType.BARRACKS) as Phaser.GameObjects.Rectangle;
      if (barracks && this.resources.food >= 100 && this.resources.gold >= 50 && this.population < this.maxPopulation) {
          this.resources.food -= 100;
          this.resources.gold -= 50;
          this.entityFactory.spawnUnit(UnitType.SOLDIER, barracks.x, barracks.y + 70);
      }
  }

  public showFloatingText(x: number, y: number, message: string, color: string = '#ffffff') {
      const iso = toIso(x, y);
      const text = this.add.text(iso.x, iso.y - 60, message, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: color,
          stroke: '#000000',
          strokeThickness: 2,
          fontStyle: 'bold'
      });
      text.setOrigin(0.5);
      text.setDepth(100000);
      this.tweens.add({
          targets: text,
          y: iso.y - 120,
          alpha: 0,
          duration: 1500,
          ease: 'Power2',
          onComplete: () => text.destroy()
      });
  }

  public showFloatingResource(x: number, y: number, amount: number, type: string) {
    const iso = toIso(x, y);
    const container = this.add.container(iso.x, iso.y - 60);
    container.setDepth(100000);
    const icon = this.add.graphics();
    if (type === 'Wood') {
        icon.fillStyle(0x5D4037); icon.fillRoundedRect(-14, -6, 10, 10, 2); icon.fillStyle(0x8D6E63); icon.fillCircle(-11, -1, 4);
    } else if (type === 'Food') {
        icon.fillStyle(0xea580c); icon.fillCircle(-10, 0, 5); icon.fillStyle(0xa3e635); icon.fillEllipse(-10, -5, 5, 2);
    } else if (type === 'Gold') {
        icon.fillStyle(0xffd700); icon.fillCircle(-10, 0, 5); icon.lineStyle(1, 0xeab308); icon.strokeCircle(-10, 0, 5);
    }
    const text = this.add.text(0, 0, `+${amount}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2
    });
    text.setOrigin(0, 0.5);
    container.add([icon, text]);
    this.tweens.add({
        targets: container,
        y: iso.y - 100,
        alpha: 0,
        duration: 1500,
        ease: 'Power2',
        onComplete: () => container.destroy()
    });
  }

  private syncVisuals() {
    const cam = this.cameras.main;
    const padding = 200; 
    const viewRect = new Phaser.Geom.Rectangle(
        cam.worldView.x - padding, 
        cam.worldView.y - padding, 
        cam.worldView.width + padding * 2, 
        cam.worldView.height + padding * 2
    );

    this.units.getChildren().forEach((u: any) => {
        const visual = u.visual as Phaser.GameObjects.Container;
        if (!visual) return;

        const iso = toIso(u.x, u.y);
        if (viewRect.contains(iso.x, iso.y)) {
            visual.setVisible(true);
            visual.setPosition(iso.x, iso.y);
            visual.setDepth(iso.y); 
            const ring = visual.getData('ring');
            if (ring) ring.visible = u.isSelected;
        } else {
            visual.setVisible(false);
        }
    });

    this.buildings.getChildren().forEach((b: any) => {
        const visual = b.visual as Phaser.GameObjects.Container;
        if (!visual) return;

        const iso = toIso(b.x, b.y);
        if (viewRect.contains(iso.x, iso.y)) {
            visual.setVisible(true);
            visual.setPosition(iso.x, iso.y);
            visual.setDepth(iso.y); 
        } else {
            visual.setVisible(false);
        }
    });

    this.trees.getChildren().forEach((t: any) => {
        const visual = t.visual as Phaser.GameObjects.Container;
        if (visual) {
            visual.setVisible(viewRect.contains(visual.x, visual.y));
        }
    });
  }
}
