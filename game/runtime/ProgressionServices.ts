import type { MainScene } from '../MainScene';
import { GameResult } from '../../types';
import type { Age } from '../../types';

/** Capabilities consumed by the progression coordinator. */
export interface ProgressionServices {
  /** True while a stress test is active (progression is skipped entirely). */
  readonly isStressMode: boolean;

  readonly session: {
    readonly isPlaying: boolean;
  };

  /** 1-second economy window capabilities. */
  readonly economy: {
    tick(): void;
    assignJobs(): void;
  };

  readonly research: {
    tick(dt: number): void;
  };

  readonly population: {
    tick(): void;
  };

  /** Victory/dominance evaluation (runs once per 1s window). */
  readonly victory: {
    check(): void;
  };

  /** Seasonal cadence. The scene owns the opaque (serialized) season timer
   *  value; the runtime reads/advances it through this capability. */
  readonly season: {
    readonly elapsed: number;
    setElapsed(ms: number): void;
    change(): void;
  };

  /** Periodic world maintenance work that runs inside the 1s window. */
  readonly world: {
    respawnGoldMines(now: number): void;
    fireGarrison(): void;
  };

  readonly autoSave: {
    save(): void;
  };

  /** Age advancement progress ticking (per-frame while advancing). */
  readonly age: {
    readonly isAdvancing: boolean;
    readonly nextAge: Age | null;
    progress(dt: number): void;
  };
}

/**
 * Temporary scene adapter. This is the only place the progression boundary
 * knows how the legacy MainScene-owned systems and episode state are read.
 *
 * Keep behavior decisions here while the scene is still the source of truth.
 * The runtime should coordinate cadence and ordering, not scene-specific modes.
 */
export function createProgressionServices(scene: MainScene): ProgressionServices {
  return {
    get isStressMode() {
      return !!scene.stressTestConfig;
    },
    session: {
      get isPlaying() {
        return scene.gameResult === GameResult.PLAYING;
      },
    },
    economy: {
      tick: () => scene.economySystem.tickEconomy(),
      assignJobs: () => scene.economySystem.assignJobs(),
    },
    research: {
      tick: (dt) => scene.researchManager.tick(dt),
    },
    population: {
      tick: () => scene.economySystem.tickPopulation(),
    },
    victory: {
      check: () => {
        scene.checkWinLose();
        scene.checkDominance();
      },
    },
    season: {
      get elapsed() {
        return scene.seasonTimer;
      },
      setElapsed: (ms) => {
        scene.seasonTimer = ms;
      },
      change: () => scene.advanceSeason(),
    },
    world: {
      respawnGoldMines: (now) => scene.respawnGoldMines(now),
      fireGarrison: () => scene.fireGarrison(),
    },
    autoSave: {
      save: () => scene.saveGame(),
    },
    age: {
      get isAdvancing() {
        return scene.isAdvancing;
      },
      get nextAge() {
        return scene.nextAge;
      },
      progress: (dt) => scene.advanceAgeProgress(dt),
    },
  };
}
