import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { MainScene } from '../MainScene';
import { deserializeGame } from './SaveSystem';
import { InputManager } from './InputManager';
import { ProgressionRuntime } from '../runtime/ProgressionRuntime';
import { NO_TERRAIN, isTerrainValid } from '../utils/terrain';
import { BuildingManager } from './BuildingManager';
import { BuildingType } from '../../types';
import type { SaveGame } from '../../types';
import type { ProgressionServices } from '../runtime/ProgressionServices';
import type { ProgressionContext } from '../runtime/ProgressionContext';

vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {
      events = {
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      };
    },
    Math: {
      Vector2: class Vector2 {
        constructor(public x = 0, public y = 0) {}
        set(x: number, y: number) { this.x = x; this.y = y; return this; }
      },
      Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
    },
    Geom: {
      Rectangle: class Rectangle {
        constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
      },
    },
    Scenes: {
      Events: {
        SHUTDOWN: 'shutdown',
      },
    },
  },
}));

type EventHandler = (...args: unknown[]) => void;

function createMockGameEventEmitter() {
  const listeners = new Map<string | symbol, Set<{ fn: EventHandler; context?: unknown }>>();
  return {
    on: vi.fn((event: string | symbol, fn: EventHandler, context?: unknown) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add({ fn, context });
    }),
    off: vi.fn((event: string | symbol, fn: EventHandler, context?: unknown) => {
      const set = listeners.get(event);
      if (!set) return;
      for (const entry of set) {
        if (entry.fn === fn && (context === undefined || entry.context === context)) {
          set.delete(entry);
        }
      }
    }),
    emit: vi.fn((event: string | symbol, ...args: unknown[]) => {
      const set = listeners.get(event);
      if (!set) return;
      for (const entry of Array.from(set)) {
        entry.fn.apply(entry.context, args);
      }
    }),
    listenerCount: (event: string | symbol) => listeners.get(event)?.size ?? 0,
    rawListeners: listeners,
  };
}

describe('T1: Game Speed and Pause Semantics', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies speed uniformly across sim scale, clamped physics reciprocal, and tweens', () => {
    const scene = Object.create(MainScene.prototype) as MainScene;
    scene.gameSpeed = 1;
    scene.isPaused = false;
    const physics = {
      world: {
        timeScale: 1,
        pause: vi.fn(),
        resume: vi.fn(),
      },
    };
    const tweens = { timeScale: 1 };
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).physics = physics;
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).tweens = tweens;

    scene.setGameSpeed(2);
    expect(scene.gameSpeed).toBe(2);
    expect(physics.world.timeScale).toBeCloseTo(0.5);
    expect(tweens.timeScale).toBe(2);

    scene.setGameSpeed(0.5);
    expect(scene.gameSpeed).toBe(0.5);
    expect(physics.world.timeScale).toBeCloseTo(2);
    expect(tweens.timeScale).toBe(0.5);
  });

  it('safely handles speed <= 0 without producing Infinity or NaN in physics timeScale', () => {
    const scene = Object.create(MainScene.prototype) as MainScene;
    scene.gameSpeed = 1;
    scene.isPaused = false;
    const physics = {
      world: {
        timeScale: 1,
        pause: vi.fn(),
        resume: vi.fn(),
      },
    };
    const tweens = { timeScale: 1 };
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).physics = physics;
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).tweens = tweens;

    scene.setGameSpeed(0);
    // Invalid non-positive speed falls back to 1 and does not divide by zero
    expect(Number.isFinite(physics.world.timeScale)).toBe(true);
    expect(physics.world.timeScale).toBe(1);
    expect(scene.gameSpeed).toBe(1);

    scene.setGameSpeed(Number.NaN);
    expect(Number.isFinite(physics.world.timeScale)).toBe(true);
    expect(scene.gameSpeed).toBe(1);
  });

  it('manages pause state via an explicit branch and freezes tweens without zero-speed physics crash', () => {
    const scene = Object.create(MainScene.prototype) as MainScene;
    scene.gameSpeed = 2;
    scene.isPaused = false;
    const pauseSpy = vi.fn();
    const resumeSpy = vi.fn();
    const physics = {
      world: {
        timeScale: 0.5,
        pause: pauseSpy,
        resume: resumeSpy,
      },
    };
    const tweens = { timeScale: 2 };
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).physics = physics;
    (scene as unknown as { physics: typeof physics; tweens: typeof tweens }).tweens = tweens;

    scene.setPaused(true);
    expect(scene.isPaused).toBe(true);
    expect(scene.gameSpeed).toBe(2); // Preserved
    expect(pauseSpy).toHaveBeenCalled();
    expect(tweens.timeScale).toBe(0);
    expect(Number.isFinite(physics.world.timeScale)).toBe(true);

    scene.togglePause();
    expect(scene.isPaused).toBe(false);
    expect(resumeSpy).toHaveBeenCalled();
    expect(tweens.timeScale).toBe(2);
    expect(physics.world.timeScale).toBeCloseTo(0.5);
  });

  it('Space key invokes togglePause on MainScene', () => {
    const toggleSpy = vi.fn();
    const keyboardHandlers = new Map<string, () => void>();
    const scene = {
      togglePause: toggleSpy,
      gameSpeed: 1,
      cameras: { main: { zoom: 1 } },
      input: {
        on: vi.fn(),
        keyboard: {
          on: vi.fn((event: string, fn: () => void) => {
            keyboardHandlers.set(event, fn);
          }),
        },
        setDefaultCursor: vi.fn(),
      },
      game: { events: { on: vi.fn() } },
      add: {
        graphics: vi.fn(() => ({ setDepth: vi.fn().mockReturnThis() })),
      },
      events: { once: vi.fn() },
    };

    new InputManager(scene as never);
    const spaceHandler = keyboardHandlers.get('keydown-SPACE');
    expect(spaceHandler).toBeDefined();

    spaceHandler!();
    expect(toggleSpy).toHaveBeenCalledOnce();
  });

  it('SaveSystem delegates speed restoration to setGameSpeed', () => {
    const speedSpy = vi.fn();
    const scene = {
      setGameSpeed: speedSpy,
      gameSpeed: 1,
      gameTime: 0,
      currentAge: 'Village',
      ageProgress: 0,
      currentSeason: 'Summer',
      resources: { wood: 0, food: 0, gold: 0 },
      population: 0,
      maxPopulation: 8,
      happiness: 100,
      taxRate: 0,
      bloomIntensity: 1,
      enemyFaction: 'Gauls',
      dominanceProgress: 0,
      playerTerritoryPercent: 0,
      gameResult: 'playing',
      units: { getChildren: () => [], remove: vi.fn() },
      buildings: { getChildren: () => [], remove: vi.fn() },
      trees: { getChildren: () => [] },
      unitSpatialHash: { remove: vi.fn() },
      pathfinder: { updateTerrainCosts: vi.fn(), markGrid: vi.fn() },
      terrainSystem: {},
      villagerSystem: { getAllVillagers: () => [], assignJobs: vi.fn(), destroyVillager: vi.fn(), spawnVillager: vi.fn() },
      economySystem: { assignJobs: vi.fn(), updateStats: vi.fn() },
      cameras: { main: { centerOn: vi.fn() } },
      mapWidth: 1024,
      mapHeight: 1024,
    } as unknown as MainScene;

    const save = {
      version: 1,
      timestamp: Date.now(),
      gameTime: 5000,
      resources: { wood: 200, food: 300, gold: 100 },
      population: 10,
      happiness: 80,
      gameSpeed: 2,
      taxRate: 10,
      bloomIntensity: 1.2,
      units: [],
      buildings: [],
      research: { completedPlayer: [], activePlayer: null, completedAI: [] },
      aiState: { buildIndex: 0 },
    } as unknown as SaveGame;

    deserializeGame(scene, save);
    expect(speedSpy).toHaveBeenCalledWith(2);
  });
});

describe('A2: Global game.events Listener Lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers handlers and completely tears them down on scene shutdown', () => {
    const gameEmitter = createMockGameEventEmitter();
    const scene = Object.create(MainScene.prototype) as MainScene;
    (scene as unknown as { game: { events: typeof gameEmitter } }).game = { events: gameEmitter };
    (scene as unknown as { registeredGameEvents: unknown[] }).registeredGameEvents = [];

    const taxHandler = vi.fn();
    const speedHandler = vi.fn();
    const formationHandler = vi.fn();

    scene.registerGameEvent(EVENTS.SET_TAX_RATE, taxHandler);
    scene.registerGameEvent(EVENTS.SET_GAME_SPEED, speedHandler);
    scene.registerGameEvent('request-set-formation', formationHandler);

    expect(gameEmitter.listenerCount(EVENTS.SET_TAX_RATE)).toBe(1);
    expect(gameEmitter.listenerCount(EVENTS.SET_GAME_SPEED)).toBe(1);
    expect(gameEmitter.listenerCount('request-set-formation')).toBe(1);

    gameEmitter.emit(EVENTS.SET_TAX_RATE, 15);
    expect(taxHandler).toHaveBeenCalledWith(15);

    // Shutdown should remove all 3 handlers
    scene.shutdown();

    expect(gameEmitter.listenerCount(EVENTS.SET_TAX_RATE)).toBe(0);
    expect(gameEmitter.listenerCount(EVENTS.SET_GAME_SPEED)).toBe(0);
    expect(gameEmitter.listenerCount('request-set-formation')).toBe(0);

    // Subsequent emits should not reach the shut down scene
    gameEmitter.emit(EVENTS.SET_TAX_RATE, 20);
    expect(taxHandler).toHaveBeenCalledOnce();
  });

  it('prevents handler accumulation across scene restart cycles', () => {
    const gameEmitter = createMockGameEventEmitter();

    // Run 3 consecutive scene lifecycles (e.g. restart / return to menu and replay)
    for (let cycle = 0; cycle < 3; cycle++) {
      const scene = Object.create(MainScene.prototype) as MainScene;
      (scene as unknown as { game: { events: typeof gameEmitter } }).game = { events: gameEmitter };
      (scene as unknown as { registeredGameEvents: unknown[] }).registeredGameEvents = [];

      const cycleHandler = vi.fn();
      scene.registerGameEvent(EVENTS.SET_GAME_SPEED, cycleHandler);

      expect(gameEmitter.listenerCount(EVENTS.SET_GAME_SPEED)).toBe(1);
      gameEmitter.emit(EVENTS.SET_GAME_SPEED, 2);
      expect(cycleHandler).toHaveBeenCalledOnce();

      scene.shutdown();
      expect(gameEmitter.listenerCount(EVENTS.SET_GAME_SPEED)).toBe(0);
    }
  });

  it('cleans up window and renderer listeners on shutdown', () => {
    const removeEventListenerSpy = vi.fn();
    vi.stubGlobal('window', { removeEventListener: removeEventListenerSpy });

    const rendererListeners = new Map<string, () => void>();
    const offSpy = vi.fn((event: string) => { rendererListeners.delete(event); });
    const renderer = {
      on: vi.fn((event: string, fn: () => void) => { rendererListeners.set(event, fn); }),
      off: offSpy,
    };
    const scene = Object.create(MainScene.prototype) as MainScene;
    (scene as unknown as { game: { events: ReturnType<typeof createMockGameEventEmitter>; renderer: typeof renderer } }).game = {
      events: createMockGameEventEmitter(),
      renderer,
    };
    (scene as unknown as { registeredGameEvents: unknown[] }).registeredGameEvents = [];

    const mockMinimapHandler = vi.fn();
    scene.minimapClickHandler = mockMinimapHandler;
    scene._preRenderHandler = vi.fn();
    scene._postRenderHandler = vi.fn();

    scene.shutdown();

    expect(offSpy).toHaveBeenCalledWith('prerender', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('postrender', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('minimap-click-ui', mockMinimapHandler);
    expect(scene.minimapClickHandler).toBeNull();
  });
});

describe('S14: Terrain Sentinel NO_TERRAIN', () => {
  it('correctly validates heights and recognizes the NO_TERRAIN sentinel', () => {
    expect(isTerrainValid(0)).toBe(true);
    expect(isTerrainValid(0.45)).toBe(true);
    expect(isTerrainValid(1)).toBe(true);
    expect(isTerrainValid(NO_TERRAIN)).toBe(false);
    expect(isTerrainValid(-1)).toBe(false);
    expect(isTerrainValid(Number.NaN)).toBe(false);
    expect(isTerrainValid(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('rejects out-of-map placement through BuildingManager.canPlace', () => {
    const scene = {
      resources: { wood: 0, food: 0, gold: 0 },
      buildings: { getChildren: () => [], getLength: () => 0 },
      units: { getChildren: () => [] },
      trees: { getChildren: () => [] },
      terrainSystem: {
        getHeightAt: (x: number, y: number) => (x < 0 || y < 0 ? NO_TERRAIN : 0.8),
        getSlopeAt: () => ({ slope: 0, isBuildable: true }),
      },
    } as unknown as MainScene;

    const manager = Object.create(BuildingManager.prototype) as BuildingManager;
    (manager as unknown as { scene: typeof scene }).scene = scene;

    const result = manager.canPlace(BuildingType.HOUSE, -100, 50, 1, {
      checkResources: false,
      requireTerritory: false,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Cannot build outside map or on water');
  });
});

describe('S11: Population Catch-up Loop', () => {
  it('caps catch-up population ticks to MAX_POP_WINDOWS_PER_UPDATE and resets overflow', () => {
    let popTicks = 0;
    const services = {
      isStressMode: false,
      session: { isPlaying: true },
      victory: { check: vi.fn() },
      economy: { tick: vi.fn(), assignJobs: vi.fn() },
      research: { tick: vi.fn() },
      season: { elapsed: 0, setElapsed: vi.fn(), change: vi.fn() },
      world: { respawnGoldMines: vi.fn(), fireGarrison: vi.fn() },
      autoSave: { save: vi.fn() },
      population: { tick: () => { popTicks++; } },
      age: { isAdvancing: false, nextAge: null, progress: vi.fn() },
    } as unknown as ProgressionServices;

    const runtime = new ProgressionRuntime();

    // Normal single tick at 8000ms
    runtime.update({ services, now: 8000, dt: 8000 } as ProgressionContext);
    expect(popTicks).toBe(1);

    // Large delta: 40000ms (5 windows accumulated). Should process max 3 windows and reset.
    runtime.update({ services, now: 48000, dt: 40000 } as ProgressionContext);
    expect(popTicks).toBe(4); // 1 + 3

    // Next small update should not trigger a residual tick because overflow was cleared
    runtime.update({ services, now: 49000, dt: 1000 } as ProgressionContext);
    expect(popTicks).toBe(4);
  });
});
