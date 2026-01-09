
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitStats } from '../../types';
import { UNIT_STATS, FACTION_COLORS } from '../../constants';
import { toIso } from '../utils/iso';

interface SoldierState {
    x: number; // World Logic X
    y: number; // World Logic Y
    z: number; // Simulated Height (Visual only)
    offset: { x: number, y: number }; // Target offset relative to squad center
}

export class SquadSystem {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public createSquad(unit: Phaser.GameObjects.GameObject, type: UnitType, owner: number) {
        const stats = UNIT_STATS[type];
        if (!stats || stats.squadSize <= 1) return; 

        const container = this.scene.add.container(0, 0);
        const gfx = this.scene.add.graphics();
        container.add(gfx);
        
        unit.setData('squadContainer', container);
        unit.setData('squadCurrentCount', stats.squadSize);
        unit.setData('squadMaxCount', stats.squadSize);
        unit.setData('formationAngle', 0); 
        
        // Initialize Soldier States
        this.initializeSoldiers(unit, stats.squadSize, type);

        // Hide commander visual
        const commanderVisual = (unit as any).visual as Phaser.GameObjects.Container;
        if (commanderVisual) {
            commanderVisual.setVisible(false);
            commanderVisual.setAlpha(0.01); 
        }

        this.scene.add.existing(container);
    }

    private initializeSoldiers(unit: Phaser.GameObjects.GameObject, count: number, type: UnitType) {
        const stats = UNIT_STATS[type];
        const soldiers: SoldierState[] = [];
        const spacing = stats.squadSpacing || 10;
        
        // Calculate grid dimensions
        const cols = Math.ceil(Math.sqrt(count));
        
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            // Add slight randomness to formation for organic look
            const jitterX = (Math.random() - 0.5) * (spacing * 0.4);
            const jitterY = (Math.random() - 0.5) * (spacing * 0.4);

            const offsetX = (col - cols/2) * spacing + jitterX;
            const offsetY = (row - (count/cols)/2) * spacing + jitterY;

            soldiers.push({
                x: (unit as any).x + offsetX,
                y: (unit as any).y + offsetY,
                z: 0,
                offset: { x: offsetX, y: offsetY }
            });
        }
        unit.setData('soldierStates', soldiers);
    }

    public update(dt: number) {
        const units = this.scene.units.getChildren();
        
        units.forEach((uObj: Phaser.GameObjects.GameObject) => {
            const unit = uObj as any;
            const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
            if (!container) return;

            const body = unit.body as Phaser.Physics.Arcade.Body;
            const stats = UNIT_STATS[unit.unitType as UnitType];
            
            // 1. Update Formation Rotation
            let angle = unit.getData('formationAngle');
            const speed = body.velocity.length();
            const isMoving = speed > 10;

            if (isMoving) {
                const targetAngle = body.velocity.angle();
                // Smooth rotation
                angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.05); // Slower turn for weight
                unit.setData('formationAngle', angle);
            }

            // 2. Sync Container to Commander (Center Point)
            const commanderIso = toIso(unit.x, unit.y);
            container.setPosition(commanderIso.x, commanderIso.y);
            container.setDepth(commanderIso.y);

            // 3. Update Soldier Count (Healing/Damage)
            const hp = unit.getData('hp');
            const maxHp = unit.getData('maxHp');
            const targetCount = Math.ceil((hp / maxHp) * stats.squadSize);
            const soldiers = unit.getData('soldierStates') as SoldierState[];
            
            if (soldiers.length !== targetCount) {
                // Adjust array size
                if (soldiers.length > targetCount) {
                    soldiers.splice(targetCount); // Kill from end
                } else {
                    // Respawn/Heal logic (add new soldiers at commander pos)
                    while(soldiers.length < targetCount) {
                        soldiers.push({
                            x: unit.x,
                            y: unit.y,
                            z: 0,
                            offset: { x: (Math.random()-0.5)*10, y: (Math.random()-0.5)*10 } 
                        });
                    }
                }
            }

            // 4. Render & Simulate Soldiers
            const gfx = container.getAt(0) as Phaser.GameObjects.Graphics;
            gfx.clear();

            const owner = unit.getData('owner');
            let color = owner === 1 ? 0xef4444 : (stats.squadColor || FACTION_COLORS[this.scene.faction]);
            if (unit.unitType === UnitType.LEGION && owner === 0) color = 0x1e3a8a;

            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Selection Highlight
            if (unit.isSelected) {
                gfx.lineStyle(1, 0xffffff, 0.5);
                // Draw approximate circle around squad
                const radius = Math.sqrt(stats.squadSize) * (stats.squadSpacing || 10) * 0.7;
                gfx.strokeEllipse(0, 0, radius * 2.5, radius * 1.5); // Iso projection ring
            }

            // Draw shadow for whole squad (optimization)
            // gfx.fillStyle(0x000000, 0.2);
            // gfx.fillEllipse(0, 0, 40, 20); // Generic shadow

            soldiers.forEach((soldier, index) => {
                // A. Calculate Target Position (World Space)
                // Offset rotated by formation angle
                const dx = soldier.offset.x * cos - soldier.offset.y * sin;
                const dy = soldier.offset.x * sin + soldier.offset.y * cos;
                
                const targetX = unit.x + dx;
                const targetY = unit.y + dy;

                // B. Lerp Position (Fluid movement)
                // Use a slightly different speed for each soldier to break uniformity
                const lerpSpeed = isMoving ? 0.05 + ((index % 3) * 0.01) : 0.1;
                soldier.x = Phaser.Math.Linear(soldier.x, targetX, lerpSpeed);
                soldier.y = Phaser.Math.Linear(soldier.y, targetY, lerpSpeed);

                // C. Walking Bob (Visual Z)
                if (isMoving) {
                    // Wave based on time + index offset to desync
                    soldier.z = Math.abs(Math.sin((this.scene.time.now / 150) + index)) * 3;
                } else {
                    soldier.z = Phaser.Math.Linear(soldier.z, 0, 0.1);
                }

                // D. Convert to Relative Isometric for Drawing
                // soldier.x/y are Logic Coordinates.
                // container is at toIso(unit.x, unit.y).
                const isoSoldier = toIso(soldier.x, soldier.y);
                
                // Relative draw position
                const drawX = isoSoldier.x - commanderIso.x;
                const drawY = isoSoldier.y - commanderIso.y - soldier.z;

                // E. Draw
                if (unit.unitType === UnitType.LEGION || unit.unitType === UnitType.SOLDIER) {
                    // Body
                    gfx.fillStyle(color, 1);
                    // Simple Box/Dot
                    gfx.fillRect(drawX - 2, drawY - 4, 4, 6);
                    // Head
                    gfx.fillStyle(0xffffff, 0.8);
                    gfx.fillRect(drawX - 1, drawY - 6, 2, 2);
                } else if (unit.unitType === UnitType.CAVALRY) {
                    gfx.fillStyle(color, 1);
                    // Horse Body
                    gfx.fillEllipse(drawX, drawY, 14, 8);
                    // Rider
                    gfx.fillStyle(0xffffff, 1);
                    gfx.fillCircle(drawX, drawY - 5, 2.5);
                }
                
                // Shadow
                gfx.fillStyle(0x000000, 0.3);
                gfx.fillEllipse(drawX, drawY + soldier.z, 6, 3);
            });
        });
    }

    public destroySquad(unit: Phaser.GameObjects.GameObject) {
        const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
        if (container) {
            container.destroy();
        }
    }
}
