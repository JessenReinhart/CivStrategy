
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, UnitStats } from '../../types';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, UNIT_SPEED, UNIT_STATS } from '../../constants';
import { toIso } from '../utils/iso';

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;
    private debugGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.pathGraphics = this.scene.add.graphics().setDepth(-4000);
        this.debugGraphics = this.scene.add.graphics().setDepth(100000);
    }

    public update(time: number, delta: number) {
        this.updateUnitLogic(time, delta);
        this.drawUnitPaths(time);

        if (this.scene.debugMode) {
            this.drawDebugLines();
        } else {
            this.debugGraphics.clear();
        }
    }

    public commandMove(units: Phaser.GameObjects.GameObject[], target: Phaser.Math.Vector2) {
        const spacing = 15;
        const formationCols = Math.ceil(Math.sqrt(units.length));

        units.forEach((unitObj, index) => {
            const unit = unitObj as any;
            const col = index % formationCols;
            const row = Math.floor(index / formationCols);
            const offsetX = (col - formationCols / 2) * spacing;
            const offsetY = (row - Math.ceil(units.length / formationCols) / 2) * spacing;
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

            // --- SECURITY BLOCK ---
            // If peaceful mode is active and this is an ENEMY unit, reject the attack command entirely.
            if (this.scene.peacefulMode && unit.getData('owner') !== 0) {
                // Flash a debug indicator if in debug mode
                if (this.scene.debugMode) {
                    const iso = toIso(unit.x, unit.y);
                    const x = this.scene.add.text(iso.x, iso.y, "X", { color: '#ff0000', fontSize: '20px' });
                    x.setOrigin(0.5);
                    this.scene.tweens.add({ targets: x, y: iso.y - 20, alpha: 0, duration: 500, onComplete: () => x.destroy() });
                }
                return;
            }
            // ----------------------

            // Only combat units attack
            if ([UnitType.SOLDIER, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(unit.unitType)) {
                console.log(`Unit ${unit.unitType} engaging target.`);
                unit.target = target;
                unit.state = UnitState.CHASING;
                unit.path = null; // Clear old move path
                unit.body.reset(unit.x, unit.y);
            } else {
                console.log(`Unit ${unit.unitType} CANNOT attack.`);
            }
        });

        // Visual Feedback (Red Flash on target)
        if ((target as any).visual) {
            console.log("Flashing Target visual");
            this.scene.tweens.add({
                targets: (target as any).visual,
                alpha: 0.5,
                yoyo: true,
                duration: 100,
                repeat: 2
            });
        } else {
            console.log("Target has no visual to flash");
        }
    }

    private updateUnitLogic(time: number, delta: number) {
        this.scene.units.getChildren().forEach((item: Phaser.GameObjects.GameObject) => {
            const unit = item as any;
            const body = unit.body as Phaser.Physics.Arcade.Body;

            if (!body) return;

            // Failsafe: If peaceful mode is on, force enemy combat units to stop attacking
            if (this.scene.peacefulMode === true && unit.getData('owner') !== 0) {
                if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
                    unit.state = UnitState.IDLE;
                    unit.target = null;
                    body.setVelocity(0, 0);
                }
            }

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
                if (body.velocity.length() > 0) body.setVelocity(0, 0);
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

            const now = time;
            const last = unit.lastAttackTime || 0;
            const cooldown = attackSpeed;

            if (now - last > cooldown) {
                console.log(`Attack Ready! Time: ${now}, Last: ${last}, CD: ${cooldown}`);
                unit.lastAttackTime = now;
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
        console.log(`PerformAttack: ${unit.unitType} -> Target (HP: ${target.getData('hp')})`);

        if (unit.unitType === UnitType.ARCHER) {
            // VOLLEY LOGIC
            // Calculate active soldiers based on HP ratio
            const maxHp = unit.getData('maxHp');
            const currentHp = unit.getData('hp');
            const squadSize = UNIT_STATS[UnitType.ARCHER].squadSize;

            // At least 1 arrow, up to squadSize
            const arrowCount = Math.max(1, Math.ceil((currentHp / maxHp) * squadSize));
            const damagePerArrow = dmg / arrowCount;

            for (let i = 0; i < arrowCount; i++) {
                // Randomize delay for loose volley feel (0-300ms)
                const delay = Phaser.Math.Between(0, 300);

                // Add minor random offset to target position for visual variety
                const spread = 15;
                const targetVaried = {
                    x: target.x + Phaser.Math.Between(-spread, spread),
                    y: target.y + Phaser.Math.Between(-spread, spread),
                    scene: target.scene, // Duck-type validity check
                    takeDamage: (amt: number) => { if (target && target.takeDamage) target.takeDamage(amt); }
                };

                this.scene.time.delayedCall(delay, () => {
                    if (unit.scene && target.scene) { // Validity check
                        this.fireProjectile(unit, targetVaried, damagePerArrow);
                    }
                });
            }

        } else {
            // Melee Lunge visual
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

            // Apply Damage Immediately (Melee)
            if (target.takeDamage) {
                target.takeDamage(dmg);
            }
        }
    }

    private fireProjectile(unit: any, target: any, dmg: number) {
        const startIso = toIso(unit.x, unit.y);
        const endIso = toIso(target.x, target.y);

        // Visual: Arrow (WHITE)
        const arrow = this.scene.add.rectangle(startIso.x, startIso.y - 20, 10, 1, 0xffffff);
        arrow.setDepth(startIso.y + 100);

        // Visual: Trail Effect (WHITE, LONGER)
        const emitter = this.scene.add.particles(0, 0, 'white_flare', {
            speed: 0,
            scale: { start: 0.2, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 500, // Longer trail
            tint: 0xffffff, // White trail
            blendMode: 'ADD',
            frequency: 10,
            follow: arrow
        });
        emitter.setDepth(Number.MAX_VALUE - 100);

        // Parabolic arc simulation
        // We tween X and Y linearly for ground movement
        // We use a custom update or a separate tween for 'height' to simulate arc

        // Simple linear movement for now, with a "height" offset curve?
        // Actually, just standard Phaser tween with a custom onUpdate is easy.

        const midX = (startIso.x + endIso.x) / 2;
        const midY = (startIso.y + endIso.y) / 2 - 50; // Arc peak control point

        // Or we can use a Quadratic Bezier curve
        const curve = new Phaser.Curves.QuadraticBezier(
            new Phaser.Math.Vector2(startIso.x, startIso.y - 15),
            new Phaser.Math.Vector2(midX, midY - 50), // Peak
            new Phaser.Math.Vector2(endIso.x, endIso.y - 10)
        );

        const projectileObj = { t: 0, vec: new Phaser.Math.Vector2() };

        this.scene.tweens.add({
            targets: projectileObj,
            t: 1,
            duration: 800, // Slower flight (was 400)
            onUpdate: () => {
                curve.getPoint(projectileObj.t, projectileObj.vec);
                arrow.setPosition(projectileObj.vec.x, projectileObj.vec.y);

                // Orient arrow along tangent
                const tangent = curve.getTangent(projectileObj.t);
                arrow.setRotation(tangent.angle());
            },
            onComplete: () => {
                arrow.destroy();
                emitter.destroy();
                // Check if target is still valid before damaging
                if (target.takeDamage) {
                    target.takeDamage(dmg);
                }
            }
        });
    }

    private drawDebugLines() {
        this.debugGraphics.clear();
        this.scene.units.getChildren().forEach((u: any) => {
            const startIso = toIso(u.x, u.y);

            // Draw Target Lines (Combat)
            if (u.target && u.target.scene) {
                const endIso = toIso(u.target.x, u.target.y);
                this.debugGraphics.lineStyle(2, 0xff0000, 0.7);
                this.debugGraphics.beginPath();
                this.debugGraphics.moveTo(startIso.x, startIso.y);
                this.debugGraphics.lineTo(endIso.x, endIso.y);
                this.debugGraphics.strokePath();
            }

            // Draw Path Lines (Movement)
            if (u.path && u.path.length > 0) {
                const dest = u.path[u.path.length - 1];
                const endIso = toIso(dest.x, dest.y);
                this.debugGraphics.lineStyle(1, 0xffffff, 0.5);
                this.debugGraphics.beginPath();
                this.debugGraphics.moveTo(startIso.x, startIso.y);
                this.debugGraphics.lineTo(endIso.x, endIso.y);
                this.debugGraphics.strokePath();
            }
        });
    }

    private drawUnitPaths(time: number) {
        this.pathGraphics.clear();
        this.scene.units.getChildren().forEach((uObj: Phaser.GameObjects.GameObject) => {
            const u = uObj as any;
            const isSelectable = [UnitType.SOLDIER, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(u.unitType);

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
