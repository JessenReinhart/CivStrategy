
import Phaser from 'phaser';
import { BUILDINGS, EVENTS, INITIAL_RESOURCES, MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from '../constants';
import { BuildingType, FactionType, Resources, UnitType } from '../types';
import { toIso } from './utils/iso';
import { Pathfinder } from './systems/Pathfinder';
import { EntityFactory } from './systems/EntityFactory';
import { EconomySystem } from './systems/EconomySystem';
import { UnitSystem } from './systems/UnitSystem';
import { BuildingManager } from './systems/BuildingManager';
import { InputManager } from './systems/InputManager';

export class MainScene extends Phaser.Scene {
  // Game State
  public resources: Resources = { ...INITIAL_RESOURCES };
  public population = 0;
  public maxPopulation = 10;
  public happiness = 100;
  public faction: FactionType = FactionType.ROMANS;
  public taxRate: number = 0; 

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

  // Input Keys (Managed here for ease of access)
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

  init(data: { faction: FactionType }) {
    this.faction = data.faction || FactionType.ROMANS;
    this.resources = { ...INITIAL_RESOURCES };
    this.population = 2;
    this.maxPopulation = 10;
    this.happiness = 100;
    this.taxRate = 0;
  }

  create() {
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    
    // Core Systems
    this.pathfinder = new Pathfinder();
    this.entityFactory = new EntityFactory(this);
    
    // Groups
    this.units = this.add.group({ runChildUpdate: true });
    this.buildings = this.add.group();
    this.trees = this.add.group();
    
    // Environment
    this.createEnvironment();
    this.generateFertileZones(); 
    this.generateForestsAndAnimals();

    // Logic Systems (Initialized after environment)
    this.unitSystem = new UnitSystem(this);
    this.buildingManager = new BuildingManager(this);
    this.inputManager = new InputManager(this); // Depends on buildingManager/unitSystem
    this.economySystem = new EconomySystem(this);

    // Initial Spawns
    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, 400, 400);
    this.entityFactory.spawnBuilding(BuildingType.BONFIRE, 480, 400); 
    this.entityFactory.spawnUnit(UnitType.VILLAGER, 450, 450);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, 350, 450);

    // Camera
    const startIso = toIso(400, 400);
    this.cameras.main.scrollX = startIso.x - this.cameras.main.width / 2;
    this.cameras.main.scrollY = startIso.y - this.cameras.main.height / 2;
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

    this.economySystem.updateStats();
  }

  update(time: number, delta: number) {
    this.inputManager.update(delta);
    this.unitSystem.update(time, delta);
    this.buildingManager.update();

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

  // --- Environment Generation (Kept here for now as it's initialization) ---

  generateFertileZones() {
    const graphics = this.add.graphics();
    graphics.setDepth(-9500); 
    for (let i = 0; i < 15; i++) {
        const x = Phaser.Math.Between(150, MAP_WIDTH - 150);
        const y = Phaser.Math.Between(150, MAP_HEIGHT - 150);
        const radius = Phaser.Math.Between(100, 180);
        this.fertileZones.push(new Phaser.Geom.Circle(x, y, radius));
        const iso = toIso(x, y);
        graphics.fillStyle(0x3e2723, 0.4); 
        graphics.fillEllipse(iso.x, iso.y, radius * 2, radius);
    }
  }

  generateForestsAndAnimals() {
    const forests = [
        { x: 1200, y: 1200, radius: 400, density: 0.8 },
        { x: 1500, y: 500, radius: 300, density: 0.7 },
        { x: 500, y: 1500, radius: 350, density: 0.75 },
        { x: 100, y: 800, radius: 250, density: 0.6 }
    ];

    forests.forEach(forest => {
        const count = Math.floor(forest.radius * forest.density * 0.5);
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * forest.radius;
            const tx = forest.x + Math.cos(angle) * dist;
            const ty = forest.y + Math.sin(angle) * dist;
            if (Phaser.Math.Distance.Between(tx, ty, 400, 400) > 200) {
                 if (tx > 50 && tx < MAP_WIDTH-50 && ty > 50 && ty < MAP_HEIGHT-50) {
                     this.entityFactory.spawnTree(tx, ty);
                 }
            }
        }
    });

    for (let i = 0; i < 80; i++) {
        const tx = Phaser.Math.Between(50, MAP_WIDTH - 50);
        const ty = Phaser.Math.Between(50, MAP_HEIGHT - 50);
        if (Phaser.Math.Distance.Between(tx, ty, 400, 400) > 250) {
            this.entityFactory.spawnTree(tx, ty);
        }
    }

    forests.forEach(forest => {
        const animalCount = Phaser.Math.Between(8, 14); 
        for(let i=0; i<animalCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * forest.radius;
            const ax = forest.x + Math.cos(angle) * dist;
            const ay = forest.y + Math.sin(angle) * dist;
            if (ax > 50 && ax < MAP_WIDTH-50 && ay > 50 && ay < MAP_HEIGHT-50) {
                this.entityFactory.spawnUnit(UnitType.ANIMAL, ax, ay);
            }
        }
    });
  }

  createEnvironment() {
    const groundGraphics = this.add.graphics();
    groundGraphics.fillStyle(0x2d6a4f, 1); 
    const p1 = toIso(0, 0);
    const p2 = toIso(MAP_WIDTH, 0);
    const p3 = toIso(MAP_WIDTH, MAP_HEIGHT);
    const p4 = toIso(0, MAP_HEIGHT);
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
    for (let x = 0; x <= MAP_WIDTH; x += TILE_SIZE) {
        const start = toIso(x, 0);
        const end = toIso(x, MAP_HEIGHT);
        gridGraphics.moveTo(start.x, start.y);
        gridGraphics.lineTo(end.x, end.y);
    }
    for (let y = 0; y <= MAP_HEIGHT; y += TILE_SIZE) {
        const start = toIso(0, y);
        const end = toIso(MAP_WIDTH, y);
        gridGraphics.moveTo(start.x, start.y);
        gridGraphics.lineTo(end.x, end.y);
    }
    gridGraphics.setDepth(-9000);
  }

  // --- Helpers ---

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
      text.setDepth(Number.MAX_VALUE);
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
    container.setDepth(Number.MAX_VALUE);
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
    this.units.getChildren().forEach((u: any) => {
        const visual = u.visual as Phaser.GameObjects.Container;
        if (visual) {
            const iso = toIso(u.x, u.y);
            visual.setPosition(iso.x, iso.y);
            visual.setDepth(iso.y); 
            const ring = visual.getData('ring');
            if (ring) ring.visible = u.isSelected;
        }
    });
    this.buildings.getChildren().forEach((b: any) => {
        const visual = b.visual as Phaser.GameObjects.Container;
        if (visual) {
           const iso = toIso(b.x, b.y);
           visual.setDepth(iso.y); 
        }
    });
  }
}
