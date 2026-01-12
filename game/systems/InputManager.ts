
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { EVENTS } from '../../constants';
import { UnitType, BuildingType } from '../../types';
import { toCartesian, toIso } from '../utils/iso';

export class InputManager {
    private scene: MainScene;
    public selectedUnits: Phaser.GameObjects.GameObject[] = [];
    public selectedBuilding: Phaser.GameObjects.GameObject | null = null;

    private isDragging = false;
    private isRightDragging = false;
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
        if (pointer.rightButtonDown()) {
            if (this.scene.buildingManager.isDemolishMode) {
                this.scene.game.events.emit(EVENTS.TOGGLE_DEMOLISH, false);
                return;
            }
            if (this.scene.buildingManager.previewBuildingType) {
                this.scene.buildingManager.enterBuildMode(null as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                this.scene.buildingManager.previewBuildingType = null;
                if (this.scene.buildingManager.previewBuilding) this.scene.buildingManager.previewBuilding.destroy();
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
                this.scene.unitSystem.commandFollowPath(this.selectedUnits, this.rightDragPoints);
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

        // Check for click on Enemy Unit/Building
        const targets = this.scene.input.hitTestPointer(pointer);

        const unitVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('unit'));
        const buildingVisual = targets.find((obj: Phaser.GameObjects.GameObject) => obj.getData && obj.getData('building'));

        let targetEntity: Phaser.GameObjects.GameObject | null = null;
        let isEnemy = false;

        if (unitVisual) {
            targetEntity = unitVisual.getData('unit');
            const owner = (targetEntity as any).getData('owner'); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (targetEntity && owner !== 0) isEnemy = true;
        } else if (buildingVisual) {
            targetEntity = buildingVisual.getData('building');
            const owner = (targetEntity as any).getData('owner'); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (targetEntity && owner !== 0) isEnemy = true;
        }

        if (isEnemy && targetEntity) {
            this.scene.unitSystem.commandAttack(this.selectedUnits, targetEntity);
        } else {
            // Standard Move
            const cart = toCartesian(pointer.worldX, pointer.worldY);
            this.scene.unitSystem.commandMove(this.selectedUnits, new Phaser.Math.Vector2(cart.x, cart.y));
        }
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
        return type === UnitType.PIKESMAN || type === UnitType.CAVALRY || type === UnitType.ARCHER || type === UnitType.LEGION;
    }

    public clearSelection() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.selectedUnits.forEach((u: any) => u.setSelected(false)); // Fix: Cast to Unit type
        this.selectedUnits = [];
        this.emitSelectionChanged();
    }

    private emitSelectionChanged() {
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
