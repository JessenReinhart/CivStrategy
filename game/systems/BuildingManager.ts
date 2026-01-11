
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, BuildingDef, UnitState, UnitType } from '../../types';
import { BUILDINGS, EVENTS, TILE_SIZE, FACTION_COLORS } from '../../constants';
import { toIso, toCartesian } from '../utils/iso';

export class BuildingManager {
    private scene: MainScene;
    public previewBuilding: Phaser.GameObjects.Container | null = null;
    public previewBuildingType: BuildingType | null = null;
    public isDemolishMode: boolean = false;
    private treeHighlightGraphics: Phaser.GameObjects.Graphics;
    private territoryGraphics: Phaser.GameObjects.Graphics;
    private isTerritoryDirty: boolean = true;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.treeHighlightGraphics = this.scene.add.graphics().setDepth(Number.MAX_VALUE - 500);
        this.territoryGraphics = this.scene.add.graphics().setDepth(-5000);

        this.scene.game.events.on('request-build', this.enterBuildMode, this);
        this.scene.game.events.on(EVENTS.TOGGLE_DEMOLISH, this.toggleDemolishMode, this);
        this.scene.game.events.on(EVENTS.REGROW_FOREST, this.handleRegrowForest, this);
        this.scene.game.events.on(EVENTS.DEMOLISH_SELECTED, this.handleDemolishSelected, this);
    }

    public update() {
        if (this.isTerritoryDirty) {
            this.drawTerritory();
            this.isTerritoryDirty = false;
        }
    }

    public markTerritoryDirty() {
        this.isTerritoryDirty = true;
    }

    public enterBuildMode(buildingType: BuildingType) {
        const def = BUILDINGS[buildingType];
        if (!def) return;

        if (this.isDemolishMode) {
            this.toggleDemolishMode(false);
            this.scene.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
        }

        if (this.previewBuilding) this.previewBuilding.destroy();
        this.previewBuildingType = buildingType;
        this.previewBuilding = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        this.scene.entityFactory.drawIsoBuilding(gfx, def, 0xffffff, 0.5);
        this.previewBuilding.add(gfx);
        this.previewBuilding.setDepth(Number.MAX_VALUE);
        this.previewBuilding.setVisible(false);
    }

    public toggleDemolishMode(isActive: boolean) {
        this.isDemolishMode = isActive;
        if (this.isDemolishMode) {
            this.scene.inputManager.clearSelection();
            this.previewBuildingType = null;
            if (this.previewBuilding) {
                this.previewBuilding.destroy();
                this.previewBuilding = null;
            }
            this.scene.input.setDefaultCursor('crosshair');
        } else {
            this.scene.input.setDefaultCursor('default');
            this.scene.buildings.getChildren().forEach((b: any) => {
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

    public updatePreview(worldX: number, worldY: number) {
        if (!this.previewBuildingType || !this.previewBuilding) return;

        this.previewBuilding.setVisible(true);

        const cart = toCartesian(worldX, worldY);
        const gx = Math.floor(cart.x / TILE_SIZE) * TILE_SIZE;
        const gy = Math.floor(cart.y / TILE_SIZE) * TILE_SIZE;
        const def = BUILDINGS[this.previewBuildingType];
        const cx = gx + def.width / 2;
        const cy = gy + def.height / 2;

        const iso = toIso(cx, cy);
        this.previewBuilding.setPosition(iso.x, iso.y);
        this.previewBuilding.setDepth(Number.MAX_VALUE - 100);

        const isValid = this.checkBuildValidity(cx, cy, this.previewBuildingType);
        const color = isValid ? 0x00ff00 : 0xff0000;

        const graphics = this.previewBuilding.getAt(0) as Phaser.GameObjects.Graphics;
        graphics.clear();

        if (def.effectRadius) {
            graphics.lineStyle(2, 0xffd700, 0.8);
            graphics.strokeEllipse(0, 0, def.effectRadius * 2, def.effectRadius);
            graphics.fillStyle(0xffd700, 0.1);
            graphics.fillEllipse(0, 0, def.effectRadius * 2, def.effectRadius);
        }

        this.treeHighlightGraphics.clear();
        this.updateHighlights(cx, cy, def);

        this.scene.entityFactory.drawIsoBuilding(graphics, def, color, 0.5);
    }

    private updateHighlights(cx: number, cy: number, def: BuildingDef) {
        if (this.previewBuildingType === BuildingType.LUMBER_CAMP) {
            const range = def.effectRadius || 200;
            this.scene.trees.getChildren().forEach((t: any) => {
                if (Phaser.Math.Distance.Between(cx, cy, t.x, t.y) <= range) {
                    const isoT = toIso(t.x, t.y);
                    this.treeHighlightGraphics.lineStyle(2, 0x4ade80, 0.8);
                    this.treeHighlightGraphics.strokeCircle(isoT.x, isoT.y, 15);
                }
            });
        }
    }

    public tryBuild(worldX: number, worldY: number) {
        if (!this.previewBuildingType) return;

        const cart = toCartesian(worldX, worldY);
        const gx = Math.floor(cart.x / TILE_SIZE) * TILE_SIZE;
        const gy = Math.floor(cart.y / TILE_SIZE) * TILE_SIZE;
        const def = BUILDINGS[this.previewBuildingType];
        const cx = gx + def.width / 2;
        const cy = gy + def.height / 2;

        if (this.checkBuildValidity(cx, cy, this.previewBuildingType)) {
            const building = this.scene.entityFactory.spawnBuilding(this.previewBuildingType, cx, cy);

            // Juice: Screen shake (subtle)
            this.scene.cameras.main.shake(80, 0.003);

            // Juice: Dust particles poof
            const iso = toIso(cx, cy);
            this.emitDustParticles(iso.x, iso.y, def.width);

            this.scene.resources.wood -= def.cost.wood;
            this.scene.resources.food -= def.cost.food;
            this.scene.resources.gold -= def.cost.gold;

            if (this.previewBuildingType === BuildingType.HOUSE) {
                this.scene.entityFactory.spawnUnit(UnitType.VILLAGER, cx + 30, cy + 30);
                this.scene.showFloatingText(cx, cy, "Peasant spawned!", "#00ff00");
            }

            this.markTerritoryDirty();
            this.scene.economySystem.updateStats();
        }
    }

    private checkBuildValidity(x: number, y: number, type: BuildingType): boolean {
        const def = BUILDINGS[type];

        if (this.scene.resources.wood < def.cost.wood || this.scene.resources.food < def.cost.food || this.scene.resources.gold < def.cost.gold) {
            return false;
        }

        let inTerritory = false;
        this.scene.buildings.getChildren().forEach((b: any) => {
            const bDef = b.getData('def') as BuildingDef;
            if (bDef.territoryRadius) {
                const dist = Phaser.Math.Distance.Between(x, y, b.x, b.y);
                if (dist <= bDef.territoryRadius) inTerritory = true;
            }
        });
        if (!inTerritory && this.scene.buildings.getLength() > 0) return false;

        const bounds = new Phaser.Geom.Rectangle(x - def.width / 2, y - def.height / 2, def.width, def.height);
        let overlaps = false;
        this.scene.buildings.getChildren().forEach((b: any) => {
            if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, b.getBounds())) {
                overlaps = true;
            }
        });
        if (overlaps) return false;

        let treeOverlap = false;
        this.scene.trees.getChildren().forEach((t: any) => {
            if (bounds.contains(t.x, t.y)) treeOverlap = true;
        });
        if (treeOverlap) return false;

        return true;
    }

    public handleDemolishHover(pointer: Phaser.Input.Pointer) {
        this.scene.buildings.getChildren().forEach((b: any) => {
            const visual = b.visual as Phaser.GameObjects.Container;
            if (visual) {
                const highlight = visual.getData('demolishHighlight') as Phaser.GameObjects.Graphics;
                if (highlight) {
                    highlight.destroy();
                    visual.setData('demolishHighlight', null);
                }
            }
        });

        const targets = this.scene.input.hitTestPointer(pointer);
        const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building')) as Phaser.GameObjects.Container | undefined;

        if (buildingVisual) {
            const b = buildingVisual.getData('building');
            if (b) {
                // Fix: Only allow demolishing player buildings (owner 0)
                const owner = b.getData('owner');
                if (owner === 0) {
                    const def = b.getData('def') as BuildingDef;
                    const highlight = this.scene.add.graphics();
                    this.scene.entityFactory.drawIsoBuilding(highlight, def, 0xff0000, 0.5);
                    buildingVisual.add(highlight);
                    buildingVisual.setData('demolishHighlight', highlight);
                }
            }
        }
    }

    public handleDemolishClick(pointer: Phaser.Input.Pointer) {
        const targets = this.scene.input.hitTestPointer(pointer);
        const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building'));
        if (buildingVisual) {
            const b = buildingVisual.getData('building');
            // Fix: Security check before demolition
            const owner = b.getData('owner');
            if (owner === 0) {
                this.demolishBuilding(b);
            }
        }
    }

    private demolishBuilding(b: Phaser.GameObjects.GameObject) {
        const def = b.getData('def') as BuildingDef;
        const owner = b.getData('owner');

        if (def.cost.wood > 0) this.scene.resources.wood += Math.floor(def.cost.wood * 0.75);

        // FIX: Only reduce maxPopulation if it was a player building
        if (owner === 0 && def.populationBonus) this.scene.maxPopulation -= def.populationBonus;
        if (owner === 0 && def.happinessBonus) this.scene.happiness -= def.happinessBonus;

        const worker = b.getData('assignedWorker');
        if (worker) {
            worker.state = UnitState.IDLE;
            worker.jobBuilding = null;
            worker.path = null;
            worker.body.setVelocity(0, 0);
        }

        const logic = b as Phaser.GameObjects.Rectangle;
        this.scene.pathfinder.markGrid(logic.x, logic.y, def.width, def.height, false);

        // Explosion Effect
        const iso = toIso(logic.x, logic.y);
        this.emitExplosionParticles(iso.x, iso.y, def.width);

        const visual = (b as any).visual;
        if (visual) visual.destroy();
        b.destroy();

        if (this.scene.inputManager.selectedBuilding === b) {
            this.scene.inputManager.deselectBuilding();
        }

        this.markTerritoryDirty();
        this.scene.economySystem.updateStats();
    }

    public emitExplosionParticles(isoX: number, isoY: number, buildingWidth: number) {
        // Larger, more dramatic explosion for demolition/destruction
        const count = 30;
        const emitter = this.scene.add.particles(isoX, isoY, 'smoke', {
            speed: { min: 100, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 1200,
            gravityY: -50,
            blendMode: 'ADD',
            emitting: false
        });
        emitter.setDepth(Number.MAX_VALUE - 5);

        // Fire burst
        const fireEmitter = this.scene.add.particles(isoX, isoY, 'flare', {
            speed: { min: 50, max: 150 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.3, end: 0 },
            alpha: { start: 0.8, end: 0 },
            tint: 0xff4500, // Orange-Red fire color
            lifespan: 800,
            blendMode: 'ADD',
            emitting: false
        });
        fireEmitter.setDepth(Number.MAX_VALUE - 5);

        emitter.explode(count);
        fireEmitter.explode(20);

        // Shake camera for impact
        this.scene.cameras.main.shake(150, 0.005);

        this.scene.time.delayedCall(1500, () => {
            emitter.destroy();
            fireEmitter.destroy();
        });
    }

    private handleDemolishSelected() {
        const selected = this.scene.inputManager.selectedBuilding;
        if (!selected) return;

        // Security check
        const owner = selected.getData('owner');
        if (owner === 0) {
            this.demolishBuilding(selected);
        }
    }

    private handleRegrowForest() {
        const b = this.scene.inputManager.selectedBuilding as Phaser.GameObjects.Rectangle;
        if (!b) return;

        const def = b.getData('def') as BuildingDef;
        if (def.type !== BuildingType.LUMBER_CAMP) return;

        const cost = 50;
        if (this.scene.resources.wood < cost) {
            this.scene.showFloatingText(b.x, b.y, "Not enough wood!", "#ff0000");
            return;
        }

        this.scene.resources.wood -= cost;

        let regrownCount = 0;
        this.scene.trees.getChildren().forEach((tObj: Phaser.GameObjects.GameObject) => {
            const t = tObj as any;
            if (t.getData('isChopped')) {
                if (Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y) < (def.effectRadius || 200)) {
                    this.scene.entityFactory.updateTreeVisual(t, false);
                    regrownCount++;
                }
            }
        });

        if (regrownCount > 0) {
            this.scene.showFloatingText(b.x, b.y, "Forest Regrown!", "#4ade80");
            this.scene.economySystem.updateStats();
        } else {
            this.scene.showFloatingText(b.x, b.y, "No stumps nearby.", "#ffffff");
            this.scene.resources.wood += cost;
        }
    }

    private drawTerritory() {
        this.territoryGraphics.clear();
        this.scene.buildings.getChildren().forEach((bObj: Phaser.GameObjects.GameObject) => {
            const b = bObj as Phaser.GameObjects.Rectangle;
            const def = b.getData('def') as BuildingDef;
            const iso = toIso(b.x, b.y);
            if (def.territoryRadius) {
                this.territoryGraphics.fillStyle(FACTION_COLORS[this.scene.faction], 0.1);
                this.territoryGraphics.lineStyle(1, FACTION_COLORS[this.scene.faction], 0.3);
                this.territoryGraphics.fillEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
                this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
            }
            if (def.effectRadius) {
                this.territoryGraphics.lineStyle(2, 0xffd700, 0.3);
                this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.effectRadius * 2, def.effectRadius);
            }
        });
    }

    private emitDustParticles(isoX: number, isoY: number, buildingWidth: number) {
        // Smoke poof from 8 points around building - like building dropped from sky
        const offset = buildingWidth * 0.45;
        const diagOffset = offset * 0.7;
        const particlesPerPoint = 5;

        // 8 emission points: 4 cardinal + 4 diagonal corners
        const emissionPoints = [
            // Cardinal directions
            { x: isoX - offset, y: isoY, angle: 180 },           // Left
            { x: isoX + offset, y: isoY, angle: 0 },             // Right  
            { x: isoX, y: isoY - offset * 0.5, angle: 270 },     // Top
            { x: isoX, y: isoY + offset * 0.5, angle: 90 },      // Bottom
            // Diagonal corners
            { x: isoX - diagOffset, y: isoY - diagOffset * 0.5, angle: 225 }, // Top-left
            { x: isoX + diagOffset, y: isoY - diagOffset * 0.5, angle: 315 }, // Top-right
            { x: isoX - diagOffset, y: isoY + diagOffset * 0.5, angle: 135 }, // Bottom-left
            { x: isoX + diagOffset, y: isoY + diagOffset * 0.5, angle: 45 },  // Bottom-right
        ];

        emissionPoints.forEach(point => {
            const emitter = this.scene.add.particles(point.x, point.y, 'smoke', {
                speed: { min: 40, max: 80 },
                angle: { min: point.angle - 25, max: point.angle + 25 }, // Horizontal spread
                scale: { start: 0.08, end: 0.18 },
                alpha: { start: 0.65, end: 0 },
                lifespan: 900,
                gravityY: 0, // No initial gravity
                accelerationY: -60, // Curves upward over time - billowing effect!
                rotate: { min: -90, max: 90 },
                emitting: false
            });
            emitter.setDepth(Number.MAX_VALUE - 10);
            emitter.explode(particlesPerPoint);

            this.scene.time.delayedCall(1100, () => emitter.destroy());
        });
    }
}
