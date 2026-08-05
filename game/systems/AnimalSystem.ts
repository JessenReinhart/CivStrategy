import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { AnimalData, AnimalSpecies, UnitState } from '../../types';
import { toIsoElev } from '../utils/iso';
import { MAP_WIDTH, MAP_HEIGHT, ANIMAL_SPECIES_STATS, SEASON_CONFIG } from '../../constants';

// ─── Constants ───────────────────────────────────────────────────────────
const MAX_PER_FRAME = 40;
const WANDER_CHANCE = 0.005;
const WANDER_RADIUS = 120;
const WANDER_ARRIVE_DIST_SQ = 64;        // 8²
const ATTACK_COOLDOWN_MS = 1000;
const DEATH_FADE_MS = 500;
const FLEE_SPEED_MULT = 1.3;
const HERD_FLEE_RADIUS_SQ = 90000;       // 300²
const HERD_JOIN_RADIUS_SQ = 40000;       // 200²
const BREED_NEARBY_RADIUS_SQ = 40000;    // 200²
const BREED_OFFSET = 50;
const HUNT_RADIUS = 200;
const RESPAWN_CHECK_MS = 30_000;          // check every 30 seconds
const RESPAWN_THRESHOLD = 3;              // respawn when species drops below this
const DEAD = 'dead' as UnitState;

const IS_WOLF_PREY: Record<AnimalSpecies, boolean> = {
  [AnimalSpecies.DEER]: true,
  [AnimalSpecies.RABBIT]: true,
  [AnimalSpecies.WOLF]: false,
  [AnimalSpecies.BOAR]: false,
};

const MAX_POPULATION: Record<AnimalSpecies, number> = {
  [AnimalSpecies.DEER]: 30,
  [AnimalSpecies.WOLF]: 8,
  [AnimalSpecies.BOAR]: 10,
  [AnimalSpecies.RABBIT]: 40,
};

const SPECIES_WEIGHTS: { species: AnimalSpecies; weight: number }[] = [
  { species: AnimalSpecies.DEER, weight: 40 },
  { species: AnimalSpecies.RABBIT, weight: 30 },
  { species: AnimalSpecies.BOAR, weight: 20 },
  { species: AnimalSpecies.WOLF, weight: 10 },
];

// ─── AnimalSystem ────────────────────────────────────────────────────────

type UnitFilter = 'player' | 'nonNeutral';

export class AnimalSystem {
  private scene: MainScene;
  private animals: AnimalData[] = [];
  private nextId = 0;
  private herdCounter = 0;
  private updateOffset = 0;
  private respawnTimer = 0;

  constructor(scene: MainScene) {
    this.scene = scene;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  public spawnAnimal(x: number, y: number, species?: AnimalSpecies): AnimalData {
    if (!species) {
      const roll = Math.random() * 100;
      let cumulative = 0;
      species = AnimalSpecies.DEER;
      for (const entry of SPECIES_WEIGHTS) {
        cumulative += entry.weight;
        if (roll < cumulative) { species = entry.species; break; }
      }
    }

    const stats = ANIMAL_SPECIES_STATS[species];
    const id = `animal_${this.nextId++}`;
    const herdId = this.assignHerdId(x, y, species);

    const animal: AnimalData = {
      id, x, y,
      state: UnitState.IDLE,
      species,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      speed: stats.speed,
      owner: -1,
      fearRange: stats.fearRange,
      attackRange: stats.attackRange,
      attackDamage: stats.attackDamage,
      foodValue: stats.foodValue,
      herdId,
      breedCooldown: stats.breedCooldownMs,
    };

    animal.visual = this.createVisual(animal);
    this.animals.push(animal);
    return animal;
  }

  public update(_time: number, delta: number): void {
    const len = this.animals.length;

    if (len > 0) {
      const count = Math.min(len, MAX_PER_FRAME);
      for (let i = 0; i < count; i++) {
        const idx = (this.updateOffset + i) % len;
        const animal = this.animals[idx];
        if (animal.state === DEAD) continue;

        if (animal.state === UnitState.WANDERING) {
          this.updateWandering(animal, delta);
        } else {
          this.tickBreeding(animal, delta);
          const species = animal.species;
          if (species === AnimalSpecies.WOLF) {
            this.updateWolf(animal, delta);
          } else if (species === AnimalSpecies.BOAR) {
            this.updateBoar(animal, delta);
          } else {
            this.updatePrey(animal, delta);
          }
        }

        this.syncVisual(animal);
      }
      this.updateOffset = (this.updateOffset + count) % Math.max(len, 1);
    }

    // ─── Respawn check (runs even when all animals are dead) ─────────
    this.respawnTimer += delta;
    if (this.respawnTimer >= RESPAWN_CHECK_MS) {
      this.respawnTimer = 0;
      this.tickRespawn();
    }
  }

  public getAnimals(): AnimalData[] {
    return this.animals;
  }

  public getAnimalsBySpecies(species: AnimalSpecies): AnimalData[] {
    return this.animals.filter(a => a.species === species && a.hp > 0);
  }

  public destroyAnimal(animal: AnimalData): void {
    const idx = this.animals.indexOf(animal);
    if (idx !== -1) this.animals.splice(idx, 1);
    if (animal.visual) {
      animal.visual.destroy();
      animal.visual = undefined;
    }
  }

  public takeDamage(animal: AnimalData, amount: number): void {
    if (animal.hp <= 0) return;
    animal.hp -= amount;
    if (animal.hp <= 0) this.killAnimal(animal);
  }

  // ─── Prey (Deer / Rabbit) ────────────────────────────────────────────

  private updatePrey(animal: AnimalData, delta: number): void {
    const threat = this.findNearestUnit(animal, animal.fearRange, 'player');
    if (threat) {
      this.startFleeing(animal, threat.x, threat.y);
      return;
    }

    if (animal.state === UnitState.CHASING) {
      if (animal.wanderDest) {
        this.moveToward(animal, animal.wanderDest, delta, FLEE_SPEED_MULT);
        const dx = animal.x - animal.wanderDest.x;
        const dy = animal.y - animal.wanderDest.y;
        if (dx * dx + dy * dy < WANDER_ARRIVE_DIST_SQ) {
          animal.state = UnitState.IDLE;
          animal.wanderDest = undefined;
        }
      } else {
        animal.state = UnitState.IDLE;
      }
      return;
    }

    if (animal.state === UnitState.IDLE && Math.random() < WANDER_CHANCE) {
      this.startWandering(animal);
    }
  }

  private startFleeing(animal: AnimalData, threatX: number, threatY: number): void {
    const dx = animal.x - threatX;
    const dy = animal.y - threatY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    animal.wanderDest = new Phaser.Math.Vector2(
      Phaser.Math.Clamp(animal.x + (dx / dist) * WANDER_RADIUS * 1.5, 0, MAP_WIDTH),
      Phaser.Math.Clamp(animal.y + (dy / dist) * WANDER_RADIUS * 1.5, 0, MAP_HEIGHT),
    );
    animal.state = UnitState.CHASING;

    // Alert herd
    if (animal.herdId >= 0) {
      for (const other of this.animals) {
        if (other === animal || other.herdId !== animal.herdId) continue;
        if (other.hp <= 0 || other.state === DEAD) continue;
        const ddx = other.x - animal.x;
        const ddy = other.y - animal.y;
        if (ddx * ddx + ddy * ddy < HERD_FLEE_RADIUS_SQ && other.state !== UnitState.CHASING) {
          this.startFleeing(other, threatX, threatY);
        }
      }
    }
  }

  // ─── Wolf ────────────────────────────────────────────────────────────

  private updateWolf(animal: AnimalData, delta: number): void {
    // Attack player units in range
    const playerTarget = this.findNearestUnit(animal, animal.attackRange, 'player');
    if (playerTarget) { this.attackUnitTarget(animal, playerTarget, delta); return; }

    // Hunt prey
    const prey = this.findNearestPrey(animal, HUNT_RADIUS);
    if (prey) {
      const dx = prey.x - animal.x;
      const dy = prey.y - animal.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= animal.attackRange * animal.attackRange) {
        this.attackAnimalTarget(animal, prey, delta);
      } else {
        animal.state = UnitState.CHASING;
        this.moveToward(animal, prey, delta, 1.0);
      }
      return;
    }

    // Nothing to do: wander
    if (animal.state === UnitState.CHASING) {
      animal.state = UnitState.IDLE;
      animal.wanderDest = undefined;
    }
    if (animal.state === UnitState.IDLE && Math.random() < WANDER_CHANCE) {
      this.startWandering(animal);
    }
  }

  // ─── Boar ────────────────────────────────────────────────────────────

  private updateBoar(animal: AnimalData, delta: number): void {
    // Territorial: attack ANY non-neutral unit in range
    const target = this.findNearestUnit(animal, animal.attackRange, 'nonNeutral');
    if (target) { this.attackUnitTarget(animal, target, delta); return; }

    if (animal.state === UnitState.ATTACKING) animal.state = UnitState.IDLE;
    if (animal.state === UnitState.IDLE && Math.random() < WANDER_CHANCE) {
      this.startWandering(animal);
    }
  }

  // ─── Attack Logic ────────────────────────────────────────────────────

  /** Attack a GameUnit (player or non-neutral). Uses wanderDest.y as cooldown timer. */
  private attackUnitTarget(animal: AnimalData, target: Phaser.GameObjects.GameObject, delta: number): void {
    animal.state = UnitState.ATTACKING;
    const distSq = Phaser.Math.Distance.BetweenPointsSquared(animal, target);

    if (distSq > animal.attackRange * animal.attackRange) {
      this.moveToward(animal, target, delta, 1.0);
      return;
    }

    if (!animal.wanderDest) {
      animal.wanderDest = new Phaser.Math.Vector2(0, ATTACK_COOLDOWN_MS);
    }
    animal.wanderDest.y -= delta;
    if (animal.wanderDest.y <= 0) {
      animal.wanderDest.y = ATTACK_COOLDOWN_MS;
      // Route through combat pipeline (armor, health bar, death cleanup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const takeDamage = (target as any).takeDamage as ((amount: number) => void) | undefined;
      if (typeof takeDamage === 'function') {
        takeDamage(animal.attackDamage);
      }
    }
  }

  /** Attack another animal (wolf attacking prey). */
  private attackAnimalTarget(attacker: AnimalData, target: AnimalData, delta: number): void {
    attacker.state = UnitState.ATTACKING;

    if (!attacker.wanderDest) {
      attacker.wanderDest = new Phaser.Math.Vector2(0, ATTACK_COOLDOWN_MS);
    }
    attacker.wanderDest.y -= delta;
    if (attacker.wanderDest.y <= 0) {
      attacker.wanderDest.y = ATTACK_COOLDOWN_MS;
      this.takeDamage(target, attacker.attackDamage);
    }
  }

  // ─── Wandering ───────────────────────────────────────────────────────

  private startWandering(animal: AnimalData): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = WANDER_RADIUS * (0.5 + Math.random() * 0.5);
    animal.wanderDest = new Phaser.Math.Vector2(
      Phaser.Math.Clamp(animal.x + Math.cos(angle) * dist, 0, MAP_WIDTH),
      Phaser.Math.Clamp(animal.y + Math.sin(angle) * dist, 0, MAP_HEIGHT),
    );
    animal.state = UnitState.WANDERING;
  }

  private updateWandering(animal: AnimalData, delta: number): void {
    if (!animal.wanderDest) { animal.state = UnitState.IDLE; return; }

    // Prey check for threats mid-walk
    if (animal.fearRange > 0) {
      const threat = this.findNearestUnit(animal, animal.fearRange, 'player');
      if (threat) { this.startFleeing(animal, threat.x, threat.y); return; }
    }

    this.moveToward(animal, animal.wanderDest, delta, 1.0);
    const dx = animal.x - animal.wanderDest.x;
    const dy = animal.y - animal.wanderDest.y;
    if (dx * dx + dy * dy < WANDER_ARRIVE_DIST_SQ) {
      animal.state = UnitState.IDLE;
      animal.wanderDest = undefined;
    }
  }

  // ─── Movement ────────────────────────────────────────────────────────

  private moveToward(animal: AnimalData, dest: { x: number; y: number }, delta: number, speedMult: number): void {
    const dx = dest.x - animal.x;
    const dy = dest.y - animal.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const move = Math.min((animal.speed * speedMult * delta) / 1000, dist);
    animal.x = Phaser.Math.Clamp(animal.x + (dx / dist) * move, 0, MAP_WIDTH);
    animal.y = Phaser.Math.Clamp(animal.y + (dy / dist) * move, 0, MAP_HEIGHT);
  }

  // ─── Spatial Queries ─────────────────────────────────────────────────

  /**
   * Find nearest unit in spatial hash matching the filter.
   * 'player'   → owner === 0 (for prey fleeing / wolf hunting)
   * 'nonNeutral' → owner !== -1 (for boar territorial aggression)
   */
  private findNearestUnit(
    animal: AnimalData, range: number, filter: UnitFilter,
  ): Phaser.GameObjects.GameObject | null {
    const hash = this.scene.unitSpatialHash;
    if (!hash) return null;

    const nearby = hash.query(animal.x, animal.y, range);
    let bestDistSq = range * range;
    let best: Phaser.GameObjects.GameObject | null = null;

    for (const unit of nearby) {
      const owner = unit.getData?.('owner') as number | undefined;
      if (filter === 'player' && owner !== 0) continue;
      if (filter === 'nonNeutral' && (owner === undefined || owner === -1)) continue;
      const hp = unit.getData?.('hp') as number | undefined;
      if (hp !== undefined && hp <= 0) continue;

      const dx = unit.x - animal.x;
      const dy = unit.y - animal.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) { bestDistSq = d2; best = unit; }
    }
    return best;
  }

  private findNearestPrey(animal: AnimalData, range: number): AnimalData | null {
    let bestDistSq = range * range;
    let best: AnimalData | null = null;

    for (const other of this.animals) {
      if (other === animal || !IS_WOLF_PREY[other.species] || other.hp <= 0) continue;
      const dx = other.x - animal.x;
      const dy = other.y - animal.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) { bestDistSq = d2; best = other; }
    }
    return best;
  }

  private findNearbySameSpecies(animal: AnimalData): AnimalData | null {
    for (const other of this.animals) {
      if (other === animal || other.species !== animal.species || other.hp <= 0) continue;
      const dx = other.x - animal.x;
      const dy = other.y - animal.y;
      if (dx * dx + dy * dy < BREED_NEARBY_RADIUS_SQ) return other;
    }
    return null;
  }

  // ─── Breeding ────────────────────────────────────────────────────────

  private tickBreeding(animal: AnimalData, delta: number): void {
    if (animal.hp <= 0) return;

    const breedRate = SEASON_CONFIG[this.scene.currentSeason].breedRate;
    if (breedRate <= 0) return; // Winter: no breeding

    animal.breedCooldown -= delta * breedRate;
    if (animal.breedCooldown > 0) return;

    const speciesCount = this.animals.filter(a => a.species === animal.species && a.hp > 0).length;
    if (speciesCount >= MAX_POPULATION[animal.species]) {
      animal.breedCooldown = ANIMAL_SPECIES_STATS[animal.species].breedCooldownMs * 0.5;
      return;
    }

    const partner = this.findNearbySameSpecies(animal);
    if (partner) {
      const ox = (Math.random() - 0.5) * BREED_OFFSET * 2;
      const oy = (Math.random() - 0.5) * BREED_OFFSET * 2;
      this.spawnAnimal(
        Phaser.Math.Clamp(animal.x + ox, 0, MAP_WIDTH),
        Phaser.Math.Clamp(animal.y + oy, 0, MAP_HEIGHT),
        animal.species,
      );
      const cd = ANIMAL_SPECIES_STATS[animal.species].breedCooldownMs;
      animal.breedCooldown = cd;
      partner.breedCooldown = cd * 0.75;
    }
  }

  // ─── Respawn ──────────────────────────────────────────────────────

  /** Periodic safety net: if a species is below RESPAWN_THRESHOLD, spawn one at a random map position. */
  private tickRespawn(): void {
    const breedRate = SEASON_CONFIG[this.scene.currentSeason].breedRate;
    if (breedRate <= 0) return; // Winter: no respawn

    for (const species of Object.values(AnimalSpecies)) {
      if (typeof species !== 'number') continue; // skip reverse enum keys
      const count = this.animals.filter(a => a.species === species && a.hp > 0).length;
      if (count >= RESPAWN_THRESHOLD) continue;
      if (count >= MAX_POPULATION[species]) continue;

      // Spawn at a random position within map bounds
      const x = Math.random() * MAP_WIDTH;
      const y = Math.random() * MAP_HEIGHT;
      this.spawnAnimal(x, y, species);
    }
  }

  // ─── Herding ─────────────────────────────────────────────────────────

  private assignHerdId(x: number, y: number, species: AnimalSpecies): number {
    if (species !== AnimalSpecies.DEER && species !== AnimalSpecies.RABBIT) return -1;

    for (const other of this.animals) {
      if (other.species !== species || other.herdId < 0 || other.hp <= 0) continue;
      const dx = other.x - x;
      const dy = other.y - y;
      if (dx * dx + dy * dy < HERD_JOIN_RADIUS_SQ) return other.herdId;
    }
    return this.herdCounter++;
  }

  // ─── Death ───────────────────────────────────────────────────────────

  private killAnimal(animal: AnimalData): void {
    animal.state = DEAD;
    animal.hp = 0;

    this.scene.proceduralSound?.playDeath(animal.x, animal.y, animal.species);

    if (animal.foodValue > 0) {
      this.scene.resources.food += animal.foodValue;
      this.scene.feedbackSystem?.showFloatingText(
        animal.x, animal.y, `+${animal.foodValue} Food`, '#facc15',
      );
    }

    this.scene.time.delayedCall(DEATH_FADE_MS, () => {
      animal.visual?.setAlpha(0);
      this.destroyAnimal(animal);
      // Notify if this species is at respawn threshold
      const sameSpecies = this.animals.filter(a => a.species === animal.species && a.hp > 0);
      if (sameSpecies.length < RESPAWN_THRESHOLD) {
        this.scene.feedbackSystem?.notifyAnimalDepleted(animal.species);
      }
    });
  }

  // ─── Visuals ─────────────────────────────────────────────────────────

  private createVisual(animal: AnimalData): Phaser.GameObjects.Container {
    const stats = ANIMAL_SPECIES_STATS[animal.species];
    const visual = this.scene.add.container(0, 0);

    this.scene.worldVisuals.add(visual);
    if (this.scene.worldLayer) this.scene.worldLayer.add(visual);
    if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);

    const gfx = this.scene.add.graphics();
    gfx.fillStyle(stats.color, 1).fillEllipse(0, 0, stats.scaleX, stats.scaleY);

    // Species-specific accent marks
    if (animal.species === AnimalSpecies.WOLF) {
      gfx.fillStyle(0x455A64, 1).fillEllipse(stats.scaleX * 0.3, -stats.scaleY * 0.2, 4, 3);
    } else if (animal.species === AnimalSpecies.BOAR) {
      gfx.fillStyle(0xD7CCC8, 1).fillEllipse(stats.scaleX * 0.35, 0, 3, 2);
    } else if (animal.species === AnimalSpecies.RABBIT) {
      gfx.fillStyle(0xFFFFFF, 0.6).fillEllipse(0, -1, stats.scaleX * 0.5, stats.scaleY * 0.4);
    }

    visual.add(gfx);
    visual.setScale(0.8);
    if (!this.scene.worldLayer) this.scene.add.existing(visual);

    const h = this.scene.terrainSystem.getHeightAt(animal.x, animal.y);
    const iso = toIsoElev(animal.x, animal.y, h);
    visual.setPosition(iso.x, iso.y).setDepth(iso.y);

    const hitRadius = Math.max(stats.scaleX, stats.scaleY) * 0.5;
    visual.setInteractive(new Phaser.Geom.Circle(0, 0, hitRadius), Phaser.Geom.Circle.Contains);

    visual.setData('type', 'animal');
    visual.setData('data', animal);
    visual.setData('unitType', 'Animal');

    return visual;
  }

  private syncVisual(animal: AnimalData): void {
    if (!animal.visual) return;
    const h = this.scene.terrainSystem.getHeightAt(animal.x, animal.y);
    const iso = toIsoElev(animal.x, animal.y, h);
    animal.visual.setPosition(iso.x, iso.y).setDepth(iso.y);
    animal.visual.setAlpha(animal.state === UnitState.CHASING && animal.fearRange > 0 ? 0.85 : 1);
  }
}
