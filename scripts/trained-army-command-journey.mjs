import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/trained-army-command.json`;
const TRAINED_COUNT = 3;
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
    try { if ((await fetch(BASE_URL)).ok) return; } catch {}
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
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager && scene?.economySystem);
  }, undefined, { timeout: 45_000 });
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.events.once('postupdate', resolve);
  }));
}

async function prepareBarracksPlacement(page) {
  return page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const tc = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center'
    ));
    if (!tc) throw new Error('Player Town Center missing.');
    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS.Barracks;
    const grid = 16;
    const snap = (value) => Math.floor(value / grid) * grid;
    for (let oy = 0; oy <= 640; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const center = {
          x: snap(tc.x - 320) + ox + def.width / 2,
          y: snap(tc.y - 320) + oy + def.height / 2,
        };
        if (!scene.buildingManager.getBuildValidity(center.x, center.y, 'Barracks').valid) continue;
        const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
        scene.cameras.main.setZoom(1.5);
        scene.cameras.main.centerOn(iso.x, iso.y);
        window.__trainedArmyBuildingBaseline = new Set(scene.buildings.getChildren());
        return { iso };
      }
    }
    throw new Error('No valid Barracks placement found.');
  });
}

async function placeBarracksThroughUi(page, canvas) {
  const setup = await prepareBarracksPlacement(page);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: /Military/i }).click();
  await page.getByRole('button', { name: /Barracks/i }).click();
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === 'Barracks'
  ), undefined, { timeout: 5_000 });

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for Barracks placement.');
  const point = await page.evaluate((iso) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, setup.iso);
  await page.mouse.click(box.x + point.x, box.y + point.y);

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__trainedArmyBuildingBaseline;
    return scene.buildings.getChildren().some((building) => (
      !baseline.has(building) && building.getData('owner') === 0 && building.getData('def')?.type === 'Barracks'
    ));
  }, undefined, { timeout: 5_000 });

  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__trainedArmyBuildingBaseline;
    const barracks = scene.buildings.getChildren().find((building) => (
      !baseline.has(building) && building.getData('owner') === 0 && building.getData('def')?.type === 'Barracks'
    ));
    if (!barracks) throw new Error('Placed Barracks disappeared before selection.');
    window.__trainedArmyBarracks = barracks;
    return { wood: scene.resources.wood, gold: scene.resources.gold };
  });
}

async function unitScreenPoints(page) {
  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return window.__trainedArmyUnits.map((unit) => ({
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    }));
  });
}

async function cartesianScreenPoint(page, target) {
  return page.evaluate((cart) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const iso = { x: cart.x - cart.y, y: (cart.x + cart.y) * 0.5 };
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, target);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/trained-army-command.png`, fullPage: true }); } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);

  evidence.phase = 'economy-setup';
  evidence.baseline = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    window.__trainedArmyPreviousGameSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    return {
      wood: scene.resources.wood,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  });

  const canvas = page.locator('canvas').first();
  evidence.phase = 'barracks-placement';
  evidence.afterBarracks = await placeBarracksThroughUi(page, canvas);
  if (evidence.afterBarracks.wood !== evidence.baseline.wood - 150 || evidence.afterBarracks.gold !== evidence.baseline.gold - 50) {
    throw new Error(`Barracks charged unexpected resources: ${JSON.stringify(evidence.afterBarracks)}`);
  }
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks-selection';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__trainedArmyBarracks;
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await waitForCameraSync(page);
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for Barracks selection.');
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__trainedArmyBarracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (barracks.visual.x - topLeft.x) * camera.zoom, y: (barracks.visual.y - 24 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y);
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__trainedArmyBarracks
  ), undefined, { timeout: 5_000 });

  evidence.phase = 'train-army';
  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    window.__trainedArmyUnitBaseline = new Set(scene.units.getChildren());
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });

  for (let index = 1; index <= TRAINED_COUNT; index += 1) {
    await page.getByRole('button', { name: /Pikesman/i }).click();
    await page.waitForFunction(({ before, expectedAdded }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      return scene.population === before.population + expectedAdded
        && scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length === before.military + expectedAdded;
    }, { before: evidence.beforeTraining, expectedAdded: index }, { timeout: 5_000 });
  }

  evidence.afterTraining = await page.evaluate((trainedCount) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__trainedArmyUnitBaseline;
    const trained = scene.units.getChildren().filter((unit) => (
      !baseline.has(unit) && unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === 'Pikesman'
    ));
    if (trained.length !== trainedCount) throw new Error(`Expected ${trainedCount} UI-trained Pikesmen, found ${trained.length}.`);
    window.__trainedArmyUnits = trained;
    trained.forEach((unit) => {
      unit.setData('__trainedArmyStartX', unit.x);
      unit.setData('__trainedArmyStartY', unit.y);
    });
    scene.gameSpeed = window.__trainedArmyPreviousGameSpeed || 1;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      trainedCount: trained.length,
      positions: trained.map((unit) => ({ x: unit.x, y: unit.y })),
    };
  }, TRAINED_COUNT);

  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100 * TRAINED_COUNT) {
    throw new Error('Training the army charged the wrong food total.');
  }
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50 * TRAINED_COUNT) {
    throw new Error('Training the army charged the wrong gold total.');
  }
  if (evidence.afterTraining.population !== evidence.beforeTraining.population + TRAINED_COUNT) {
    throw new Error('Training the army produced the wrong population delta.');
  }

  evidence.phase = 'drag-select-trained-army';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = window.__trainedArmyUnits;
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    const x = units.reduce((sum, unit) => sum + unit.visual.x, 0) / units.length;
    const y = units.reduce((sum, unit) => sum + unit.visual.y, 0) / units.length;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(x, y);
  });
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for trained-army selection.');
  const points = await unitScreenPoints(page);
  const left = Math.min(...points.map((point) => point.x)) - 28;
  const right = Math.max(...points.map((point) => point.x)) + 28;
  const top = Math.min(...points.map((point) => point.y)) - 28;
  const bottom = Math.max(...points.map((point) => point.y)) + 28;
  await page.mouse.move(box.x + left, box.y + top);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(box.x + right, box.y + bottom, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((expected) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const trained = window.__trainedArmyUnits;
    return trained.length === expected && trained.every((unit) => scene.inputManager.selectedUnits.includes(unit));
  }, TRAINED_COUNT, { timeout: 5_000 });
  evidence.selection = await page.evaluate(() => ({
    selectedCount: window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.length,
    trainedSelected: window.__trainedArmyUnits.filter((unit) => (
      window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(unit)
    )).length,
  }));

  evidence.phase = 'group-move';
  evidence.moveTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = window.__trainedArmyUnits;
    const centroid = units.reduce(
      (point, unit) => ({ x: point.x + unit.x / units.length, y: point.y + unit.y / units.length }),
      { x: 0, y: 0 },
    );
    const candidates = [[96, 0], [-96, 0], [0, 96], [0, -96], [72, 72], [-72, -72]];
    for (const [dx, dy] of candidates) {
      const target = { x: centroid.x + dx, y: centroid.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const reachable = units.every((unit) => {
        const path = scene.pathfinder.findPath({ x: unit.x, y: unit.y }, target);
        return Boolean(path?.length && path.length > 1);
      });
      if (reachable) return target;
    }
    throw new Error('No common reachable group-move target for the UI-trained army.');
  });
  const movePoint = await cartesianScreenPoint(page, evidence.moveTarget);
  await page.mouse.click(box.x + movePoint.x, box.y + movePoint.y, { button: 'right' });

  await page.waitForFunction((expected) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const trained = window.__trainedArmyUnits;
    return trained.length === expected
      && trained.every((unit) => unit.active && scene.units.getChildren().includes(unit))
      && trained.every((unit) => Math.hypot(
        unit.x - unit.getData('__trainedArmyStartX'),
        unit.y - unit.getData('__trainedArmyStartY'),
      ) > 5);
  }, TRAINED_COUNT, { timeout: 20_000 });

  evidence.afterMove = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      selectedCount: scene.inputManager.selectedUnits.length,
      units: window.__trainedArmyUnits.map((unit) => ({
        active: unit.active,
        x: unit.x,
        y: unit.y,
        moved: Math.hypot(unit.x - unit.getData('__trainedArmyStartX'), unit.y - unit.getData('__trainedArmyStartY')),
        pathLength: unit.path?.length ?? 0,
      })),
    };
  });
  if (evidence.afterMove.units.some((unit) => !unit.active || unit.moved <= 5)) {
    throw new Error(`One or more UI-trained army units failed to move: ${JSON.stringify(evidence.afterMove)}`);
  }
  if (evidence.browserErrors.length > 0) {
    throw new Error(`Browser errors occurred: ${evidence.browserErrors.join(' | ')}`);
  }

  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
