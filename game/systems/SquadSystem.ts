import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, FormationType, UnitState } from '../../types';
import { UNIT_STATS } from '../../constants';
import { toIso } from '../utils/iso';
import { FormationSystem } from './FormationSystem';

interface SoldierState {
    x: number;
    y: number;
    z: number;
    offset: { x: number, y: number };
}

export class SquadSystem {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public createSquad(unit: Phaser.GameObjects.GameObject, type: UnitType, _owner: number) {
        const stats = UNIT_STATS[type];
        if (!stats || stats.squadSize <= 1) return;

        const container = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(container);
        if (this.scene.worldLayer) this.scene.worldLayer.add(container); // Add to layer
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(container);
        const gfx = this.scene.add.graphics();
        container.add(gfx);

        // Indicator now handled mainly in update() via uiGroup separation
        unit.setData('squadContainer', container);
        unit.setData('squadCurrentCount', stats.squadSize);
        unit.setData('squadMaxCount', stats.squadSize);
        unit.setData('formationAngle', 0);

        this.initializeSoldiers(unit, stats.squadSize, type);

        const commanderVisual = (unit as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (commanderVisual) {
            // commanderVisual.setVisible(false);
            // commanderVisual.removeAll(true);
        }

        if (!this.scene.worldLayer) this.scene.add.existing(container);
    }

    private initializeSoldiers(unit: Phaser.GameObjects.GameObject, count: number, _type: UnitType) {
        // const stats = UNIT_STATS[type];
        const soldiers: SoldierState[] = [];
        const u = unit as Phaser.GameObjects.Container; // Assuming unit has x/y

        for (let i = 0; i < count; i++) {
            soldiers.push({
                x: u.x, // Start at center
                y: u.y,
                z: 0,
                offset: { x: 0, y: 0 } // Will be set by applyFormation
            });
        }
        unit.setData('soldierStates', soldiers);

        // Apply default BOX formation initially
        this.applyFormation(unit, FormationType.BOX);
    }

    public update(_dt: number) {
        const units = this.scene.units.getChildren();

        units.forEach((uObj: Phaser.GameObjects.GameObject) => {
            const unit = uObj as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
            if (!container) return;

            // Optimization: Skip processing if the squad container is culled
            if (!container.visible) return;

            const body = unit.body as Phaser.Physics.Arcade.Body;
            const stats = UNIT_STATS[unit.unitType as UnitType];

            let angle = unit.getData('formationAngle');
            const speed = body.velocity.length();
            const isMoving = speed > 10;

            if (isMoving) {
                const targetAngle = body.velocity.angle();
                angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.1);
                unit.setData('formationAngle', angle);
            } else if ((unit.state === UnitState.ATTACKING || unit.state === UnitState.CHASING) && unit.target) {
                // Face target when attacking/chasing
                const targetAngle = Phaser.Math.Angle.Between(unit.x, unit.y, unit.target.x, unit.target.y);
                angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.1);
                unit.setData('formationAngle', angle);
            }

            const commanderIso = toIso(unit.x, unit.y);
            container.setPosition(commanderIso.x, commanderIso.y);
            container.setDepth(commanderIso.y);

            const hp = unit.getData('hp');
            const maxHp = unit.getData('maxHp');
            const targetCount = Math.ceil((hp / maxHp) * stats.squadSize);
            const soldiers = unit.getData('soldierStates') as SoldierState[];

            if (soldiers.length !== targetCount) {
                if (soldiers.length > targetCount) {
                    soldiers.splice(targetCount);
                } else {
                    while (soldiers.length < targetCount) {
                        soldiers.push({
                            x: unit.x,
                            y: unit.y,
                            z: 0,
                            offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 }
                        });
                    }
                }
            }

            const gfx = container.getAt(0) as Phaser.GameObjects.Graphics;
            gfx.clear();

            const owner = unit.getData('owner');
            const color = this.scene.getFactionColor(owner);

            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            if (unit.isSelected) {
                gfx.lineStyle(2, 0xffffff, 0.8);
                const radius = Math.sqrt(stats.squadSize) * (stats.squadSpacing || 10) * 0.7;
                gfx.strokeEllipse(0, 0, radius * 2.5, radius * 1.5);
            }

            // Unit Indicator Icon (Global Toggle)
            // Unit Indicator Icon (Global Toggle)
            // Unit Indicator Icon (Global Toggle)
            if (this.scene.showUnitIndicators && owner === 0) {
                const indicatorY = -60; // Position above the squad
                const circleRadius = 22;

                // Draw to Graphics (which IS in worldLayer) - wait, if we want icon SHARP, we must move it out too?
                // The user said "UNIT ICONS are affected". This likely means the circle+symbol drawn on graphics.
                // If so, we need to move THAT drawing to a separate container in UI group too.

                // Let's create a dedicated UI container for the indicator if it doesn't exist.
                let uiIndicator = unit.getData('uiIndicatorContainer') as Phaser.GameObjects.Container;
                if (!uiIndicator) {
                    uiIndicator = this.scene.add.container(0, 0);
                    this.scene.uiGroup.add(uiIndicator); // Add to UI Group (Sharp)
                    unit.setData('uiIndicatorContainer', uiIndicator);

                    // Create Graphics for the icon background/symbol
                    const iconGfx = this.scene.add.graphics();
                    uiIndicator.add(iconGfx);

                    // Create Text Label
                    const label = this.scene.add.text(0, 32, '', {
                        fontFamily: 'Arial',
                        fontSize: '10px',
                        color: '#ffffff',
                        stroke: '#000000',
                        strokeThickness: 2,
                        backgroundColor: '#000000bb',
                        padding: { x: 4, y: 2 }
                    }).setOrigin(0.5);
                    uiIndicator.add(label);
                }

                uiIndicator.setVisible(true);

                // Sync Position (Convert World Iso -> Screen XY relative to UI Camera?)
                // UI Camera and Main Camera share scroll/zoom? 
                // MainScene.update: this.uiCamera.scrollX = this.cameras.main.scrollX;
                // So we can just position at World Coordinates if UI Camera tracks World.
                // MainScene.ts: "this.cameras.main.ignore(this.uiGroup);" 
                // So UI elements are NOT drawn by Main Cam (with PostFX).
                // They ARE drawn by UI Cam (No PostFX).

                const indicatorIso = toIso(unit.x, unit.y);
                uiIndicator.setPosition(indicatorIso.x, indicatorIso.y - 60);
                // No depth needed for UI usually, or simple sorting

                const iconGfx = uiIndicator.getAt(0) as Phaser.GameObjects.Graphics;
                iconGfx.clear();

                // Background circle with border
                iconGfx.fillStyle(0x1a1a2e, 0.95);
                iconGfx.fillCircle(0, 0, circleRadius);
                iconGfx.lineStyle(2, 0xffffff, 0.9);
                iconGfx.strokeCircle(0, 0, circleRadius);

                // Draw unit icon silhouette inside
                iconGfx.fillStyle(0xffffff, 0.9);
                const drawY = 0; // Relative to container
                if (unit.unitType === UnitType.PIKESMAN || unit.unitType === UnitType.LEGION) {
                    iconGfx.fillRect(-3, drawY - 8, 6, 12);
                    iconGfx.fillCircle(0, drawY - 12, 4);
                    iconGfx.fillRect(5, drawY - 14, 2, 18);
                    iconGfx.fillStyle(0x888888, 0.9);
                    iconGfx.fillTriangle(6, drawY - 14, 4, drawY - 10, 8, drawY - 10);
                } else if (unit.unitType === UnitType.CAVALRY) {
                    iconGfx.fillEllipse(0, drawY + 2, 16, 8);
                    iconGfx.fillCircle(-6, drawY - 2, 3);
                    iconGfx.fillRect(-2, drawY - 8, 4, 6);
                    iconGfx.fillCircle(0, drawY - 12, 3);
                } else if (unit.unitType === UnitType.ARCHER) {
                    iconGfx.lineStyle(2, 0xffffff, 1);
                    iconGfx.beginPath();
                    iconGfx.arc(0, drawY, 8, Phaser.Math.DegToRad(-45), Phaser.Math.DegToRad(45), false);
                    iconGfx.strokePath();
                    iconGfx.lineStyle(1, 0xffffff, 1);
                    iconGfx.beginPath();
                    iconGfx.moveTo(-8, drawY);
                    iconGfx.lineTo(8, drawY);
                    iconGfx.strokePath();
                }

                // Unit type name
                const unitName = unit.unitType === UnitType.LEGION ? 'LEGION' :
                    unit.unitType === UnitType.PIKESMAN ? 'PIKESMAN' :
                        unit.unitType === UnitType.ARCHER ? 'ARCHERS' :
                            unit.unitType === UnitType.CAVALRY ? 'CAVALRY' : 'UNIT';

                const label = uiIndicator.getAt(1) as Phaser.GameObjects.Text;
                label.setText(unitName);

            } else {
                // Hide indicator
                const uiIndicator = unit.getData('uiIndicatorContainer') as Phaser.GameObjects.Container;
                if (uiIndicator) {
                    uiIndicator.setVisible(false);
                }
            }

            soldiers.forEach((soldier, index) => {
                const dx = soldier.offset.x * cos - soldier.offset.y * sin;
                const dy = soldier.offset.x * sin + soldier.offset.y * cos;
                const targetX = unit.x + dx;
                const targetY = unit.y + dy;

                const lerpSpeed = isMoving ? 0.15 : 0.1;
                soldier.x = Phaser.Math.Linear(soldier.x, targetX, lerpSpeed);
                soldier.y = Phaser.Math.Linear(soldier.y, targetY, lerpSpeed);

                if (isMoving) {
                    soldier.z = Math.abs(Math.sin((this.scene.time.now / 150) + index)) * 3;
                } else {
                    soldier.z = Phaser.Math.Linear(soldier.z, 0, 0.2);
                }

                const isoSoldier = toIso(soldier.x, soldier.y);
                const drawX = isoSoldier.x - commanderIso.x;
                const drawY = isoSoldier.y - commanderIso.y - soldier.z;

                if (unit.unitType === UnitType.LEGION || unit.unitType === UnitType.PIKESMAN || unit.unitType === UnitType.ARCHER) {
                    // Draw Pike for Pikesman
                    if (unit.unitType === UnitType.PIKESMAN) {
                        // Length of the pike
                        const pikeLen = 14;
                        // Calculate pike tip position based on unit facing angle
                        // We use 'angle' which is the squad's facing direction
                        // Draw it originating from center/side of body

                        const pikeStartX = drawX + Math.cos(angle + Math.PI / 4) * 2;
                        const pikeStartY = drawY - 2 + Math.sin(angle + Math.PI / 4) * 2;

                        const pikeTipX = pikeStartX + Math.cos(angle) * pikeLen;
                        const pikeTipY = pikeStartY + Math.sin(angle) * pikeLen;

                        gfx.lineStyle(1, 0x8D6E63, 1); // Wood color shaft
                        gfx.beginPath();
                        gfx.moveTo(pikeStartX, pikeStartY);
                        gfx.lineTo(pikeTipX, pikeTipY);
                        gfx.strokePath();

                        // Silver tip (Pointy Triangle)
                        gfx.fillStyle(0xC0C0C0, 1);

                        // Calculate triangle vertices
                        const tipLen = 3;
                        const tipWidth = 2;

                        // P1: Tip
                        const p1x = pikeTipX;
                        const p1y = pikeTipY;

                        // Base center is back along the shaft
                        const bx = pikeTipX - Math.cos(angle) * tipLen;
                        const by = pikeTipY - Math.sin(angle) * tipLen;

                        // Perpendicular vector for width
                        const px = Math.cos(angle + Math.PI / 2) * (tipWidth / 2);
                        const py = Math.sin(angle + Math.PI / 2) * (tipWidth / 2);

                        // P2 & P3: Base corners
                        const p2x = bx + px;
                        const p2y = by + py;
                        const p3x = bx - px;
                        const p3y = by - py;

                        gfx.fillTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
                    }

                    gfx.fillStyle(0x000000, 0.3);
                    gfx.fillEllipse(drawX, drawY + soldier.z, 6, 3);
                    gfx.fillStyle(color, 1);
                    gfx.fillRect(drawX - 2, drawY - 4, 4, 6);
                    gfx.fillStyle(0xffffff, 0.8);
                    gfx.fillRect(drawX - 1, drawY - 6, 2, 2);
                } else if (unit.unitType === UnitType.CAVALRY) {
                    gfx.fillStyle(0x000000, 0.3);
                    gfx.fillEllipse(drawX, drawY + soldier.z, 10, 5);
                    gfx.fillStyle(color, 1);
                    gfx.fillEllipse(drawX, drawY, 14, 8);
                    gfx.fillStyle(0xffffff, 1);
                    gfx.fillCircle(drawX, drawY - 5, 2.5);
                }
            });
        });
    }

    public destroySquad(unit: Phaser.GameObjects.GameObject) {
        const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
        if (container) {
            container.destroy();
        }
        const uiIndicator = unit.getData('uiIndicatorContainer') as Phaser.GameObjects.Container;
        if (uiIndicator) {
            uiIndicator.destroy();
        }
    }

    public applyFormation(unit: Phaser.GameObjects.GameObject, formationType: FormationType) {
        const soldiers = unit.getData('soldierStates') as SoldierState[];
        if (!soldiers || soldiers.length === 0) return;

        const count = soldiers.length;
        // Keep existing spacing or default to 10
        const stats = UNIT_STATS[unit.getData('unitType') as UnitType];
        const spacing = stats.squadSpacing || 10;

        // Get new offsets
        const offsets = FormationSystem.getFormationOffsets(formationType, count, spacing);

        // Update soldier targets
        // We update the 'offset' property of each soldierState
        // The update loop in SquadSystem will handle the lerping to the new positions
        for (let i = 0; i < count; i++) {
            if (i < offsets.length) {
                soldiers[i].offset = { x: offsets[i].x, y: offsets[i].y };
            }
        }
    }
}