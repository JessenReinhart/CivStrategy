
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, BuildingDef, UnitState, GameStats, ResourceRates, VillagerData, AnimalData } from '../../types';
import { EVENTS, VILLAGER_BUILDING_UPKEEP, POPULATION_FOOD_COST, GOLD_MINE_SEARCH_RADIUS, TRADE_INCOME, CATHEDRAL_TRADE_BONUS_MULTIPLIER, FACTION_BONUSES } from '../../constants';

export class EconomySystem {
    private scene: MainScene;
    private lastRates: ResourceRates = { wood: 0, food: 0, gold: 0, foodConsumption: 0 };
    private lastHappinessChange: number = 0;
    private lastHappinessWarning: number = 0;
    private lastEnemyCheck: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    /**
     * Called by VillagerSystem when a villager reaches a dropsite.
     * Deposits carried resources into the global pool with research multipliers applied.
     */
    public depositResource(owner: number, type: 'wood' | 'food' | 'gold', amount: number) {
        let finalAmount = amount;

        // Apply research gather multipliers
        if (this.scene.researchManager) {
            const snap = this.scene.researchManager.getSnapshot(owner);
            if (type === 'wood') finalAmount = Math.floor(finalAmount * snap.gatherMult.wood);
            else if (type === 'food') finalAmount = Math.floor(finalAmount * snap.gatherMult.food);
            else if (type === 'gold') finalAmount = Math.floor(finalAmount * snap.gatherMult.gold);
        }
        // Apply faction gather rate bonus (multiplicative with research)
        const gatherFaction = owner === 0 ? this.scene.faction : this.scene.enemyFaction;
        const gatherMult = FACTION_BONUSES[gatherFaction]?.gatherRateMult ?? 1;
        if (gatherMult !== 1) finalAmount = Math.floor(finalAmount * gatherMult);

        this.scene.resources[type] += finalAmount;

        // Show floating text at player's TC
        if (owner === 0) {
            const tcs = this.scene.buildings.getChildren().filter((b) =>
                b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
            ) as Phaser.GameObjects.Image[];
            if (tcs.length > 0) {
                const label = type.charAt(0).toUpperCase() + type.slice(1);
                this.scene.feedbackSystem.showFloatingResource(tcs[0].x, tcs[0].y, finalAmount, label);
            }
        }
    }

    public tickPopulation() {
        // Only manage Player population (Owner 0)
        // Civil Service: +50% pop growth = lower effective food cost
        const growthMult = this.scene.researchManager?.getSnapshot(0).popGrowthMult ?? 1;
        const effectiveFoodCost = Math.round(POPULATION_FOOD_COST / growthMult);
        if (this.scene.population < this.scene.maxPopulation && this.scene.happiness > 50) {
            // Food cost gate: must have enough food to grow
            if (this.scene.resources.food < effectiveFoodCost) return;

            const houses = this.scene.buildings.getChildren().filter((b) =>
                b.getData('def').type === BuildingType.HOUSE && b.getData('owner') === 0
            ) as Phaser.GameObjects.Rectangle[];

            let spawnSource = null;
            if (houses.length > 0) {
                spawnSource = houses[Phaser.Math.Between(0, houses.length - 1)];
            } else {
                const townCenters = this.scene.buildings.getChildren().filter((b) =>
                    b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
                ) as Phaser.GameObjects.Rectangle[];
                if (townCenters.length > 0) spawnSource = townCenters[0];
            }

            if (spawnSource) {
                // Subtract food cost for population growth
                this.scene.resources.food -= effectiveFoodCost;

                const offsetX = Phaser.Math.Between(-30, 30);
                const offsetY = Phaser.Math.Between(-30, 30);
                const spawnX = spawnSource.x + (offsetX >= 0 ? 50 : -50) + offsetX;
                const spawnY = spawnSource.y + (offsetY >= 0 ? 50 : -50) + offsetY;

                this.scene.villagerSystem.spawnVillager(spawnX, spawnY, 0);
                this.scene.events.emit('message', "A new peasant has arrived.");
            }
        }
    }

    public assignJobs() {
        const vacantBuildings = this.scene.buildings.getChildren().filter((b) => {
            const def = b.getData('def') as BuildingDef;
            const assignedWorker = b.getData('assignedWorker');
            return def.workerNeeds && !assignedWorker;
        });

        for (const building of vacantBuildings) {
            const b = building as Phaser.GameObjects.Image;
            const buildingOwner = b.getData('owner');

            // Query idle villagers matching THIS building's owner
            const idleVillagers = this.scene.villagerSystem.getIdleVillagers(buildingOwner);
            if (idleVillagers.length === 0) continue;

            let closestWorker: VillagerData | null = null;
            let minDist = Number.MAX_VALUE;

            for (let i = 0; i < idleVillagers.length; i++) {
                const villager = idleVillagers[i];
                const dist = Phaser.Math.Distance.Between(b.x, b.y, villager.x, villager.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestWorker = villager;
                }
            }

            if (closestWorker) {
                b.setData('assignedWorker', closestWorker);
                this.scene.villagerSystem.assignJob(closestWorker, b);
            }
        }

        // Assign idle villagers to gold mines near a Town Center
        const idleForGold = this.scene.villagerSystem.getIdleVillagers(0);
        if (idleForGold.length > 0) {
            // Find player TCs as potential dropsites
            const tcs = this.scene.buildings.getChildren().filter((b) => {
                const def = b.getData('def') as BuildingDef;
                return def.type === BuildingType.TOWN_CENTER && b.getData('owner') === 0;
            }) as Phaser.GameObjects.Image[];

            for (const tc of tcs) {
                // Find gold mines near this TC
                const nearbyMines = this.scene.treeSpatialHash.query(tc.x, tc.y, GOLD_MINE_SEARCH_RADIUS) as Phaser.GameObjects.Image[];
                const activeMines = nearbyMines.filter((m) =>
                    m.getData('isGoldMine') && !m.getData('isDepleted') && m.active
                );

                for (const mine of activeMines) {
                    if (idleForGold.length === 0) break;

                    // Find closest idle villager to this mine
                    let bestVillager: VillagerData | null = null;
                    let bestDist = Infinity;
                    let bestIdx = -1;
                    for (let i = 0; i < idleForGold.length; i++) {
                        const v = idleForGold[i];
                        if (v.owner !== 0) continue;
                        const d = Phaser.Math.Distance.Between(mine.x, mine.y, v.x, v.y);
                        if (d < bestDist) {
                            bestDist = d;
                            bestVillager = v;
                            bestIdx = i;
                        }
                    }

                    if (bestVillager && bestDist < GOLD_MINE_SEARCH_RADIUS * 1.5) {
                        idleForGold.splice(bestIdx, 1);
                        this.scene.villagerSystem.assignJob(bestVillager, mine);
                    }
                }
            }
        }

        // Re-filter idle villagers to those who are still truly idle and job-less
        const remainingIdle = this.scene.villagerSystem.getAllVillagers().filter((villager) =>
            villager.state === UnitState.IDLE && !villager.jobBuilding
        );

        if (remainingIdle.length > 0) {
            const allBonfires = this.scene.buildings.getChildren().filter((b) => b.getData('def').type === BuildingType.BONFIRE) as Phaser.GameObjects.Rectangle[];

            if (allBonfires.length > 0) {
                remainingIdle.forEach((villager) => {
                    const owner = villager.owner;
                    // Filter bonfires by OWNER
                    const myBonfires = allBonfires.filter((b) => b.getData('owner') === owner);

                    if (myBonfires.length > 0) {
                        let closestBonfire = myBonfires[0];
                        let minDistance = Number.MAX_VALUE;
                        for (const bonfire of myBonfires) {
                            const d = Phaser.Math.Distance.Between(villager.x, villager.y, bonfire.x, bonfire.y);
                            if (d < minDistance) {
                                minDistance = d;
                                closestBonfire = bonfire;
                            }
                        }
                        const rallyPoint = closestBonfire;
                        // Only move if far away AND no existing rally destination (prevents per-tick random reassignment)
                        if (minDistance > 100 && !villager.rallyPoint) {
                            const angle = Math.random() * Math.PI * 2;
                            const r = Math.random() * 60 + 40;
                            const destX = rallyPoint.x + Math.cos(angle) * r;
                            const destY = rallyPoint.y + Math.sin(angle) * r;
                            this.scene.villagerSystem.sendToRallyPoint(villager, destX, destY);
                            villager.rallyPoint = { x: destX, y: destY };
                        }
                    }
                });
            }
        }
    }

    public tickEconomy() {
        const isLowHappiness = this.scene.happiness < 50;
        const efficiency = isLowHappiness ? 0.5 : 1.0;
        const taxGoldPerPop = this.scene.taxRate;

        let foodGen = 0;
        let woodGen = 0;

        // Base Commerce for Player
        let goldGen = Math.floor((this.scene.population * (0.5 + taxGoldPerPop)) * efficiency);

        // Faction passive gold bonus (e.g., Carthage +1 gold/tick)
        const factionBonus = FACTION_BONUSES[this.scene.faction];
        if (factionBonus?.goldPerTick) {
            goldGen += factionBonus.goldPerTick;
        }

        this.scene.buildings.getChildren().forEach((bObj) => {
            const b = bObj as Phaser.GameObjects.Image;
            // STRICT OWNERSHIP CHECK: Only process PLAYER buildings for player economy
            if (b.getData('owner') !== 0) return;

            const def = b.getData('def') as BuildingDef;
            const visual = (b as any).visual as Phaser.GameObjects.Container; // eslint-disable-line @typescript-eslint/no-explicit-any
            const vacantIcon = visual.getData('vacantIcon') as Phaser.GameObjects.Text;
            const noResIcon = visual.getData('noResIcon') as Phaser.GameObjects.Text;

            let isWorking = true;

            if (def.workerNeeds) {
                const worker = b.getData('assignedWorker') as VillagerData | null;
                if (worker && (worker.state === UnitState.WORKING || worker.state === UnitState.GATHERING)) {
                    if (vacantIcon) vacantIcon.visible = false;
                } else {
                    isWorking = false;
                    if (vacantIcon) vacantIcon.visible = true;
                }
            }

            // Town Center: commerce hub generates passive gold
            if (def.type === BuildingType.TOWN_CENTER) {
                goldGen += Math.floor(2 * efficiency);
                isWorking = true;
            }

            if (isWorking) {
                // Farm terrain affinity: passive bonus per working farm scaled by terrain yield
                if (def.type === BuildingType.FARM) {
                    const terrainYield = b.getData('terrainYield') as number ?? 1.0;
                    foodGen += Math.floor(terrainYield * 2 * efficiency);
                }

                // Hunter's Lodge: passive food from nearby animals (hunting mechanic preserved)
                if (def.type === BuildingType.HUNTERS_LODGE && def.effectRadius) {
                    const animals = this.scene.animalSystem.getAnimals();
                    let animalsNearby = 0;
                    const nearbyAnimals: AnimalData[] = [];

                    for (const animal of animals) {
                        const dist = Phaser.Math.Distance.Between(b.x, b.y, animal.x, animal.y);
                        if (dist < def.effectRadius!) {
                            animalsNearby++;
                            nearbyAnimals.push(animal);
                        }
                    }
                    if (animalsNearby > 0) {
                        // Use species-specific food value from nearest animal
                        const nearest = nearbyAnimals[0];
                        let gain = nearest.foodValue || 20;
                        gain = Math.floor(gain * efficiency);
                        foodGen += gain;
                        if (Math.random() < 0.20) {
                            const victim = nearbyAnimals[Phaser.Math.Between(0, nearbyAnimals.length - 1)];
                            this.scene.animalSystem.destroyAnimal(victim);
                            this.scene.feedbackSystem.showFloatingText(b.x, b.y - 30, "Depleted!", "#ef4444");
                        }
                    }
                }

                // Lumber camp: show "no resource" icon when no trees nearby (visual feedback, no passive generation)
                if (def.type === BuildingType.LUMBER_CAMP && def.effectRadius) {
                    const candidates = this.scene.treeSpatialHash.query(b.x, b.y, def.effectRadius);
                    let treesNearby = 0;
                    for (const t of candidates) {
                        const tree = t as Phaser.GameObjects.Image;
                        if (Phaser.Math.Distance.Between(b.x, b.y, tree.x, tree.y) < def.effectRadius) {
                            if (!tree.getData('isChopped')) {
                                treesNearby++;
                            }
                        }
                    }
                    if (noResIcon) noResIcon.visible = (treesNearby === 0);
                }
            }
        });
        // Trade income: player earns gold when both sides have a Market and peace/treaty is active
        const playerHasMarket = this.scene.buildings.getChildren().some(
            (b) => b.getData('owner') === 0 && (b.getData('def') as BuildingDef)?.type === BuildingType.MARKET
        );
        const aiHasMarket = this.scene.buildings.getChildren().some(
            (b) => b.getData('owner') === 1 && (b.getData('def') as BuildingDef)?.type === BuildingType.MARKET
        );
        const isPeaceful = this.scene.peacefulMode || this.scene.gameTime < this.scene.treatyLength;
        const playerHasCathedral = this.scene.buildings.getChildren().some(
            (b) => b.getData('owner') === 0 && (b.getData('def') as BuildingDef)?.type === BuildingType.CATHEDRAL
        );
        const tradeMult = playerHasCathedral ? CATHEDRAL_TRADE_BONUS_MULTIPLIER : 1;
        const tradeGold = (playerHasMarket && aiHasMarket && isPeaceful) ? TRADE_INCOME * tradeMult : 0;
        goldGen += tradeGold;

        // Show floating gold at TC
        if (goldGen > 0) {
            const tcs = this.scene.buildings.getChildren().filter((b) =>
                b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
            ) as Phaser.GameObjects.Rectangle[];
            if (tcs.length > 0) {
                this.scene.feedbackSystem.showFloatingResource(tcs[0].x, tcs[0].y, goldGen, 'Gold');
            }
        }

        // Apply research gather multipliers to passive production
        if (this.scene.researchManager) {
            const snap = this.scene.researchManager.getSnapshot(0);
            woodGen = Math.floor(woodGen * snap.gatherMult.wood);
            foodGen = Math.floor(foodGen * snap.gatherMult.food);
        }

        // ─── Building Upkeep ───
        let upkeepFood = 0;
        let upkeepGold = 0;
        this.scene.buildings.getChildren().forEach((bObj) => {
            const b = bObj as Phaser.GameObjects.Image;
            if (b.getData('owner') !== 0) return;
            const def = b.getData('def') as BuildingDef;
            const upkeep = VILLAGER_BUILDING_UPKEEP[def.type];
            if (upkeep) {
                if (upkeep.food) upkeepFood += upkeep.food;
                if (upkeep.gold) upkeepGold += upkeep.gold;
            }
        });

        const foodConsumed = this.scene.population * 1;
        this.scene.resources.food += foodGen;
        this.scene.resources.wood += woodGen;
        this.scene.resources.gold += goldGen;
        this.scene.resources.food -= foodConsumed;
        this.scene.resources.food -= upkeepFood;
        this.scene.resources.gold -= upkeepGold;
        if (this.scene.resources.food < 0) this.scene.resources.food = 0;
        if (this.scene.resources.gold < 0) this.scene.resources.gold = 0;
        this.lastRates = { wood: woodGen, food: foodGen - foodConsumed - upkeepFood, gold: goldGen - upkeepGold, foodConsumption: foodConsumed + upkeepFood };

        // ─── Happiness ───
        let happinessChange = 0;
        const isStarving = this.scene.resources.food === 0 && foodConsumed > 0;
        if (isStarving) { happinessChange -= 5; } else { happinessChange += 0; }
        if (this.scene.population > this.scene.maxPopulation) { happinessChange -= 2; }
        if (this.scene.population > this.scene.maxPopulation * 0.8) { happinessChange -= 1; }
        const taxImpact = [0, 0, -1, -3, -6, -10];
        happinessChange += (taxImpact[this.scene.taxRate] || 0);

        // Civil Service: -30% happiness decay (applies to negative changes only)
        const decayMult = this.scene.researchManager?.getSnapshot(0).happinessDecayMult ?? 1;
        if (happinessChange < 0) happinessChange = Math.round(happinessChange * decayMult);

        this.scene.happiness += happinessChange;
        this.scene.happiness = Phaser.Math.Clamp(this.scene.happiness, 0, 100);
        this.lastHappinessChange = happinessChange;
        // ─── Feedback Wiring ───
        const now = Date.now();
        if (this.scene.happiness < 30 && this.scene.happiness > 0 && now - this.lastHappinessWarning > 30000) {
            this.scene.feedbackSystem.notifyHappinessCritical();
            this.lastHappinessWarning = now;
        }
        if (isStarving && now - this.lastHappinessWarning > 10000) {
            this.scene.feedbackSystem.notifyHappinessCritical();
            this.lastHappinessWarning = now;
        }

        // Enemy approaching detection (throttled to every 5s)
        if (this.scene.gameTime - this.lastEnemyCheck > 5000) {
            this.lastEnemyCheck = this.scene.gameTime;
            this.detectEnemyApproaching();
        }

        this.updateStats();
    }

    /**
     * Check for enemy units within 500px of any player Town Center.
     */
    private detectEnemyApproaching() {
        const playerTCs = this.scene.buildings.getChildren().filter((b) =>
            b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
        ) as Phaser.GameObjects.Image[];
        if (playerTCs.length === 0) return;

        for (const unit of this.scene.units.getChildren()) {
            const u = unit as Phaser.GameObjects.Image;
            const owner = u.getData('owner') as number;
            if (owner === 0 || owner < 0) continue;
            const hp = u.getData('hp') as number;
            if (hp <= 0) continue;

            for (const tc of playerTCs) {
                if (Phaser.Math.Distance.Between(u.x, u.y, tc.x, tc.y) < 500) {
                    this.scene.feedbackSystem.notifyEnemyApproaching();
                    return; // one notification per check cycle
                }
            }
        }
    }

    public updateStats() {
        const remainingTreaty = Math.max(0, this.scene.treatyLength - this.scene.gameTime);

        const stats: GameStats = {
            population: this.scene.population,
            maxPopulation: this.scene.maxPopulation,
            happiness: this.scene.happiness,
            happinessChange: this.lastHappinessChange,
            resources: { ...this.scene.resources },
            rates: this.lastRates,
            taxRate: this.scene.taxRate,
            mapMode: this.scene.mapMode,
            peacefulMode: this.scene.peacefulMode,
            treatyTimeRemaining: remainingTreaty,
            bloomIntensity: this.scene.bloomIntensity || 1.0,
            currentFormation: this.scene.unitSystem.currentFormation,
            currentStance: this.scene.unitSystem.currentStance,
            currentAge: this.scene.currentAge,
            ageProgress: this.scene.ageProgress,
            nextAge: this.scene.nextAge,
            currentSeason: this.scene.currentSeason,
            notifications: this.scene.feedbackSystem.getNotifications(),
            activeResearch: (() => {
                const active = this.scene.researchManager?.getActive(0);
                if (!active) return null;
                return { techId: active.techId, progress: 1 - active.remainingMs / active.totalMs, duration: active.totalMs };
            })(),
            completedTechs: [...(this.scene.researchManager?.getSnapshot(0).completed ?? [])],
            gameResult: this.scene.gameResult,
            dominanceProgress: this.scene.dominanceProgress,
            playerTerritoryPercent: this.scene.playerTerritoryPercent,
            victoryType: this.scene.victoryType,
            mapSeed: this.scene.mapSeed,
        };

        // Selected building info for UI display
        const selB = this.scene.inputManager?.selectedBuilding as Phaser.GameObjects.Image | null;
        if (selB && selB.getData('owner') === 0) {
            const def = selB.getData('def') as BuildingDef;
            if (def.effectRadius) {
                const worker = selB.getData('assignedWorker') as VillagerData | null;
                const hasWorker = !!(worker && worker.state === UnitState.WORKING);
                let nearbyResources = 0;
                let resourceLabel = '';
                if (def.type === BuildingType.LUMBER_CAMP) {
                    const candidates = this.scene.treeSpatialHash.query(selB.x, selB.y, def.effectRadius);
                    for (const t of candidates) {
                        const tree = t as Phaser.GameObjects.Image;
                        if (!tree.getData('isChopped') && Phaser.Math.Distance.Between(selB.x, selB.y, tree.x, tree.y) < def.effectRadius) {
                            nearbyResources++;
                        }
                    }
                    resourceLabel = 'trees nearby';
                } else if (def.type === BuildingType.HUNTERS_LODGE) {
                    const animals = this.scene.animalSystem.getAnimals();
                    for (const a of animals) {
                        if (Phaser.Math.Distance.Between(selB.x, selB.y, a.x, a.y) < def.effectRadius) {
                            nearbyResources++;
                        }
                    }
                    resourceLabel = 'animals nearby';
                } else if (def.type === BuildingType.FARM) {
                    resourceLabel = 'fertile land';
                    nearbyResources = 1; // Farms always produce if worker assigned
                }
                const garrisonCount = def.type === BuildingType.CASTLE
                    ? Object.values(selB.getData('garrison') || {} as Record<string, number>).reduce((s: number, n) => s + (n as number), 0)
                    : undefined;
                stats.selectedBuildingInfo = { type: def.type, hasWorker, nearbyResources, resourceLabel, garrisonCount };
            }
        }

        this.scene.game.events.emit(EVENTS.UPDATE_STATS, stats);
    }
}
