
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, FormationType, UnitStance, GameUnit } from '../../types';
import { MAP_WIDTH, MAP_HEIGHT, UNIT_SPEED, UNIT_STATS, FORMATION_BONUSES } from '../../constants';
import { toIso } from '../utils/iso';
import { FormationSystem } from './FormationSystem';

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;
    private debugGraphics: Phaser.GameObjects.Graphics;

    public currentFormation: FormationType = FormationType.BOX;
    public currentStance: UnitStance = UnitStance.AGGRESSIVE;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.pathGraphics = this.scene.add.graphics().setDepth(-4000);
        this.debugGraphics = this.scene.add.graphics().setDepth(100000);
    }

    public update(time: number, _delta: number) {
        this.updateUnitLogic(time, _delta);
        this.drawUnitPaths(time);

        if (this.scene.debugMode) {
            this.drawDebugLines();
        } else {
            this.debugGraphics.clear();
        }
    }

    public commandMove(units: Phaser.GameObjects.GameObject[], target: Phaser.Math.Vector2, queue: boolean = false) {
        const spacing = 15; // Unit spacing (not squad spacing)

        // 1. Calculate Group Offsets based on Formation
        const groupOffsets = FormationSystem.getFormationOffsets(this.currentFormation, units.length, spacing);

        // 2. Rotate offsets to face movement direction?
        // Basic linear/box formations are usually axis-aligned or facing target.
        // For now, let's keep them axis-aligned relative to the group center for simplicity,
        // OR rotate them if it's a Line formation so the line is perpendicular to movement.

        let rotationAngle = 0;
        if (this.currentFormation === FormationType.LINE || this.currentFormation === FormationType.WEDGE) {
            // Find center of mass of units
            let sumX = 0, sumY = 0;
            units.forEach((u: Phaser.GameObjects.GameObject) => {
                const unit = u as Phaser.GameObjects.Image; // Image/Sprite has x/y
                sumX += unit.x;
                sumY += unit.y;
            });
            const avgX = sumX / units.length;
            const avgY = sumY / units.length;

            // Angle to target
            rotationAngle = Phaser.Math.Angle.Between(avgX, avgY, target.x, target.y) + Math.PI / 2;
        }

        units.forEach((unitObj, index) => {
            const unit = unitObj as GameUnit;

            // Apply Squad Formation (Individual Soldiers)
            // This ensures soldiers inside the unit also follow the chosen pattern
            this.scene.squadSystem.applyFormation(unitObj, this.currentFormation);
            unit.setData('formation', this.currentFormation);

            // Calculate Unit Position in Group
            // Use the offsets we generated
            // Apply rotation if needed
            const baseOffset = groupOffsets[index];
            const rotatedOffset = new Phaser.Math.Vector2(
                baseOffset.x * Math.cos(rotationAngle) - baseOffset.y * Math.sin(rotationAngle),
                baseOffset.x * Math.sin(rotationAngle) + baseOffset.y * Math.cos(rotationAngle)
            );

            const unitTarget = new Phaser.Math.Vector2(target.x + rotatedOffset.x, target.y + rotatedOffset.y);

            const startPos = (queue && unit.path && unit.path.length > 0)
                ? unit.path[unit.path.length - 1]
                : new Phaser.Math.Vector2(unit.x, unit.y);

            const path = this.scene.pathfinder.findPath(startPos, unitTarget);
            if (path) {
                if (queue && unit.path) {
                    unit.path = unit.path.concat(path);
                } else {
                    unit.path = path;
                    unit.pathStep = 0;
                    unit.pathCreatedAt = this.scene.gameTime;
                    unit.state = UnitState.IDLE;
                    unit.target = null; // Clear combat target
                    (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
                    // Update Anchor for Defensive stance
                    unit.setData('anchor', { x: target.x, y: target.y });
                }
            }
        });

        // Visual feedback
        const iso = toIso(target.x, target.y);
        const color = queue ? 0xffff00 : 0xffffff;
        const circle = this.scene.add.circle(iso.x, iso.y, 5, color);
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

    public commandFollowPath(units: Phaser.GameObjects.GameObject[], pathPoints: Phaser.Math.Vector2[], queue: boolean = false) {
        if (pathPoints.length < 2) return;

        units.forEach((unitObj) => {
            const unit = unitObj as any; // eslint-disable-line @typescript-eslint/no-explicit-any

            // 1. Find path to start of drawn path
            let fullPath: Phaser.Math.Vector2[] = [];

            const startPos = (queue && unit.path && unit.path.length > 0)
                ? unit.path[unit.path.length - 1]
                : new Phaser.Math.Vector2(unit.x, unit.y);

            const startPath = this.scene.pathfinder.findPath(startPos, pathPoints[0]);
            if (startPath) {
                fullPath = startPath;
            } else {
                // If direct path blocked, at least start from startPos
                fullPath = [new Phaser.Math.Vector2(startPos.x, startPos.y)];
            }

            // 2. Add segments between drawn points, avoiding obstacles
            for (let i = 0; i < pathPoints.length - 1; i++) {
                const segment = this.scene.pathfinder.findPath(pathPoints[i], pathPoints[i + 1]);
                if (segment && segment.length > 0) {
                    const lastPoint = fullPath[fullPath.length - 1];
                    const startIdx = (lastPoint && Phaser.Math.Distance.Between(lastPoint.x, lastPoint.y, segment[0].x, segment[0].y) < 2) ? 1 : 0;

                    for (let j = startIdx; j < segment.length; j++) {
                        fullPath.push(segment[j]);
                    }
                }
            }

            if (fullPath.length > 0) {
                if (queue && unit.path) {
                    unit.path = unit.path.concat(fullPath);
                } else {
                    unit.path = fullPath;
                    unit.pathStep = 0;
                    unit.pathCreatedAt = this.scene.gameTime;
                    unit.state = UnitState.IDLE;
                    unit.target = null;
                    (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
                }
            }
        });

        // Visual feedback at destination
        const lastPoint = pathPoints[pathPoints.length - 1];
        const iso = toIso(lastPoint.x, lastPoint.y);
        const color = queue ? 0x00ffff : 0x00ff00;
        const circle = this.scene.add.circle(iso.x, iso.y, 5, color);
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

    public setStance(stance: UnitStance) {
        this.currentStance = stance;
        // Optional: Update selected units? For now just sets default for future training (if applicable) 
        // or user might want to simple Toggle checking logic. 
        // Usually, in RTS, you select units -> click 'Stand Ground' -> updates those units.
        const selected = this.scene.inputManager.selectedUnits; // Assuming MainScene has this or we iterate
        if (selected && selected.length > 0) {
            selected.forEach(obj => {
                const u = obj as Phaser.GameObjects.Image;
                u.setData('stance', stance);
                // If switching to HOLD, stop moving if chasing?
                if (stance === UnitStance.HOLD && ((u as GameUnit).state === UnitState.CHASING)) {
                    (u as GameUnit).state = UnitState.IDLE;
                    (u as GameUnit).target = null;
                    const body = u.body as Phaser.Physics.Arcade.Body;
                    if (body) body.setVelocity(0, 0);
                }
                // Update anchor to current position if switching to Defensive/Hold?
                // Usually anchor is set where they were last ordered to move. 
                // If I toggle Defensive now, anchor should probably be *here*.
                u.setData('anchor', { x: u.x, y: u.y });
            });
        }
    }

    public commandAttack(units: Phaser.GameObjects.GameObject[], target: Phaser.GameObjects.GameObject) {
        units.forEach((unitObj) => {
            const unit = unitObj as any; // eslint-disable-line @typescript-eslint/no-explicit-any

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
            if ([UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(unit.unitType)) {
                // console.log(`Unit ${unit.unitType} engaging target.`);
                unit.target = target;
                unit.state = UnitState.CHASING;
                unit.path = null; // Clear old move path
                (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
            } else {
                // console.log(`Unit ${unit.unitType} CANNOT attack.`);
            }
        });

        // Visual Feedback (Red Flash on target)
        if ((target as any).visual) { // eslint-disable-line @typescript-eslint/no-explicit-any
            // console.log("Flashing Target visual");
            this.scene.tweens.add({
                targets: (target as any).visual, // eslint-disable-line @typescript-eslint/no-explicit-any
                alpha: 0.5,
                yoyo: true,
                duration: 100,
                repeat: 2
            });
        } else {
            // console.log("Target has no visual to flash");
        }
    }

    private updateUnitLogic(time: number, _delta: number) {
        this.scene.units.getChildren().forEach((item: Phaser.GameObjects.GameObject) => {
            const unit = item as GameUnit;
            const body = unit.body as Phaser.Physics.Arcade.Body;

            if (!body) return;

            // Skip Villagers - they are now managed by VillagerSystem
            if (unit.unitType === UnitType.VILLAGER) return;

            // Failsafe: If peaceful mode is on, force enemy combat units to stop attacking
            if (this.scene.peacefulMode === true && unit.getData('owner') !== 0) {
                if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
                    unit.state = UnitState.IDLE;
                    unit.target = null;
                    (unit.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
                }
            }

            // Combat State Logic
            if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
                this.handleCombatState(unit, time);
            }
            // --- PATH FOLLOWING ---
            else if (unit.path && unit.path.length > 0) {
                if (unit.pathStep >= unit.path.length) {
                    body.setVelocity(0, 0);
                    unit.path = null;
                    return;
                }
                const nextPoint = unit.path[unit.pathStep];
                const dist = Phaser.Math.Distance.Between(unit.x, unit.y, nextPoint.x, nextPoint.y);

                if (dist < 4) {
                    unit.pathStep++;
                } else {
                    const baseSpeed = UNIT_SPEED[unit.unitType as UnitType] || 100;
                    const formation = unit.getData('formation') as FormationType || FormationType.BOX;
                    const multiplier = FORMATION_BONUSES[formation]?.speed || 1.0;
                    this.scene.physics.moveTo(unit, nextPoint.x, nextPoint.y, baseSpeed * multiplier);
                }
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
            else if (unit.state === UnitState.IDLE) {
                // Auto-Targeting
                this.scanForTargets(unit, time);
            }
            else {
                if (body.velocity.length() > 0) body.setVelocity(0, 0);
            }
        });

        // Separation
        this.scene.physics.overlap(this.scene.units, this.scene.units, (obj1, obj2) => {
            const u1 = obj1 as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const u2 = obj2 as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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

    private scanForTargets(unit: GameUnit, time: number) {
        // Throttle scanning: Only scan periodically (e.g. every 10 ticks or based on ID)
        // Simple optimization: check (time + unitID) % 500 < delta
        if (time % 500 > 20) return; // Check roughly every 0.5s

        // Only combat units should auto-target
        const isCombatUnit = [UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(unit.unitType);
        if (!isCombatUnit) return;

        const stance = unit.getData('stance') as UnitStance || UnitStance.AGGRESSIVE;
        const visionRange = 250; // Scan range
        const myOwner = unit.getData('owner');

        // Find closest enemy
        let closest: Phaser.GameObjects.GameObject | null = null;
        let closestDist = visionRange;

        // 1. Scan Units
        this.scene.units.getChildren().forEach((other: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (other === unit) return;
            if (other.getData('owner') !== myOwner && other.getData('hp') > 0) {
                const dist = Phaser.Math.Distance.Between(unit.x, unit.y, other.x, other.y);
                if (dist < closestDist) {
                    // Visibility check could go here (e.g. Fog of War)
                    closest = other;
                    closestDist = dist;
                }
            }
        });

        // 2. Scan Buildings (if no unit found or strict priority?)
        // Usually units prioritize units.
        if (!closest) {
            this.scene.buildings.getChildren().forEach((b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (b.getData('owner') !== myOwner && b.getData('hp') > 0) {
                    const dist = Phaser.Math.Distance.Between(unit.x, unit.y, b.x, b.y);
                    if (dist < closestDist) {
                        closest = b;
                        closestDist = dist;
                    }
                }
            });
        }

        if (closest) {
            // Found target!
            // If HOLDStance, only engage if in ATTACK range (not scan range)? 
            // Or engage = set target. Handle movement restrictions in handleCombat.
            // Actually, if HOLD, we shouldn't even set target if it's out of range, because setting target triggers CHASE state typically.

            const range = unit.getData('range') || 40;
            if (stance === UnitStance.HOLD && closestDist > range) {
                return; // Ignore
            }

            // Engage
            unit.target = closest;
            unit.state = UnitState.CHASING; // Default to chasing, handleCombat will restriction movement if HOLD
        }
    }

    private handleCombatState(unit: GameUnit, time: number) {
        const target = unit.target as Phaser.GameObjects.Image; // Cast for x/y access

        // Target dead or destroyed
        if (!target || !target.scene) {
            unit.state = UnitState.IDLE;
            unit.target = null;
            if (unit.body) (unit.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
            return;
        }

        const dist = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);
        const range = unit.getData('range') || 40;
        const attackSpeed = unit.getData('attackSpeed') || 1000;
        const stance = unit.getData('stance') as UnitStance || UnitStance.AGGRESSIVE;
        const anchor = unit.getData('anchor') || { x: unit.x, y: unit.y };

        // STANCE LOGIC: Check constraints
        if (stance === UnitStance.DEFENSIVE) {
            const tetherDist = Phaser.Math.Distance.Between(unit.x, unit.y, anchor.x, anchor.y);
            if (tetherDist > 300) { // Tether Radius
                // Too far! Give up chase.
                unit.target = null;
                unit.state = UnitState.IDLE; // Next loop will path back? 
                // Force move back to anchor
                this.scene.physics.moveTo(unit, anchor.x, anchor.y, UNIT_SPEED[unit.unitType as UnitType] || 100);
                // We need a state for "Return to Anchor" so we don't scan immediately
                // But for now, returning to IDLE with velocity might just drift.
                // Better: commandMove them back?
                // Or just set path.
                const path = this.scene.pathfinder.findPath(new Phaser.Math.Vector2(unit.x, unit.y), new Phaser.Math.Vector2(anchor.x, anchor.y));
                if (path) {
                    unit.path = path;
                    unit.pathStep = 0;
                    unit.pathCreatedAt = time;
                }
                return;
            }
        }
        else if (stance === UnitStance.HOLD) {
            // Ensure we don't move.
            // If target is out of range, drop it? Or just stand there?
            // "Hold Place" - attack if in range.
            if (dist > range) {
                // Out of range. Stop trying to chase.
                (unit.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
                // If we were attacking, we stop.
                // We keep target? No, if we keep target, we stay in CombatState.
                // If we drop target, we scan again.
                // If enemy is just outside range, we might toggle target/no-target. This is fine.
                unit.target = null;
                unit.state = UnitState.IDLE;
                return;
            }
        }

        // Attack Logic
        if (dist <= range) {
            (unit.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
            unit.state = UnitState.ATTACKING;

            const now = time;
            const last = unit.lastAttackTime || 0;
            const cooldown = attackSpeed;

            if (now - last > cooldown) {
                // console.log(`Attack Ready! Time: ${now}, Last: ${last}, CD: ${cooldown}`);
                unit.lastAttackTime = now;
                this.performAttack(unit, target);
            }
        } else {
            // Chase Logic
            if (stance === UnitStance.HOLD) {
                // Do NOT move
                (unit.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
                // Drop target since we can't reach it
                unit.target = null;
                unit.state = UnitState.IDLE;
            } else {
                unit.state = UnitState.CHASING;
                const speed = UNIT_SPEED[unit.unitType as UnitType] || 100;
                this.scene.physics.moveTo(unit, target.x, target.y, speed);
            }
        }
    }

    private performAttack(unit: GameUnit, targetObj: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const target = targetObj as GameUnit;
        let dmg = unit.getData('attack') || 10;
        const formation = unit.getData('formation') as FormationType || FormationType.BOX;
        // Apply Formation Attack Bonus
        const attackMult = FORMATION_BONUSES[formation]?.attack || 1.0;
        dmg *= attackMult;

        // console.log(`PerformAttack: ${unit.unitType} -> Target (HP: ${target.getData('hp')})`);

        if (unit.unitType === UnitType.ARCHER) {
            // VOLLEY LOGIC
            // Calculate active soldiers based on HP ratio
            const maxHp = unit.getData('maxHp');
            const currentHp = unit.getData('hp');
            const squadSize = UNIT_STATS[UnitType.ARCHER].squadSize;
            const soldiers = unit.getData('soldierStates') || []; // Get soldier positions

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

                const origin = (soldiers.length > 0)
                    ? soldiers[i % soldiers.length] // Cycle through soldiers
                    : { x: unit.x, y: unit.y }; // Fallback to unit center

                this.scene.time.delayedCall(delay, () => {
                    if (unit.scene && target.scene) { // Validity check
                        this.fireProjectile(origin, targetVaried, damagePerArrow); // Pass origin point (Cartesian)
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

    private fireProjectile(origin: { x: number, y: number }, target: any, dmg: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const startIso = toIso(origin.x, origin.y);
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
        this.scene.units.getChildren().forEach((u: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
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
            const u = uObj as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const isSelectable = [UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(u.unitType);

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
    public setFormation(type: FormationType) {
        this.currentFormation = type;
        // Optionally immediately re-form selected units? 
        // For now, it just sets the mode for the NEXT move command, 
        // OR we can trigger a short move to reform in place if we wanted.
        // User requested UI button sets it.
    }
}
