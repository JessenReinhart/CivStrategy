
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, UnitState, BuildingDef, FormationType, UnitStance, DamageType } from '../../types';
import { BUILDINGS, UNIT_STATS, FORMATION_BONUSES, UNIT_DAMAGE, UNIT_ARMOR, BUILDING_ARMOR, TERRAIN_CONFIG, FARM_TERRAIN_YIELD, UNIT_NAMES, FACTION_BONUSES } from '../../constants';
import { toIso, toIsoElev } from '../utils/iso';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';

const BUILDING_SHADOW_BASE_COLOR = 0x1a1208;
const BUILDING_SHADOW_BASE_ALPHA = 0.35;
const DAY_NIGHT_SHADOW_ALPHA_REFERENCE = 0.30;
const DAY_NIGHT_STATE_DATA_KEY = 'dayNightState';

export class EntityFactory {
    private scene: MainScene;
    private buildingShadows = new Map<Phaser.GameObjects.Graphics, { width: number; height: number }>();

    constructor(scene: MainScene) {
        this.scene = scene;
        this.scene.events.on('changedata', this.handleDayNightDataChange, this);
        this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.scene.events.off('changedata', this.handleDayNightDataChange, this);
        });
    }

    public spawnBuilding(type: BuildingType, x: number, y: number, owner: number = 0): Phaser.GameObjects.GameObject {
        const def = BUILDINGS[type];
        const b = this.scene.add.rectangle(x, y, def.width, def.height, 0x000000, 0);
        this.scene.physics.add.existing(b, true);
        b.setData('def', def);
        b.setData('owner', owner);
        const hpMult = this.scene.researchManager?.getSnapshot(owner).buildingHpMult ?? 1;
        let adjustedMaxHp = Math.round(def.maxHp * hpMult);
        // Apply faction building HP bonus (multiplicative with research)
        const factionBonus = FACTION_BONUSES[owner === 0 ? this.scene.faction : this.scene.enemyFaction];
        if (factionBonus) {
            const isWall = type === BuildingType.WALL;
            const factionHpMult = isWall ? (factionBonus.wallHpMult ?? factionBonus.buildingHpMult ?? 1) : (factionBonus.buildingHpMult ?? 1);
            adjustedMaxHp = Math.round(adjustedMaxHp * factionHpMult);
        }
        b.setData('hp', adjustedMaxHp);
        b.setData('maxHp', adjustedMaxHp);
        b.setData('armor', BUILDING_ARMOR[type] || {});
        this.scene.buildings.add(b);

        // Farm terrain affinity: store yield multiplier on all farms (player + AI)
        if (type === BuildingType.FARM) {
            const biome = this.scene.terrainSystem.getBiomeLabel(x, y);
            b.setData('terrainYield', FARM_TERRAIN_YIELD[biome] ?? 1.0);
        }

        // Castle garrison: initialize empty garrison store
        if (type === BuildingType.CASTLE) {
            b.setData('garrison', {});
        }

        this.scene.pathfinder.markGrid(x, y, def.width, def.height, true);



        const visual = this.scene.add.container(0, 0);
        // Ground shadow: soft warm-dark ellipse sized to the footprint, kept
        // below the building art so the iso base overlaps it. Added as a child
        // of the visual container so it is destroyed with the building.
        const groundShadow = this.scene.add.graphics();
        const groundShadowWidth = def.width * 0.62;
        const groundShadowHeight = def.height * 0.42;
        groundShadow.fillStyle(0x1a1208, 0.35).fillEllipse(0, 0, groundShadowWidth, groundShadowHeight);
        visual.addAt(groundShadow, 0);
        this.registerBuildingShadow(groundShadow, groundShadowWidth, groundShadowHeight);
        this.scene.worldVisuals.add(visual); // Add to ignored group
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual); // Add to rendering layer
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);


        const gfx = this.scene.add.graphics();
        const baseColor = owner === 1 ? 0x3f3f46 : def.color; // Keep dark base for enemy buildings for contrast, or maybe subtle tint? Let's keep it but make banner colorful.
        // ACTUALLY plan says "Update the enemy banner creation to use this.scene.getFactionColor(owner)".
        // And "Update spawnUnit to use this.scene.getFactionColor(owner)".
        // Let's stick to the plan.

        let spriteUsed = false;

        const setupSprite = (key: string, scaleMultiplier: number = 2.2, originY: number = 0.75) => {
            if (!this.scene.textures.exists(key)) return false;
            const sprite = this.scene.add.image(0, 0, key);
            sprite.setOrigin(0.5, originY);
            const targetWidth = def.width * scaleMultiplier;
            const scale = targetWidth / sprite.width;
            sprite.setScale(scale);
            visual.add(sprite);
            return true;
        };

        const spriteConfig = BUILDING_SPRITE_VISUALS[type];
        if (setupSprite(spriteConfig.key, spriteConfig.scaleMultiplier, spriteConfig.originY)) spriteUsed = true;

        if (!spriteUsed) {
            if (type === BuildingType.BONFIRE) {
                this.drawBonfire(gfx);
                this.scene.tweens.add({ targets: gfx, scaleX: 1.05, scaleY: 1.05, alpha: 0.9, yoyo: true, repeat: -1, duration: 150 });
            } else if (type === BuildingType.SMALL_PARK) {
                this.drawPark(gfx);
            } else {
                this.drawIsoBuilding(gfx, def, baseColor);
            }
        }

        if (owner === 1) {
            const banner = this.scene.add.rectangle(0, -40, 16, 8, this.scene.getFactionColor(owner));
            visual.add(banner);
        }

        if (!spriteUsed) {
            const text = this.scene.add.text(0, -def.height * 0.5 - 10, def.name[0], { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
            visual.add([gfx, text]);
        } else {
            visual.add(gfx);
        }

        // Keep the painted flame grounded while a restrained stream of embers
        // sells the fire at game zoom. As a child of the visual container the
        // emitter is automatically destroyed with the building.
        if (type === BuildingType.BONFIRE && spriteUsed && this.scene.textures.exists('flare')) {
            this.addBonfireGlow(visual);
            const embers = this.scene.add.particles(0, -18, 'flare', {
                speedX: { min: -10, max: 10 },
                speedY: { min: -58, max: -26 },
                scale: { start: 0.15, end: 0.03 },
                alpha: { start: 0.85, end: 0 },
                tint: [0xfff3a3, 0xffb000, 0xff5a00],
                lifespan: { min: 600, max: 1050 },
                frequency: 190,
                quantity: 1,
                gravityY: -4,
                blendMode: 'ADD',
            });
            embers.setData('bonfireEmbers', true);
            visual.add(embers);
        }

        const hpBar = this.createHealthBar(visual, def.width, -def.height * 0.8 - 35);
        visual.setData('hpBar', hpBar);

        const iso = toIsoElev(x, y, this.scene.terrainSystem.getHeightAt(x, y));
        visual.setPosition(iso.x, iso.y).setDepth(iso.y);
        // Position ground shadow relative to iso base
        const shadow = visual.getAt(0) as Phaser.GameObjects.Graphics;
        shadow.setPosition(0, 0).setDepth(0);

        // --- VACANT / NO RES ICONS (UI Camera Only) ---
        // These are added to uiGroup so they are NOT bloomed
        if (def.workerNeeds || def.effectRadius) {
            const vy = -def.height * 0.5 - 30;

            // Vacant Icon (Yellow Warning)
            const vacantIcon = this.scene.add.text(iso.x, iso.y + vy, "⚠️", { fontSize: '24px' });
            vacantIcon.setOrigin(0.5);
            vacantIcon.setVisible(false);
            this.scene.uiGroup.add(vacantIcon);
            visual.setData('vacantIcon', vacantIcon);

            // No Resources Icon (Red Ban)
            const noResIcon = this.scene.add.text(iso.x, iso.y + vy, "🚫", { fontSize: '24px' });
            noResIcon.setOrigin(0.5);
            noResIcon.setVisible(false);
            this.scene.uiGroup.add(noResIcon);
            visual.setData('noResIcon', noResIcon);
        }

        // Efficiency ring: shows gathering radius when building is selected
        if (def.effectRadius) {
            const ringGfx = this.scene.add.graphics();
            const r = def.effectRadius;
            // Dashed ellipse: draw arc segments (iso y compressed 0.5x)
            const segments = 64;
            const dashAngle = (Math.PI * 2) / segments;
            for (let i = 0; i < segments; i += 2) {
                const a1 = i * dashAngle;
                const a2 = (i + 1) * dashAngle;
                const x1 = Math.cos(a1) * r;
                const y1 = Math.sin(a1) * r * 0.5;
                const x2 = Math.cos(a2) * r;
                const y2 = Math.sin(a2) * r * 0.5;
                ringGfx.lineStyle(1.5, 0xffd700, 0.45);
                ringGfx.beginPath();
                ringGfx.moveTo(x1, y1);
                ringGfx.lineTo(x2, y2);
                ringGfx.strokePath();
            }
            ringGfx.setVisible(false);
            visual.add(ringGfx);
            visual.setData('ring', ringGfx);
        }

        if (!this.scene.worldLayer) this.scene.add.existing(visual);
        (b as any).visual = visual; // eslint-disable-line @typescript-eslint/no-explicit-any

        // Position set earlier


        visual.setInteractive(new Phaser.Geom.Rectangle(-def.width / 2, -def.height, def.width, def.height), Phaser.Geom.Rectangle.Contains);
        visual.setData('building', b);

        // Building selection method with pulsing glow effect
        (b as any).setSelected = (selected: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            (b as any).isSelected = selected; // eslint-disable-line @typescript-eslint/no-explicit-any
            const hpBar = visual.getData('hpBar') as Phaser.GameObjects.Container;
            if (hpBar) hpBar.setVisible(selected || b.getData('hp') < b.getData('maxHp'));

            if (selected) {
                this.startGlowEffect(visual);
            } else {
                this.stopGlowEffect(visual);
            }
        };

        if (owner === 0) {
            if (def.populationBonus) this.scene.maxPopulation += def.populationBonus;
            if (def.happinessBonus) this.scene.happiness += def.happinessBonus;
        }

        (b as any).takeDamage = (amount: number) => this.handleDamage(b, amount, false); // eslint-disable-line @typescript-eslint/no-explicit-any

        // Waypoint Logic for Barracks
        if (type === BuildingType.BARRACKS) {
            const waypointGfx = this.scene.add.graphics().setDepth(iso.y - 1);
            visual.add(waypointGfx);
            (b as any).setWaypoint = (cx: number, cy: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const isoDest = toIso(cx, cy);
                const isoStart = toIso(b.x, b.y);
                b.setData('waypoint', { x: cx, y: cy });

                waypointGfx.clear();
                waypointGfx.lineStyle(2, 0xffffff, 0.5);
                // Points relative to visual container
                const relDest = { x: isoDest.x - isoStart.x, y: isoDest.y - isoStart.y };
                waypointGfx.moveTo(0, 0).lineTo(relDest.x, relDest.y);
                // Draw a small flag or circle at dest
                waypointGfx.fillStyle(0xffffff, 0.8).fillCircle(relDest.x, relDest.y, 4);

                // Show floating text confirmation
                this.scene.feedbackSystem.showFloatingText(isoDest.x, isoDest.y, "Waypoint Set", "#ffffff");
            };

            // Hide waypoint if not selected? Or always show? 
            // In many RTS it shows only when selected.
            waypointGfx.setVisible(false);
            const originalSetSelected = (b as any).setSelected; // eslint-disable-line @typescript-eslint/no-explicit-any
            (b as any).setSelected = (sel: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                originalSetSelected(sel);
                waypointGfx.setVisible(sel);
            };
        }

        return b;
    }

    /** Track a building's static contact-shadow graphics so day/night updates can modulate it. */
    private registerBuildingShadow(shadow: Phaser.GameObjects.Graphics, width: number, height: number): void {
        this.buildingShadows.set(shadow, { width, height });
        shadow.once(Phaser.GameObjects.Events.DESTROY, () => {
            this.buildingShadows.delete(shadow);
        });
    }

    /** React to day/night state publishes and modulate every building contact shadow. */
    private handleDayNightDataChange(parent: Phaser.Data.DataManager, key: string, value: unknown): void {
        if (key !== DAY_NIGHT_STATE_DATA_KEY) return;
        const state = value as { shadowAlpha?: number } | undefined;
        const shadowAlpha = typeof state?.shadowAlpha === 'number' ? state.shadowAlpha : 0;

        for (const [shadow, dims] of this.buildingShadows) {
            if (!shadow || !shadow.active) continue;
            const factor = Math.max(0, Math.min(1, shadowAlpha / DAY_NIGHT_SHADOW_ALPHA_REFERENCE));
            const modulatedAlpha = BUILDING_SHADOW_BASE_ALPHA * factor;
            const modulatedColor = EntityFactory.modulateBuildingShadowColor(BUILDING_SHADOW_BASE_COLOR, factor);
            shadow.clear();
            shadow.fillStyle(modulatedColor, modulatedAlpha);
            shadow.fillEllipse(0, 0, dims.width, dims.height);
        }
    }

    /**
     * Warm the baseline building-shadow color at full sun and cool it toward
     * slate as the sun drops, with a small per-channel offset proportional to
     * the day/night shadow strength.
     */
    private static modulateBuildingShadowColor(baseColor: number, factor: number): number {
        const baseR = (baseColor >> 16) & 0xff;
        const baseG = (baseColor >> 8) & 0xff;
        const baseB = baseColor & 0xff;
        const warmth = Math.max(0, Math.min(1, factor));
        const shift = Math.round((warmth - 0.5) * 2 * 24);
        const r = Math.min(255, Math.max(0, baseR + shift));
        const g = Math.min(255, Math.max(0, baseG + (shift >> 1)));
        const b = Math.min(255, Math.max(0, baseB - shift));
        return (r << 16) | (g << 8) | b;
    }

    /** Add a local, additive firelight halo without raising global bloom. */
    private addBonfireGlow(visual: Phaser.GameObjects.Container): void {
        const glowKey = 'bonfire-glow';
        if (!this.scene.textures.exists(glowKey)) {
            const size = 128;
            const canvas = this.scene.textures.createCanvas(glowKey, size, size);
            if (!canvas) return;

            const gradient = canvas.context.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
            gradient.addColorStop(0, 'rgba(255, 248, 190, 0.95)');
            gradient.addColorStop(0.18, 'rgba(255, 187, 45, 0.7)');
            gradient.addColorStop(0.52, 'rgba(255, 89, 10, 0.24)');
            gradient.addColorStop(1, 'rgba(255, 70, 0, 0)');
            canvas.context.fillStyle = gradient;
            canvas.context.fillRect(0, 0, size, size);
            canvas.refresh();
        }

        const glow = this.scene.add.image(0, -24, glowKey)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.42)
            .setScale(0.78);
        visual.addAt(glow, 0);

        const flicker = this.scene.tweens.add({
            targets: glow,
            alpha: { from: 0.32, to: 0.62 },
            scaleX: { from: 0.70, to: 0.90 },
            scaleY: { from: 0.70, to: 0.90 },
            duration: 460,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
        glow.once(Phaser.GameObjects.Events.DESTROY, () => flicker.stop());
    }

    public spawnUnit(type: UnitType, x: number, y: number, owner: number = 0): Phaser.GameObjects.Arc | undefined {
        // Villagers are now handled by VillagerSystem, not EntityFactory
        if (type === UnitType.VILLAGER) {
            console.warn('Villagers should be spawned through VillagerSystem, not EntityFactory.spawnUnit');
            return;
        }

        if (type === UnitType.ANIMAL) {
            // Delegate to AnimalSystem which handles species, behavior, visuals
            return this.scene.animalSystem.spawnAnimal(x, y) as unknown as Phaser.GameObjects.Arc;
        }

        const stats = UNIT_STATS[type];
        const radius = 8;
        const unit = this.scene.add.circle(x, y, radius, 0x000000, 0);
        this.scene.physics.add.existing(unit);
        const body = unit.body as Phaser.Physics.Arcade.Body;
        body.setCircle(radius);
        // Combat units only reach here; drag differs for civilians (excluded above).
        // 250 balances liquid combat steering (forces ~50-300px/s²) with attack-range stability.
        // 800 killed liquid forces entirely; 80 caused overshoot past attack range.
        body.setDrag(250);
        const damageProfile = UNIT_DAMAGE[type] || {};
        const attackTotal = Object.values(DamageType).reduce((s, t) => s + (damageProfile[t] || 0), 0);
        unit.setData({
            owner,
            unitType: type,
            hp: stats.maxHp,
            maxHp: stats.maxHp,
            attack: attackTotal || stats.attack,
            damage: damageProfile,
            armor: UNIT_ARMOR[type] || {},
            range: stats.range,
            attackSpeed: stats.attackSpeed,
            stance: UnitStance.HOLD, // Default stance (USER REQUESTED CHANGE)
            anchor: { x: x, y: y }         // Default anchor
        });

        // Set combat bonuses for specific unit types
        if (type === UnitType.AXEMAN) {
            unit.setData('bonusVsBuilding', 2.0); // 2x damage vs buildings
        }
        if (type === UnitType.HOPLITE) {
            unit.setData('defensiveBonus', 0.15); // 15% damage reduction
        }

        // Store faction melee attack multiplier for combat resolution
        const unitFaction = owner === 0 ? this.scene.faction : this.scene.enemyFaction;
        const unitFactionBonus = FACTION_BONUSES[unitFaction];
        if (unitFactionBonus?.meleeAttackMult) {
            unit.setData('factionMeleeMult', unitFactionBonus.meleeAttackMult);
        }

        (unit as any).lastAttackTime = 0; // eslint-disable-line @typescript-eslint/no-explicit-any
        this.scene.units.add(unit);
        // Units are spawned via group.add() which does NOT emit the 'create' event,
        // so the MainScene spatial-hash insert hook never fires. Insert directly so
        // idle/stationary units are targetable by combat scanning.
        this.scene.unitSpatialHash.insert(unit);

        // Increment population for player-owned units
        if (owner === 0) {
            this.scene.population++;
        }

        const visual = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(visual); // Add to ignored group
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual); // Add to rendering layer
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);



        if (stats.squadSize === 1) {
            visual.setData('hpBar', this.createHealthBar(visual, 24, -20));
        }

        if (!this.scene.worldLayer) this.scene.add.existing(visual);
        (unit as any).visual = visual; // eslint-disable-line @typescript-eslint/no-explicit-any
        (unit as any).unitType = type; // eslint-disable-line @typescript-eslint/no-explicit-any

        // CRITICAL FIX: Make unit visual click-able for selection/targeting
        visual.setInteractive(new Phaser.Geom.Circle(0, -10, 15), Phaser.Geom.Circle.Contains);
        visual.setData('unit', unit);

        (unit as any).state = UnitState.IDLE; // eslint-disable-line @typescript-eslint/no-explicit-any
        (unit as any).setSelected = (selected: boolean) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            (unit as any).isSelected = selected; // eslint-disable-line @typescript-eslint/no-explicit-any
            const hpBar = visual.getData('hpBar');
            if (hpBar) hpBar.setVisible(selected || unit.getData('hp') < unit.getData('maxHp'));

            const existingRing = visual.getData('selectionRing') as Phaser.GameObjects.Ellipse | undefined;
            if (selected) {
                if (!existingRing) {
                    const ringColor = owner === 0 ? 0x4ade80 : 0xef4444;
                    const ring = this.scene.add.ellipse(0, 10, 28, 14, ringColor, 0.5);
                    visual.addAt(ring, 0); // Render below unit sprite
                    visual.setData('selectionRing', ring);
                }
            } else {
                if (existingRing) {
                    existingRing.destroy();
                    visual.setData('selectionRing', undefined);
                }
            }
        };

        if (stats.squadSize > 1) this.scene.squadSystem.createSquad(unit, type, owner);
        (unit as any).takeDamage = (amount: number) => this.handleDamage(unit, amount, true); // eslint-disable-line @typescript-eslint/no-explicit-any
        return unit;
    }

    private createHealthBar(visual: Phaser.GameObjects.Container, width: number, y: number): Phaser.GameObjects.Container {
        const bar = this.scene.add.container(0, y);
        const fg = this.scene.add.rectangle(-width / 2, 0, width, 2, 0x22c55e).setOrigin(0, 0.5).setName('barFill');
        bar.add([this.scene.add.rectangle(0, 0, width, 4, 0x000000), fg]);
        bar.setVisible(false);
        visual.add(bar);
        return bar;
    }

    private handleDamage(entity: Phaser.GameObjects.GameObject, amount: number, isUnit: boolean) {
        let hp = entity.getData('hp');
        const maxHp = entity.getData('maxHp');

        // Apply Formation Defense Bonus (Damage Reduction)
        if (isUnit) {
            const formation = entity.getData('formation') as FormationType || FormationType.BOX;
            const defBonus = FORMATION_BONUSES[formation]?.defense || 0;
            // E.g., 0.25 -> amount * 0.75
            // E.g., 0.25 -> amount * 0.75
            amount = Math.max(1, amount * (1 - defBonus));

            // REACTIVE DEFENSE: If holding ground and attacked, switch to Defensive to fight back
            // unless it's an Animal (which flees/wanders) or Villager (which flees)
            if (entity.getData('stance') === UnitStance.HOLD) {
                entity.setData('stance', UnitStance.DEFENSIVE);
                // Also update the visual stance if needed, but data is source of truth
                // We might want to notify user? No, just behavior change.
            }
        }

        // Apply research armor bonus (flat reduction per research snapshot)
        const entityOwner = entity.getData('owner') as number;
        const armorAdd = this.scene.researchManager?.getSnapshot(entityOwner).armorAdd ?? 0;
        if (armorAdd > 0) {
            amount = Math.max(1, amount - armorAdd);
        }

        hp -= amount;
        entity.setData('hp', hp);
        const visual = (entity as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (visual && visual.getData('hpBar')) {
            const hpBar = visual.getData('hpBar') as Phaser.GameObjects.Container;
            hpBar.setVisible(true);
            const fill = hpBar.getByName('barFill') as Phaser.GameObjects.Rectangle;
            fill.scaleX = Math.max(0, hp / maxHp);
            fill.fillColor = fill.scaleX < 0.3 ? 0xef4444 : 0x22c55e;
        }
        // Show floating damage number for buildings (units handled by UnitSystem)
        if (!isUnit) {
            this.scene.feedbackSystem.showDamageNumber((entity as any).x, (entity as any).y, Math.round(amount)); // eslint-disable-line @typescript-eslint/no-explicit-any
            this.scene.feedbackSystem.showHitSpark((entity as any).x, (entity as any).y); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        // Building health warning at ≤50% HP (fires once per building)
        if (!isUnit && hp > 0 && hp / maxHp < 0.5 && !entity.getData('_healthWarned')) {
            entity.setData('_healthWarned', true);
            const def = entity.getData('def');
            this.scene.feedbackSystem?.notifyBuildingDamaged(def?.name ?? 'Building', hp / maxHp);
        }
        if (hp <= 0) {
            if (isUnit) {
                const unitType = entity.getData('unitType') as string;
                const unitName = UNIT_NAMES[unitType] ?? 'Unit';
                this.scene.feedbackSystem.notifyUnitKilled(unitName, entity.getData('owner') === 0);
                const e = entity as Phaser.GameObjects.Image;
                this.scene.proceduralSound.playDeath(e.x, e.y, unitType);
                this.scene.feedbackSystem?.showDeathEffect(e.x, e.y);
                this.scene.squadSystem.destroySquad(entity);
                if (entity.getData('owner') === 0) this.scene.population--;
                // AI taunts when losing military units
                if (entity.getData('owner') === 1 && unitType !== UnitType.VILLAGER && unitType !== UnitType.ANIMAL) {
                    this.scene.enemyAI?.sendTauntOnArmyLost();
                }
            }
            else {
                const def = entity.getData('def');
                if (entity.getData('owner') === 0) {
                    this.scene.feedbackSystem.notifyBuildingDestroyed(def.name);
                    // Wall breach: specific notification so player knows their defenses fell
                    if (def.type === BuildingType.WALL) {
                        this.scene.feedbackSystem.showFloatingText(
                            (entity as any).x, (entity as any).y - 20, // eslint-disable-line @typescript-eslint/no-explicit-any
                            'Wall Breached!', '#ef4444'
                        );
                    }
                    // AI taunts after destroying a player building
                    this.scene.enemyAI?.sendTauntOnBuildingDestroyed();
                }
                this.scene.proceduralSound.playDemolition((entity as any).x, (entity as any).y); // eslint-disable-line @typescript-eslint/no-explicit-any
                this.scene.pathfinder.markGrid((entity as any).x, (entity as any).y, def.width, def.height, false); // eslint-disable-line @typescript-eslint/no-explicit-any
                if (entity.getData('owner') === 0 && def.populationBonus) this.scene.maxPopulation -= def.populationBonus;
                if (entity.getData('owner') === 0 && def.happinessBonus) {
                    this.scene.happiness = Math.max(0, this.scene.happiness - def.happinessBonus);
                }

                // Trigger explosion effect
                const iso = toIso((entity as any).x, (entity as any).y); // eslint-disable-line @typescript-eslint/no-explicit-any
                this.scene.buildingManager.emitExplosionParticles(iso.x, iso.y, def.width);
            }
            if (visual) visual.destroy();
            entity.destroy();
        }
    }

    public spawnTree(x: number, y: number) {
        // Optimization: Use single Image instead of Container + 2 Images
        // Don't spawn trees in water
        if (this.scene.terrainSystem.getHeightAt(x, y) < TERRAIN_CONFIG.WATER_LEVEL) return;
        // VIRTUALIZATON: Do NOT create visual here. Store data for pool.
        const treeBase = this.scene.add.circle(x, y, 6, 0x000000, 0);
        treeBase.setVisible(false); // Invisible, logic only
        this.scene.physics.add.existing(treeBase, true);
        this.scene.trees.add(treeBase);
        this.scene.treeSpatialHash.insert(treeBase);

        // Store visual properties for later hydration
        treeBase.setData('visualScale', Phaser.Math.FloatBetween(0.8, 1.1) * 0.075);
        treeBase.setData('visualTexture', 'tree');
        treeBase.setData('visualOriginY', 0.95);
        treeBase.setData('isChopped', false);
    }

    public spawnGoldMine(x: number, y: number) {
        if (this.scene.terrainSystem.getHeightAt(x, y) < TERRAIN_CONFIG.WATER_LEVEL) return;
        const mine = this.scene.add.circle(x, y, 8, 0x000000, 0);
        mine.setVisible(false);
        this.scene.physics.add.existing(mine, true);
        // Reuse trees group + spatial hash — flagged as gold mine
        this.scene.trees.add(mine);
        this.scene.treeSpatialHash.insert(mine);

        mine.setData('visualScale', 0.1);
        mine.setData('visualTexture', 'flare');
        mine.setData('visualOriginY', 0.95);
        mine.setData('visualTint', 0xFFD700);
        mine.setData('isChopped', false);
        mine.setData('isGoldMine', true);
        mine.setData('goldRemaining', 200);
        mine.setData('isDepleted', false);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public updateTreeVisual(tree: any, isChopped: boolean) {
        tree.setData('isChopped', isChopped);

        // Update data
        if (isChopped) {
            tree.setData('visualTexture', 'stump');
            tree.setData('visualScale', 0.075);
            tree.setData('visualOriginY', 0.5);
        } else {
            tree.setData('visualTexture', 'tree');
            // Keep original random scale? simplified for now
            tree.setData('visualOriginY', 0.95);
        }

        // If currently visible (has visual), update it immediately
        const visual = tree.visual as Phaser.GameObjects.Image;
        if (visual) {
            visual.setTexture(tree.getData('visualTexture'));
            visual.setScale(tree.getData('visualScale'));
            visual.setOrigin(0.5, tree.getData('visualOriginY'));
        }
    }

    public drawIsoBuilding(gfx: Phaser.GameObjects.Graphics, def: BuildingDef, color: number, alpha = 1) {
        const w = def.width, h = def.height, height = Math.min(w, h) * 0.45;
        const corners = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
        const isoCorners = corners.map(c => toIso(c.x, c.y));
        gfx.fillStyle(color, alpha).beginPath();
        gfx.moveTo(isoCorners[0].x, isoCorners[0].y - height).lineTo(isoCorners[1].x, isoCorners[1].y - height)
            .lineTo(isoCorners[2].x, isoCorners[2].y - height).lineTo(isoCorners[3].x, isoCorners[3].y - height).closePath().fillPath();
        gfx.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(20).color, alpha).beginPath()
            .moveTo(isoCorners[2].x, isoCorners[2].y - height).lineTo(isoCorners[1].x, isoCorners[1].y - height)
            .lineTo(isoCorners[1].x, isoCorners[1].y).lineTo(isoCorners[2].x, isoCorners[2].y).closePath().fillPath();
    }

    private drawBonfire(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x78716c).fillEllipse(0, 0, 24, 12);
        gfx.fillStyle(0xf97316, 0.8).beginPath().moveTo(-6, -6).lineTo(0, -20).lineTo(6, -6).closePath().fillPath();
    }

    private drawPark(gfx: Phaser.GameObjects.Graphics) {
        gfx.fillStyle(0x86efac).beginPath();
        const pts = [toIso(-14, -14), toIso(14, -14), toIso(14, 14), toIso(-14, 14)];
        gfx.moveTo(pts[0].x, pts[0].y).lineTo(pts[1].x, pts[1].y).lineTo(pts[2].x, pts[2].y).lineTo(pts[3].x, pts[3].y).closePath().fillPath();
        gfx.fillStyle(0x15803d).fillCircle(0, -4, 6);
    }

    private startGlowEffect(visual: Phaser.GameObjects.Container) {
        // Remove any existing glow
        this.stopGlowEffect(visual);

        // Find all sprites/images in the container and create additive overlays
        const glowOverlays: Phaser.GameObjects.Image[] = [];
        visual.each((child: Phaser.GameObjects.GameObject) => {
            if (child instanceof Phaser.GameObjects.Image) {
                // Create a duplicate sprite on top with ADD blend mode
                const overlay = this.scene.add.image(child.x, child.y, child.texture.key);
                overlay.setOrigin(child.originX, child.originY);
                overlay.setScale(child.scaleX, child.scaleY);
                overlay.setBlendMode(Phaser.BlendModes.ADD);
                overlay.setAlpha(0);
                visual.add(overlay);
                glowOverlays.push(overlay);
            }
        });

        if (glowOverlays.length === 0) return;

        visual.setData('glowOverlays', glowOverlays);

        // Create pulsing tween on the overlay alphas
        const tween = this.scene.tweens.add({
            targets: glowOverlays,
            alpha: { from: 0, to: 0.35 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        visual.setData('glowTween', tween);
    }

    private stopGlowEffect(visual: Phaser.GameObjects.Container) {
        const tween = visual.getData('glowTween') as Phaser.Tweens.Tween;
        if (tween) {
            tween.stop();
            tween.destroy();
            visual.setData('glowTween', null);
        }

        // Destroy overlay sprites
        const glowOverlays = visual.getData('glowOverlays') as Phaser.GameObjects.Image[];
        if (glowOverlays) {
            glowOverlays.forEach(overlay => overlay.destroy());
            visual.setData('glowOverlays', null);
        }
    }
}
