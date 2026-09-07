import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4196;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/building-save-continuity.json`;
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
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager);
  }, undefined, { timeout: 45_000 });
}

async function openGameMenu(page) {
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
  await page.getByRole('button', { name: /Save game/i }).waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.__civStrategyGame.scene.getScene('MainScene').events.once('postupdate', resolve);
  }));
}

async function screenPointForIso(page, iso) {
  return page.evaluate((point) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (point.x - topLeft.x) * camera.zoom, y: (point.y - topLeft.y) * camera.zoom };
  }, iso);
}

async function buildingScreenPoint(page) {
  return page.evaluate(() => {
    const building = window.__buildingSaveProbe;
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const hitArea = building.visual.input?.hitArea;
    const localX = typeof hitArea?.centerX === 'number' ? hitArea.centerX : 0;
    const localY = typeof hitArea?.centerY === 'number' ? hitArea.centerY : -16;
    const transformed = building.visual.getWorldTransformMatrix().transformPoint(localX, localY);
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (transformed.x - topLeft.x) * camera.zoom, y: (transformed.y - topLeft.y) * camera.zoom };
  });
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/building-save-continuity.png`, fullPage: true }); } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));

  evidence.phase = 'new-game';
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);

  evidence.phase = 'prepare-house-placement';
  const setup = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing.');
    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS.House;
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    for (let oy = 0; oy <= 640; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const center = { x: snap(tc.x - 320) + ox + def.width / 2, y: snap(tc.y - 320) + oy + def.height / 2 };
        if (!scene.buildingManager.getBuildValidity(center.x, center.y, 'House').valid) continue;
        const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
        scene.cameras.main.setZoom(1.5);
        scene.cameras.main.centerOn(iso.x, iso.y);
        window.__buildingSaveBaseline = new Set(scene.buildings.getChildren());
        return { iso, wood: scene.resources.wood, maxPopulation: scene.maxPopulation };
      }
    }
    throw new Error('No valid House placement found.');
  });

  await waitForCameraSync(page);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable.');
  await page.getByRole('button', { name: /Economy/i }).click();
  await page.getByRole('button', { name: /House/i }).click();
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === 'House');
  const placementPoint = await screenPointForIso(page, setup.iso);
  await page.mouse.click(box.x + placementPoint.x, box.y + placementPoint.y);

  evidence.phase = 'house-placed';
  evidence.beforeSave = await page.evaluate(({ initialWood, initialCap }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__buildingSaveBaseline;
    const house = scene.buildings.getChildren().find((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === 'House');
    if (!house) throw new Error('Player House was not created through the build UI.');
    window.__buildingSaveProbe = house;
    return {
      x: house.x,
      y: house.y,
      hp: house.getData('hp'),
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      expectedWood: initialWood - 50,
      expectedCap: initialCap + 8,
    };
  }, { initialWood: setup.wood, initialCap: setup.maxPopulation });
  if (evidence.beforeSave.wood !== evidence.beforeSave.expectedWood) throw new Error('House did not deduct exactly 50 wood.');
  if (evidence.beforeSave.maxPopulation !== evidence.beforeSave.expectedCap) throw new Error('House did not add exactly 8 housing capacity.');

  await page.keyboard.press('Escape');
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
  await page.evaluate(() => { window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = 0; });
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await waitForScene(page);

  evidence.phase = 'restore-house';
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((b) => b.active && b.getData('owner') === 0 && b.getData('def')?.type === 'House' && Math.hypot(b.x - saved.x, b.y - saved.y) <= 2);
  }, evidence.beforeSave, { timeout: 20_000 });
  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = scene.buildings.getChildren().filter((b) => b.active && b.getData('owner') === 0 && b.getData('def')?.type === 'House')
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!house) throw new Error('Saved House did not return after Load.');
    window.__buildingSaveProbe = house;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(house.visual.x, house.visual.y);
    return {
      x: house.x,
      y: house.y,
      hp: house.getData('hp'),
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      positionDelta: Math.hypot(house.x - saved.x, house.y - saved.y),
    };
  }, evidence.beforeSave);
  if (evidence.restored.positionDelta > 2) throw new Error('Saved House position changed across reload.');
  for (const key of ['hp', 'wood', 'maxPopulation']) {
    if (evidence.restored[key] !== evidence.beforeSave[key]) throw new Error(`${key} changed across House save/load.`);
  }

  evidence.phase = 'select-restored-house';
  await waitForCameraSync(page);
  const restoredBox = await canvas.boundingBox();
  if (!restoredBox) throw new Error('Canvas unavailable after Load.');
  const restoredPoint = await buildingScreenPoint(page);
  await page.mouse.click(restoredBox.x + restoredPoint.x, restoredBox.y + restoredPoint.y);
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__buildingSaveProbe, undefined, { timeout: 5_000 });
  evidence.restored.selectable = true;

  if (evidence.browserErrors.length) throw new Error(`Browser errors observed: ${evidence.browserErrors.join(' | ')}`);
  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
