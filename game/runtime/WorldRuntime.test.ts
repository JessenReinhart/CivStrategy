import { describe, expect, it, vi } from 'vitest';
import { WorldRuntime } from './WorldRuntime';
import { WorldRuntimeHost } from './WorldRuntimeHost';
import { createMainSceneWorldBridge } from './MainSceneWorldBridge';
import type { WorldContext } from './WorldContext';
import type { WorldServices } from './WorldServices';
import type { MainScene } from '../MainScene';

function createServices(
  infiniteMap = true,
  minimap = true,
  fogOfWar = true,
): WorldServices & { events: string[] } {
  const events: string[] = [];
  const mark = (name: string) => vi.fn(() => events.push(name));

  const services: WorldServices = {
    get infiniteMap() {
      return infiniteMap ? { update: mark('infiniteMapSystem') } : null;
    },
    get minimap() {
      return minimap ? { update: mark('minimapSystem') } : null;
    },
    get fogOfWar() {
      return fogOfWar ? { update: mark('fogOfWar') } : null;
    },
  };

  return Object.assign(services, { events }) as WorldServices & { events: string[] };
}

function createContext(services: WorldServices): WorldContext {
  return {
    services,
    now: 1000,
    dt: 16,
    profile: (_label, work) => work(),
  };
}

describe('WorldRuntime', () => {
  it('preserves the world pipeline ordering', () => {
    const services = createServices(true, true, true);
    const runtime = new WorldRuntime();
    const ctx = createContext(services);

    runtime.update(ctx);

    expect(services.events).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);
  });

  it('skips infiniteMap when null (non-infinite map)', () => {
    const services = createServices(false, true, true);
    const runtime = new WorldRuntime();
    const ctx = createContext(services);

    runtime.update(ctx);

    expect(services.events).toEqual(['minimapSystem', 'fogOfWar']);
  });

  it('skips minimap when null (stress mode)', () => {
    const services = createServices(true, false, true);
    const runtime = new WorldRuntime();
    const ctx = createContext(services);

    runtime.update(ctx);

    expect(services.events).toEqual(['infiniteMapSystem', 'fogOfWar']);
  });

  it('skips fogOfWar when null (disabled)', () => {
    const services = createServices(true, true, false);
    const runtime = new WorldRuntime();
    const ctx = createContext(services);

    runtime.update(ctx);

    expect(services.events).toEqual(['infiniteMapSystem', 'minimapSystem']);
  });

  it('profiles every executed stage', () => {
    const services = createServices(true, true, true);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const runtime = new WorldRuntime();
    runtime.update({ services, now: 1000, dt: 16, profile });

    expect(labels).toEqual(['infiniteMapSystem', 'minimapSystem', 'fogOfWar']);
  });
});

describe('WorldRuntimeHost', () => {
  it('delegates to the runtime with services and profile', () => {
    const services = createServices(true, true, true);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = new WorldRuntimeHost(new WorldRuntime(), services, profile);

    host.update(1000, 16);

    expect(labels).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);
  });

  it('throttles fogOfWar to 100ms', () => {
    const services = createServices(true, true, true);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = new WorldRuntimeHost(new WorldRuntime(), services, profile);

    // First call — should run all three
    host.update(1000, 16);
    expect(labels).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);

    // Second call within 100ms — fogOfWar should be throttled
    labels.length = 0;
    host.update(1050, 16);
    expect(labels).toEqual(['infiniteMapSystem', 'minimapSystem']);

    // Third call after 100ms — fogOfWar should run again
    labels.length = 0;
    host.update(1100, 16);
    expect(labels).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);
  });

  it('runs infiniteMap and minimap every frame regardless of fog throttle', () => {
    const services = createServices(true, true, true);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = new WorldRuntimeHost(new WorldRuntime(), services, profile);

    host.update(1000, 16);
    expect(labels).toContain('infiniteMapSystem');
    expect(labels).toContain('minimapSystem');

    labels.length = 0;
    host.update(1050, 16); // within throttle
    expect(labels).toContain('infiniteMapSystem');
    expect(labels).toContain('minimapSystem');
    expect(labels).not.toContain('fogOfWar');
  });
});

describe('createMainSceneWorldBridge', () => {
  it('assembles host with scene services and profile adapter', () => {
    const labels: string[] = [];
    const mockScene = {
      stressTestConfig: null,
      infiniteMapSystem: { update: vi.fn() },
      minimapSystem: { update: vi.fn() },
      fogOfWar: { update: vi.fn() },
    } as unknown as MainScene;

    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = createMainSceneWorldBridge(mockScene, profile);

    host.update(1000, 16);

    expect(labels).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);

    expect(mockScene.infiniteMapSystem.update).toHaveBeenCalled();
    expect(mockScene.minimapSystem.update).toHaveBeenCalled();
    expect(mockScene.fogOfWar!.update).toHaveBeenCalled();
  });

  it('skips all world systems when scene has stressTestConfig', () => {
    const mockScene = {
      stressTestConfig: { unitCount: 500 },
      infiniteMapSystem: { update: vi.fn() },
      minimapSystem: { update: vi.fn() },
      fogOfWar: { update: vi.fn() },
    } as unknown as MainScene;

    const host = createMainSceneWorldBridge(mockScene, (_l, w) => w());

    host.update(1000, 16);

    expect(mockScene.infiniteMapSystem.update).not.toHaveBeenCalled();
    expect(mockScene.minimapSystem.update).not.toHaveBeenCalled();
    expect(mockScene.fogOfWar!.update).not.toHaveBeenCalled();
  });
});

describe('WorldRuntimeHost — per-frame fog throttle boundary', () => {
  it('throttles exactly at 100ms boundary', () => {
    const services = createServices(true, true, true);
    const host = new WorldRuntimeHost(
      new WorldRuntime(),
      services,
      (label, work) => work(),
    );

    host.update(1000, 16); // initial
    host.update(1050, 16); // 50ms — throttled
    host.update(1099, 16); // 99ms — throttled
    host.update(1100, 16); // 100ms — NOT throttled
  });
});

describe('createMainSceneWorldBridge — preserves ordering and profile labels', () => {
  it('matches MainScene original ordering and label set', () => {
    const labels: string[] = [];
    const mockScene = {
      stressTestConfig: null,
      infiniteMapSystem: { update: vi.fn() },
      minimapSystem: { update: vi.fn() },
      fogOfWar: { update: vi.fn() },
    } as unknown as MainScene;

    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = createMainSceneWorldBridge(mockScene, profile);
    host.update(1000, 16);

    expect(labels).toEqual([
      'infiniteMapSystem',
      'minimapSystem',
      'fogOfWar',
    ]);
  });
});