
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, UnitStats } from '../../types';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, UNIT_SPEED, UNIT_STATS } from '../../constants';
import { toIso } from '../utils/iso';

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.pathGraphics = this.scene.add.graphics().setDepth(-4000);
    }

    public update(time: number, delta: number) {
        this.updateUnitLogic(time, delta);
        this.drawUnitPaths(time);
    }

    public commandMove(units: Phaser.GameObjects.GameObject[], target: Phaser.Math.Vector2) {
        const spacing = 15;
        const formationCols = Math.ceil(Math.sqrt(units.length));

        units.forEach((unitObj, index) => {
            const unit = unitObj as any;
            const col = index % formationCols;
            const row = Math.floor(index / formationCols);
            const offsetX = (col - formationCols/2) * spacing;
            const offsetY = (row - Math.ceil(units.length/formationCols)/2) * spacing;
            const unitTarget = new Phaser.Math.Vector2(target.x + offsetX, target.y + offsetY);
            
            const path = this.scene.pathfinder.findPath(new Phaser.Math.Vector2(unit.x, unit.y), unitTarget);
            if (path) {
                unit.path = path;
                unit.pathStep = 0;
                unit.pathCreatedAt = this.scene.gameTime;
                unit.state = UnitState.IDLE; 
                unit.target = null; // Clear combat target
                unit.body.reset(unit.x, unit.y);
            }
        });

        // Visual feedback
        const iso = toIso(target.x, target.y);
        const circle = this.scene.add.circle(iso.x, iso.y, 5, 0xffffff);
        circle.setScale(1, 0.5);
        circle.setDepth(iso.y); 
        this.scene.tweens.add({
            targets: circle,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 500,
            onComplete: () => circle.destroy()
        });
    }

    public commandAttack(units: Phaser.GameObjects.GameObject[], target: Phaser.GameObjects.GameObject) {
        units.forEach((unitObj) => {
            const unit = unitObj as any;
            // Only combat units attack
            if (unit.unitType === UnitType.SOLDIER || unit.unitType === UnitType.CAVALRY) {
                unit.target = target;
                unit.state = UnitState.CHASING;
                unit.path = null; // Clear old move path
                unit.body.reset(unit.x, unit.y);
            }
        });

        // Visual Feedback (Red Flash on target)
        if ((target as any).visual) {
            this.scene.tweens.add({
                targets: (target as any).visual,
                alpha: 0.5,
                yoyo: true,
                duration: 100,
                repeat: 2
            });
        }
    }

    private updateUnitLogic(time: number, delta: number) {
        this.scene.units.getChildren().forEach((item: Phaser.GameObjects.GameObject) => {
            const unit = item as any;
            const body = unit.body as Phaser.Physics.Arcade.Body;
            
            if (!body) return;

            // Combat State Logic
            if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
                this.handleCombatState(unit, time);
            }
            // --- ANIMAL WANDERING AI ---
            else if (unit.unitType === UnitType.ANIMAL) {
                 if (body.velocity.length() > 0) {
                     const dest = unit.getData('wanderDest') as Phaser.Math.Vector2;
                     if (dest && Phaser.Math.Distance.Between(unit.x, unit.y, dest.x, dest.y) < 5) {
                         body.setVelocity(0, 0);
                         unit.state = UnitState.IDLE;
                     }
                 } else if (Math.random() < 0.005) { 
                     const wanderRadius = 100;
                     const angle = Math.random() * Math.PI * 2;
                     const dist = Math.random() * wanderRadius;
                     const tx = Phaser.Math.Clamp(unit.x + Math.cos(angle) * dist, 50, MAP_WIDTH - 50);
                     const ty = Phaser.Math.Clamp(unit.y + Math.sin(angle) * dist, 50, MAP_HEIGHT - 50);
                     
                     unit.setData('wanderDest', new Phaser.Math.Vector2(tx, ty));
                     this.scene.physics.moveTo(unit, tx, ty, 20);
                     unit.state = UnitState.WANDERING;
                 }
            }
            // --- PATH FOLLOWING ---
            else if (unit.path && unit.path.length > 0) {
                if (unit.pathStep >= unit.path.length) {
                    body.setVelocity(0, 0);
                    unit.path = null;
                    if (unit.unitType === UnitType.VILLAGER) {
                        if (unit.state === UnitState.MOVING_TO_WORK) unit.state = UnitState.WORKING;
                        else if (unit.state === UnitState.MOVING_TO_RALLY) unit.state = UnitState.IDLE;
                    }
                    return;
                }
                const nextPoint = unit.path[unit.pathStep];
                const dist = Phaser.Math.Distance.Between(unit.x, unit.y, nextPoint.x, nextPoint.y);
                const speed = UNIT_SPEED[unit.unitType as UnitType] || 100;

                if (dist < 4) {
                    unit.pathStep++;
                } else {
                    this.scene.physics.moveTo(unit, nextPoint.x, nextPoint.y, speed);
                }
            } else {
                if (body.velocity.length() > 0) body.setVelocity(0,0);
            }
        });
        
        // Separation
        this.scene.physics.overlap(this.scene.units, this.scene.units, (obj1, obj2) => {
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

    private handleCombatState(unit: any, time: number) {
        const target = unit.target;
        
        // Target dead or destroyed
        if (!target || !target.scene) {
            unit.state = UnitState.IDLE;
            unit.target = null;
            unit.body.setVelocity(0, 0);
            return;
        }

        const dist = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);
        const range = unit.getData('range') || 40;
        const attackSpeed = unit.getData('attackSpeed') || 1000;
        
        // Attack Logic
        if (dist <= range) {
            unit.body.setVelocity(0, 0);
            unit.state = UnitState.ATTACKING;
            
            if (time - unit.lastAttackTime > attackSpeed) {
                unit.lastAttackTime = time;
                this.performAttack(unit, target);
            }
        } else {
            // Chase Logic
            unit.state = UnitState.CHASING;
            const speed = UNIT_SPEED[unit.unitType as UnitType] || 100;
            this.scene.physics.moveTo(unit, target.x, target.y, speed);
        }
    }

    private performAttack(unit: any, target: any) {
        const dmg = unit.getData('attack') || 10;
        
        // Lunge visual
        const visual = unit.visual;
        if (visual) {
            const angle = Phaser.Math.Angle.Between(unit.x, unit.y, target.x, target.y);
            const ox = visual.x;
            const oy = visual.y;
            const lungeX = ox + Math.cos(angle) * 10;
            const lungeY = oy + Math.sin(angle) * 5; // Iso squash
            
            this.scene.tweens.add({
                targets: visual,
                x: lungeX,
                y: lungeY,
                duration: 100,
                yoyo: true,
                onComplete: () => {
                    // Reset position exactly to avoid drift
                    const iso = toIso(unit.x, unit.y);
                    visual.setPosition(iso.x, iso.y);
                }
            });
        }

        // Apply Damage
        if (target.takeDamage) {
            target.takeDamage(dmg);
        }
    }

    private drawUnitPaths(time: number) {
        this.pathGraphics.clear();
        this.scene.units.getChildren().forEach((uObj: Phaser.GameObjects.GameObject) => {
            const u = uObj as any;
            const isSelectable = u.unitType === UnitType.SOLDIER || u.unitType === UnitType.CAVALRY;

            if (isSelectable && u.path && u.pathCreatedAt) {
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
                    }
                }
            }
        });
    }
}
