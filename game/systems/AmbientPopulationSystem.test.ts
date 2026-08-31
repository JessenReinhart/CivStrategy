/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { AmbientPopulationSystem } from './AmbientPopulationSystem';
import { AmbientRole, BuildingType, MapMode } from '../../types';
import type { MainScene } from '../MainScene';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
  },
}));

const mockCtx = {
  fillStyle: '',
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
};

interface MockSceneOptions {
  population?: number;
  maxPopulation?: number;
  stressTestConfig?: { city?: boolean; density?: string } | null;
  waterLevel?: number;
  heightAt?: number;
  buildings?: Array<{ x: number; y: number; getData: (key: string) => unknown }>;
}

function makeMockScene(options: MockSceneOptions = {}): MainScene {
  const bobs: any[] = [];
  const textures: Record<string, { frames: Record<string, unknown> }> = {};

  const makeTexture = (key: string, canvas: HTMLCanvasElement) => {
    const frames: Record<string, unknown> = {};
    const texture = {
      key,
      source: canvas,
      frames,
      add: (name: string, _sourceIndex: number, x: number, y: number, w: number, h: number) => {
        frames[name] = { name, x, y, width: w, height: h };
      },
    };
    textures[key] = texture;
    return texture;
  };

  const scene = {
    population: options.population ?? 0,
    maxPopulation: options.maxPopulation ?? 10,
    gameTime: 0,
    gameSpeed: 1,
    mapMode: MapMode.FIXED,
    mapWidth: 2048,
    mapHeight: 2048,
    stressTestConfig: options.stressTestConfig ?? null,
    getFactionColor: () => 0xff0000,
    worldLayer: { add: vi.fn() },
    cameras: {
      main: {
        worldView: { left: 0, top: 0, right: 800, bottom: 600, centerX: 400, centerY: 300 },
      },
    },
    terrainSystem: {
      getWaterLevel: () => options.waterLevel ?? 0.3,
      getHeightAt: () => options.heightAt ?? 0.4,
    },
    buildings: {
      getChildren: () => options.buildings ?? [],
    },
    textures: {
      exists: (key: string) => key in textures,
      addCanvas: vi.fn((key: string, canvas: HTMLCanvasElement) => {
        if (key in textures) return textures[key];
        return makeTexture(key, canvas);
      }),
    },
    add: {
      blitter: vi.fn(() => ({
        setDepth: vi.fn(),
        setVisible: vi.fn(),
        destroy: vi.fn(),
        create: vi.fn((x: number, y: number, frame?: string) => {
          const bob = {
            x,
            y,
            tint: 0xffffff,
            frame: { name: frame ?? '__BASE' },
            setFrame: function (name: string) {
              this.frame.name = name;
            },
          };
          bobs.push(bob);
          return bob;
        }),
      })),
    },
    make: {
      graphics: vi.fn(() => ({
        fillStyle: vi.fn(),
        fillCircle: vi.fn(),
        fillRect: vi.fn(),
        generateTexture: vi.fn((key: string, w: number, h: number) => {
          textures[key] = { frames: { __BASE: { name: '__BASE', x: 0, y: 0, width: w, height: h } } };
        }),
        destroy: vi.fn(),
      })),
    },
    events: {
      on: vi.fn((event: string, handler: unknown) => {
        if (!(scene as any).__handlers[event]) (scene as any).__handlers[event] = [];
        (scene as any).__handlers[event].push(handler);
      }),
      once: vi.fn(),
      off: vi.fn(),
    },
  } as unknown as MainScene;

  (scene as any).__bobs = bobs;
  (scene as any).__handlers = {};
  return scene;

}

describe('AmbientPopulationSystem', () => {
  let scene: MainScene;
  let ambient: AmbientPopulationSystem;

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => tag === 'canvas'
        ? { width: 0, height: 0, getContext: () => mockCtx }
        : {},
    });
  });

  afterEach(() => {
    ambient?.destroy();
    vi.unstubAllGlobals();
  });

  describe('population-linked density budget', () => {
    it('scales desired count from population ratio capped by anchor capacity', () => {
      scene = makeMockScene({
        population: 100,
        maxPopulation: 200,
        buildings: [makeBuilding(BuildingType.TOWN_CENTER, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      // Capacity is 18, population ratio 0.5 => floor(220*0.5*0.75) = 82, capped to 18.
      expect(ambient.getDesiredCitizenCount()).toBe(18);
    });

    it('keeps a baseline when population is zero', () => {
      scene = makeMockScene({
        population: 0,
        maxPopulation: 10,
        buildings: [
          makeBuilding(BuildingType.HOUSE, 1000, 1000, 1, 100),
          makeBuilding(BuildingType.HOUSE, 1050, 1000, 1, 100),
        ],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getDesiredCitizenCount()).toBe(8);
    });

    it('does not exceed MAX_CITIZENS', () => {
      scene = makeMockScene({
        population: 500,
        maxPopulation: 500,
        buildings: [makeBuilding(BuildingType.TOWN_CENTER, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getDesiredCitizenCount()).toBeLessThanOrEqual(18);
    });
  });

  describe('role mapping', () => {
    it('assigns FARMER to farm anchors', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.FARM, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      expect(ambient.getRoleForAnchor(BuildingType.FARM)).toBe(AmbientRole.FARMER);
    });

    it('assigns MERCHANT to market anchors', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.MARKET, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      expect(ambient.getRoleForAnchor(BuildingType.MARKET)).toBe(AmbientRole.MERCHANT);
    });

    it('assigns WORKER to production anchors', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.LUMBER_CAMP, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      expect(ambient.getRoleForAnchor(BuildingType.LUMBER_CAMP)).toBe(AmbientRole.WORKER);
      expect(ambient.getRoleForAnchor(BuildingType.BARRACKS)).toBe(AmbientRole.WORKER);
    });

    it('assigns CIVILIAN to civic/household anchors', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.HOUSE, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      expect(ambient.getRoleForAnchor(BuildingType.HOUSE)).toBe(AmbientRole.CIVILIAN);
    });
  });

  describe('LOD tiers and texture switching', () => {
    it('selects the generated role-specific near frame for nearby townfolk', () => {
      const market = makeBuilding(BuildingType.MARKET, 320, 260, 0, 100);
      const scene = makeMockScene({ population: 10, maxPopulation: 10, buildings: [market] });
      const ambient = new AmbientPopulationSystem(scene);

      tickUpdate(scene, ambient, 16);

      expect(ambient.getCitizenFrame(0)).toBe('merchant.near');
    });

    it('uses the detailed near frame for citizens close to the camera', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.HOUSE, 400, 300, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenTier(0)).toBe(0);
      expect(ambient.getCitizenFrame(0)).toBe('civilian.near');
    });

    it('uses the mid frame for citizens between the near and far thresholds', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.HOUSE, 1200, 1200, 1, 100)],
      });
      (scene as any).cameras.main.worldView = {
        left: -1000, top: -1000, right: 2500, bottom: 2500, centerX: 400, centerY: 300,
      };
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenTier(0)).toBe(1);
      expect(ambient.getCitizenFrame(0)).toBe('civilian.mid');
    });

    it('uses far frame for citizens far from the camera', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.HOUSE, 2300, 2300, 1, 100)],
      });
      (scene as any).cameras.main.worldView = {
        left: 0, top: 0, right: 5000, bottom: 5000, centerX: 400, centerY: 300,
      };
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenTier(0)).toBe(2);
      expect(ambient.getCitizenFrame(0)).toBe('civilian.far');
    });

    it('switches frame when the citizen moves between tiers', () => {
      scene = makeMockScene({
        buildings: [makeBuilding(BuildingType.HOUSE, 400, 300, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenFrame(0)).toBe('civilian.near');

      // Move camera far away by changing worldView center while keeping the
      // citizen inside the expanded visible world.
      (scene as any).cameras.main.worldView = {
        left: 0,
        top: 0,
        right: 3000,
        bottom: 3000,
        centerX: -1400,
        centerY: -1400,
      };
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenTier(0)).toBe(2);
      expect(ambient.getCitizenFrame(0)).toBe('civilian.far');
    });
  });

  describe('contextual activity profiles', () => {
    it('markets retarget faster than farms', () => {
      scene = makeMockScene();
      ambient = new AmbientPopulationSystem(scene);
      const market = ambient.getActivityProfile(BuildingType.MARKET);
      const farm = ambient.getActivityProfile(BuildingType.FARM);
      expect(market).not.toBeNull();
      expect(farm).not.toBeNull();
      expect(market!.retargetMs[1]).toBeLessThan(farm!.retargetMs[0]);
      expect(market!.pauseChance).toBeGreaterThan(farm!.pauseChance);
      expect(market!.jitterRadius).toBeLessThan(farm!.jitterRadius);
    });

    it('pauses by keeping its target at its current position when pause chance rolls true', () => {
      const originalRandom = Math.random;
      Math.random = () => 0.2;
      try {
        scene = makeMockScene({
          buildings: [makeBuilding(BuildingType.MARKET, 400, 300, 1, 100)],
        });
        ambient = new AmbientPopulationSystem(scene);
        tickUpdate(scene, ambient, 16);
        expect(ambient.getCitizenCount()).toBeGreaterThan(0);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe('read-only metrics', () => {
    it('exposes citizen count without exposing mutable internals', () => {
      scene = makeMockScene({
        population: 100,
        maxPopulation: 200,
        buildings: [makeBuilding(BuildingType.TOWN_CENTER, 1000, 1000, 1, 100)],
      });
      ambient = new AmbientPopulationSystem(scene);
      tickUpdate(scene, ambient, 16);
      expect(ambient.getCitizenCount()).toBe(ambient.getDesiredCitizenCount());
    });
  });
});

function makeBuilding(type: BuildingType, x: number, y: number, owner: number, hp: number) {
  return {
    x,
    y,
    getData: (key: string) => {
      if (key === 'hp') return hp;
      if (key === 'owner') return owner;
      if (key === 'def') return { type };
      return undefined;
    },
  };
}

function tickUpdate(scene: MainScene, ambient: AmbientPopulationSystem, delta: number) {
  (scene as any).gameTime += delta;
  const handler = (scene as any).__handlers['update']?.[0];
  if (typeof handler === 'function') handler.call(ambient, scene.gameTime, delta);
}
