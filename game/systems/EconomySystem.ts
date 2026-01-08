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
            const townCenters = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER) as Phaser.GameObjects.Rectangle[];
            
            if (townCenters.length === 0) return;
  
            let spawnTC = townCenters[0];
            const vacantBuildings = this.scene.buildings.getChildren().filter((b: any) => {
                const def = b.getData('def') as BuildingDef;
                const assignedWorker = b.getData('assignedWorker');
                return def.workerNeeds && !assignedWorker;
            });
  
            if (vacantBuildings.length > 0) {
                let bestScore = Number.MAX_VALUE;
                for (const tc of townCenters) {
                    for (const b of vacantBuildings) {
                        const dist = Phaser.Math.Distance.Between(tc.x, tc.y, (b as any).x, (b as any).y);
                        if (dist < bestScore) {
                            bestScore = dist;
                            spawnTC = tc;
                        }
                    }
                }
            } else {
               spawnTC = townCenters[Phaser.Math.Between(0, townCenters.length - 1)];
            }
  
            if (spawnTC) {
                const offsetX = Phaser.Math.Between(-30, 30);
                const offsetY = Phaser.Math.Between(-30, 30);
                const spawnX = spawnTC.x + (offsetX >= 0 ? 60 : -60) + offsetX;
                const spawnY = spawnTC.y + (offsetY >= 0 ? 60 : -60) + offsetY;
                
                this.scene.entityFactory.spawnUnit(UnitType.VILLAGER, spawnX, spawnY);
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
            return u.unitType === UnitType.VILLAGER && u.state === UnitState.IDLE;
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
  
        const remainingIdle = this.scene.units.getChildren().filter((u: any) => {
          return u.unitType === UnitType.VILLAGER && u.state === UnitState.IDLE && !u.jobBuilding;
        });
  
        if (remainingIdle.length > 0) {
          const townCenters = this.scene.buildings.getChildren().filter((b: any) => b.getData('def').type === BuildingType.TOWN_CENTER) as Phaser.GameObjects.Rectangle[];
          
          if (townCenters.length > 0) {
               remainingIdle.forEach((u: any) => {
                   let closestTC = townCenters[0];
                   let minDist = Number.MAX_VALUE;
                   
                   townCenters.forEach(tc => {
                      const d = Phaser.Math.Distance.Between(u.x, u.y, tc.x, tc.y);
                      if (d < minDist) {
                          minDist = d;
                          closestTC = tc;
                      }
                   });
  
                   if (minDist > 150) {
                       u.state = UnitState.MOVING_TO_RALLY;
                       const path = this.scene.pathfinder.findPath(new Phaser.Math.Vector2(u.x, u.y), new Phaser.Math.Vector2(closestTC.x, closestTC.y));
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
        let happinessChange = 0;
        
        if (this.scene.population > this.scene.maxPopulation) happinessChange -= 10;
        
        let foodGen = 0;
        let woodGen = 0;
        let goldGen = 0;
    
        this.scene.buildings.getChildren().forEach((b: any) => {
            const def = b.getData('def') as BuildingDef;
            const visual = b.visual as Phaser.GameObjects.Container;
            const vacantIcon = visual.getData('vacantIcon') as Phaser.GameObjects.Text;
            const noResIcon = visual.getData('noResIcon') as Phaser.GameObjects.Text;
    
            let isWorking = true;
            
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
                if (def.type === BuildingType.FARM) foodGen += 5;
                
                if (def.type === BuildingType.LUMBER_CAMP && def.effectRadius) {
                    let treesNearby = 0;
                    this.scene.trees.getChildren().forEach((t: any) => {
                        if (Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y) < def.effectRadius!) {
                            treesNearby++;
                        }
                    });

                    // Update Inefficiency Icon
                    if (noResIcon) {
                        noResIcon.visible = (treesNearby === 0);
                    }
                    
                    woodGen += Math.min(treesNearby * 2, 12);
                }
            }
        });
    
        this.scene.resources.food += foodGen;
        this.scene.resources.wood += woodGen;
        this.scene.resources.gold += goldGen;
    
        const foodConsumed = this.scene.population * 1;
        this.scene.resources.food -= foodConsumed;
    
        if (this.scene.resources.food < 0) {
            this.scene.resources.food = 0;
            happinessChange -= 5;
        } else {
            happinessChange += 1;
        }
    
        this.scene.happiness = Phaser.Math.Clamp(this.scene.happiness + happinessChange, 0, 100);
        this.updateStats();
    }

    public updateStats() {
        const stats: GameStats = {
            population: this.scene.population,
            maxPopulation: this.scene.maxPopulation,
            happiness: this.scene.happiness,
            resources: { ...this.scene.resources }
        };
        this.scene.game.events.emit(EVENTS.UPDATE_STATS, stats);
    }
}