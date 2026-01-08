
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState } from '../../types';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../../constants';
import { toIso } from '../utils/iso';

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.pathGraphics = this.scene.add.graphics().setDepth(-4000);
    }

    public update(time: number, delta: number) {
        this.updateUnitLogic(delta);
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
                unit.pathCreatedAt = this.scene.time.now;
                unit.state = UnitState.IDLE; // Reset state to following path
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

    private updateUnitLogic(delta: number) {
        this.scene.units.getChildren().forEach((item: Phaser.GameObjects.GameObject) => {
            const unit = item as Phaser.GameObjects.Arc & {
                body: Phaser.Physics.Arcade.Body;
                unitType: UnitType;
                state: UnitState;
                path: Phaser.Math.Vector2[] | null;
                pathStep: number;
                pathCreatedAt?: number;
            };
            const body = unit.body;
            
            if (!body) return;

            // --- ANIMAL WANDERING AI ---
            if (unit.unitType === UnitType.ANIMAL) {
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
                    this.scene.physics.moveTo(unit, nextPoint.x, nextPoint.y, 100);
                }
            } else {
                if (body.velocity.length() > 0) {
                    body.setVelocity(0,0);
                }
            }
        });
        
        // Simple separation behavior
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

    private drawUnitPaths(time: number) {
        this.pathGraphics.clear();
        this.scene.units.getChildren().forEach((uObj: Phaser.GameObjects.GameObject) => {
            const u = uObj as Phaser.GameObjects.Arc & {
                unitType: UnitType;
                path: Phaser.Math.Vector2[] | null;
                pathCreatedAt?: number;
                pathStep: number;
            };
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
}
