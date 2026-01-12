
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, Resources, UnitState, MapMode, BuildingDef } from '../../types';
import { BUILDINGS } from '../../constants';

interface BlueprintItem {
    type: BuildingType;
    x: number;
    y: number;
}

const AI_BLUEPRINT: BlueprintItem[] = [
    { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
    { type: BuildingType.HOUSE, x: -80, y: 0 },
    { type: BuildingType.HOUSE, x: 80, y: 0 },
    { type: BuildingType.HOUSE, x: 0, y: -80 },
    { type: BuildingType.HOUSE, x: 0, y: 80 },
    { type: BuildingType.LUMBER_CAMP, x: -150, y: -150 },
    { type: BuildingType.LUMBER_CAMP, x: 150, y: 150 },
    { type: BuildingType.FARM, x: 150, y: -150 },
    { type: BuildingType.FARM, x: -150, y: 150 },
    { type: BuildingType.BARRACKS, x: 100, y: 100 },
    { type: BuildingType.BARRACKS, x: -100, y: -100 },
    { type: BuildingType.BONFIRE, x: 250, y: 0 },
    { type: BuildingType.BONFIRE, x: -250, y: 0 },
    { type: BuildingType.BONFIRE, x: 0, y: 250 },
    { type: BuildingType.BONFIRE, x: 0, y: -250 },
];

export class EnemyAISystem {
    private scene: MainScene;

    // AI State
    private resources: Resources = { wood: 500, food: 500, gold: 500 };
    private baseX: number = 200;
    private baseY: number = 200;
    private buildings: (Phaser.GameObjects.GameObject | null)[] = new Array(AI_BLUEPRINT.length).fill(null);

    // Personality
    private aggressionThreshold = 8;
    private unitPreference = UnitType.PIKESMAN;
    private attackTarget: Phaser.GameObjects.GameObject | null = null; // Changed to GameObject for Entity targeting

    private lastTick: number = 0;
    private buildIndex: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;

        if (this.scene.mapMode === MapMode.INFINITE) {
            // Spawn far away in infinite mode
            this.baseX = 4000;
            this.baseY = 4000;
        } else {
            // Fixed mode: Player is at center (e.g. 1024,1024), spawn enemy at top-left
            this.baseX = this.scene.mapWidth * 0.15;
            this.baseY = this.scene.mapHeight * 0.15;
        }
    }

    public update(time: number, _delta: number) {
        if (this.scene.aiDisabled) return;

        // Tick AI logic every 1s
        if (time - this.lastTick > 1000) {
            this.tickAI();
            this.lastTick = time;
        }
    }

    private tickAI() {
        this.tickEconomy();
        this.tickBuild();
        this.tickRecruit();
        this.tickAttack();
    }

    private tickEconomy() {
        this.resources.wood += 20;
        this.resources.food += 20;
        this.resources.gold += 10;
    }

    private tickBuild() {
        for (let i = 0; i <= Math.min(this.buildIndex, AI_BLUEPRINT.length - 1); i++) {
            const existing = this.buildings[i];
            if (existing && !existing.scene) {
                this.buildings[i] = null;
            }

            if (!this.buildings[i]) {
                this.tryConstruct(i);
                if (i < this.buildIndex) return;
            }
        }

        if (this.buildings[this.buildIndex] && this.buildIndex < AI_BLUEPRINT.length - 1) {
            this.buildIndex++;
        }
    }

    private tryConstruct(index: number) {
        const item = AI_BLUEPRINT[index];
        const def = BUILDINGS[item.type];

        if (this.canAfford(def.cost)) {
            const bx = this.baseX + item.x;
            const by = this.baseY + item.y;

            this.resources.wood -= def.cost.wood;
            this.resources.food -= def.cost.food;
            this.resources.gold -= def.cost.gold;

            const b = this.scene.entityFactory.spawnBuilding(item.type, bx, by, 1);
            this.buildings[index] = b;
        }
    }

    private tickRecruit() {
        const hasBarracks = this.buildings.some(b => b && b.scene && (b.getData('def') as BuildingDef).type === BuildingType.BARRACKS);
        if (!hasBarracks) return;

        if (this.resources.food >= 100 && this.resources.gold >= 50) {
            this.resources.food -= 100;
            this.resources.gold -= 50;

            const spawnX = this.baseX + Phaser.Math.Between(-50, 50);
            const spawnY = this.baseY + Phaser.Math.Between(-50, 50);

            this.scene.entityFactory.spawnUnit(this.unitPreference, spawnX, spawnY, 1);
        }
    }

    private tickAttack() {
        // DIPLOMACY CHECKS
        // Strictly check boolean true
        if (this.scene.peacefulMode === true) return;

        // Check treaty timer
        if (this.scene.gameTime < this.scene.treatyLength) return;

        // Get all AI units
        const mySoldiers = this.scene.units.getChildren().filter((u) => u.getData('owner') === 1 && (u.getData('def') && (u.getData('def') as any).isMilitary)) as Phaser.GameObjects.GameObject[]; // eslint-disable-line @typescript-eslint/no-explicit-any

        const readyToAttack = mySoldiers.length >= this.aggressionThreshold;

        if (readyToAttack) {
            // Find Target (Player Town Center or any building)
            if (!this.attackTarget || !this.attackTarget.scene) {
                const playerTC = this.scene.buildings.getChildren().find((b) => {
                    return b.getData('owner') === 0 && b.getData('def').type === BuildingType.TOWN_CENTER;
                });

                if (playerTC) {
                    this.attackTarget = playerTC;

                    const leader = mySoldiers[0] as Phaser.GameObjects.Image;
                    this.scene.feedbackSystem.showFloatingText(leader.x, leader.y, "The Boar: CRUSH THEM!", "#ef4444");
                } else {
                    this.attackTarget = this.findAttackTarget();
                }
            }

            if (this.attackTarget && this.attackTarget.scene) {
                // Command all idle units to attack
                const idleTroops = mySoldiers.filter((u) => (u as unknown as { state: UnitState }).state === UnitState.IDLE);
                if (idleTroops.length > 0) {
                    this.scene.unitSystem.commandAttack(idleTroops, this.attackTarget);
                }
            }
        } else {
            if (mySoldiers.length < 2) {
                this.attackTarget = null;
            }
        }
    }

    private findAttackTarget(): Phaser.GameObjects.GameObject | null {
        const enemyUnits = this.scene.units.getChildren().filter((u) => u.getData('owner') === 0);
        if (enemyUnits.length > 0) {
            return enemyUnits[Phaser.Math.Between(0, enemyUnits.length - 1)];
        }

        const enemyBuildings = this.scene.buildings.getChildren().filter((b) => b.getData('owner') === 0);
        if (enemyBuildings.length > 0) {
            return enemyBuildings[Phaser.Math.Between(0, enemyBuildings.length - 1)];
        }
        return null;
    }

    private canAfford(cost: { wood: number, food: number, gold: number }): boolean {
        return this.resources.wood >= cost.wood &&
            this.resources.food >= cost.food &&
            this.resources.gold >= cost.gold;
    }

    public getDebugInfo(): string {
        const armySize = this.scene.units.getChildren().filter((u) => u.getData('owner') === 1).length;
        const target = this.attackTarget ? (this.attackTarget.getData('def') ? (this.attackTarget.getData('def') as BuildingDef).type : 'Unit') : 'None';
        return `Res: ${this.resources.wood}/${this.resources.food} | Army: ${armySize} | Target: ${target} | State: ${this.buildIndex}/${AI_BLUEPRINT.length}`;
    }
}
