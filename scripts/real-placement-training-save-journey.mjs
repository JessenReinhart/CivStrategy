import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/real-placement-training-save.json`;
const TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE_URL)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Vite did not become ready.\n${serverOutput}`);
}

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), sleep(2_000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

async function waitForScene(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager && scene?.pathfinder && scene?.units);
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.events.once('postupdate', resolve);
  }));
}

async function preparePlacement(page, type) {
  return page.evaluate(async (buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const townCenter = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center'
    ));
    if (!townCenter) throw new Error('Player Town Center missing.');

    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS[buildingType];
    if (!def) throw new Error(`${buildingType} definition missing.`);

    const grid = 16;
    const snap = (value) => Math.floor(value / grid) * grid;
    let center = null;
    for (let oy = 0; oy <= 640 && !center; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const candidate = {
          x: snap(townCenter.x - 320) + ox + def.width / 2,
          y: snap(townCenter.y - 320) + oy + def.height / 2,
        };
        if (manager.getBuildValidity(candidate.x, candidate.y, buildingType).valid) {
          center = candidate;
          break;
        }
      }
    }
    if (!center) throw new Error(`No valid ${buildingType} placement found.`);

    const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(iso.x, iso.y);
    window.__placementSaveBaseline = new Set(scene.buildings.getChildren());
    return { center, iso };
  }, type);
}

async function placeThroughUi(page, canvas, category, type) {
  const setup = await preparePlacement(page, type);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: new RegExp(category, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  await page.waitForFunction((buildingType) => (
    window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === buildingType
  ), type, { timeout: 5_000 });

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable.');
  const point = await page.evaluate((iso) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (iso.x - topLeft.x) * camera.zoom,
      y: (iso.y - topLeft.y) * camera.zoom,
    };
  }, setup.iso);

  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((building) => (
      !window.__placementSaveBaseline.has(building)
      && building.getData('owner') === 0
      && building.getData('def')?.type === buildingType
    ));
  }, type, { timeout: 5_000 });

  return page.evaluate((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren().find((candidate) => (
      !window.__placementSaveBaseline.has(candidate)
      && candidate.getData('owner') === 0
      && candidate.getData('def')?.type === buildingType
    ));
    window.__placementSaveBuilding = building;
    return {
      x: building.x,
      y: building.y,
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
    };
  }, type);
}

async function buildingScreenPoint(page) {
  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__placementSaveBuilding;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const visual = building.visual;
    const hitArea = visual.input?.hitArea;
    const localX = typeof hitArea?.centerX === 'number' ? hitArea.centerX : 0;
    const localY = typeof hitArea?.centerY === 'number' ? hitArea.centerY : -24;
    const transformed = visual.getWorldTransformMatrix().transformPoint(localX, localY);
    return {
      x: (transformed.x - topLeft.x) * camera.zoom,
      y: (transformed.y - topLeft.y) * camera.zoom,
    };
  });
}

async function unitScreenPoint(page) {
  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementSaveUnit;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  });
}

async function cartesianScreenPoint(page, target) {
  return page.evaluate(({ x, y }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const iso = { x: x - y, y: (x + y) * 0.5 };
    return {
      x: (iso.x - topLeft.x) * camera.zoom,
      y: (iso.y - topLeft.y) * camera.zoom,
    };
  }, target);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try {
    await page.screenshot({ path: `${ARTIFACT_DIR}/real-placement-training-save.png`, fullPage: true });
  } catch {
    // Telemetry is still useful if Chromium has already stopped.
  }
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.baseline = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    return {
      wood: scene.resources.wood,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  });

  const canvas = page.locator('canvas').first();

  evidence.phase = 'house-placement';
  evidence.house = await placeThroughUi(page, canvas, 'Economy', 'House');
  if (evidence.house.maxPopulation !== evidence.baseline.maxPopulation + 8) {
    throw new Error('Real House placement did not increase population capacity by 8.');
  }
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks-placement';
  evidence.barracks = await placeThroughUi(page, canvas, 'Military', 'Barracks');
  if (evidence.barracks.wood >= evidence.house.wood) {
    throw new Error('Real Barracks placement did not deduct wood.');
  }
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks-selection';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__placementSaveBuilding;
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await waitForCameraSync(page);
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable for Barracks selection.');
  let point = await buildingScreenPoint(page);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__placementSaveBuilding
  ), undefined, { timeout: 5_000 });

  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });

  evidence.phase = 'train';
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    return scene.population === before.population + 1 && playerUnits.length === before.military + 1;
  }, evidence.beforeTraining, { timeout: 5_000 });

  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    const unit = playerUnits[playerUnits.length - 1];
    window.__placementSaveUnit = unit;
    scene.gameSpeed = 0.75;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: playerUnits.length,
      type: unit?.unitType ?? unit?.getData('unitType'),
      x: unit?.x,
      y: unit?.y,
      hp: unit?.getData('hp'),
      maxPopulation: scene.maxPopulation,
    };
  });

  if (evidence.afterTraining.type !== 'Pikesman') throw new Error('Real Barracks UI did not train a Pikesman.');
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100) throw new Error('Pikesman food cost was not exactly 100.');
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman gold cost was not exactly 50.');

  evidence.phase = 'save';
  evidence.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementSaveUnit;
    const barracks = window.__placementSaveBuilding;
    const snapshot = {
      x: unit.x,
      y: unit.y,
      hp: unit.getData('hp'),
      barracksX: barracks.x,
      barracksY: barracks.y,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      military: scene.units.getChildren().filter((candidate) => candidate.getData('owner') === 0).length,
    };
    window.dispatchEvent(new Event('save-game'));
    return snapshot;
  });
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    if (!scene?.isReady) return false;
    const survivorRestored = scene.units.getChildren().some((unit) => (
      unit.getData?.('owner') === 0
      && (unit.unitType ?? unit.getData?.('unitType')) === 'Pikesman'
      && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2
    ));
    const barracksRestored = scene.buildings.getChildren().some((building) => (
      building.getData?.('owner') === 0
      && building.getData?.('def')?.type === 'Barracks'
      && Math.hypot(building.x - saved.barracksX, building.y - saved.barracksY) <= 2
    ));
    return survivorRestored && barracksRestored;
  }, evidence.beforeSave, { timeout: 20_000 });

  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = scene.units.getChildren()
      .filter((candidate) => candidate.getData?.('owner') === 0 && (candidate.unitType ?? candidate.getData?.('unitType')) === 'Pikesman')
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    const barracks = scene.buildings.getChildren()
      .filter((candidate) => candidate.getData?.('owner') === 0 && candidate.getData?.('def')?.type === 'Barracks')
      .sort((a, b) => Math.hypot(a.x - saved.barracksX, a.y - saved.barracksY) - Math.hypot(b.x - saved.barracksX, b.y - saved.barracksY))[0];
    if (!unit) throw new Error('Trained Pikesman was not restored.');
    if (!barracks) throw new Error('Player-placed Barracks was not restored.');
    window.__placementSaveUnit = unit;
    window.__placementSaveBuilding = barracks;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
    return {
      x: unit.x,
      y: unit.y,
      hp: unit.getData('hp'),
      barracksX: barracks.x,
      barracksY: barracks.y,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      military: scene.units.getChildren().filter((candidate) => candidate.getData('owner') === 0).length,
      positionDelta: Math.hypot(unit.x - saved.x, unit.y - saved.y),
      barracksPositionDelta: Math.hypot(barracks.x - saved.barracksX, barracks.y - saved.barracksY),
    };
  }, evidence.beforeSave);

  if (evidence.restored.positionDelta > 2) throw new Error('Trained Pikesman position changed across reload.');
  if (evidence.restored.barracksPositionDelta > 2) throw new Error('Player-placed Barracks position changed across reload.');
  if (evidence.restored.hp !== evidence.beforeSave.hp) throw new Error('Trained Pikesman HP changed across reload.');
  for (const key of ['food', 'gold', 'population', 'maxPopulation', 'military']) {
    if (evidence.restored[key] !== evidence.beforeSave[key]) throw new Error(`${key} changed across save/load.`);
  }

  evidence.phase = 'post-load-production';
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable for restored Barracks selection.');
  point = await buildingScreenPoint(page);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__placementSaveBuilding
  ), undefined, { timeout: 5_000 });
  evidence.beforePostLoadTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    return scene.population === before.population + 1 && playerUnits.length === before.military + 1;
  }, evidence.beforePostLoadTraining, { timeout: 5_000 });
  evidence.afterPostLoadTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });
  if (evidence.afterPostLoadTraining.food !== evidence.beforePostLoadTraining.food - 100) {
    throw new Error('Restored Barracks Pikesman food cost was not exactly 100.');
  }
  if (evidence.afterPostLoadTraining.gold !== evidence.beforePostLoadTraining.gold - 50) {
    throw new Error('Restored Barracks Pikesman gold cost was not exactly 50.');
  }
  if (evidence.afterPostLoadTraining.population !== evidence.beforePostLoadTraining.population + 1) {
    throw new Error('Restored Barracks did not increase population after training.');
  }
  if (evidence.afterPostLoadTraining.military !== evidence.beforePostLoadTraining.military + 1) {
    throw new Error('Restored Barracks did not create a new military unit after load.');
  }

  evidence.phase = 'continue-playing';
  evidence.moveTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__placementSaveUnit;
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.gameSpeed = 0.75;
    scene.cameras.main.centerOn(unit.visual.x, unit.visual.y);
    const candidates = [[64, 0], [-64, 0], [0, 64], [0, -64], [48, 48], [-48, -48]];
    for (const [dx, dy] of candidates) {
      const target = { x: unit.x + dx, y: unit.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: unit.x, y: unit.y }, target);
      if (path?.length > 1) {
        unit.setData('__journeyStartX', unit.x);
        unit.setData('__journeyStartY', unit.y);
        return target;
      }
    }
    throw new Error('Could not find a post-load walkable target.');
  });

  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable after reload.');
  point = await unitScreenPoint(page);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__placementSaveUnit)
  ), undefined, { timeout: 5_000 });

  point = await cartesianScreenPoint(page, evidence.moveTarget);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const unit = window.__placementSaveUnit;
    return Math.hypot(unit.x - unit.getData('__journeyStartX'), unit.y - unit.getData('__journeyStartY')) > 5;
  }, undefined, { timeout: 12_000 });

  evidence.afterContinue = await page.evaluate(() => {
    const unit = window.__placementSaveUnit;
    return {
      x: unit.x,
      y: unit.y,
      moved: Math.hypot(unit.x - unit.getData('__journeyStartX'), unit.y - unit.getData('__journeyStartY')),
    };
  });

  if (evidence.browserErrors.length > 0) {
    throw new Error(`Browser errors observed: ${evidence.browserErrors.join(' | ')}`);
  }

  evidence.phase = 'passed';
  await persistEvidence();
  console.log('Real placement -> training -> save/reload journey passed.');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.message : String(error);
  await persistEvidence();
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}