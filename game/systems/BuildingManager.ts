
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, BuildingDef, UnitState } from '../../types';
import { BUILDINGS, EVENTS, TILE_SIZE, TERRAIN_CONFIG, SEASON_CONFIG, FARM_TERRAIN_YIELD } from '../../constants';
import { toIso, toIsoElev, toCartesian } from '../utils/iso';

export class BuildingManager {
    private scene: MainScene;
    public previewBuilding: Phaser.GameObjects.Container | null = null;
    public previewBuildingType: BuildingType | null = null;
    public isDemolishMode: boolean = false;
    private treeHighlightGraphics: Phaser.GameObjects.Graphics;
    private territoryGraphics: Phaser.GameObjects.Graphics;
    private isTerritoryDirty: boolean = true;
    private activeSelectionBeam: Phaser.GameObjects.Graphics | null = null;
    private previewText: Phaser.GameObjects.Text | null = null;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.treeHighlightGraphics = this.scene.add.graphics().setDepth(-4500);
        this.territoryGraphics = this.scene.add.graphics().setDepth(-5000);
        this.scene.worldLayer.add(this.treeHighlightGraphics);
        this.scene.worldLayer.add(this.territoryGraphics);

        this.scene.game.events.on('request-build', this.enterBuildMode, this);
        this.scene.game.events.on(EVENTS.TOGGLE_DEMOLISH, this.toggleDemolishMode, this);
        this.scene.game.events.on(EVENTS.REGROW_FOREST, this.handleRegrowForest, this);
        this.scene.game.events.on(EVENTS.DEMOLISH_SELECTED, this.handleDemolishSelected, this);
        this.scene.game.events.on(EVENTS.BUILDING_SELECTED, this.handleBuildingSelection, this);
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
    public cancelBuildMode() {
        this.previewBuildingType = null;
        if (this.previewBuilding) {
            this.previewBuilding.destroy();
            this.previewBuilding = null;
        }
        if (this.previewText) {
            this.previewText.destroy();
            this.previewText = null;
        }
        if (this.treeHighlightGraphics) {
            this.treeHighlightGraphics.clear();
        }
    }

    public enterBuildMode(buildingType: BuildingType) {
        const def = BUILDINGS[buildingType];
        if (!def) return;

        // Ensure clean slate before starting new build
        this.cancelBuildMode();

        if (this.isDemolishMode) {
            this.toggleDemolishMode(false);
            this.scene.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
        }
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
            this.cancelBuildMode();
            this.scene.input.setDefaultCursor('crosshair');
        } else {
            this.scene.input.setDefaultCursor('default');
            this.scene.buildings.getChildren().forEach((b) => {
                const visual = (b as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
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

        const iso = toIsoElev(cx, cy, this.scene.terrainSystem.getHeightAt(cx, cy));
        this.previewBuilding.setPosition(iso.x, iso.y);
        this.previewBuilding.setDepth(Number.MAX_VALUE - 100);

        const isValid = this.checkBuildValidity(cx, cy, this.previewBuildingType);
        const slopeInfo = this.scene.terrainSystem.getSlopeAt(cx, cy);
        const color = !isValid ? 0xff0000 : (slopeInfo.slope > 0.1 ? 0xffaa00 : 0x00ff00);

        const graphics = this.previewBuilding.getAt(0) as Phaser.GameObjects.Graphics;
        graphics.clear();

        if (def.effectRadius) {
            const radius = def.effectRadius;
            const wallHeight = 150; // Shorter height
            const segments = 48; // More segments = smoother wall

            // Draw vertical wall segments around the cylinder
            for (let i = 0; i < segments; i++) {
                const angle1 = (i / segments) * Math.PI * 2;
                const angle2 = ((i + 1) / segments) * Math.PI * 2;

                // Bottom points (on the ellipse)
                const x1 = Math.cos(angle1) * radius;
                const y1 = Math.sin(angle1) * radius * 0.5;
                const x2 = Math.cos(angle2) * radius;
                const y2 = Math.sin(angle2) * radius * 0.5;

                // Draw gradient wall segment (multiple layers for fade effect)
                const fadeSteps = 5;
                for (let s = 0; s < fadeSteps; s++) {
                    const stepProgress = s / fadeSteps;
                    const nextProgress = (s + 1) / fadeSteps;
                    const stepAlpha = 0.2 * (1 - stepProgress);

                    const stepY1 = y1 - wallHeight * stepProgress;
                    const stepY2 = y2 - wallHeight * stepProgress;
                    const nextY1 = y1 - wallHeight * nextProgress;
                    const nextY2 = y2 - wallHeight * nextProgress;

                    graphics.fillStyle(0xffd700, stepAlpha);
                    graphics.beginPath();
                    graphics.moveTo(x1, stepY1);
                    graphics.lineTo(x2, stepY2);
                    graphics.lineTo(x2, nextY2);
                    graphics.lineTo(x1, nextY1);
                    graphics.closePath();
                    graphics.fillPath();
                }
            }

            // Draw glowing ring at the base
            graphics.lineStyle(3, 0xffd700, 0.8);
            graphics.strokeEllipse(0, 0, radius * 2.02, radius * 1.01);
            graphics.lineStyle(2, 0xffffcc, 1.0);
            graphics.strokeEllipse(0, 0, radius * 2, radius);
        }

        if (!this.treeHighlightGraphics) {
            this.treeHighlightGraphics = this.scene.add.graphics().setDepth(-4500);
            this.scene.worldLayer.add(this.treeHighlightGraphics);
        }
        this.treeHighlightGraphics.clear();
        this.updateHighlights(cx, cy, def);

        this.scene.entityFactory.drawIsoBuilding(graphics, def, color, 0.5);

        // Farm terrain yield preview
        if (this.previewBuildingType === BuildingType.FARM && isValid) {
            const biome = this.scene.terrainSystem.getBiomeLabel(cx, cy);
            const mult = FARM_TERRAIN_YIELD[biome] ?? 1.0;
            if (!this.previewText) {
                this.previewText = this.scene.add.text(0, 0, '', {
                    fontSize: '14px',
                    color: '#ffd700',
                    fontStyle: 'bold',
                    stroke: '#000',
                    strokeThickness: 3,
                }).setOrigin(0.5);
                this.previewBuilding.add(this.previewText);
            }
            this.previewText.setText('×' + mult.toFixed(1));
            this.previewText.setColor(mult >= 1.0 ? '#55ff55' : mult >= 0.6 ? '#ffdd44' : '#ff4444');
            this.previewText.setPosition(0, -30);
            this.previewText.setVisible(true);
        } else if (this.previewText) {
            this.previewText.setVisible(false);
        }
    }

    private updateHighlights(cx: number, cy: number, def: BuildingDef) {
        if (this.previewBuildingType === BuildingType.LUMBER_CAMP) {
            const range = def.effectRadius || 200;
            this.scene.trees.getChildren().forEach((t) => {
                const tree = t as Phaser.GameObjects.Image;
                const tx = tree.x;
                const ty = tree.y;
                if (Phaser.Math.Distance.Between(cx, cy, tx, ty) <= range) {
                    const isoT = toIsoElev(tx, ty, this.scene.terrainSystem.getHeightAt(tx, ty));

                    // Draw glowing effect on tree
                    const glowRadius = 20;
                    const glowHeight = 60;

                    // Outer glow ring
                    this.treeHighlightGraphics.fillStyle(0x4ade80, 0.15);
                    this.treeHighlightGraphics.fillEllipse(isoT.x, isoT.y, glowRadius * 2.5, glowRadius * 1.25);

                    // Inner glow ring
                    this.treeHighlightGraphics.fillStyle(0x4ade80, 0.25);
                    this.treeHighlightGraphics.fillEllipse(isoT.x, isoT.y, glowRadius * 1.5, glowRadius * 0.75);

                    // Light pillar going up (fading)
                    const pillarSteps = 4;
                    for (let s = 0; s < pillarSteps; s++) {
                        const progress = s / pillarSteps;
                        const alpha = 0.2 * (1 - progress);
                        const y = isoT.y - glowHeight * progress;
                        const width = glowRadius * (1 - progress * 0.5);

                        this.treeHighlightGraphics.fillStyle(0x4ade80, alpha);
                        this.treeHighlightGraphics.fillEllipse(isoT.x, y, width * 2, width);
                    }

                    // Bright center ring
                    this.treeHighlightGraphics.lineStyle(2, 0x86efac, 0.9);
                    this.treeHighlightGraphics.strokeEllipse(isoT.x, isoT.y, glowRadius * 1.2, glowRadius * 0.6);
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

        const validity = this.getBuildValidity(cx, cy, this.previewBuildingType);

        if (validity.valid) {
            // Juice: Screen shake (subtle) - only if near camera center
            const cam = this.scene.cameras.main;
            const iso = toIso(cx, cy);
            const dx = iso.x - cam.scrollX - cam.width / 2;
            const dy = iso.y - cam.scrollY - cam.height / 2;
            if (Math.sqrt(dx * dx + dy * dy) < 500) {
                cam.shake(80, 0.003);
            }
            // Juice: Dust particles poof
            this.emitDustParticles(iso.x, iso.y, def.width);
            this.scene.proceduralSound.playConstruction(cx, cy);

            this.scene.resources.wood -= def.cost.wood;
            this.scene.resources.food -= def.cost.food;
            this.scene.resources.gold -= def.cost.gold;
            // Actually spawn the building sprite into the world
            this.scene.entityFactory.spawnBuilding(this.previewBuildingType, cx, cy, 0);

            this.markTerritoryDirty();
            this.scene.feedbackSystem.notifyBuildingComplete(def.name);
            this.scene.economySystem.updateStats();
        } else {
            this.scene.feedbackSystem.showFloatingText(cx, cy, validity.reason || "Unable to build", "#ff0000");
        }
    }

    private checkBuildValidity(x: number, y: number, type: BuildingType): boolean {
        return this.getBuildValidity(x, y, type).valid;
    }

    private getBuildValidity(x: number, y: number, type: BuildingType): { valid: boolean; reason?: string } {
        const def = BUILDINGS[type];

        if (this.scene.resources.wood < def.cost.wood || this.scene.resources.food < def.cost.food || this.scene.resources.gold < def.cost.gold) {
            return { valid: false, reason: "Not enough resources" };
        }

        let inTerritory = false;
        this.scene.buildings.getChildren().forEach((b) => {
            const bDef = b.getData('def') as BuildingDef;
            if (bDef.territoryRadius) {
                const dist = Phaser.Math.Distance.Between(x, y, (b as Phaser.GameObjects.Image).x, (b as Phaser.GameObjects.Image).y);
                if (dist <= bDef.territoryRadius) inTerritory = true;
            }
        });
        if (!inTerritory && this.scene.buildings.getLength() > 0) return { valid: false, reason: "Outside Territory" };

        const bounds = new Phaser.Geom.Rectangle(x - def.width / 2, y - def.height / 2, def.width, def.height);
        let overlaps = false;
        this.scene.buildings.getChildren().forEach((b) => {
            if (!b || !b.scene) return;
            if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, (b as Phaser.GameObjects.Image).getBounds())) {
                overlaps = true;
            }
        });
        this.scene.units.getChildren().forEach((u) => {
            if (!u || !u.scene) return;
            if (bounds.contains((u as Phaser.GameObjects.Image).x, (u as Phaser.GameObjects.Image).y)) overlaps = true;
        });
        this.scene.villagerSystem?.getAllVillagers().forEach((v) => {
            if (!v) return;
            if (bounds.contains(v.x, v.y)) overlaps = true;
        });

        if (overlaps) return { valid: false, reason: "Space Occupied" };

        // Check tree overlap
        let treeOverlap = false;
        this.scene.trees.getChildren().forEach((t) => {
            if (!t || !t.scene) return;
            if (bounds.contains((t as Phaser.GameObjects.Image).x, (t as Phaser.GameObjects.Image).y)) treeOverlap = true;
        });
        if (treeOverlap) return { valid: false, reason: "Tree in way" };

         // Check terrain slope
        const slopeInfo = this.scene.terrainSystem.getSlopeAt(x, y);
        if (!slopeInfo.isBuildable) {
            return { valid: false, reason: "Terrain too steep" };
        }

        // Reject water (center + footprint corners)
        const waterLevel = TERRAIN_CONFIG.WATER_LEVEL;
        const hw = def.width / 2;
        const hh = def.height / 2;
        const samplePts: [number, number][] = [
            [x, y],
            [x - hw, y - hh],
            [x + hw, y - hh],
            [x - hw, y + hh],
            [x + hw, y + hh],
        ];
        for (const [sx, sy] of samplePts) {
            if (this.scene.terrainSystem.getHeightAt(sx, sy) < waterLevel) {
                return { valid: false, reason: "Cannot build on water" };
            }
        }

        return { valid: true };
    }

    public handleDemolishHover(pointer: Phaser.Input.Pointer) {
        this.scene.buildings.getChildren().forEach((b) => {
            const visual = (b as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (visual) {
                const highlight = visual.getData('demolishHighlight') as Phaser.GameObjects.Graphics;
                if (highlight) {
                    highlight.destroy();
                    visual.setData('demolishHighlight', null);
                }
            }
        });

        const targets = this.scene.input.hitTestPointer(pointer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        this.scene.proceduralSound.playDemolition(logic.x, logic.y);

        const visual = (b as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (visual) visual.destroy();
        b.destroy();

        if (this.scene.inputManager.selectedBuilding === b) {
            this.scene.inputManager.deselectBuilding();
        }

        this.markTerritoryDirty();
        this.scene.economySystem.updateStats();
    }

    public emitExplosionParticles(isoX: number, isoY: number, _buildingWidth: number) {
        // Larger, more dramatic explosion for demolition/destruction
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

        // Shake camera for impact - only if near camera center
        const cam = this.scene.cameras.main;
        const dx = isoX - cam.scrollX - cam.width / 2;
        const dy = isoY - cam.scrollY - cam.height / 2;
        if (Math.sqrt(dx * dx + dy * dy) < 500) {
            cam.shake(150, 0.005);
        }

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
            this.scene.feedbackSystem.showFloatingText(b.x, b.y, "Not enough wood!", "#ff0000");
            return;
        }


        this.scene.resources.wood -= cost;

        let regrownCount = 0;
        const regrowthChance = Math.min(1, SEASON_CONFIG[this.scene.currentSeason].treeRegrowth);
        this.scene.trees.getChildren().forEach((tObj: Phaser.GameObjects.GameObject) => {
            const t = tObj as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (t.getData('isChopped')) {
                if (Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y) < (def.effectRadius || 200)) {
                    if (Math.random() < regrowthChance) {
                        this.scene.entityFactory.updateTreeVisual(t, false);
                        regrownCount++;
                    }
                }
            }
        });

        if (regrownCount > 0) {
            this.scene.feedbackSystem.showFloatingText(b.x, b.y, "Forest Regrown!", "#4ade80");
            this.scene.economySystem.updateStats();
        } else {
            this.scene.feedbackSystem.showFloatingText(b.x, b.y, "No stumps nearby.", "#ffffff");
            this.scene.resources.wood += cost;
        }

    }

    private drawTerritory() {
        if (!this.territoryGraphics) {
            this.territoryGraphics = this.scene.add.graphics().setDepth(-5000);
            this.scene.worldLayer.add(this.territoryGraphics);
        }
        this.territoryGraphics.clear();
        this.scene.buildings.getChildren().forEach((bObj: Phaser.GameObjects.GameObject) => {
            const b = bObj as Phaser.GameObjects.Rectangle;
            const def = b.getData('def') as BuildingDef;
            const iso = toIsoElev(b.x, b.y, this.scene.terrainSystem.getHeightAt(b.x, b.y));
            if (def.territoryRadius) {
                const color = this.scene.getFactionColor(b.getData('owner'));
                this.territoryGraphics.fillStyle(color, 0.08);
                this.territoryGraphics.lineStyle(1, color, 0.3);
                this.territoryGraphics.fillEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
                this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.territoryRadius * 2, def.territoryRadius);
            }
            if (def.effectRadius) {
                this.territoryGraphics.lineStyle(2, 0xffd700, 0.3);
                this.territoryGraphics.strokeEllipse(iso.x, iso.y, def.effectRadius * 2, def.effectRadius);
            }
        });
    }

    public emitDustParticles(isoX: number, isoY: number, buildingWidth: number) {
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

    private handleBuildingSelection() {
        // Clear previous selection beam
        if (this.activeSelectionBeam) {
            this.activeSelectionBeam.destroy();
            this.activeSelectionBeam = null;
        }

        const selected = this.scene.inputManager.selectedBuilding;
        if (!selected) return;

        const def = selected.getData('def') as BuildingDef;
        if (!def || !def.effectRadius) return;

        // Create the light cylinder effect for selected building
        const b = selected as Phaser.GameObjects.Rectangle;
        const iso = toIsoElev(b.x, b.y, this.scene.terrainSystem.getHeightAt(b.x, b.y));
        const radius = def.effectRadius;
        const wallHeight = 150;
        const segments = 48;

        this.activeSelectionBeam = this.scene.add.graphics();
        this.activeSelectionBeam.setPosition(iso.x, iso.y);
        this.activeSelectionBeam.setDepth(100);
        this.scene.worldLayer.add(this.activeSelectionBeam);

        const graphics = this.activeSelectionBeam;

        // Draw vertical wall segments around the cylinder
        for (let i = 0; i < segments; i++) {
            const angle1 = (i / segments) * Math.PI * 2;
            const angle2 = ((i + 1) / segments) * Math.PI * 2;

            const x1 = Math.cos(angle1) * radius;
            const y1 = Math.sin(angle1) * radius * 0.5;
            const x2 = Math.cos(angle2) * radius;
            const y2 = Math.sin(angle2) * radius * 0.5;

            const fadeSteps = 5;
            for (let s = 0; s < fadeSteps; s++) {
                const stepProgress = s / fadeSteps;
                const nextProgress = (s + 1) / fadeSteps;
                const stepAlpha = 0.2 * (1 - stepProgress);

                const stepY1 = y1 - wallHeight * stepProgress;
                const stepY2 = y2 - wallHeight * stepProgress;
                const nextY1 = y1 - wallHeight * nextProgress;
                const nextY2 = y2 - wallHeight * nextProgress;

                graphics.fillStyle(0xffd700, stepAlpha);
                graphics.beginPath();
                graphics.moveTo(x1, stepY1);
                graphics.lineTo(x2, stepY2);
                graphics.lineTo(x2, nextY2);
                graphics.lineTo(x1, nextY1);
                graphics.closePath();
                graphics.fillPath();
            }
        }

        // Draw glowing ring at the base
        graphics.lineStyle(3, 0xffd700, 0.8);
        graphics.strokeEllipse(0, 0, radius * 2.02, radius * 1.01);
        graphics.lineStyle(2, 0xffffcc, 1.0);
        graphics.strokeEllipse(0, 0, radius * 2, radius);
    }

    /** Return wall buildings within `radius` of (x, y). Optionally filter by owner. */
    public getWallsNear(x: number, y: number, radius: number, owner?: number): Phaser.GameObjects.GameObject[] {
        const r2 = radius * radius;
        return this.scene.buildings.getChildren().filter((b) => {
            const def = b.getData('def') as BuildingDef | undefined;
            if (!def || def.type !== BuildingType.WALL) return false;
            if (owner !== undefined && b.getData('owner') !== owner) return false;
            const dx = (b as Phaser.GameObjects.Image).x - x;
            const dy = (b as Phaser.GameObjects.Image).y - y;
            return dx * dx + dy * dy <= r2;
        });
    }


}
