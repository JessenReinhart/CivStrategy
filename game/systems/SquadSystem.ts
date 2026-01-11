import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitStats } from '../../types';
import { UNIT_STATS, FACTION_COLORS } from '../../constants';
import { toIso } from '../utils/iso';

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

        this.initializeSoldiers(unit, stats.squadSize, type);

        const commanderVisual = (unit as any).visual as Phaser.GameObjects.Container;
        if (commanderVisual) {
            commanderVisual.setVisible(false);
            commanderVisual.removeAll(true);
        }

        this.scene.add.existing(container);
    }

    private initializeSoldiers(unit: Phaser.GameObjects.GameObject, count: number, type: UnitType) {
        const stats = UNIT_STATS[type];
        const soldiers: SoldierState[] = [];
        const spacing = stats.squadSpacing || 10;
        const cols = Math.ceil(Math.sqrt(count));

        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const offsetX = (col - cols / 2) * spacing;
            const offsetY = (row - (count / cols) / 2) * spacing;

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
            let color = owner === 1 ? 0xef4444 : (stats.squadColor || FACTION_COLORS[this.scene.faction]);

            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            if (unit.isSelected) {
                gfx.lineStyle(2, 0xffffff, 0.8);
                const radius = Math.sqrt(stats.squadSize) * (stats.squadSpacing || 10) * 0.7;
                gfx.strokeEllipse(0, 0, radius * 2.5, radius * 1.5);
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

                if (unit.unitType === UnitType.LEGION || unit.unitType === UnitType.SOLDIER) {
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
    }
}