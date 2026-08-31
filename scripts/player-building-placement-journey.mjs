import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/player-building-placement.json`;

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
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

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
const evidence = {
  phase: 'boot',
  browserErrors: [],
};

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager && scene?.buildings?.getChildren?.().length);
  }, undefined, { timeout: 45_000 });

  evidence.phase = 'placement-setup';
  const setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const buildings = scene.buildings.getChildren();
    const tc = buildings.find((building) => building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center was not available after world load.');

    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();

    const GRID = 16;
    const width = 32;
    const height = 32;
    const WATER_LEVEL = 0.38;
    const HEIGHT_LIFT = 200;
    const snap = (value) => Math.floor(value / GRID) * GRID;
    const toIsoElev = (x, y) => {
      const terrainHeight = scene.terrainSystem.getHeightAt(x, y);
      const lift = Math.max(0, terrainHeight - WATER_LEVEL) * HEIGHT_LIFT;
      return { x: x - y, y: (x + y) * 0.5 - lift };
    };
    const baseX = snap(tc.x - 280);
    const baseY = snap(tc.y - 280);
    let center = null;

    for (let oy = 0; oy <= 560 && !center; oy += GRID) {
      for (let ox = 0; ox <= 560; ox += GRID) {
        const candidate = {
          x: baseX + ox + width / 2,
          y: baseY + oy + height / 2,
        };
        if (manager.getBuildValidity(candidate.x, candidate.y, 'House').valid) {
          center = candidate;
          break;
        }
      }
    }
    if (!center) throw new Error('Could not find a valid House placement inside player territory.');

    // Placement now treats the real player pointer as the desired building center.
    // Project that center onto the rendered terrain surface before converting it
    // to a canvas click, matching the terrain-aware pointer contract in-game.
    const input = toIsoElev(center.x, center.y);
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(input.x, input.y);

    window.__playerPlacementBaselineBuildings = new Set(buildings);
    return {
      input,
      center,
      before: {
        wood: scene.resources.wood,
        maxPopulation: scene.maxPopulation,
        buildingCount: buildings.length,
      },
    };
  });

  await sleep(100);

  const economyButton = page.getByRole('button', { name: /Economy/i });
  await economyButton.waitFor({ state: 'visible', timeout: 3_000 });
  await economyButton.click();

  const houseButton = page.getByRole('button', { name: /House/i });
  await houseButton.waitFor({ state: 'visible', timeout: 3_000 });
  await houseButton.click();

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildingManager.previewBuildingType === 'House';
  }, undefined, { timeout: 3_000 });

  evidence.phase = 'real-canvas-placement';
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for House placement.');

  const screenPoint = await page.evaluate((input) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (input.x - topLeft.x) * camera.zoom,
      y: (input.y - topLeft.y) * camera.zoom,
    };
  }, setup.input);

  await page.mouse.move(canvasBox.x + screenPoint.x, canvasBox.y + screenPoint.y);
  await page.waitForFunction(() => {
    const manager = window.__civStrategyGame.scene.getScene('MainScene').buildingManager;
    return Boolean(manager.previewBuilding?.visible);
  }, undefined, { timeout: 3_000 });
  await page.mouse.click(canvasBox.x + screenPoint.x, canvasBox.y + screenPoint.y, { button: 'left' });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__playerPlacementBaselineBuildings;
    return scene.buildings.getChildren().some((building) => (
      !baseline.has(building)
      && building.getData('owner') === 0
      && building.getData('def')?.type === 'House'
    ));
  }, undefined, { timeout: 5_000 });

  const after = await page.evaluate((expectedCenter) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__playerPlacementBaselineBuildings;
    const built = scene.buildings.getChildren().find((building) => (
      !baseline.has(building)
      && building.getData('owner') === 0
      && building.getData('def')?.type === 'House'
    ));
    if (!built) throw new Error('Real canvas placement did not create an owned House.');
    return {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      buildingCount: scene.buildings.getChildren().length,
      built: { x: built.x, y: built.y },
      centerDelta: Math.hypot(built.x - expectedCenter.x, built.y - expectedCenter.y),
      previewType: scene.buildingManager.previewBuildingType,
    };
  }, setup.center);

  if (after.wood !== setup.before.wood - 50) {
    throw new Error(`Real House placement charged the wrong wood cost: ${setup.before.wood} -> ${after.wood}.`);
  }
  if (after.maxPopulation !== setup.before.maxPopulation + 8) {
    throw new Error(`Real House placement changed population cap incorrectly: ${setup.before.maxPopulation} -> ${after.maxPopulation}.`);
  }
  if (after.buildingCount !== setup.before.buildingCount + 1) {
    throw new Error(`Real House placement created ${after.buildingCount - setup.before.buildingCount} buildings instead of exactly one.`);
  }
  if (after.centerDelta > 0.01) {
    throw new Error(`Real House placement landed ${after.centerDelta}px away from the validated snapped center.`);
  }
  if (after.previewType !== 'House') {
    throw new Error('Placement mode did not remain coherent after a successful House placement.');
  }

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const manager = window.__civStrategyGame.scene.getScene('MainScene').buildingManager;
    return manager.previewBuildingType === null && manager.previewBuilding === null;
  }, undefined, { timeout: 3_000 });

  evidence.phase = 'complete';
  evidence.setup = setup;
  evidence.after = after;

  if (evidence.browserErrors.length > 0) {
    throw new Error(`Browser page errors during real player placement:\n${evidence.browserErrors.join('\n')}`);
  }

  await page.screenshot({ path: `${ARTIFACT_DIR}/player-building-placement.png`, fullPage: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = evidence.phase === 'complete' ? 'complete' : `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}