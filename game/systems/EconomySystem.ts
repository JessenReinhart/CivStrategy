

import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, BuildingDef, UnitState, UnitType, GameStats } from '../../types';
import { EVENTS } from '../../constants';

export class EconomySystem {
    private scene: MainScene;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public tickPopulation() {
        if (this.scene.population < this.scene.maxPopulation && this.scene.happiness > 50) {
            // Spawn from Houses preferentially
            const houses = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.HOUSE) as Phaser.GameObjects.Rectangle[];
            
            let spawnSource = null;
            if (houses.length > 0) {
                spawnSource = houses[Phaser.Math.Between(0, houses.length - 1)];
            } else {
                 // Fallback to Town Center
                 const townCenters = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER) as Phaser.GameObjects.Rectangle[];
                 if (townCenters.length > 0) spawnSource = townCenters[0];
            }
  
            if (spawnSource) {
                const offsetX = Phaser.Math.Between(-30, 30);
                const offsetY = Phaser.Math.Between(-30, 30);
                const spawnX = spawnSource.x + (offsetX >= 0 ? 50 : -50) + offsetX;
                const spawnY = spawnSource.y + (offsetY >= 0 ? 50 : -50) + offsetY;
                
                this.scene.entityFactory.spawnUnit(UnitType.VILLAGER, spawnX, spawnY);
                this.scene.events.emit('message', "A new peasant has arrived.");
            }
        }
    }

    public assignJobs() {
        // 1. Assign Jobs
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
            
            let closestWorker = null;
            let minDist = Number.MAX_VALUE;
            let workerIndex = -1;
  
            for (let i = 0; i < idleVillagers.length; i++) {
                const u = idleVillagers[i] as any;
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
  
        // 2. Send remaining Idle to Bonfire (Rally Point)
        const remainingIdle = this.scene.units.getChildren().filter((u: any) => {
          return u.unitType === UnitType.VILLAGER && u.state === UnitState.IDLE && !u.jobBuilding;
        });
  
        if (remainingIdle.length > 0) {
          const bonfires = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.BONFIRE) as Phaser.GameObjects.Rectangle[];
          
          if (bonfires.length > 0) {
               remainingIdle.forEach((u: any) => {
                   // Find nearest bonfire for this specific unit
                   let closestBonfire = bonfires[0];
                   let minDistance = Number.MAX_VALUE;

                   for (const bonfire of bonfires) {
                       const d = Phaser.Math.Distance.Between(u.x, u.y, bonfire.x, bonfire.y);
                       if (d < minDistance) {
                           minDistance = d;
                           closestBonfire = bonfire;
                       }
                   }

                   const rallyPoint = closestBonfire;

                   if (minDistance > 100) { // Only move if far away
                       u.state = UnitState.MOVING_TO_RALLY;
                       // Add some randomness to destination around fire
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
               });
          }
        }
    }

    public tickEconomy() {
        let baseHappiness = 100;
        let happinessModifiers = 0;
        
        // Overcrowding
        if (this.scene.population > this.scene.maxPopulation) happinessModifiers -= 10;
        
        // Tax Impact
        // Rate: 0=0, 1=1g/pop (-2hap), 2=2g/pop (-4hap), 3=3g/pop (-8hap), 4=4g/pop (-16hap), 5=5g/pop (-32hap)
        const taxMap = [0, 2, 4, 8, 16, 32];
        const taxGoldPerPop = this.scene.taxRate;
        const taxHappinessPenalty = taxMap[this.scene.taxRate] || 0;
        
        happinessModifiers -= taxHappinessPenalty;
        
        let foodGen = 0;
        let woodGen = 0;
        let goldGen = (this.scene.population * taxGoldPerPop); // Tax Income

        // Park Happiness
        const parks = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.SMALL_PARK);
        happinessModifiers += (parks.length * 5);

        // Track harvested trees to prevent double counting
        const harvestedTrees = new Set<Phaser.GameObjects.GameObject>();

        this.scene.buildings.getChildren().forEach((b: any) => {
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
                goldGen += 2; 
                isWorking = true;
            }
    
            if (isWorking) {
                if (def.type === BuildingType.FARM) {
                    let gain = 5;
                    const isFertile = this.scene.fertileZones.some(zone => zone.contains(b.x, b.y));
                    if (isFertile) gain = Math.floor(gain * 1.5);

                    foodGen += gain;
                    productionAmount = gain;
                    productionType = 'Food';
                }
                
                // Lumber Camp
                if (def.type === BuildingType.LUMBER_CAMP && def.effectRadius) {
                    let treesNearby = 0;
                    this.scene.trees.getChildren().forEach((t: any) => {
                        if (Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y) < def.effectRadius!) {
                            const isChopped = t.getData('isChopped');
                            
                            // Check if tree is available and not already claimed this tick
                            if (!isChopped && !harvestedTrees.has(t)) {
                                treesNearby++;
                                harvestedTrees.add(t);
                                
                                // Depletion Logic: 10% chance to chop down tree per tick
                                if (Math.random() < 0.1) {
                                    this.scene.entityFactory.updateTreeVisual(t, true);
                                    this.scene.showFloatingText(t.x, t.y, "Chopped!", "#a0522d");
                                }
                            }
                        }
                    });

                    if (noResIcon) noResIcon.visible = (treesNearby === 0);
                    
                    const gain = Math.min(treesNearby * 2, 12);
                    woodGen += gain;
                    if (gain > 0) {
                        productionAmount = gain;
                        productionType = 'Wood';
                    }
                }

                // Hunter's Lodge
                if (def.type === BuildingType.HUNTERS_LODGE && def.effectRadius) {
                    let animals = this.scene.units.getChildren().filter((u: any) => {
                        return u.unitType === UnitType.ANIMAL && Phaser.Math.Distance.Between(b.x, b.y, u.x, u.y) < def.effectRadius!;
                    });
                    
                    const animalsNearby = animals.length;

                    if (noResIcon) noResIcon.visible = (animalsNearby === 0);

                    if (animalsNearby > 0) {
                        const gain = 20; 
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
        
        // Apply Tax Gold Floating Text on Town Centers (Abstract representation of collecting taxes)
        if (goldGen > 0) {
             const tcs = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER) as Phaser.GameObjects.Rectangle[];
             if (tcs.length > 0) {
                 // Show accumulated gold on the first TC
                 this.scene.showFloatingResource(tcs[0].x, tcs[0].y, goldGen, 'Gold');
             }
        }
    
        this.scene.resources.food += foodGen;
        this.scene.resources.wood += woodGen;
        this.scene.resources.gold += goldGen;
    
        const foodConsumed = this.scene.population * 1;
        this.scene.resources.food -= foodConsumed;
    
        if (this.scene.resources.food < 0) {
            this.scene.resources.food = 0;
            happinessModifiers -= 10; // Starvation penalty
        } else {
            happinessModifiers += 5; // Well fed bonus
        }
    
        this.scene.happiness = Phaser.Math.Clamp(baseHappiness + happinessModifiers, 0, 100);
        this.updateStats();
    }

    public updateStats() {
        const stats: GameStats = {
            population: this.scene.population,
            maxPopulation: this.scene.maxPopulation,
            happiness: this.scene.happiness,
            resources: { ...this.scene.resources },
            taxRate: this.scene.taxRate
        };
        this.scene.game.events.emit(EVENTS.UPDATE_STATS, stats);
    }
}