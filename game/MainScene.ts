import Phaser from 'phaser';
import { BUILDINGS, EVENTS, INITIAL_RESOURCES, MAP_HEIGHT, MAP_WIDTH, TILE_SIZE, FACTION_COLORS } from '../constants';
import { BuildingType, FactionType, Resources, BuildingDef, UnitType, UnitState } from '../types';
import { toIso, toCartesian } from './utils/iso';
import { Pathfinder } from './systems/Pathfinder';
import { EntityFactory } from './systems/EntityFactory';
import { EconomySystem } from './systems/EconomySystem';

export class MainScene extends Phaser.Scene {
  // Game State
  public resources: Resources = { ...INITIAL_RESOURCES };
  public population = 0;
  public maxPopulation = 10;
  public happiness = 100;
  public faction: FactionType = FactionType.ROMANS;

  // Logic Entities (Physics, Invisible)
  public units: Phaser.GameObjects.Group;
  public buildings: Phaser.GameObjects.Group;
  public trees: Phaser.GameObjects.Group;

  // Systems
  public pathfinder: Pathfinder;
  public entityFactory: EntityFactory;
  public economySystem: EconomySystem;

  // Interaction
  private territoryGraphics: Phaser.GameObjects.Graphics;
  private pathGraphics: Phaser.GameObjects.Graphics;
  private selectionGraphics: Phaser.GameObjects.Graphics;
  private treeHighlightGraphics: Phaser.GameObjects.Graphics;
  private previewBuilding: Phaser.GameObjects.Container | null = null;
  private previewBuildingType: BuildingType | null = null;
  private isDemolishMode: boolean = false;

  // Selection
  private selectedUnits: Phaser.GameObjects.GameObject[] = [];
  private isDragging = false;
  private dragStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  private dragRect: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle();

  // Input
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
  }

  create() {
    this.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    
    // Systems Init
    this.pathfinder = new Pathfinder();
    this.entityFactory = new EntityFactory(this);
    this.economySystem = new EconomySystem(this);

    // Camera
    const startIso = toIso(400, 400);
    this.cameras.main.scrollX = startIso.x - this.cameras.main.width / 2;
    this.cameras.main.scrollY = startIso.y - this.cameras.main.height / 2;
    this.cameras.main.setZoom(1);
    this.cameras.main.setBackgroundColor('#0d1117');

    // Groups
    this.units = this.add.group({ runChildUpdate: true });
    this.buildings = this.add.group();
    this.trees = this.add.group();
    
    // Environment
    this.createEnvironment();

    // Graphics
    this.territoryGraphics = this.add.graphics().setDepth(-5000); 
    this.pathGraphics = this.add.graphics().setDepth(-4000);
    this.selectionGraphics = this.add.graphics().setDepth(Number.MAX_VALUE);
    this.treeHighlightGraphics = this.add.graphics().setDepth(Number.MAX_VALUE - 500);

    // Initial Spawns (Trees, TC, Villagers)
    for (let i = 0; i < 120; i++) {
        const tx = Phaser.Math.Between(50, MAP_WIDTH - 50);
        const ty = Phaser.Math.Between(50, MAP_HEIGHT - 50);
        if (Phaser.Math.Distance.Between(tx, ty, 400, 400) > 250) {
            this.entityFactory.spawnTree(tx, ty);
        }
    }
    this.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, 400, 400);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, 450, 450);
    this.entityFactory.spawnUnit(UnitType.VILLAGER, 350, 450);

    // Input Setup
    this.input.mouse?.disableContextMenu();
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as any;

    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
        const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.5, 2);
        this.cameras.main.setZoom(newZoom);
    });

    this.game.events.on('request-build', this.enterBuildMode, this);
    this.game.events.on('request-soldier-spawn', this.handleSoldierSpawnRequest, this);
    this.game.events.on(EVENTS.TOGGLE_DEMOLISH, this.toggleDemolishMode, this);

    this.economySystem.updateStats();
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

  update(time: number, delta: number) {
    this.handleCameraMovement(delta);
    
    if (time > this.lastTick + 1000) {
      this.economySystem.tickEconomy();
      this.lastTick = time;
    }

    if (time > this.lastPopCheck + 5000) {
      this.economySystem.tickPopulation();
      this.lastPopCheck = time;
    }

    this.economySystem.assignJobs();
    
    this.drawTerritory();
    this.drawUnitPaths(time);
    this.updateUnitLogic(delta);
    this.syncVisuals();
  }

  // --- Input & Interaction Logic ---

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.rightButtonDown()) {
        if (this.isDemolishMode) {
            this.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
            return;
        }
        
        // Right click cancels build mode
        if (this.previewBuildingType) {
            this.previewBuildingType = null;
            if (this.previewBuilding) {
                this.previewBuilding.destroy();
                this.previewBuilding = null;
            }
            this.treeHighlightGraphics.clear();
            return;
        }

        this.handleRightClick(pointer);
        return;
    }

    if (this.isDemolishMode) {
        this.handleDemolishClick(pointer);
        return;
    }

    if (this.previewBuildingType) {
        const cart = toCartesian(pointer.worldX, pointer.worldY);
        const gx = Math.floor(cart.x / TILE_SIZE) * TILE_SIZE;
        const gy = Math.floor(cart.y / TILE_SIZE) * TILE_SIZE;
        const def = BUILDINGS[this.previewBuildingType];
        const cx = gx + def.width/2;
        const cy = gy + def.height/2;

        this.tryBuild(cx, cy);
    } else {
        this.isDragging = true;
        this.dragStart.set(pointer.worldX, pointer.worldY);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.isDemolishMode) {
        const targets = this.input.hitTestPointer(pointer);
        const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building')) as Phaser.GameObjects.Container | undefined;
        
        this.buildings.getChildren().forEach((b: any) => {
            const visual = b.visual as Phaser.GameObjects.Container;
            if (visual) {
                const highlight = visual.getData('demolishHighlight') as Phaser.GameObjects.Graphics;
                if (highlight) {
                    highlight.destroy();
                    visual.setData('demolishHighlight', null);
                }
            }
        });

        if (buildingVisual) {
             const b = buildingVisual.getData('building');
             if (b) {
                const def = b.getData('def') as BuildingDef;
                const highlight = this.add.graphics();
                this.entityFactory.drawIsoBuilding(highlight, def, 0xff0000, 0.5);
                buildingVisual.add(highlight);
                buildingVisual.setData('demolishHighlight', highlight);
             }
        }
        return;
    }

    if (this.isDragging) {
        this.dragRect.setTo(
            Math.min(this.dragStart.x, pointer.worldX),
            Math.min(this.dragStart.y, pointer.worldY),
            Math.abs(pointer.worldX - this.dragStart.x),
            Math.abs(pointer.worldY - this.dragStart.y)
        );
        
        this.selectionGraphics.clear();
        this.selectionGraphics.lineStyle(2, 0xffffff);
        this.selectionGraphics.strokeRectShape(this.dragRect);
        this.selectionGraphics.fillStyle(0xffffff, 0.1);
        this.selectionGraphics.fillRectShape(this.dragRect);
    }

    if (this.previewBuilding) {
        const cart = toCartesian(pointer.worldX, pointer.worldY);
        const gx = Math.floor(cart.x / TILE_SIZE) * TILE_SIZE;
        const gy = Math.floor(cart.y / TILE_SIZE) * TILE_SIZE;
        const def = BUILDINGS[this.previewBuildingType!];
        const cx = gx + def.width/2;
        const cy = gy + def.height/2;

        const iso = toIso(cx, cy);
        this.previewBuilding.setPosition(iso.x, iso.y);
        this.previewBuilding.setDepth(Number.MAX_VALUE - 100); 
        
        const isValid = this.checkBuildValidity(cx, cy, this.previewBuildingType!);
        const color = isValid ? 0x00ff00 : 0xff0000;
        
        const graphics = this.previewBuilding.getAt(0) as Phaser.GameObjects.Graphics;
        graphics.clear();

        if (def.effectRadius) {
            graphics.lineStyle(2, 0xffd700, 0.8);
            graphics.strokeEllipse(0, 0, def.effectRadius * 2, def.effectRadius);
            graphics.fillStyle(0xffd700, 0.1);
            graphics.fillEllipse(0, 0, def.effectRadius * 2, def.effectRadius);
        }

        // --- TREE HIGHLIGHTING LOGIC ---
        this.treeHighlightGraphics.clear();
        if (this.previewBuildingType === BuildingType.LUMBER_CAMP) {
            const range = def.effectRadius || 200;
            let treesInRange = 0;
            
            this.trees.getChildren().forEach((t: any) => {
                if (Phaser.Math.Distance.Between(cx, cy, t.x, t.y) <= range) {
                    treesInRange++;
                    const isoT = toIso(t.x, t.y);
                    this.treeHighlightGraphics.lineStyle(2, 0x4ade80, 0.8); // Bright Green
                    this.treeHighlightGraphics.strokeCircle(isoT.x, isoT.y, 15);
                }
            });

            // If no trees, show warning on cursor
            if (treesInRange === 0) {
                 graphics.fillStyle(0xff0000, 0.3);
                 graphics.fillCircle(0, 0, 40);
            }
        }

        this.entityFactory.drawIsoBuilding(graphics, def, color, 0.5);
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.isDragging) {
        this.isDragging = false;
        const dist = Phaser.Math.Distance.Between(
            this.dragStart.x, this.dragStart.y,
            pointer.worldX, pointer.worldY
        );
        this.selectionGraphics.clear();
        if (dist < 5) {
            this.handleSingleSelection(pointer);
        } else {
            this.selectUnitsInIsoRect(this.dragRect);
        }
    }
  }

  private tryBuild(x: number, y: number) {
      if (!this.previewBuildingType) return;
      
      if (this.checkBuildValidity(x, y, this.previewBuildingType)) {
          this.entityFactory.spawnBuilding(this.previewBuildingType, x, y);
          
          const def = BUILDINGS[this.previewBuildingType];
          this.resources.wood -= def.cost.wood;
          this.resources.food -= def.cost.food;
          this.resources.gold -= def.cost.gold;
          
          this.economySystem.updateStats();

          // Continuous building: DO NOT clear previewBuildingType
      }
  }

  private enterBuildMode(buildingType: BuildingType) {
      const def = BUILDINGS[buildingType];
      if (!def) return;
      
      if (this.isDemolishMode) {
          this.toggleDemolishMode(false);
          this.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
      }

      if (this.previewBuilding) this.previewBuilding.destroy();
      this.previewBuildingType = buildingType;
      this.previewBuilding = this.add.container(0, 0);
      const gfx = this.add.graphics();
      this.entityFactory.drawIsoBuilding(gfx, def, 0xffffff, 0.5);
      this.previewBuilding.add(gfx);
      this.previewBuilding.setDepth(Number.MAX_VALUE);
  }

  // --- Logic Helpers ---

  private handleCameraMovement(delta: number) {
    const speed = 1.0 * delta / this.cameras.main.zoom;
    if (this.cursors.left.isDown || this.wasd.A.isDown) this.cameras.main.scrollX -= speed;
    if (this.cursors.right.isDown || this.wasd.D.isDown) this.cameras.main.scrollX += speed;
    if (this.cursors.up.isDown || this.wasd.W.isDown) this.cameras.main.scrollY -= speed;
    if (this.cursors.down.isDown || this.wasd.S.isDown) this.cameras.main.scrollY += speed;
  }

  private toggleDemolishMode(isActive: boolean) {
      this.isDemolishMode = isActive;
      if (this.isDemolishMode) {
          this.selectedUnits.forEach((u: any) => u.setSelected(false));
          this.selectedUnits = [];
          this.game.events.emit(EVENTS.SELECTION_CHANGED, 0);
          this.previewBuildingType = null;
          if (this.previewBuilding) {
              this.previewBuilding.destroy();
              this.previewBuilding = null;
          }
          this.input.setDefaultCursor('crosshair');
      } else {
          this.input.setDefaultCursor('default');
          this.buildings.getChildren().forEach((b: any) => {
              const visual = b.visual as Phaser.GameObjects.Container;
              if (visual) {
                 const highlight = visual.getData('demolishHighlight') as Phaser.GameObjects.Graphics;
                 if (highlight) {
                     highlight.destroy();
                     visual.setData('demolishHighlight', null);
                 }
              }
          });
      }
  }

  private handleDemolishClick(pointer: Phaser.Input.Pointer) {
      const targets = this.input.hitTestPointer(pointer);
      const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building'));
      if (buildingVisual) {
          const b = buildingVisual.getData('building');
          this.demolishBuilding(b);
      }
  }

  private demolishBuilding(b: Phaser.GameObjects.GameObject) {
      const def = b.getData('def') as BuildingDef;
      
      if (def.cost.wood > 0) this.resources.wood += Math.floor(def.cost.wood * 0.75);
      
      if (def.populationBonus) this.maxPopulation -= def.populationBonus;
      if (def.happinessBonus) this.happiness -= def.happinessBonus;

      const worker = b.getData('assignedWorker');
      if (worker) {
          worker.state = UnitState.IDLE;
          worker.jobBuilding = null;
          worker.path = null;
          worker.body.setVelocity(0,0);
      }

      const logic = b as Phaser.GameObjects.Rectangle;
      this.pathfinder.markGrid(logic.x, logic.y, def.width, def.height, false);

      const visual = (b as any).visual;
      if (visual) visual.destroy();
      b.destroy();

      this.economySystem.updateStats();
  }

  private handleSingleSelection(pointer: Phaser.Input.Pointer) {
      const targets = this.input.hitTestPointer(pointer);
      const unitVisual = targets.find((obj: any) => obj.getData && obj.getData('unit'));
      
      this.selectedUnits.forEach((u: any) => u.setSelected(false));
      this.selectedUnits = [];

      if (unitVisual) {
          const unit = unitVisual.getData('unit');
          if (unit && unit.unitType === UnitType.SOLDIER) {
              unit.setSelected(true);
              this.selectedUnits.push(unit);
          }
      }
      this.game.events.emit(EVENTS.SELECTION_CHANGED, this.selectedUnits.length);
  }

  private selectUnitsInIsoRect(rect: Phaser.Geom.Rectangle) {
      this.selectedUnits.forEach((u: any) => u.setSelected(false));
      this.selectedUnits = [];

      this.units.getChildren().forEach((u: any) => {
          if (u.unitType !== UnitType.SOLDIER) return;
          const visual = u.visual;
          if (visual) {
              const inside = rect.contains(visual.x, visual.y);
              if (inside) {
                  u.setSelected(true);
                  this.selectedUnits.push(u);
              }
          }
      });
      this.game.events.emit(EVENTS.SELECTION_CHANGED, this.selectedUnits.length);
  }

  private handleRightClick(pointer: Phaser.Input.Pointer) {
    const cart = toCartesian(pointer.worldX, pointer.worldY);

    if (this.selectedUnits.length > 0) {
        const target = new Phaser.Math.Vector2(cart.x, cart.y);
        const spacing = 15;
        const formationCols = Math.ceil(Math.sqrt(this.selectedUnits.length));

        this.selectedUnits.forEach((unit: any, index) => {
            const col = index % formationCols;
            const row = Math.floor(index / formationCols);
            const offsetX = (col - formationCols/2) * spacing;
            const offsetY = (row - Math.ceil(this.selectedUnits.length/formationCols)/2) * spacing;
            const unitTarget = new Phaser.Math.Vector2(target.x + offsetX, target.y + offsetY);
            
            const path = this.pathfinder.findPath(new Phaser.Math.Vector2(unit.x, unit.y), unitTarget);
            if (path) {
                unit.path = path;
                unit.pathStep = 0;
                unit.pathCreatedAt = this.time.now;
                unit.body.reset(unit.x, unit.y);
            }
        });
        
        const iso = toIso(cart.x, cart.y);
        const circle = this.add.circle(iso.x, iso.y, 5, 0xffffff);
        circle.setScale(1, 0.5);
        circle.setDepth(iso.y); 
        this.tweens.add({
            targets: circle,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 500,
            onComplete: () => circle.destroy()
        });
    }
  }

  private handleSoldierSpawnRequest() {
      const barracks = this.buildings.getChildren().find((b: any) => b.getData('def').type === BuildingType.BARRACKS) as Phaser.GameObjects.Rectangle;

      if (barracks && this.resources.food >= 100 && this.resources.gold >= 50 && this.population < this.maxPopulation) {
          this.resources.food -= 100;
          this.resources.gold -= 50;
          this.entityFactory.spawnUnit(UnitType.SOLDIER, barracks.x, barracks.y + 70);
      }
  }

  private checkBuildValidity(x: number, y: number, type: BuildingType): boolean {
      const def = BUILDINGS[type];
      
      if (this.resources.wood < def.cost.wood || this.resources.food < def.cost.food || this.resources.gold < def.cost.gold) {
          return false;
      }

      let inTerritory = false;
      this.buildings.getChildren().forEach((b: any) => {
          const bDef = b.getData('def') as BuildingDef;
          if (bDef.territoryRadius) {
              const dist = Phaser.Math.Distance.Between(x, y, b.x, b.y);
              if (dist <= bDef.territoryRadius) inTerritory = true;
          }
      });
      if (!inTerritory && this.buildings.getLength() > 0) return false;

      const bounds = new Phaser.Geom.Rectangle(x - def.width/2, y - def.height/2, def.width, def.height);
      let overlaps = false;
      this.buildings.getChildren().forEach((b: any) => {
          if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, b.getBounds())) {
              overlaps = true;
          }
      });
      if (overlaps) return false;

      let treeOverlap = false;
      this.trees.getChildren().forEach((t: any) => {
          if (bounds.contains(t.x, t.y)) treeOverlap = true;
      });
      if (treeOverlap) return false;

      return true;
  }

  private drawTerritory() {
      this.territoryGraphics.clear();
      this.buildings.getChildren().forEach((b: any) => {
          const def = b.getData('def') as BuildingDef;
          const iso = toIso(b.x, b.y);
          if (def.territoryRadius) {
             this.territoryGraphics.fillStyle(FACTION_COLORS[this.faction], 0.1);
             this.territoryGraphics.lineStyle(1, FACTION_COLORS[this.faction], 0.3);
             this.territoryGraphics.fillEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
             this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
          }
          if (def.effectRadius) {
             this.territoryGraphics.lineStyle(2, 0xffd700, 0.3); 
             this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.effectRadius * 2, def.effectRadius);
          }
      });
  }

  private drawUnitPaths(time: number) {
    this.pathGraphics.clear();
    this.units.getChildren().forEach((u: any) => {
        if (u.unitType === UnitType.SOLDIER && u.path && u.pathCreatedAt) {
            const age = time - u.pathCreatedAt;
            const fadeDuration = 1500;
            if (age < fadeDuration) {
                const alpha = Phaser.Math.Clamp(1 - (age / fadeDuration), 0, 1);
                if (u.path.length > u.pathStep) {
                    this.pathGraphics.beginPath();
                    const startIso = toIso(u.x, u.y);
                    this.pathGraphics.moveTo(startIso.x, startIso.y);
                    for (let i = u.pathStep; i < u.path.length; i++) {
                        const pt = u.path[i];
                        const iso = toIso(pt.x, pt.y);
                        this.pathGraphics.lineTo(iso.x, iso.y);
                    }
                    this.pathGraphics.lineStyle(2, 0xffffff, alpha);
                    this.pathGraphics.strokePath();
                    this.pathGraphics.lineStyle(6, 0xffffff, alpha * 0.3);
                    this.pathGraphics.strokePath();
                    const lastPt = u.path[u.path.length - 1];
                    const lastIso = toIso(lastPt.x, lastPt.y);
                    this.pathGraphics.fillStyle(0xffffff, alpha);
                    this.pathGraphics.fillCircle(lastIso.x, lastIso.y, 4);
                }
            }
        }
    });
  }

  private updateUnitLogic(delta: number) {
      this.units.getChildren().forEach((unit: any) => {
          const body = unit.body as Phaser.Physics.Arcade.Body;
          if (unit.path && unit.path.length > 0) {
              if (unit.pathStep >= unit.path.length) {
                  body.setVelocity(0, 0);
                  unit.path = null;
                  if (unit.unitType === UnitType.VILLAGER) {
                      if (unit.state === UnitState.MOVING_TO_WORK) {
                          unit.state = UnitState.WORKING;
                      } else if (unit.state === UnitState.MOVING_TO_RALLY) {
                          unit.state = UnitState.IDLE;
                      }
                  }
                  return;
              }
              const nextPoint = unit.path[unit.pathStep];
              const dist = Phaser.Math.Distance.Between(unit.x, unit.y, nextPoint.x, nextPoint.y);
              if (dist < 4) {
                  unit.pathStep++;
              } else {
                  this.physics.moveTo(unit, nextPoint.x, nextPoint.y, 100);
              }
          } else {
              if (body.velocity.length() > 0) {
                  body.setVelocity(0,0);
              }
          }
      });
      
      this.physics.overlap(this.units, this.units, (obj1, obj2) => {
          const u1 = obj1 as any;
          const u2 = obj2 as any;
          if (u1 === u2) return;
          const dist = Phaser.Math.Distance.Between(u1.x, u1.y, u2.x, u2.y);
          if (dist < 18) { 
               const angle = Phaser.Math.Angle.Between(u2.x, u2.y, u1.x, u1.y);
               const force = (18 - dist) * 1.5; 
               u1.body.velocity.x += Math.cos(angle) * force;
               u1.body.velocity.y += Math.sin(angle) * force;
               u2.body.velocity.x -= Math.cos(angle) * force;
               u2.body.velocity.y -= Math.sin(angle) * force;
          }
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