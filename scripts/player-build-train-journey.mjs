import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/player-build-train.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

async function preparePlacement(page, type) {
  return page.evaluate((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing.');
    const def = { House: { width: 48, height: 48 }, Barracks: { width: 72, height: 72 } }[buildingType];
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    let center = null;
    for (let oy = 0; oy <= 640 && !center; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const candidate = { x: snap(tc.x - 320) + ox + def.width / 2, y: snap(tc.y - 320) + oy + def.height / 2 };
        if (manager.getBuildValidity(candidate.x, candidate.y, buildingType).valid) { center = candidate; break; }
      }
    }
    if (!center) throw new Error(`No valid ${buildingType} placement found.`);
    const iso = { x: (center.x - def.width / 2) - (center.y - def.height / 2), y: ((center.x - def.width / 2) + (center.y - def.height / 2)) * 0.5 };
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(iso.x, iso.y);
    window.__buildTrainBaseline = new Set(scene.buildings.getChildren());
    return { center, iso };
  }, type);
}

async function placeThroughUi(page, canvas, category, type) {
  const setup = await preparePlacement(page, type);
  await page.getByRole('button', { name: new RegExp(category, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  await page.waitForFunction((t) => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === t, type, { timeout: 5_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable.');
  const point = await page.evaluate((iso) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, setup.iso);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__buildTrainBaseline;
    return scene.buildings.getChildren().some((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
  }, type, { timeout: 5_000 });
  return page.evaluate((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__buildTrainBaseline;
    const building = scene.buildings.getChildren().find((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
    window.__buildTrainLast = building;
    return { wood: scene.resources.wood, food: scene.resources.food, gold: scene.resources.gold, population: scene.population, maxPopulation: scene.maxPopulation, x: building.x, y: building.y };
  }, type);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);

  evidence.baseline = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    return { wood: scene.resources.wood, food: scene.resources.food, gold: scene.resources.gold, population: scene.population, maxPopulation: scene.maxPopulation };
  });

  const canvas = page.locator('canvas').first();
  evidence.phase = 'house-placement';
  evidence.afterHouse = await placeThroughUi(page, canvas, 'Economy', 'House');
  if (evidence.afterHouse.wood !== evidence.baseline.wood - 50) throw new Error('House wood cost was not exactly 50.');
  if (evidence.afterHouse.maxPopulation !== evidence.baseline.maxPopulation + 8) throw new Error('House did not add exactly 8 population capacity.');
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks-placement';
  evidence.afterBarracks = await placeThroughUi(page, canvas, 'Military', 'Barracks');
  if (evidence.afterBarracks.wood >= evidence.afterHouse.wood) throw new Error('Barracks placement did not deduct wood.');
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks-selection';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__buildTrainLast;
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  const box = await canvas.boundingBox();
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__buildTrainLast;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (building.visual.x - topLeft.x) * camera.zoom, y: (building.visual.y - 24 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y, { button: 'left' });
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__buildTrainLast, undefined, { timeout: 5_000 });

  evidence.trainingIsolation = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    window.__buildTrainPreviousGameSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    return { previousGameSpeed: window.__buildTrainPreviousGameSpeed, pausedGameSpeed: scene.gameSpeed };
  });
  const pausedResources = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { food: scene.resources.food, gold: scene.resources.gold };
  });
  await sleep(250);
  const stableResources = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { food: scene.resources.food, gold: scene.resources.gold };
  });
  if (stableResources.food !== pausedResources.food || stableResources.gold !== pausedResources.gold) {
    throw new Error('Player resources continued drifting while simulation time was paused.');
  }

  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, military: scene.units.getChildren().filter((u) => u.getData('owner') === 0).length };
  });
  evidence.phase = 'train';
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.population === before.population + 1 && scene.units.getChildren().filter((u) => u.getData('owner') === 0).length === before.military + 1;
  }, evidence.beforeTraining, { timeout: 5_000 });
  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((u) => u.getData('owner') === 0);
    const newest = playerUnits[playerUnits.length - 1];
    const result = { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, military: playerUnits.length, type: newest?.unitType ?? newest?.getData('unitType') };
    scene.gameSpeed = window.__buildTrainPreviousGameSpeed;
    return { ...result, restoredGameSpeed: scene.gameSpeed };
  });
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100) throw new Error('Pikesman food cost was not exactly 100.');
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman gold cost was not exactly 50.');
  if (evidence.afterTraining.population !== evidence.beforeTraining.population + 1) throw new Error('Pikesman training did not add exactly 1 population.');
  if (evidence.afterTraining.military !== evidence.beforeTraining.military + 1) throw new Error('Pikesman training did not create exactly one player military unit.');
  if (evidence.afterTraining.type !== 'Pikesman') throw new Error(`Expected trained Pikesman, got ${evidence.afterTraining.type}.`);
  if (evidence.afterTraining.restoredGameSpeed !== evidence.trainingIsolation.previousGameSpeed) throw new Error('Game speed was not restored after training-cost isolation.');
  if (evidence.browserErrors.length) throw new Error(`Browser errors:\n${evidence.browserErrors.join('\n')}`);

  evidence.phase = 'complete';
  await page.screenshot({ path: `${ARTIFACT_DIR}/player-build-train.png`, fullPage: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (page) { try { await page.screenshot({ path: `${ARTIFACT_DIR}/player-build-train-failure.png`, fullPage: true }); } catch {} }
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
