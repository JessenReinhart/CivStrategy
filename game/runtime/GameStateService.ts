import type { Resources } from '../../types';
import {
  Age,
  FactionType,
  GameResult,
  MapMode,
  MapPreset,
  Season,
  VictoryType,
} from '../../types';

/**
 * Canonical mutable simulation state (Phase 8, A1/A3).
 *
 * MainScene currently owns `resources` / `population` / `happiness` and similar
 * scalars as bare public fields, and every system mutates them ad hoc with no
 * invariants. This service is the first slice of that refactor: guarded mutators
 * plus a dirty/subscribe layer so systems and the React bridge stop reading a
 * full mutable object and start reading sliced, validated snapshots.
 *
 * Migration is progressive: MainScene/Systems keep their fields for now and
 * adopt this service one write path at a time. In dev mode every mutator
 * validates its argument and a broken invariant throws with a clear stack.
 */

export interface GameStateSnapshot {
  resources: Resources;
  population: number;
  maxPopulation: number;
  happiness: number;
  taxRate: number;
  peacefulMode: boolean;
  treatyLength: number;
  dominanceProgress: number;
  playerTerritoryPercent: number;

  faction?: FactionType;
  enemyFaction?: FactionType;
  mapMode?: MapMode;
  mapWidth?: number;
  mapHeight?: number;
  bloomIntensity?: number;
  isFowEnabled?: boolean;
  waterAnimationEnabled?: boolean;
  currentAge?: Age;
  ageProgress?: number;
  isAdvancing?: boolean;
  nextAge?: Age | null;
  gameResult?: GameResult;
  victoryType?: VictoryType;
  aiDisabled?: boolean;
  mapSeed?: number;
  mapPreset?: MapPreset;
  debugMode?: boolean;
  showUnitIndicators?: boolean;
  gameSpeed?: number;
  isPaused?: boolean;
  gameTime?: number;
  currentSeason?: Season;
  seasonTimer?: number;
}

export type FullGameStateSnapshot = Required<GameStateSnapshot>;

export const DEFAULT_STATE_META: Omit<
  FullGameStateSnapshot,
  'resources' | 'population' | 'maxPopulation' | 'happiness' | 'taxRate' | 'peacefulMode' | 'treatyLength' | 'dominanceProgress' | 'playerTerritoryPercent'
> = {
  faction: FactionType.ROMANS,
  enemyFaction: FactionType.GAULS,
  mapMode: MapMode.FIXED,
  mapWidth: 2048,
  mapHeight: 2048,
  bloomIntensity: 1.0,
  isFowEnabled: true,
  waterAnimationEnabled: true,
  currentAge: Age.VILLAGE,
  ageProgress: 0,
  isAdvancing: false,
  nextAge: null,
  gameResult: GameResult.PLAYING,
  victoryType: VictoryType.CONQUEST,
  aiDisabled: false,
  mapSeed: 0,
  mapPreset: MapPreset.STANDARD,
  debugMode: false,
  showUnitIndicators: true,
  gameSpeed: 1,
  isPaused: false,
  gameTime: 0,
  currentSeason: Season.SUMMER,
  seasonTimer: 0,
};

export type GameStateKey = keyof GameStateSnapshot;

export type StateSubscriber<T> = (value: T) => void;

const TAX_RATE_MAX = 5; // index into EconomySystem taxImpact array

export class GameStateService {
  private state: FullGameStateSnapshot;
  private readonly dirty = new Set<GameStateKey>();
  private readonly listeners = new Map<GameStateKey, Set<StateSubscriber<unknown>>>();
  private readonly dev: boolean;

  constructor(initial: GameStateSnapshot, dev = true) {
    this.dev = dev;
    this.state = {
      ...DEFAULT_STATE_META,
      ...initial,
      resources: { ...initial.resources },
    };
    this.validateAll();
  }

  /** Read-only view. Dev mode freezes so accidental in-place mutation throws. */
  getSnapshot(): Readonly<FullGameStateSnapshot> {
    const snap = { ...this.state, resources: { ...this.state.resources } };
    return this.dev ? Object.freeze({ ...snap, resources: Object.freeze(snap.resources) }) : snap;
  }

  /**
   * Selector-based subscribe with reference equality. Returns an unsubscribe fn.
   * The callback fires immediately with the current value, then only when the
   * selected slice actually changes.
   */
  subscribe<T>(key: GameStateKey, selector: (s: FullGameStateSnapshot) => T, cb: StateSubscriber<T>): () => void {
    let last = selector(this.state);
    cb(last);

    const set = this.listeners.get(key) ?? new Set<StateSubscriber<unknown>>();
    const wrapped: StateSubscriber<unknown> = (() => {
      const next = selector(this.state);
      if (next !== last) {
        last = next;
        cb(next);
      }
    }) as StateSubscriber<unknown>;
    set.add(wrapped);
    this.listeners.set(key, set);

    return () => {
      set.delete(wrapped);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  /** Keys changed since the last `consumeDirty`. */
  getDirtyKeys(): ReadonlySet<GameStateKey> {
    return this.dirty;
  }

  consumeDirty(): GameStateKey[] {
    const keys = [...this.dirty];
    this.dirty.clear();
    return keys;
  }

  private mark(key: GameStateKey): void {
    this.dirty.add(key);
    this.notify(key);
  }

  private notify(key: GameStateKey): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const cb of set) cb(undefined);
  }

  // ── Guarded mutators ────────────────────────────────────────────────────

  setPopulation(value: number): void {
    this.assertFiniteInt('population', value);
    if (value < 0) this.fail('population cannot be negative', { population: value });
    if (value !== this.state.population) {
      this.state.population = value;
      this.mark('population');
    }
  }

  /**
   * Lenient population mutator: floors to 0 instead of throwing. Used by the
   * MainScene accessor because population is decremented from several systems
   * (kill, garrison release, villager death) where a transient underflow is
   * possible within a frame; the post-frame invariant still catches a truly
   * negative end-of-frame value.
   */
  setPopulationClamped(value: number): void {
    this.assertFinite('population', value);
    const clamped = Math.max(0, Math.floor(value));
    if (clamped !== this.state.population) {
      this.state.population = clamped;
      this.mark('population');
    }
  }

  setMaxPopulation(value: number): void {
    this.assertFiniteInt('maxPopulation', value);
    if (value < 0) this.fail('maxPopulation cannot be negative', { maxPopulation: value });
    if (value !== this.state.maxPopulation) {
      this.state.maxPopulation = value;
      this.mark('maxPopulation');
    }
  }

  setHappiness(value: number): void {
    this.assertFinite('happiness', value);
    const clamped = Math.max(0, Math.min(100, value));
    if (clamped !== this.state.happiness) {
      this.state.happiness = clamped;
      this.mark('happiness');
    }
  }

  setTaxRate(value: number): void {
    this.assertFinite('taxRate', value);
    const clamped = Math.max(0, Math.min(TAX_RATE_MAX, Math.floor(value)));
    if (clamped !== this.state.taxRate) {
      this.state.taxRate = clamped;
      this.mark('taxRate');
    }
  }

  setPeacefulMode(value: boolean): void {
    if (value !== this.state.peacefulMode) {
      this.state.peacefulMode = value;
      this.mark('peacefulMode');
    }
  }

  setTreatyLength(value: number): void {
    this.assertFinite('treatyLength', value);
    if (value < 0) this.fail('treatyLength cannot be negative', { treatyLength: value });
    if (value !== this.state.treatyLength) {
      this.state.treatyLength = value;
      this.mark('treatyLength');
    }
  }

  setFaction(value: FactionType): void {
    if (value !== this.state.faction) {
      this.state.faction = value;
      this.mark('faction');
    }
  }

  setEnemyFaction(value: FactionType): void {
    if (value !== this.state.enemyFaction) {
      this.state.enemyFaction = value;
      this.mark('enemyFaction');
    }
  }

  setMapMode(value: MapMode): void {
    if (value !== this.state.mapMode) {
      this.state.mapMode = value;
      this.mark('mapMode');
    }
  }

  setMapWidth(value: number): void {
    this.assertFinite('mapWidth', value);
    if (value !== this.state.mapWidth) {
      this.state.mapWidth = value;
      this.mark('mapWidth');
    }
  }

  setMapHeight(value: number): void {
    this.assertFinite('mapHeight', value);
    if (value !== this.state.mapHeight) {
      this.state.mapHeight = value;
      this.mark('mapHeight');
    }
  }

  setBloomIntensity(value: number): void {
    this.assertFinite('bloomIntensity', value);
    if (value !== this.state.bloomIntensity) {
      this.state.bloomIntensity = value;
      this.mark('bloomIntensity');
    }
  }

  setIsFowEnabled(value: boolean): void {
    if (value !== this.state.isFowEnabled) {
      this.state.isFowEnabled = value;
      this.mark('isFowEnabled');
    }
  }

  setWaterAnimationEnabled(value: boolean): void {
    if (value !== this.state.waterAnimationEnabled) {
      this.state.waterAnimationEnabled = value;
      this.mark('waterAnimationEnabled');
    }
  }

  setCurrentAge(value: Age): void {
    if (value !== this.state.currentAge) {
      this.state.currentAge = value;
      this.mark('currentAge');
    }
  }

  setAgeProgress(value: number): void {
    this.assertFinite('ageProgress', value);
    if (value !== this.state.ageProgress) {
      this.state.ageProgress = value;
      this.mark('ageProgress');
    }
  }

  setIsAdvancing(value: boolean): void {
    if (value !== this.state.isAdvancing) {
      this.state.isAdvancing = value;
      this.mark('isAdvancing');
    }
  }

  setNextAge(value: Age | null): void {
    if (value !== this.state.nextAge) {
      this.state.nextAge = value;
      this.mark('nextAge');
    }
  }

  setGameResult(value: GameResult): void {
    if (value !== this.state.gameResult) {
      this.state.gameResult = value;
      this.mark('gameResult');
    }
  }

  setDominanceProgress(value: number): void {
    this.assertFinite('dominanceProgress', value);
    if (value !== this.state.dominanceProgress) {
      this.state.dominanceProgress = value;
      this.mark('dominanceProgress');
    }
  }

  setPlayerTerritoryPercent(value: number): void {
    this.assertFinite('playerTerritoryPercent', value);
    if (value !== this.state.playerTerritoryPercent) {
      this.state.playerTerritoryPercent = value;
      this.mark('playerTerritoryPercent');
    }
  }

  setVictoryType(value: VictoryType): void {
    if (value !== this.state.victoryType) {
      this.state.victoryType = value;
      this.mark('victoryType');
    }
  }

  setAiDisabled(value: boolean): void {
    if (value !== this.state.aiDisabled) {
      this.state.aiDisabled = value;
      this.mark('aiDisabled');
    }
  }

  setMapSeed(value: number): void {
    this.assertFinite('mapSeed', value);
    if (value !== this.state.mapSeed) {
      this.state.mapSeed = value;
      this.mark('mapSeed');
    }
  }

  setMapPreset(value: MapPreset): void {
    if (value !== this.state.mapPreset) {
      this.state.mapPreset = value;
      this.mark('mapPreset');
    }
  }

  setDebugMode(value: boolean): void {
    if (value !== this.state.debugMode) {
      this.state.debugMode = value;
      this.mark('debugMode');
    }
  }

  setShowUnitIndicators(value: boolean): void {
    if (value !== this.state.showUnitIndicators) {
      this.state.showUnitIndicators = value;
      this.mark('showUnitIndicators');
    }
  }

  setGameSpeed(value: number): void {
    this.assertFinite('gameSpeed', value);
    if (value !== this.state.gameSpeed) {
      this.state.gameSpeed = value;
      this.mark('gameSpeed');
    }
  }

  setIsPaused(value: boolean): void {
    if (value !== this.state.isPaused) {
      this.state.isPaused = value;
      this.mark('isPaused');
    }
  }

  setGameTime(value: number): void {
    this.assertFinite('gameTime', value);
    if (value !== this.state.gameTime) {
      this.state.gameTime = value;
      this.mark('gameTime');
    }
  }

  setCurrentSeason(value: Season): void {
    if (value !== this.state.currentSeason) {
      this.state.currentSeason = value;
      this.mark('currentSeason');
    }
  }

  setSeasonTimer(value: number): void {
    this.assertFinite('seasonTimer', value);
    if (value !== this.state.seasonTimer) {
      this.state.seasonTimer = value;
      this.mark('seasonTimer');
    }
  }

  addResources(partial: Partial<Resources>): void {
    for (const k of ['wood', 'food', 'gold'] as const) {
      const v = partial[k];
      if (v === undefined) continue;
      this.assertFinite(`resources.${k}`, v);
      const next = this.state.resources[k] + v;
      if (next < 0) this.fail(`resources.${k} cannot go negative`, { [k]: next });
      this.state.resources[k] = next;
    }
    this.mark('resources');
  }

  /** Deduct partial if fully affordable; returns false without mutating otherwise. */
  spendResources(partial: Partial<Resources>): boolean {
    for (const k of ['wood', 'food', 'gold'] as const) {
      const v = partial[k];
      if (v === undefined) continue;
      this.assertFinite(`resources.${k}`, v);
      if (this.state.resources[k] < v) return false;
    }
    this.addResources({
      wood: partial.wood !== undefined ? -partial.wood : undefined,
      food: partial.food !== undefined ? -partial.food : undefined,
      gold: partial.gold !== undefined ? -partial.gold : undefined,
    });
    return true;
  }

  /**
   * Live internal handle for the legacy scene adapter (`MainScene.resources`).
   * NOT frozen: the returned object is the canonical mutable state so existing
   * `.resources.X` reads keep returning current values. Prefer `addResources` /
   * `spendResources` for writes so invariants and dirty-marking stay intact.
   */
  getResources(): Resources {
    return this.state.resources;
  }

  /** Shallow-copy wood/food/gold into `state.resources` (validated + marked). */
  setResources(value: Resources): void {
    for (const k of ['wood', 'food', 'gold'] as const) {
      this.assertFinite(`resources.${k}`, value[k]);
      this.state.resources[k] = value[k];
    }
    this.mark('resources');
  }

  // ── Dev validation ──────────────────────────────────────────────────────

  private assertFinite(field: string, value: number): void {
    if (this.dev && !Number.isFinite(value)) this.fail(`${field} must be finite`, { [field]: value });
  }

  private assertFiniteInt(field: string, value: number): void {
    if (this.dev && (!Number.isInteger(value) || !Number.isFinite(value))) {
      this.fail(`${field} must be a finite integer`, { [field]: value });
    }
  }

  /**
   * Validate an arbitrary snapshot against the same invariants. Used by
   * MainScene during the progressive migration: before systems migrate their
   * writes into guarded mutators, MainScene still owns the scalars and calls
   * this at the end of each frame so a broken invariant throws in dev mode.
   */
  public assertValid(values: GameStateSnapshot): void {
    if (!this.dev) return;
    this.assertFiniteInt('population', values.population);
    this.assertFiniteInt('maxPopulation', values.maxPopulation);
    this.assertFinite('happiness', values.happiness);
    this.assertFinite('taxRate', values.taxRate);
    this.assertFinite('treatyLength', values.treatyLength);
    this.assertFinite('dominanceProgress', values.dominanceProgress);
    this.assertFinite('playerTerritoryPercent', values.playerTerritoryPercent);
    if (values.mapWidth !== undefined) this.assertFinite('mapWidth', values.mapWidth);
    if (values.mapHeight !== undefined) this.assertFinite('mapHeight', values.mapHeight);
    if (values.bloomIntensity !== undefined) this.assertFinite('bloomIntensity', values.bloomIntensity);
    if (values.ageProgress !== undefined) this.assertFinite('ageProgress', values.ageProgress);
    if (values.mapSeed !== undefined) this.assertFinite('mapSeed', values.mapSeed);
    if (values.gameSpeed !== undefined) this.assertFinite('gameSpeed', values.gameSpeed);
    if (values.gameTime !== undefined) this.assertFinite('gameTime', values.gameTime);
    if (values.seasonTimer !== undefined) this.assertFinite('seasonTimer', values.seasonTimer);
    for (const k of ['wood', 'food', 'gold'] as const) {
      this.assertFinite(`resources.${k}`, values.resources[k]);
      if (values.resources[k] < 0) this.fail(`resources.${k} cannot be negative`, { [k]: values.resources[k] });
    }
    if (values.population < 0) this.fail('population cannot be negative', { population: values.population });
    if (values.maxPopulation < 0) this.fail('maxPopulation cannot be negative', { maxPopulation: values.maxPopulation });
    if (values.happiness < 0 || values.happiness > 100) this.fail('happiness out of range [0,100]', { happiness: values.happiness });
  }

  private validateAll(): void {
    this.assertValid(this.state);
  }

  private fail(message: string, context: Record<string, unknown>): never {
    throw new Error(`[GameState invariant] ${message}: ${JSON.stringify(context)}`);
  }
}