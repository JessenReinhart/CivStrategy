
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { EVENTS } from '../../constants';
import { BuildingDef, UnitType, BuildingType } from '../../types';
import { toCartesian } from '../utils/iso';

export class InputManager {
    private scene: MainScene;
    public selectedUnits: Phaser.GameObjects.GameObject[] = [];
    public selectedBuilding: Phaser.GameObjects.GameObject | null = null;
    
    private isDragging = false;
    private dragStart = new Phaser.Math.Vector2();
    private dragRect = new Phaser.Geom.Rectangle();
    private selectionGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.selectionGraphics = this.scene.add.graphics().setDepth(Number.MAX_VALUE);
        this.setupInputs();
    }

    private setupInputs() {
        this.scene.input.on('pointerdown', this.handlePointerDown, this);
        this.scene.input.on('pointermove', this.handlePointerMove, this);
        this.scene.input.on('pointerup', this.handlePointerUp, this);
        this.scene.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
            const newZoom = Phaser.Math.Clamp(this.scene.cameras.main.zoom - deltaY * 0.001, 0.5, 2);
            this.scene.cameras.main.setZoom(newZoom);
        });
    }

    public update(delta: number) {
        this.handleCameraMovement(delta);
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
                this.scene.buildingManager.enterBuildMode(null as any); 
                this.scene.buildingManager.previewBuildingType = null;
                if(this.scene.buildingManager.previewBuilding) this.scene.buildingManager.previewBuilding.destroy();
                return;
            }

            this.handleRightClick(pointer);
            return;
        }

        if (this.scene.buildingManager.isDemolishMode) {
            this.scene.buildingManager.handleDemolishClick(pointer);
            return;
        }

        if (this.scene.buildingManager.previewBuildingType) {
            this.scene.buildingManager.tryBuild(pointer.worldX, pointer.worldY);
        } else {
            this.isDragging = true;
            this.dragStart.set(pointer.worldX, pointer.worldY);
        }
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
        }

        if (this.scene.buildingManager.previewBuildingType) {
            this.scene.buildingManager.updatePreview(pointer.worldX, pointer.worldY);
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

    private handleRightClick(pointer: Phaser.Input.Pointer) {
        if (this.selectedUnits.length === 0) return;

        // Check for click on Enemy Unit/Building
        const targets = this.scene.input.hitTestPointer(pointer);
        const unitVisual = targets.find((obj: any) => obj.getData && obj.getData('unit'));
        const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building'));
        
        let targetEntity: Phaser.GameObjects.GameObject | null = null;
        let isEnemy = false;

        if (unitVisual) {
            targetEntity = unitVisual.getData('unit');
            if (targetEntity && (targetEntity as any).getData('owner') !== 0) isEnemy = true;
        } else if (buildingVisual) {
            targetEntity = buildingVisual.getData('building');
            if (targetEntity && (targetEntity as any).getData('owner') !== 0) isEnemy = true;
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
        const unitVisual = targets.find((obj: any) => obj.getData && obj.getData('unit'));
        const buildingVisual = targets.find((obj: any) => obj.getData && obj.getData('building'));
  
        this.clearSelection();
        
        if (unitVisual || !buildingVisual) {
            this.deselectBuilding();
        }
  
        if (unitVisual) {
            const unit = unitVisual.getData('unit');
            const type = (unit as any).unitType;
            // Only select Player units
            if (unit && (unit as any).getData('owner') === 0 && (type === UnitType.SOLDIER || type === UnitType.CAVALRY)) { 
                unit.setSelected(true);
                this.selectedUnits.push(unit);
            }
        } else if (buildingVisual) {
            const b = buildingVisual.getData('building');
            this.selectedBuilding = b;
            const visual = (b as any).visual;
            const ring = visual.getData('ring');
            if (ring) ring.visible = true;
            
            const def = b.getData('def') as BuildingDef;
            this.scene.game.events.emit(EVENTS.BUILDING_SELECTED, def.type);
        }
        
        this.scene.game.events.emit(EVENTS.SELECTION_CHANGED, this.selectedUnits.length);
    }

    private selectUnitsInIsoRect(rect: Phaser.Geom.Rectangle) {
        this.clearSelection();
        this.deselectBuilding();
  
        this.scene.units.getChildren().forEach((u: any) => {
            // Only select Player units in combat roles
            if (u.getData('owner') !== 0) return;
            if (u.unitType !== UnitType.SOLDIER && u.unitType !== UnitType.CAVALRY) return;
            
            const visual = u.visual;
            if (visual) {
                const inside = rect.contains(visual.x, visual.y);
                if (inside) {
                    u.setSelected(true);
                    this.selectedUnits.push(u);
                }
            }
        });
        this.scene.game.events.emit(EVENTS.SELECTION_CHANGED, this.selectedUnits.length);
    }

    public clearSelection() {
        this.selectedUnits.forEach((u: any) => u.setSelected(false));
        this.selectedUnits = [];
        this.scene.game.events.emit(EVENTS.SELECTION_CHANGED, 0);
    }

    public deselectBuilding() {
        if (this.selectedBuilding) {
            const v = (this.selectedBuilding as any).visual;
            if (v) {
                const ring = v.getData('ring');
                if (ring) ring.visible = false;
            }
            this.selectedBuilding = null;
            this.scene.game.events.emit(EVENTS.BUILDING_SELECTED, null);
        }
    }
}
