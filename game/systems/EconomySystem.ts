
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, BuildingDef, UnitState, UnitType, GameStats, ResourceRates } from '../../types';
import { EVENTS } from '../../constants';

export class EconomySystem {
    private scene: MainScene;
    private lastRates: ResourceRates = { wood: 0, food: 0, gold: 0, foodConsumption: 0 };
    private lastHappinessChange: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public tickPopulation() {
        // Only manage Player population (Owner 0)
        if (this.scene.population < this.scene.maxPopulation && this.scene.happiness > 50) {
            const houses = this.scene.buildings.getChildren().filter((b: any) =>
                b.getData('def').type === BuildingType.HOUSE && b.getData('owner') === 0
            ) as Phaser.GameObjects.Rectangle[];

            let spawnSource = null;
            if (houses.length > 0) {
                spawnSource = houses[Phaser.Math.Between(0, houses.length - 1)];
            } else {
                const townCenters = this.scene.buildings.getChildren().filter((b: any) =>
                    b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
                ) as Phaser.GameObjects.Rectangle[];
                if (townCenters.length > 0) spawnSource = townCenters[0];
            }

            if (spawnSource) {
                const offsetX = Phaser.Math.Between(-30, 30);
                const offsetY = Phaser.Math.Between(-30, 30);
                const spawnX = spawnSource.x + (offsetX >= 0 ? 50 : -50) + offsetX;
                const spawnY = spawnSource.y + (offsetY >= 0 ? 50 : -50) + offsetY;

                this.scene.entityFactory.spawnUnit(UnitType.VILLAGER, spawnX, spawnY, 0);
                this.scene.events.emit('message', "A new peasant has arrived.");
            }
        }
    }

    public assignJobs() {
        const vacantBuildings = this.scene.buildings.getChildren().filter((b: any) => {
            const def = b.getData('def') as BuildingDef;
            const assignedWorker = b.getData('assignedWorker');
            return def.workerNeeds && !assignedWorker;
        });

        let idleVillagers = this.scene.units.getChildren().filter((u: any) => {
            return u.unitType === UnitType.VILLAGER && (u.state === UnitState.IDLE || u.state === UnitState.MOVING_TO_RALLY);
        }) as Phaser.GameObjects.GameObject[];

        for (const building of vacantBuildings) {
            if (idleVillagers.length === 0) break;

            const b = building as any;
            const buildingOwner = b.getData('owner');

            let closestWorker = null;
            let minDist = Number.MAX_VALUE;
            let workerIndex = -1;

            for (let i = 0; i < idleVillagers.length; i++) {
                const u = idleVillagers[i] as any;

                // STRICT OWNERSHIP CHECK: Only assign villagers to buildings of the same owner
                if (u.getData('owner') !== buildingOwner) continue;

                const dist = Phaser.Math.Distance.Between(b.x, b.y, u.x, u.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestWorker = u;
                    workerIndex = i;
                }
            }

            if (closestWorker) {
                idleVillagers.splice(workerIndex, 1);
                b.setData('assignedWorker', closestWorker);
                (closestWorker as any).state = UnitState.MOVING_TO_WORK;
                (closestWorker as any).jobBuilding = b;

                const path = this.scene.pathfinder.findPath(new Phaser.Math.Vector2((closestWorker as any).x, (closestWorker as any).y), new Phaser.Math.Vector2(b.x, b.y));
                if (path) {
                    (closestWorker as any).path = path;
                    (closestWorker as any).pathStep = 0;
                }
            }
        }

        // Re-filter idle villagers to those who are still truly idle and job-less
        const remainingIdle = this.scene.units.getChildren().filter((u: any) => {
            return u.unitType === UnitType.VILLAGER && u.state === UnitState.IDLE && !u.jobBuilding;
        });

        if (remainingIdle.length > 0) {
            const allBonfires = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.BONFIRE) as Phaser.GameObjects.Rectangle[];

            if (allBonfires.length > 0) {
                remainingIdle.forEach((u: any) => {
                    const owner = u.getData('owner');
                    // Filter bonfires by OWNER
                    const myBonfires = allBonfires.filter((b: any) => b.getData('owner') === owner);

                    if (myBonfires.length > 0) {
                        let closestBonfire = myBonfires[0];
                        let minDistance = Number.MAX_VALUE;
                        for (const bonfire of myBonfires) {
                            const d = Phaser.Math.Distance.Between(u.x, u.y, bonfire.x, bonfire.y);
                            if (d < minDistance) {
                                minDistance = d;
                                closestBonfire = bonfire;
                            }
                        }
                        const rallyPoint = closestBonfire;
                        // Only move if far away
                        if (minDistance > 100) {
                            u.state = UnitState.MOVING_TO_RALLY;
                            const angle = Math.random() * Math.PI * 2;
                            const r = Math.random() * 60 + 40;
                            const destX = rallyPoint.x + Math.cos(angle) * r;
                            const destY = rallyPoint.y + Math.sin(angle) * r;
                            const path = this.scene.pathfinder.findPath(new Phaser.Math.Vector2(u.x, u.y), new Phaser.Math.Vector2(destX, destY));
                            if (path) {
                                u.path = path;
                                u.pathStep = 0;
                            }
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

        const harvestedTrees = new Set<Phaser.GameObjects.GameObject>();

        this.scene.buildings.getChildren().forEach((b: any) => {
            // STRICT OWNERSHIP CHECK: Only process PLAYER buildings for player economy
            if (b.getData('owner') !== 0) return;

            const def = b.getData('def') as BuildingDef;
            const visual = b.visual as Phaser.GameObjects.Container;
            const vacantIcon = visual.getData('vacantIcon') as Phaser.GameObjects.Text;
            const noResIcon = visual.getData('noResIcon') as Phaser.GameObjects.Text;

            let isWorking = true;
            let productionAmount = 0;
            let productionType = '';

            if (def.workerNeeds) {
                const worker = b.getData('assignedWorker');
                if (worker && worker.state === UnitState.WORKING) {
                    if (vacantIcon) vacantIcon.visible = false;
                } else {
                    isWorking = false;
                    if (vacantIcon) vacantIcon.visible = true;
                }
            }

            if (def.type === BuildingType.TOWN_CENTER) {
                goldGen += Math.floor(2 * efficiency);
                isWorking = true;
            }

            if (isWorking) {
                if (def.type === BuildingType.FARM) {
                    let gain = 5;
                    const isFertile = this.scene.fertileZones.some(zone => zone.contains(b.x, b.y));
                    if (isFertile) gain = Math.floor(gain * 1.5);
                    gain = Math.floor(gain * efficiency);
                    foodGen += gain;
                    productionAmount = gain;
                    productionType = 'Food';
                }

                if (def.type === BuildingType.LUMBER_CAMP && def.effectRadius) {
                    let treesNearby = 0;
                    // Optimize: Use Spatial Partitioning
                    const candidates = this.scene.treeSpatialHash.query(b.x, b.y, def.effectRadius);

                    for (const t of candidates) {
                        if (Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y) < def.effectRadius) {
                            const isChopped = t.getData('isChopped');
                            if (!isChopped && !harvestedTrees.has(t)) {
                                treesNearby++;
                                harvestedTrees.add(t);
                                if (Math.random() < 0.1) {
                                    this.scene.entityFactory.updateTreeVisual(t, true);
                                    // if (this.scene.minimapSystem) this.scene.minimapSystem.refreshStaticLayer();
                                    this.scene.showFloatingText(t.x, t.y, "Chopped!", "#a0522d");
                                }
                            }
                        }
                    }
                    if (noResIcon) noResIcon.visible = (treesNearby === 0);
                    let gain = Math.min(treesNearby * 2, 12);
                    gain = Math.floor(gain * efficiency);
                    woodGen += gain;
                    if (gain > 0) {
                        productionAmount = gain;
                        productionType = 'Wood';
                    }
                }

                if (def.type === BuildingType.HUNTERS_LODGE && def.effectRadius) {
                    let animals = this.scene.units.getChildren().filter((u: any) => {
                        return u.unitType === UnitType.ANIMAL && Phaser.Math.Distance.Between(b.x, b.y, u.x, u.y) < def.effectRadius!;
                    });
                    const animalsNearby = animals.length;
                    if (noResIcon) noResIcon.visible = (animalsNearby === 0);
                    if (animalsNearby > 0) {
                        let gain = 20;
                        gain = Math.floor(gain * efficiency);
                        foodGen += gain;
                        productionAmount = gain;
                        productionType = 'Food';
                        if (Math.random() < 0.20) {
                            const victim = animals[Phaser.Math.Between(0, animalsNearby - 1)];
                            const victimVisual = (victim as any).visual;
                            if (victimVisual) victimVisual.destroy();
                            victim.destroy();
                            this.scene.showFloatingText(b.x, b.y - 30, "Depleted!", "#ef4444");
                        }
                    }
                }
            }
            if (productionAmount > 0) {
                this.scene.showFloatingResource(b.x, b.y, productionAmount, productionType);
            }
        });

        if (goldGen > 0) {
            const tcs = this.scene.buildings.getChildren().filter((b: any) =>
                b.getData('def').type === BuildingType.TOWN_CENTER && b.getData('owner') === 0
            ) as Phaser.GameObjects.Rectangle[];
            if (tcs.length > 0) {
                this.scene.showFloatingResource(tcs[0].x, tcs[0].y, goldGen, 'Gold');
            }
        }

        const foodConsumed = this.scene.population * 1;
        this.lastRates = { wood: woodGen, food: foodGen, gold: goldGen, foodConsumption: foodConsumed };
        this.scene.resources.food += foodGen;
        this.scene.resources.wood += woodGen;
        this.scene.resources.gold += goldGen;
        this.scene.resources.food -= foodConsumed;
        if (this.scene.resources.food < 0) this.scene.resources.food = 0;

        let happinessChange = 0;
        const isStarving = this.scene.resources.food === 0 && foodConsumed > 0;
        if (isStarving) { happinessChange -= 5; } else { happinessChange += 1; }
        if (this.scene.population > this.scene.maxPopulation) { happinessChange -= 2; }
        const taxImpact = [1, 0, -1, -3, -6, -10];
        happinessChange += (taxImpact[this.scene.taxRate] || 0);

        // Count ONLY player parks
        const parks = this.scene.buildings.getChildren().filter((b: any) =>
            b.getData('def').type === BuildingType.SMALL_PARK && b.getData('owner') === 0
        );
        happinessChange += parks.length;

        this.scene.happiness += happinessChange;
        this.scene.happiness = Phaser.Math.Clamp(this.scene.happiness, 0, 100);
        this.lastHappinessChange = happinessChange;
        this.updateStats();
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
            treatyTimeRemaining: remainingTreaty
        };
        this.scene.game.events.emit(EVENTS.UPDATE_STATS, stats);
    }
}
