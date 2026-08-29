
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { EVENTS, UNIT_ABILITIES } from '../../constants';
import { UnitType, BuildingType, GameUnit } from '../../types';
import { addAbilityWindowListener } from '../../utils/abilityWindowListener';
import { toCartesian, toIso } from '../utils/iso';

export class InputManager {
    private scene: MainScene;
    public selectedUnits: Phaser.GameObjects.GameObject[] = [];
    public selectedBuilding: Phaser.GameObjects.GameObject | null = null;

    private lastGameSpeed = 0.5;
    private isRightDragging = false;
    private isDragging = false;
    private dragStart = new Phaser.Math.Vector2();
    private dragRect = new Phaser.Geom.Rectangle();
    private selectionGraphics: Phaser.GameObjects.Graphics;
    private rightDragGraphics: Phaser.GameObjects.Graphics;
    private rightDragPoints: Phaser.Math.Vector2[] = [];

    private lastClickTime = 0;
    private lastClickPos = new Phaser.Math.Vector2();

    constructor(scene: MainScene) {
        this.scene = scene;
        this.selectionGraphics = this.scene.add.graphics().setDepth(Number.MAX_VALUE);
        this.rightDragGraphics = this.scene.add.graphics().setDepth(Number.MAX_VALUE - 1);
        this.setupInputs();
    }

    private setupInputs() {
        this.scene.input.on('pointerdown', this.handlePointerDown, this);
        this.scene.input.on('pointermove', this.handlePointerMove, this);
        this.scene.input.on('pointerup', this.handlePointerUp, this);
        this.scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number, _deltaZ: number) => {
            this.handleZoom(deltaY);
        });

        this.scene.game.events.on('filter-selection', (type: UnitType) => {
            this.filterSelectionByType(type);
        });

        this.scene.game.events.on('clear-selection', () => {
            this.clearSelection();
            this.deselectBuilding();
        });

        // ── Keyboard Shortcuts ───────────────────────────────────────────
        const kb = this.scene.input.keyboard;
        if (!kb) return;

        // ESC — Deselect all / cancel build mode
        kb.on('keydown-ESC', () => {
            if (this.scene.buildingManager.isDemolishMode) {
                this.scene.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
            } else if (this.scene.buildingManager.previewBuildingType) {
                this.scene.buildingManager.cancelBuildMode();
            }
            this.clearSelection();
            this.deselectBuilding();
        });

        // Space — Pause / unpause
        kb.on('keydown-SPACE', () => {
            if (this.scene.gameSpeed > 0) {
                this.lastGameSpeed = this.scene.gameSpeed;
                this.scene.gameSpeed = 0;
                this.scene.tweens.timeScale = 0;
            } else {
                this.scene.gameSpeed = this.lastGameSpeed || 0.5;
                this.scene.physics.world.timeScale = 1 / this.scene.gameSpeed;
                this.scene.tweens.timeScale = this.scene.gameSpeed;
            }
        });

        // 1 — Select all player military units in viewport
        kb.on('keydown-ONE', () => {
            const cam = this.scene.cameras.main;
            const rect = new Phaser.Geom.Rectangle(cam.scrollX, cam.scrollY, cam.width / cam.zoom, cam.height / cam.zoom);
            this.clearSelection();
            this.deselectBuilding();
            const combatTypes = [UnitType.PIKESMAN, UnitType.ARCHER, UnitType.CAVALRY, UnitType.LEGION, UnitType.SLINGER, UnitType.AXEMAN, UnitType.HOPLITE, UnitType.CHARIOT];
            this.scene.units.getChildren().forEach((u: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (u.getData('owner') !== 0) return;
                if (!combatTypes.includes(u.unitType)) return;
                const visual = u.visual;
                if (visual && rect.contains(visual.x, visual.y)) {
                    u.setSelected(true);
                    this.selectedUnits.push(u);
                }
            });
            this.emitSelectionChanged();
        });

        // 2 — Select all idle villagers
        kb.on('keydown-TWO', () => {
            const idle = this.scene.villagerSystem.getIdleVillagers(0);
            if (idle.length > 0 && idle[0].visual) {
                const v = idle[0].visual;
                this.scene.cameras.main.centerOn(v.x, v.y);
            }
            this.scene.game.events.emit(EVENTS.NOTIFICATION, {
                message: `${idle.length} idle villager${idle.length !== 1 ? 's' : ''}`,
                type: idle.length > 0 ? 'info' : 'warning',
            });
        });

        // B — Toggle build menu
        kb.on('keydown-B', () => {
            window.dispatchEvent(new CustomEvent('toggle-build-menu'));
        });

        // Delete — Demolish selected building
        kb.on('keydown-DELETE', () => {
            if (this.selectedBuilding) {
                this.scene.game.events.emit(EVENTS.DEMOLISH_SELECTED);
            }
        });

        // Q — Activate ability for selected units
        kb.on('keydown-Q', () => {
            for (const unitObj of this.selectedUnits) {
                const unit = unitObj as GameUnit;
                if (unit.unitType && UNIT_ABILITIES[unit.unitType as UnitType]) {
                    this.scene.unitSystem.activateAbility(unit);
                }
            }
        });

        // Listen for ability activation from UI button and release the global listener with the scene.
        const removeAbilityListener = addAbilityWindowListener(window, ((e: CustomEvent) => {
            const unitType = e.detail as UnitType;
            for (const unitObj of this.selectedUnits) {
                const unit = unitObj as GameUnit;
                if (unit.unitType === unitType) {
                    this.scene.unitSystem.activateAbility(unit);
                }
            }
        }) as EventListener);
        this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, removeAbilityListener);
    }

    public update(delta: number) {
        this.handleCameraMovement(delta);
    }

    private handleZoom(deltaY: number) {
        const newZoom = Phaser.Math.Clamp(this.scene.cameras.main.zoom - deltaY * 0.001, 0.5, 2);
        this.scene.cameras.main.setZoom(newZoom);
    }

    private handleCameraMovement(delta: number) {
        const speed = 1.0 * delta / this.scene.cameras.main.zoom;
        if (this.scene.cursors.left.isDown || this.scene.wasd.A.isDown) this.scene.cameras.main.scrollX -= speed;
        if (this.scene.cursors.right.isDown || this.scene.wasd.D.isDown) this.scene.cameras.main.scrollX += speed;
        if (this.scene.cursors.up.isDown || this.scene.wasd.W.isDown) this.scene.cameras.main.scrollY -= speed;
        if (this.scene.cursors.down.isDown || this.scene.wasd.S.isDown) this.scene.cameras.main.scrollY += speed;
    }

    private handlePointerDown(pointer: Phaser.Input.Pointer) {
        // Minimap click-to-move: consume clicks on the minimap
        if (this.scene.minimapSystem?.isPointerOnMinimap(pointer)) return;

        if (pointer.rightButtonDown()) {
            if (this.scene.buildingManager.isDemolishMode) {
                this.scene.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
                return;
            }
            if (this.scene.buildingManager.previewBuildingType) {
                this.scene.buildingManager.cancelBuildMode();
                return;
            }

            if (this.selectedUnits.length > 0) {
                this.isRightDragging = true;
                this.rightDragPoints = [];
                const cart = toCartesian(pointer.worldX, pointer.worldY);
                this.rightDragPoints.push(new Phaser.Math.Vector2(cart.x, cart.y));
            } else {
                this.handleRightClick(pointer);
            }
            return;
        }

        if (this.scene.buildingManager.isDemolishMode) {
            this.scene.buildingManager.handleDemolishClick(pointer);
            return;
        }

        if (this.scene.buildingManager.previewBuildingType) {
            this.scene.buildingManager.tryBuild(pointer.worldX, pointer.worldY);
        } else {
            // DOUBLE CLICK DETECTION
            const now = this.scene.time.now;
            const dist = this.lastClickPos.distance(new Phaser.Math.Vector2(pointer.x, pointer.y));

            if (now - this.lastClickTime < 300 && dist < 10) {
                this.handleDoubleClick(pointer);
                this.isDragging = false;
                return;
            }

            this.lastClickTime = now;
            this.lastClickPos.set(pointer.x, pointer.y);

            this.isDragging = true;
            this.dragStart.set(pointer.worldX, pointer.worldY);
        }
    }

    private handleDoubleClick(pointer: Phaser.Input.Pointer) {
        const targets = this.scene.input.hitTestPointer(pointer);
        const unitVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('unit'));

        if (unitVisual) {
            const unit = unitVisual.getData('unit');
            const type = (unit as any).unitType; // eslint-disable-line @typescript-eslint/no-explicit-any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((unit as any).getData('owner') === 0 && this.isSelectable(type)) { // Fix: Owner 0 is Player
                this.selectAllOfType(type);
                return;
            }
        }
    }

    private selectAllOfType(type: UnitType) {
        this.clearSelection();
        this.deselectBuilding();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.scene.units.getChildren().forEach((u: any) => { // Fix: Cast to Unit type
            if (u.getData('owner') === 0 && u.unitType === type) { // Fix: Owner 0 is Player
                u.setSelected(true);
                this.selectedUnits.push(u);
            }
        });
        this.emitSelectionChanged();
    }

    private filterSelectionByType(type: UnitType) {
        const toKeep: Phaser.GameObjects.GameObject[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.selectedUnits.forEach((u: any) => { // Fix: Cast to Unit type
            if (u.unitType === type) {
                toKeep.push(u);
            } else {
                u.setSelected(false);
            }
        });

        this.selectedUnits = toKeep;
        this.emitSelectionChanged();
    }

    private handlePointerMove(pointer: Phaser.Input.Pointer) {
        if (this.scene.buildingManager.isDemolishMode) {
            this.scene.buildingManager.handleDemolishHover(pointer);
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
        } else if (this.isRightDragging) {
            const cart = toCartesian(pointer.worldX, pointer.worldY);
            const lastPoint = this.rightDragPoints[this.rightDragPoints.length - 1];
            const dist = Phaser.Math.Distance.Between(lastPoint.x, lastPoint.y, cart.x, cart.y);

            if (dist > 10) { // Add point if far enough from last
                this.rightDragPoints.push(new Phaser.Math.Vector2(cart.x, cart.y));
                this.drawRightDragPath();
            }
        }

        if (this.scene.buildingManager.previewBuildingType) {
            this.scene.buildingManager.updatePreview(pointer.worldX, pointer.worldY);
        }
    }

    private drawRightDragPath() {
        this.rightDragGraphics.clear();
        if (this.rightDragPoints.length < 2) return;

        this.rightDragGraphics.lineStyle(3, 0x00ff00, 0.8);
        this.rightDragGraphics.beginPath();
        const startIso = toIso(this.rightDragPoints[0].x, this.rightDragPoints[0].y);
        this.rightDragGraphics.moveTo(startIso.x, startIso.y);

        for (let i = 1; i < this.rightDragPoints.length; i++) {
            const iso = toIso(this.rightDragPoints[i].x, this.rightDragPoints[i].y);
            this.rightDragGraphics.lineTo(iso.x, iso.y);
        }
        this.rightDragGraphics.strokePath();
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
        } else if (this.isRightDragging) {
            this.isRightDragging = false;
            this.rightDragGraphics.clear();

            if (this.rightDragPoints.length > 1) {
                // If we dragged, it's a path command
                this.scene.unitSystem.commandFollowPath(this.selectedUnits, this.rightDragPoints, pointer.event.shiftKey);
            } else {
                // If it was just a click (or very small drag), treat as normal move
                this.handleRightClick(pointer);
            }
            this.rightDragPoints = [];
        }
    }

    private handleRightClick(pointer: Phaser.Input.Pointer) {
        if (this.selectedUnits.length === 0) {
            // Check if a Barracks is selected and no units are selected
            if (this.selectedBuilding && this.selectedBuilding.getData('def').type === BuildingType.BARRACKS) {
                const cart = toCartesian(pointer.worldX, pointer.worldY);
                (this.selectedBuilding as any).setWaypoint(cart.x, cart.y); // eslint-disable-line @typescript-eslint/no-explicit-any
            }
            return;
        }

        const targets = this.scene.input.hitTestPointer(pointer);

        // Animals remain an explicit attack target regardless of any overlapping unit/building visuals.
        const animalVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('type') === 'animal');
        if (animalVisual) {
            this.scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
            this.scene.unitSystem.commandAttack(this.selectedUnits, animalVisual);
            return;
        }

        // A friendly unit can visually overlap an enemy in a crowded fight. Resolve any enemy
        // under the pointer before considering friendly entities, otherwise right-click becomes a move.
        const enemyUnitVisual = targets.find((obj: Phaser.GameObjects.GameObject) => {
            const unit = obj.getData && obj.getData('unit');
            return Boolean(unit && unit.getData('owner') !== 0);
        });
        const enemyBuildingVisual = targets.find((obj: Phaser.GameObjects.GameObject) => {
            const building = obj.getData && obj.getData('building');
            return Boolean(building && building.getData('owner') !== 0);
        });
        const enemyEntity = enemyUnitVisual?.getData('unit') ?? enemyBuildingVisual?.getData('building');

        if (enemyEntity) {
            this.scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
            this.scene.unitSystem.commandAttack(this.selectedUnits, enemyEntity);
            return;
        }

        // Friendly Castle garrison: right-click with units on own Castle.
        const friendlyBuildingVisual = targets.find((obj: Phaser.GameObjects.GameObject) => {
            const building = obj.getData && obj.getData('building');
            return Boolean(building && building.getData('owner') === 0);
        });
        if (friendlyBuildingVisual) {
            const building = friendlyBuildingVisual.getData('building');
            const def = (building as any).getData('def'); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (def && def.type === BuildingType.CASTLE) {
                this.garrisonUnits(building);
                return;
            }
        }

        // Standard Move
        const cart = toCartesian(pointer.worldX, pointer.worldY);
        this.scene.proceduralSound.playCommandAck(pointer.worldX, pointer.worldY);
        this.scene.unitSystem.commandMove(this.selectedUnits, new Phaser.Math.Vector2(cart.x, cart.y), pointer.event.shiftKey);
    }

    private garrisonUnits(castle: Phaser.GameObjects.GameObject) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const garrison: Record<string, number> = (castle as any).getData('garrison') || {};

        for (const unit of this.selectedUnits) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitType = (unit as any).unitType as string;
            garrison[unitType] = (garrison[unitType] || 0) + 1;

            // Clean up squad visuals if any
            this.scene.squadSystem.destroySquad(unit);
            // Destroy visual
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const visual = (unit as any).visual;
            if (visual) visual.destroy();
            // Remove from units group (triggers spatial hash removal)
            this.scene.units.remove(unit, true);
            this.scene.population--;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (castle as any).setData('garrison', garrison);
        this.selectedUnits = [];
        this.emitSelectionChanged();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.scene.feedbackSystem?.showFloatingText((castle as any).x, (castle as any).y - 40, 'Units garrisoned', '#ffd700');
    }

    private handleSingleSelection(pointer: Phaser.Input.Pointer) {
        const targets = this.scene.input.hitTestPointer(pointer);
        const unitVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('unit'));
        const buildingVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('building'));

        this.clearSelection();

        if (unitVisual || !buildingVisual) {
            this.deselectBuilding();
        }

        if (unitVisual) {
            const unit = unitVisual.getData('unit');
            const type = (unit as any).unitType; // eslint-disable-line @typescript-eslint/no-explicit-any
            // Only select Player units
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (unit && (unit as any).getData('owner') === 0 && this.isSelectable(type)) { // Fix: Owner 0 is Player
                unit.setSelected(true);
                this.selectedUnits.push(unit);
                this.scene.proceduralSound.playUIClick();
            }
        } else if (buildingVisual) {
            const b = buildingVisual.getData('building');
            this.selectedUnits.forEach((u) => {
                if ((u as any).setSelected) (u as any).setSelected(false); // eslint-disable-line @typescript-eslint/no-explicit-any
            });
            this.selectedBuilding = b;
            if ((b as any).setSelected) (b as any).setSelected(true); // eslint-disable-line @typescript-eslint/no-explicit-any
            const visual = (b as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
            const ring = visual.getData('ring');
            if (ring) ring.visible = true;

            const def = b.getData('def'); // Fix: Type should be BuildingDef if available, or a more generic type
            this.scene.game.events.emit(EVENTS.BUILDING_SELECTED, def.type);
        }

        this.emitSelectionChanged();
    }

    private selectUnitsInIsoRect(rect: Phaser.Geom.Rectangle) {
        this.clearSelection();
        this.deselectBuilding();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.scene.units.getChildren().forEach((u: any) => { // Fix: Cast to Unit type
            // Only select Player units in combat roles
            if (u.getData('owner') !== 0) return; // Fix: Owner 0 is Player
            if (!this.isSelectable(u.unitType)) return;

            const visual = u.visual;
            if (visual) {
                const inside = rect.contains(visual.x, visual.y);
                if (inside) {
                    u.setSelected(true);
                    this.selectedUnits.push(u);
                }
            }
        });
        this.emitSelectionChanged();
    }
    private isSelectable(type: UnitType) {
        const combatTypes = [UnitType.PIKESMAN, UnitType.ARCHER, UnitType.CAVALRY, UnitType.LEGION, UnitType.SLINGER, UnitType.AXEMAN, UnitType.HOPLITE, UnitType.CHARIOT, UnitType.VILLAGER];
        return combatTypes.includes(type);
    }

    public clearSelection() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.selectedUnits.forEach((u: any) => u.setSelected(false)); // Fix: Cast to Unit type
        this.selectedUnits = [];
        this.emitSelectionChanged();
    }

    public emitSelectionChanged() {
        // Aggregate Counts
        const counts: Record<string, number> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.selectedUnits.forEach((u: any) => { // Fix: Cast to Unit type
            const type = u.unitType;
            counts[type] = (counts[type] || 0) + 1;
        });

        this.scene.game.events.emit(EVENTS.SELECTION_CHANGED, {
            count: this.selectedUnits.length,
            counts: counts
        });
    }

    public deselectBuilding() {
        if (this.selectedBuilding) {
            if ((this.selectedBuilding as any).setSelected) (this.selectedBuilding as any).setSelected(false); // eslint-disable-line @typescript-eslint/no-explicit-any
            const v = (this.selectedBuilding as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (v) {
                const ring = v.getData('ring');
                if (ring) ring.visible = false;
            }
            this.selectedBuilding = null;
            this.scene.game.events.emit(EVENTS.BUILDING_SELECTED, null);
        }
    }
}
