import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/restored-building-interaction.json`;
const TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 30_000;
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
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager && scene?.entityFactory);
  }, undefined, { timeout: 45_000 });
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.__civStrategyGame.scene.getScene('MainScene').events.once('postupdate', resolve);
  }));
}

async function openGameMenu(page) {
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
  await page.getByRole('button', { name: /Save game/i }).waitFor({ state: 'visible', timeout: 5_000 });
}

async function screenPointForIso(page, iso) {
  return page.evaluate((point) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (point.x - topLeft.x) * camera.zoom, y: (point.y - topLeft.y) * camera.zoom };
  }, iso);
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
    scene.resources.wood = Math.max(scene.resources.wood, 1_000);
    scene.resources.food = Math.max(scene.resources.food, 1_000);
    scene.resources.gold = Math.max(scene.resources.gold, 1_000);

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
        window.__restoredBuildingBaseline = new Set(scene.buildings.getChildren());
        return { iso };
      }
    }
    throw new Error('No valid Barracks placement found.');
  });
}

async function restoredBuildingScreenPoint(page) {
  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__restoredBuildingProbe;
    const visual = building.visual;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
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

await mkdir(ARTIFACT_DIR, { recursive: true });
const evidence = { phase: 'boot', browserErrors: [] };
let browser;
let page;

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/restored-building-interaction.png`, fullPage: true }); } catch {}
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

  evidence.phase = 'place-barracks';
  const placement = await prepareBarracksPlacement(page);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: /Military/i }).click();
  await page.getByRole('button', { name: /Barracks/i }).click();
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === 'Barracks'
  ), undefined, { timeout: 5_000 });

  const canvas = page.locator('canvas').first();
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable.');
  const placementPoint = await screenPointForIso(page, placement.iso);
  await page.mouse.move(box.x + placementPoint.x, box.y + placementPoint.y);
  await page.mouse.click(box.x + placementPoint.x, box.y + placementPoint.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((building) => (
      !window.__restoredBuildingBaseline.has(building)
      && building.getData('owner') === 0
      && building.getData('def')?.type === 'Barracks'
    ));
  }, undefined, { timeout: 10_000 });

  evidence.placed = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren().find((candidate) => (
      !window.__restoredBuildingBaseline.has(candidate)
      && candidate.getData('owner') === 0
      && candidate.getData('def')?.type === 'Barracks'
    ));
    return { x: building.x, y: building.y };
  });
  await page.keyboard.press('Escape');

  evidence.phase = 'save';
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((building) => (
      building.getData('owner') === 0
      && building.getData('def')?.type === 'Barracks'
      && Math.hypot(building.x - saved.x, building.y - saved.y) <= 2
    ));
  }, evidence.placed, { timeout: 20_000 });

  evidence.phase = 'select-restored-barracks';
  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren()
      .filter((candidate) => candidate.getData('owner') === 0 && candidate.getData('def')?.type === 'Barracks')
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!building?.visual?.input?.enabled) throw new Error('Restored Barracks is not input-enabled.');
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(building.visual.x, building.visual.y);
    window.__restoredBuildingProbe = building;
    return { x: building.x, y: building.y };
  }, evidence.placed);
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable after reload.');
  const restoredPoint = await restoredBuildingScreenPoint(page);
  await page.mouse.move(box.x + restoredPoint.x, box.y + restoredPoint.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const restored = window.__restoredBuildingProbe;
    return scene.input.hitTestPointer(scene.input.activePointer)
      .some((target) => target.getData?.('building') === restored);
  }, undefined, { timeout: TIMEOUT_MS });
  await page.mouse.click(box.x + restoredPoint.x, box.y + restoredPoint.y);
  await page.waitForFunction(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__restoredBuildingProbe
  ), undefined, { timeout: TIMEOUT_MS });

  evidence.trainingActionVisible = await page.getByRole('button', { name: /Pikesman/i }).isVisible();
  if (!evidence.trainingActionVisible) throw new Error('Restored Barracks selection did not expose its training action.');
  if (Math.hypot(evidence.restored.x - evidence.placed.x, evidence.restored.y - evidence.placed.y) > 2) {
    throw new Error('Restored Barracks moved across save/load.');
  }

  evidence.phase = 'train-after-reload';
  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    window.__restoredBuildingUnitBaseline = new Set(scene.units.getChildren());
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });
  if (evidence.beforeTraining.food < 100 || evidence.beforeTraining.gold < 50) {
    throw new Error(`Restored economy cannot afford Pikesman training: ${JSON.stringify(evidence.beforeTraining)}`);
  }
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const newPlayerUnits = scene.units.getChildren().filter((unit) => (
      unit.getData('owner') === 0 && !window.__restoredBuildingUnitBaseline.has(unit)
    ));
    return scene.population === before.population + 1 && newPlayerUnits.length === 1;
  }, evidence.beforeTraining, { timeout: TIMEOUT_MS });
  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    const trained = playerUnits.find((unit) => !window.__restoredBuildingUnitBaseline.has(unit));
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      military: playerUnits.length,
      type: trained?.unitType ?? trained?.getData('unitType'),
    };
  });
  if (evidence.afterTraining.military !== evidence.beforeTraining.military + 1) {
    throw new Error('Post-reload training did not add exactly one player military unit.');
  }
  if (evidence.afterTraining.type !== 'Pikesman') {
    throw new Error(`Restored Barracks trained wrong unit: ${evidence.afterTraining.type ?? 'unknown'}`);
  }
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100 || evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) {
    throw new Error('Post-reload Pikesman training charged the wrong resources.');
  }
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
  if (browser) await browser.close();
  await stopServer();
}
