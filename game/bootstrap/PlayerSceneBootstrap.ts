import Phaser from 'phaser';

import { AGE_CONFIGS, EVENTS, TECH_DEFS } from '../../constants';
import { Age, BuildingType, FormationType, MapMode, TechId, UnitStance, UnitType } from '../../types';
import {
  dispatchGameLoadComplete,
  dispatchGameLoadProgress,
  yieldToBrowser,
} from '../../utils/gameLoading';
import type { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';
import { FogOfWarSystem } from '../systems/FogOfWarSystem';
import { MinimapSystem } from '../systems/MinimapSystem';
import {
  clearPendingLoad,
  deserializeGame,
  isPendingLoad,
  loadFromLocalStorage,
} from '../systems/SaveSystem';
import { createMainSceneSimulationBridge } from '../runtime/MainSceneSimulationBridge';
import type { SimulationRuntimeHost } from '../runtime/SimulationRuntimeHost';
import { createMainSceneWorldBridge } from '../runtime/MainSceneWorldBridge';
import type { WorldRuntimeHost } from '../runtime/WorldRuntimeHost';
import { createMainSceneProgressionBridge } from '../runtime/MainSceneProgressionBridge';
import type { ProgressionRuntimeHost } from '../runtime/ProgressionRuntimeHost';
import { spawnStartingResourceNodes } from './StartingResourceBootstrap';
import { WaterBootstrap } from './WaterBootstrap';
import { WorldBootstrap } from './WorldBootstrap';

interface SceneInternals {
  simulationHost: SimulationRuntimeHost | null;
  worldHost: WorldRuntimeHost | null;
  progressionHost: ProgressionRuntimeHost | null;
  waterDepthSprite: Phaser.GameObjects.Sprite | null;
  waterWaveSprite: Phaser.GameObjects.TileSprite | null;
  waterMaskBounds: Phaser.Geom.Rectangle | null;
  waterAnimFrame: number;
  waterShoreChainData: { px: number; py: number; nx: number; ny: number; ph1: number; ph2: number }[][];
  _renderStart: number;
  profileTimings: Record<string, number>;
  profileStart(label: string): number;
  profileEnd(label: string, startTime: number): void;
}

/**
 * Cooperative startup path used by PlayerMainScene.
 *
 * MainScene.create() still exists as the legacy synchronous lifecycle while
 * its decomposition is in progress. The player-facing scene uses this owner
 * so expensive terrain and water work can yield to React between slices.
 */
export async function bootstrapPlayerScene(scene: MainScene): Promise<void> {
  const internal = scene as unknown as SceneInternals;
  let publishedProgress = 0.16;
  scene.isReady = false;

  const report = (
    progress: number,
    phase: string,
    detail: string,
    processed?: number,
    total?: number,
  ) => {
    publishedProgress = Math.max(publishedProgress, Math.min(1, Math.max(0, progress)));
    dispatchGameLoadProgress({
      progress: publishedProgress,
      phase,
      detail,
      processed,
      total,
    });
  };

  scene.game.canvas.oncontextmenu = (event) => event.preventDefault();
  report(0.17, 'Starting simulation', 'Preparing game renderer');
  await yieldToBrowser();

  // Programmatic performance API — agents/evaluate() read this.
  if (!window.__perf) {
    const MAX = 60;
    const buffer: PerfSnapshot[] = [];
    let latest: PerfSnapshot | null = null;
    let boundScene: { gameTime: number; atmosphericSystem?: { setPostFXEnabled(enabled: boolean): void }; waterAnimationEnabled: boolean } | null = null;
    let startTime = 0;
    window.__perf = {
      buffer,
      get latest() { return latest; },
      set latest(value: PerfSnapshot | null) { latest = value; },
      get maxSamples() { return MAX; },
      setPostFX(enabled: boolean) { boundScene?.atmosphericSystem?.setPostFXEnabled(enabled); },
      setWaterAnimation(enabled: boolean) {
        if (boundScene) boundScene.waterAnimationEnabled = enabled;
      },
      bind(nextScene: { gameTime: number; atmosphericSystem?: { setPostFXEnabled(enabled: boolean): void }; waterAnimationEnabled: boolean }) {
        boundScene = nextScene;
        startTime = nextScene.gameTime;
      },
      reset() {
        buffer.length = 0;
        latest = null;
        startTime = boundScene?.gameTime ?? 0;
      },
      report() {
        const elapsedS = boundScene ? (boundScene.gameTime - startTime) / 1000 : 0;
        if (buffer.length === 0) return { buffer: [], summary: null, elapsedS };
        const copy = buffer.map((sample) => ({ ...sample, hogs: sample.hogs.map((hog) => ({ ...hog })) }));
        return { buffer: copy, summary: copy[copy.length - 1], elapsedS };
      },
    };
    window.__perf.bind(scene);
  } else {
    window.__perf.bind(scene);
    window.__perf.reset();
  }

  if (!scene.textures.exists('white_flare')) {
    const graphics = scene.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(4, 4, 4);
    graphics.generateTexture('white_flare', 8, 8);
  }
  if (!scene.textures.exists('lod_dot')) {
    const graphics = scene.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(4, 4, 3);
    graphics.generateTexture('lod_dot', 8, 8);
  }
  if (!scene.textures.exists('lod_rect')) {
    const graphics = scene.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 4, 6);
    graphics.generateTexture('lod_rect', 4, 6);
  }

  await new WorldBootstrap(scene).initializeAsync((progress) => {
    report(
      0.18 + progress.progress * 0.40,
      progress.phase,
      progress.detail || 'Building world systems',
      progress.processed,
      progress.total,
    );
  });

  if (scene.mapMode === MapMode.FIXED) {
    const water = await new WaterBootstrap(scene).initialize((progress) => {
      report(
        0.58 + progress.progress * 0.24,
        progress.phase,
        progress.detail,
        progress.processed,
        progress.total,
      );
    });
    internal.waterDepthSprite = water.waterDepthSprite;
    internal.waterWaveSprite = water.waterWaveSprite;
    internal.waterMaskBounds = water.waterMaskBounds;
    internal.waterShoreChainData = water.waterShoreChainData;
    internal.waterAnimFrame = 0;
  } else {
    report(0.82, 'World environment ready', 'Infinite world streaming is ready');
    await yieldToBrowser();
  }

  report(0.84, 'Founding civilizations', 'Placing starting settlement and resources');
  await yieldToBrowser();

  const centerX = scene.mapMode === MapMode.FIXED ? scene.mapWidth / 2 : 400;
  const centerY = scene.mapMode === MapMode.FIXED ? scene.mapHeight / 2 : 400;
  const hasPendingLoad = isPendingLoad();

  scene.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, centerX, centerY, 0);
  scene.entityFactory.spawnBuilding(BuildingType.BONFIRE, centerX + 80, centerY, 0);
  scene.villagerSystem.spawnVillager(centerX + 50, centerY + 50, 0);
  scene.villagerSystem.spawnVillager(centerX - 50, centerY + 50, 0);
  scene.entityFactory.spawnUnit(UnitType.PIKESMAN, centerX, centerY + 90, 0);

  for (let i = 0; i < 3; i++) {
    scene.entityFactory.spawnUnit(UnitType.SLINGER, centerX - 60 + (i * 15), centerY + 80, 0);
  }

  spawnStartingResourceNodes(scene, centerX, centerY);

  if (!hasPendingLoad) {
    const aiTC = scene.entityFactory.spawnBuilding(BuildingType.TOWN_CENTER, scene.enemyAI.baseX, scene.enemyAI.baseY, 1);
    scene.enemyAI.buildings[0] = aiTC;
    scene.enemyAI.buildIndex = 1;
    scene.enemyAI.resources.wood -= 300;
    scene.enemyAI.resources.gold -= 100;
    scene.villagerSystem.spawnVillager(scene.enemyAI.baseX + 50, scene.enemyAI.baseY + 50, 1);
    scene.villagerSystem.spawnVillager(scene.enemyAI.baseX - 50, scene.enemyAI.baseY + 50, 1);
  }

  report(0.88, 'Founding civilizations', 'Starting units and nearby resources are ready');
  await yieldToBrowser();

  const startIso = toIso(centerX, centerY);
  scene.cameras.main.centerOn(startIso.x, startIso.y);
  scene.cameras.main.setBackgroundColor('#3a4d5c');

  scene.cursors = scene.input.keyboard!.createCursorKeys();
  scene.wasd = scene.input.keyboard!.addKeys('W,A,S,D') as {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  const debugText = scene.add.text(10, 80, '', {
    font: '14px monospace',
    color: '#00ff00',
    backgroundColor: '#000000bb',
    padding: { x: 10, y: 10 },
  }).setScrollFactor(0).setDepth(99999).setVisible(false);
  // MainScene.update owns the debug text reference.
  (scene as unknown as { debugText: Phaser.GameObjects.Text }).debugText = debugText;

  scene.input.keyboard!.on('keydown-F3', () => {
    scene.debugMode = !scene.debugMode;
    debugText.setVisible(scene.debugMode);
  });
  scene.input.keyboard!.on('keydown-I', () => {
    scene.showUnitIndicators = !scene.showUnitIndicators;
  });

  const stressKeys: Record<string, number> = { F5: 500, F6: 1000, F7: 2000 };
  for (const [key, count] of Object.entries(stressKeys)) {
    scene.input.keyboard!.on(`keydown-${key}`, () => {
      const cx = scene.mapWidth / 2;
      const cy = scene.mapHeight / 2;
      const cols = Math.ceil(Math.sqrt(count));
      const spacing = 24;
      const startX = cx - (cols * spacing) / 2;
      const startY = cy - (cols * spacing) / 2;
      const units: Phaser.GameObjects.GameObject[] = [];
      for (let i = 0; i < count; i++) {
        const x = startX + (i % cols) * spacing + Phaser.Math.Between(-4, 4);
        const y = startY + Math.floor(i / cols) * spacing + Phaser.Math.Between(-4, 4);
        const type = i % 3 === 0 ? UnitType.ARCHER : (i % 3 === 1 ? UnitType.PIKESMAN : UnitType.CAVALRY);
        const unit = scene.entityFactory.spawnUnit(type, x, y, 0);
        if (unit) units.push(unit as unknown as Phaser.GameObjects.GameObject);
      }
      const tx = scene.enemyAI.baseX ?? cx + 400;
      const ty = scene.enemyAI.baseY ?? cy - 50;
      scene.unitSystem.commandMove(units, new Phaser.Math.Vector2(tx, ty));
      scene.debugMode = true;
      debugText.setVisible(true);
      console.warn(`[STRESS] Spawned ${units.length} units, commanding move to (${tx.toFixed(0)}, ${ty.toFixed(0)})`);
    });
  }

  scene.game.events.on('request-unit-spawn', scene.handleUnitSpawnRequest, scene);
  scene.game.events.on(EVENTS.SET_TAX_RATE, (rate: number) => {
    scene.taxRate = rate;
    scene.economySystem.updateStats();
  }, scene);
  scene.game.events.on(EVENTS.CENTER_CAMERA, scene.centerCameraOnTownCenter, scene);
  scene.game.events.on(EVENTS.SET_GAME_SPEED, (speed: number) => {
    scene.gameSpeed = speed;
    scene.physics.world.timeScale = 1 / speed;
    scene.tweens.timeScale = speed;
  }, scene);
  scene.game.events.on(EVENTS.SET_BLOOM_INTENSITY, (intensity: number) => {
    scene.bloomIntensity = intensity;
    scene.atmosphericSystem.setBloomIntensity(intensity);
    scene.economySystem.updateStats();
  });

  scene.physics.world.timeScale = 1 / scene.gameSpeed;
  scene.economySystem.updateStats();

  report(0.91, 'Preparing visibility', scene.isFowEnabled ? 'Generating fog of war and minimap' : 'Generating minimap');
  await yieldToBrowser();
  scene.fogOfWar = scene.isFowEnabled ? new FogOfWarSystem(scene) : null;
  scene.minimapSystem = new MinimapSystem(scene);

  const minimapClickHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    scene.handleMinimapClick(detail.x, detail.y);
  };
  window.addEventListener('minimap-click-ui', minimapClickHandler);

  scene.game.events.on('set-bloom-intensity-ui', (intensity: number) => {
    scene.atmosphericSystem.setBloomIntensity(intensity);
    scene.economySystem.updateStats();
  });

  if (scene.game.renderer && scene.game.renderer.on) {
    scene.game.renderer.on('prerender', () => {
      internal._renderStart = performance.now();
    });
    scene.game.renderer.on('postrender', () => {
      const elapsed = performance.now() - (internal._renderStart || 0);
      internal.profileTimings.__render = (internal.profileTimings.__render || 0) + elapsed;
    });
  }

  scene.game.events.on('request-set-formation', (type: FormationType) => {
    scene.unitSystem.setFormation(type);
    scene.economySystem.updateStats();
  }, scene);
  scene.game.events.on('request-set-stance', (stance: UnitStance) => {
    scene.unitSystem.setStance(stance);
    scene.economySystem.updateStats();
  }, scene);

  // UI camera + group MUST exist before stress setup: EntityFactory.spawnBuilding
  // adds UI-only icons (vacantIcon/noResIcon) to scene.uiGroup for buildings with
  // workerNeeds/effectRadius (HOUSE/MARKET/LUMBER_CAMP/FARM/HUNTERS_LODGE/...).
  scene.uiGroup = scene.add.group({ runChildUpdate: true });
  scene.uiCamera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
  if (scene.stressTestConfig && scene.stressTestConfig.city !== true) {
    scene.uiCamera.visible = false;
    scene.fogOfWar?.screenRT.setVisible(false);
    scene.atmosphericSystem.clouds.forEach((cloud) => cloud.setVisible(false));
  }
  scene.cameras.main.ignore(scene.uiGroup);
  scene.uiCamera.ignore(scene.worldLayer);
  scene.uiCamera.ignore(scene.trees);
  scene.uiCamera.ignore(scene.buildings);
  scene.uiCamera.ignore(scene.units);
  scene.uiCamera.ignore(scene.atmosphericSystem.clouds);
  if (scene.fogOfWar) scene.uiCamera.ignore(scene.fogOfWar.screenRT);

  if (scene.stressTestConfig) {
    const config = scene.stressTestConfig;
    const isCityStress = config.city === true;
    const peacefulStress = !config.enableEnemies && !isCityStress;
    scene.waterAnimationEnabled = false;
    scene.atmosphericSystem.setPostFXEnabled(false);
    if (isCityStress) {
      scene.setupCityStress();
    } else {
      scene.terrainSystem.visualSprite?.setVisible(false);
      scene.groundLayer.setVisible(false);
      internal.waterDepthSprite?.setVisible(false);
      internal.waterWaveSprite?.setVisible(false);
      scene.setupStressTest();
      if (peacefulStress) {
        const stressDot = scene.squadSystem.lodDotBlitter;
        scene.worldLayer.removeAll(false);
        scene.worldLayer.add(stressDot);
      }
    }
  }

  scene.game.events.on(EVENTS.ADVANCE_AGE, () => scene.startAgeAdvancement());
  scene.game.events.on(EVENTS.START_RESEARCH, (techId: TechId) => {
    const def = TECH_DEFS[techId];
    if (def && scene.researchManager.tryStart(0, techId, scene.currentAge, def.hostBuildingTypes[0])) {
      scene.economySystem.updateStats();
    }
  });
  scene.events.on(EVENTS.RESEARCH_COMPLETED, (data: { playerId: number; techId: TechId }) => {
    const def = TECH_DEFS[data.techId];
    if (def) scene.feedbackSystem.notifyResearchComplete(def.name);
    if (data.playerId === 0) {
      const camera = scene.cameras.main;
      scene.proceduralSound.playResearchComplete(camera.scrollX + camera.width / 2, camera.scrollY + camera.height / 2);
    }
    scene.economySystem.updateStats();
  });
  scene.events.on(EVENTS.SEASON_CHANGED, (data: { season: import('../../types').Season }) => {
    scene.atmosphericSystem.applySeasonalTint(data.season);
    scene.proceduralSound.setSeasonalWind(data.season);
  });
  scene.events.on(EVENTS.AI_AGE_ADVANCED, (age: Age) => {
    const name = AGE_CONFIGS[age]?.name ?? age;
    scene.feedbackSystem.addNotification(`⚔️ Enemy entered ${name}!`, 'warning', 6000);
  });
  scene.game.events.on('release-garrison', () => {
    const selectedBuilding = scene.inputManager.selectedBuilding as Phaser.GameObjects.Image | null;
    if (!selectedBuilding) return;
    const def = selectedBuilding.getData('def');
    if (!def || def.type !== BuildingType.CASTLE) return;
    const garrison: Record<string, number> = selectedBuilding.getData('garrison') || {};
    const total = Object.values(garrison).reduce((sum, count) => sum + count, 0);
    if (total === 0) return;

    let offset = 0;
    for (const [typeString, count] of Object.entries(garrison)) {
      for (let i = 0; i < count; i++) {
        const angle = (offset / total) * Math.PI * 2;
        const spawnX = selectedBuilding.x + Math.cos(angle) * 60;
        const spawnY = selectedBuilding.y + Math.sin(angle) * 60;
        scene.entityFactory.spawnUnit(typeString as UnitType, spawnX, spawnY, 0);
        offset++;
      }
    }
    selectedBuilding.setData('garrison', {});
    scene.feedbackSystem.showFloatingText(selectedBuilding.x, selectedBuilding.y - 40, `${total} units released`, '#4ade80');
    scene.economySystem.updateStats();
  });

  scene.game.events.on('save-game', () => scene.saveGame());
  scene.game.events.on('load-game', () => scene.loadGame());

  let pendingSave: ReturnType<typeof loadFromLocalStorage> = null;
  if (hasPendingLoad) {
    clearPendingLoad();
    pendingSave = loadFromLocalStorage();
  }

  internal.simulationHost = createMainSceneSimulationBridge(scene, (label, work) => {
    const started = internal.profileStart(label);
    work();
    internal.profileEnd(label, started);
  });
  scene.proceduralSound.startAmbientWind();
  internal.worldHost = createMainSceneWorldBridge(scene, (label, work) => {
    const started = internal.profileStart(label);
    work();
    internal.profileEnd(label, started);
  });
  internal.progressionHost = createMainSceneProgressionBridge(scene);

  report(0.97, 'Finalizing simulation', 'Connecting runtime systems');
  await yieldToBrowser();

  if (pendingSave) {
    report(0.98, 'Restoring save', 'Applying saved civilization state');
    await new Promise<void>((resolve) => {
      scene.time.delayedCall(500, () => {
        deserializeGame(scene, pendingSave!);
        scene.feedbackSystem.addNotification('💾 Game loaded!', 'success', 3000);
        resolve();
      });
    });
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.proceduralSound.destroy();
    scene.clashSystem.destroy();
    window.removeEventListener('minimap-click-ui', minimapClickHandler);
  });

  scene.isReady = true;
  report(1, 'Realm ready', 'Simulation is ready');
  dispatchGameLoadComplete();
}