import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4183;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/economy-progression-journey.json`;
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
    return Boolean(scene?.isReady && scene?.villagerSystem && scene?.buildingManager && scene?.inputManager && scene?.economySystem && scene?.entityFactory);
  }, undefined, { timeout: 45_000 });
}

async function waitForCameraSync(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const main = scene?.cameras?.main;
    const ui = scene?.uiCamera;
    return Boolean(main && ui)
      && Math.abs(main.scrollX - ui.scrollX) < 0.5
      && Math.abs(main.scrollY - ui.scrollY) < 0.5
      && Math.abs(main.zoom - ui.zoom) < 0.001;
  }, undefined, { timeout: 30_000 });
}

async function screenPoint(page, kind) {
  return page.evaluate((targetKind) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__economyProgressionProbe;
    const visual = targetKind === 'villager' ? probe.villager.visual : probe.camp.visual;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    let worldX = visual.x;
    let worldY = visual.y - 8;
    if (targetKind === 'camp') {
      const hitArea = visual.input?.hitArea;
      const localX = typeof hitArea?.centerX === 'number' ? hitArea.centerX : 0;
      const localY = typeof hitArea?.centerY === 'number' ? hitArea.centerY : -24;
      const transformed = visual.getWorldTransformMatrix().transformPoint(localX, localY);
      worldX = transformed.x;
      worldY = transformed.y;
    }
    return { x: (worldX - topLeft.x) * camera.zoom, y: (worldY - topLeft.y) * camera.zoom };
  }, kind);
}

async function rightClickThroughFrame(page, x, y) {
  await page.mouse.move(x, y);
  const beforeMove = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, beforeMove, { timeout: 30_000 });
  await page.mouse.move(x, y);
  const beforeDown = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.mouse.down({ button: 'right' });
  try {
    await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, beforeDown, { timeout: 30_000 });
  } finally {
    await page.mouse.up({ button: 'right' });
  }
}

async function preparePlacement(page, type) {
  return page.evaluate((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    const def = { House: { width: 48, height: 48 }, Barracks: { width: 72, height: 72 } }[buildingType];
    if (!tc || !def) throw new Error(`Cannot prepare ${buildingType} placement.`);
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    let center;
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
    window.__economyPlacementBaseline = new Set(scene.buildings.getChildren());
    return { iso };
  }, type);
}

async function placeThroughUi(page, canvas, category, type) {
  const setup = await preparePlacement(page, type);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: new RegExp(category, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  await page.waitForFunction((t) => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === t, type, { timeout: 5_000 });
  const box = await canvas.boundingBox();
  const point = await page.evaluate((iso) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, setup.iso);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((b) => !window.__economyPlacementBaseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
  }, type, { timeout: 5_000 });
  return page.evaluate((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren().find((b) => !window.__economyPlacementBaseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
    window.__economyLastBuilding = building;
    return { wood: scene.resources.wood, population: scene.population, maxPopulation: scene.maxPopulation, x: building.x, y: building.y };
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

  evidence.phase = 'gather-setup';
  evidence.gatherSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.economySystem.assignJobs = () => {};
    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    const villager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!villager?.visual) throw new Error('No idle player villager available.');
    const trees = scene.trees.getChildren().filter((tree) => tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped'));
    const tree = trees.sort((a, b) => Math.hypot(a.x - villager.x, a.y - villager.y) - Math.hypot(b.x - villager.x, b.y - villager.y))[0];
    if (!tree) throw new Error('No live tree available.');
    const dx = tree.x - villager.x;
    const dy = tree.y - villager.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const camp = scene.entityFactory.spawnBuilding('Lumber Camp', villager.x + (-dy / length) * 64, villager.y + (dx / length) * 64, 0);
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn((villager.visual.x + camp.visual.x) * 0.5, (villager.visual.y + camp.visual.y) * 0.5);
    scene.inputManager.clearSelection();
    window.__economyProgressionProbe = { villager, camp };
    return { wood: scene.resources.wood, villagerId: villager.id };
  });
  await waitForCameraSync(page);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable.');

  evidence.phase = 'select-villager';
  const villagerPoint = await screenPoint(page, 'villager');
  await page.mouse.click(box.x + villagerPoint.x, box.y + villagerPoint.y, { button: 'left' });
  await page.waitForFunction(() => Boolean(window.__economyProgressionProbe.villager.visual?.getData('workforceSelectionRing')?.active), undefined, { timeout: 30_000 });

  evidence.phase = 'assign-work';
  const campPoint = await screenPoint(page, 'camp');
  await rightClickThroughFrame(page, box.x + campPoint.x, box.y + campPoint.y);
  await page.waitForFunction(() => {
    const { villager, camp } = window.__economyProgressionProbe;
    return villager.jobBuilding === camp && camp.getData('assignedWorker') === villager;
  }, undefined, { timeout: 30_000 });

  evidence.phase = 'gather-deposit';
  evidence.gather = await page.evaluate((initialWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    let simulatedMs = 0;
    for (let i = 0; i < 2_000 && scene.resources.wood <= initialWood; i++) {
      scene.villagerSystem.update(scene.gameTime + simulatedMs, 100);
      simulatedMs += 100;
    }
    return { simulatedMs, initialWood, finalWood: scene.resources.wood };
  }, evidence.gatherSetup.wood);
  if (evidence.gather.finalWood <= evidence.gather.initialWood) throw new Error('Assigned villager did not deposit any wood.');

  evidence.phase = 'return-to-build-ui';
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Economy/i }).waitFor({ state: 'visible', timeout: 10_000 });

  evidence.phase = 'house';
  const beforeHouse = await page.evaluate(() => ({ wood: window.__civStrategyGame.scene.getScene('MainScene').resources.wood, maxPopulation: window.__civStrategyGame.scene.getScene('MainScene').maxPopulation }));
  evidence.house = await placeThroughUi(page, canvas, 'Economy', 'House');
  if (evidence.house.wood !== beforeHouse.wood - 50) throw new Error('House did not cost exactly 50 wood after gathering.');
  if (evidence.house.maxPopulation !== beforeHouse.maxPopulation + 8) throw new Error('House did not add exactly 8 population capacity.');
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks';
  evidence.barracks = await placeThroughUi(page, canvas, 'Military', 'Barracks');
  await page.keyboard.press('Escape');

  evidence.phase = 'train';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__economyLastBuilding;
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await waitForCameraSync(page);
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__economyLastBuilding;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (building.visual.x - topLeft.x) * camera.zoom, y: (building.visual.y - 24 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y, { button: 'left' });
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__economyLastBuilding, undefined, { timeout: 5_000 });
  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    window.__economyPreviousSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    return { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, units: scene.units.getChildren().filter((u) => u.getData('owner') === 0).length };
  });
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.population === before.population + 1 && scene.units.getChildren().filter((u) => u.getData('owner') === 0).length === before.units + 1;
  }, evidence.beforeTraining, { timeout: 5_000 });
  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren().filter((u) => u.getData('owner') === 0);
    const newest = units[units.length - 1];
    const result = { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, units: units.length, type: newest?.unitType ?? newest?.getData('unitType') };
    scene.gameSpeed = window.__economyPreviousSpeed;
    return result;
  });
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100) throw new Error('Pikesman did not cost exactly 100 food.');
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman did not cost exactly 50 gold.');
  if (evidence.afterTraining.population !== evidence.beforeTraining.population + 1) throw new Error('Pikesman did not consume exactly one population.');
  if (evidence.afterTraining.units !== evidence.beforeTraining.units + 1 || evidence.afterTraining.type !== 'Pikesman') throw new Error('Visible training action did not create exactly one Pikesman.');
  if (evidence.browserErrors.length) throw new Error(`Browser errors:\n${evidence.browserErrors.join('\n')}`);

  evidence.phase = 'complete';
  await page.screenshot({ path: `${ARTIFACT_DIR}/economy-progression-journey.png`, fullPage: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
