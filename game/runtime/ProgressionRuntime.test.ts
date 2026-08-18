import { describe, expect, it, vi } from 'vitest';
import { ProgressionRuntime } from './ProgressionRuntime';
import { ProgressionRuntimeHost } from './ProgressionRuntimeHost';
import { createMainSceneProgressionBridge } from './MainSceneProgressionBridge';
import type { ProgressionContext } from './ProgressionContext';
import type { ProgressionServices } from './ProgressionServices';
import type { MainScene } from '../MainScene';
import { Age } from '../../types';
import { SEASON_DURATION_MS } from '../../constants';

function createServices(
  overrides: Partial<{
    isStressMode: boolean;
    isPlaying: boolean;
    isAdvancing: boolean;
    nextAge: Age | null;
    seasonElapsed: number;
  }> = {},
): ProgressionServices & { events: string[]; seasonElapsedVal: number } {
  const events: string[] = [];
  const mark = (name: string) => vi.fn(() => events.push(name));
  const opts = {
    isStressMode: false,
    isPlaying: true,
    isAdvancing: false,
    nextAge: null,
    seasonElapsed: 0,
    ...overrides,
  };

  let seasonElapsedVal = opts.seasonElapsed;

  const services: ProgressionServices = {
    get isStressMode() {
      return opts.isStressMode;
    },
    session: {
      get isPlaying() {
        return opts.isPlaying;
      },
    },
    economy: {
      tick: mark('economyTick'),
      assignJobs: mark('assignJobs'),
    },
    research: {
      tick: mark('researchTick'),
    },
    population: {
      tick: mark('populationTick'),
    },
    victory: {
      check: mark('victoryCheck'),
    },
    season: {
      get elapsed() {
        return seasonElapsedVal;
      },
      setElapsed: vi.fn((ms: number) => {
        seasonElapsedVal = ms;
        events.push('seasonSetElapsed');
      }),
      change: mark('seasonChange'),
    },
    world: {
      respawnGoldMines: mark('respawnGoldMines'),
      fireGarrison: mark('fireGarrison'),
    },
    autoSave: {
      save: mark('autoSave'),
    },
    age: {
      get isAdvancing() {
        return opts.isAdvancing;
      },
      get nextAge() {
        return opts.nextAge;
      },
      progress: mark('ageProgress'),
    },
  };

  return Object.assign(services, { events, get seasonElapsedVal() { return seasonElapsedVal; } });
}

function createContext(services: ProgressionServices, now = 1000, dt = 16): ProgressionContext {
  return { services, now, dt };
}

describe('ProgressionRuntime', () => {
  it('skips all progression in stress mode', () => {
    const services = createServices({ isStressMode: true });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services));

    expect(services.events).toEqual([]);
  });

  it('does not fire 1s window before accumulator fills', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 16, 16));

    expect(services.events).toEqual([]);
  });

  it('fires 1s window when accumulator reaches 1000ms', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 1000, 1000));

    expect(services.events).toContain('victoryCheck');
    expect(services.events).toContain('economyTick');
    expect(services.events).toContain('researchTick');
    expect(services.events).toContain('assignJobs');
    expect(services.events).toContain('respawnGoldMines');
    expect(services.events).toContain('seasonSetElapsed');
  });

  it('preserves 1s window ordering', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    // now=4000 so garrison fires (4000 - 0 >= CASTLE_GARRISON_FIRE_INTERVAL)
    runtime.update(createContext(services, 4000, 1000));

    // victory → economy → research → assignJobs → season → respawnGoldMines → fireGarrison
    expect(services.events).toEqual([
      'victoryCheck',
      'economyTick',
      'researchTick',
      'assignJobs',
      'seasonSetElapsed',
      'respawnGoldMines',
      'fireGarrison',
    ]);
  });

  it('skips economy/research/assignJobs when game is not playing', () => {
    const services = createServices({ isPlaying: false });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 1000, 1000));

    expect(services.events).toContain('victoryCheck');
    expect(services.events).toContain('respawnGoldMines');
    expect(services.events).not.toContain('economyTick');
    expect(services.events).not.toContain('researchTick');
    expect(services.events).not.toContain('assignJobs');
    expect(services.events).not.toContain('fireGarrison');
  });

  it('skips population tick and age progress when game is not playing', () => {
    const services = createServices({ isPlaying: false });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 1000, 1000));

    expect(services.events).not.toContain('populationTick');
    expect(services.events).not.toContain('ageProgress');
  });

  it('advances season when season duration elapses', () => {
    const services = createServices({ seasonElapsed: SEASON_DURATION_MS - 1000 });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 1000, 1000));

    expect(services.events).toContain('seasonChange');
    expect(services.season.elapsed).toBe(0);
  });

  it('does not advance season before duration elapses', () => {
    const services = createServices({ seasonElapsed: 0 });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 1000, 1000));

    expect(services.events).not.toContain('seasonChange');
    expect(services.season.elapsed).toBe(1000);
  });

  it('fires garrison only when playing and interval has elapsed', () => {
    const services = createServices({ isPlaying: true });
    const runtime = new ProgressionRuntime();

    // First 1s window at now=1000 — lastGarrisonFireTime starts at 0, so 1000-0=1000 < 3000
    runtime.update(createContext(services, 1000, 1000));
    expect(services.events).not.toContain('fireGarrison');

    // Second 1s window at now=4000 — 4000-0=4000 >= 3000
    runtime.update(createContext(services, 4000, 1000));
    expect(services.events).toContain('fireGarrison');
  });

  it('auto-saves every 60 one-second windows', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    // 59 windows — no auto-save yet
    for (let i = 1; i <= 59; i++) {
      runtime.update(createContext(services, i * 1000, 1000));
    }
    expect(services.events.filter(e => e === 'autoSave')).toHaveLength(0);

    // 60th window — auto-save fires
    runtime.update(createContext(services, 60000, 1000));
    expect(services.events.filter(e => e === 'autoSave')).toHaveLength(1);
  });

  it('fires population tick every 8000ms', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    // Accumulate 7999ms — no population tick
    for (let i = 0; i < 499; i++) {
      runtime.update(createContext(services, i * 16, 16));
    }
    expect(services.events).not.toContain('populationTick');

    // One more 16ms frame crosses 8000ms
    runtime.update(createContext(services, 499 * 16, 16));
    expect(services.events).toContain('populationTick');
  });

  it('ticks age progress every frame while advancing', () => {
    const services = createServices({ isAdvancing: true, nextAge: Age.TOWN });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 16, 16));

    expect(services.events).toContain('ageProgress');
  });

  it('does not tick age progress when not advancing', () => {
    const services = createServices({ isAdvancing: false });
    const runtime = new ProgressionRuntime();

    runtime.update(createContext(services, 16, 16));

    expect(services.events).not.toContain('ageProgress');
  });

  it('accumulates across multiple frames to reach 1s window', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();

    // 62 frames of ~16ms ≈ 992ms — no 1s window yet
    for (let i = 0; i < 62; i++) {
      runtime.update(createContext(services, i * 16, 16));
    }
    expect(services.events).not.toContain('victoryCheck');

    // 63rd frame crosses 1000ms
    runtime.update(createContext(services, 62 * 16, 16));
    expect(services.events).toContain('victoryCheck');
  });
});

describe('ProgressionRuntimeHost', () => {
  it('delegates to the runtime with now and dt', () => {
    const services = createServices();
    const runtime = new ProgressionRuntime();
    const host = new ProgressionRuntimeHost(runtime, services);

    host.update(1000, 1000);

    expect(services.events).toContain('victoryCheck');
  });
});

describe('createMainSceneProgressionBridge', () => {
  function createMockScene(overrides: Record<string, unknown> = {}): unknown {
    return {
      stressTestConfig: null,
      gameResult: 'playing',
      economySystem: { tickEconomy: vi.fn(), assignJobs: vi.fn(), tickPopulation: vi.fn() },
      researchManager: { tick: vi.fn() },
      checkWinLose: vi.fn(),
      checkDominance: vi.fn(),
      seasonTimer: 0,
      advanceSeason: vi.fn(),
      respawnGoldMines: vi.fn(),
      fireGarrison: vi.fn(),
      saveGame: vi.fn(),
      isAdvancing: false,
      nextAge: null,
      advanceAgeProgress: vi.fn(),
      ...overrides,
    };
  }

  it('constructs a host that delegates to scene methods', () => {
    const mockScene = createMockScene() as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    host.update(1000, 1000);

    expect((mockScene as unknown as Record<string, unknown>).economySystem)
      .toBeDefined();
  });

  it('skips progression when stressTestConfig is set', () => {
    const mockScene = createMockScene({ stressTestConfig: {} }) as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    host.update(1000, 1000);

    const scene = mockScene as unknown as {
      economySystem: { tickEconomy: ReturnType<typeof vi.fn> };
      checkWinLose: ReturnType<typeof vi.fn>;
    };
    expect(scene.economySystem.tickEconomy).not.toHaveBeenCalled();
    expect(scene.checkWinLose).not.toHaveBeenCalled();
  });

  it('delegates economy tick and assignJobs through services', () => {
    const mockScene = createMockScene() as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    host.update(1000, 1000);

    const scene = mockScene as unknown as {
      economySystem: { tickEconomy: ReturnType<typeof vi.fn>; assignJobs: ReturnType<typeof vi.fn> };
      researchManager: { tick: ReturnType<typeof vi.fn> };
    };
    expect(scene.economySystem.tickEconomy).toHaveBeenCalled();
    expect(scene.researchManager.tick).toHaveBeenCalledWith(1000);
    expect(scene.economySystem.assignJobs).toHaveBeenCalled();
  });

  it('delegates season change through services', () => {
    const mockScene = createMockScene({
      seasonTimer: SEASON_DURATION_MS - 1000,
    }) as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    host.update(1000, 1000);

    const scene = mockScene as unknown as { advanceSeason: ReturnType<typeof vi.fn> };
    expect(scene.advanceSeason).toHaveBeenCalled();
  });

  it('delegates age progress through services', () => {
    const mockScene = createMockScene({
      isAdvancing: true,
      nextAge: Age.TOWN,
    }) as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    host.update(16, 16);

    const scene = mockScene as unknown as { advanceAgeProgress: ReturnType<typeof vi.fn> };
    expect(scene.advanceAgeProgress).toHaveBeenCalledWith(16);
  });

  it('delegates garrison fire when interval elapses', () => {
    const mockScene = createMockScene() as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    // First window at now=1000 — garrison should not fire (1000 < CASTLE_GARRISON_FIRE_INTERVAL)
    host.update(1000, 1000);
    let scene = mockScene as unknown as { fireGarrison: ReturnType<typeof vi.fn> };
    expect(scene.fireGarrison).not.toHaveBeenCalled();

    // Second window at now=4000 — garrison fires (4000 >= 3000)
    host.update(4000, 1000);
    scene = mockScene as unknown as { fireGarrison: ReturnType<typeof vi.fn> };
    expect(scene.fireGarrison).toHaveBeenCalledTimes(1);
  });

  it('auto-saves every 60 one-second windows', () => {
    const mockScene = createMockScene() as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    for (let i = 1; i <= 60; i++) {
      host.update(i * 1000, 1000);
    }

    const scene = mockScene as unknown as { saveGame: ReturnType<typeof vi.fn> };
    expect(scene.saveGame).toHaveBeenCalledTimes(1);
  });

  it('delegates population tick through services', () => {
    const mockScene = createMockScene() as unknown as MainScene;
    const host = createMainSceneProgressionBridge(mockScene);

    // Accumulate 8000ms of dt
    for (let i = 0; i < 500; i++) {
      host.update(i * 16, 16);
    }

    const scene = mockScene as unknown as {
      economySystem: { tickPopulation: ReturnType<typeof vi.fn> };
    };
    expect(scene.economySystem.tickPopulation).toHaveBeenCalled();
  });
});
