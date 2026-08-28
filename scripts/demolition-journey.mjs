import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';

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
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.buildings?.getChildren?.().length);
  }, undefined, { timeout: 45_000 });

  const fixture = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const buildings = () => scene.buildings.getChildren();
    const getDef = (building) => building.getData('def');
    const getOwner = (building) => building.getData('owner');
    const townCenter = buildings().find(
      (building) => getOwner(building) === 0 && getDef(building)?.type === 'Town Center',
    );
    if (!townCenter) throw new Error('Player Town Center was not available after world load.');

    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;

    const GRID = 16;
    const HOUSE_SIZE = 48;
    const snap = (value) => Math.floor(value / GRID) * GRID;
    const toIso = (x, y) => ({ x: x - y, y: (x + y) * 0.5 });
    const baseX = snap(townCenter.x - 280);
    const baseY = snap(townCenter.y - 280);
    let center = null;

    for (let oy = 0; oy <= 560 && !center; oy += GRID) {
      for (let ox = 0; ox <= 560; ox += GRID) {
        const candidate = {
          x: baseX + ox + HOUSE_SIZE / 2,
          y: baseY + oy + HOUSE_SIZE / 2,
        };
        if (manager.getBuildValidity(candidate.x, candidate.y, 'House').valid) {
          center = candidate;
          break;
        }
      }
    }
    if (!center) throw new Error('Could not find a valid House location for demolition acceptance.');

    const beforeBuildings = new Set(buildings());
    manager.enterBuildMode('House');
    const input = toIso(center.x - HOUSE_SIZE / 2, center.y - HOUSE_SIZE / 2);
    manager.tryBuild(input.x, input.y);
    manager.cancelBuildMode();

    const house = buildings().find(
      (building) => !beforeBuildings.has(building)
        && getOwner(building) === 0
        && getDef(building)?.type === 'House',
    );
    if (!house) throw new Error('Live House was not created for demolition acceptance.');

    const def = getDef(house);
    window.__demolitionJourneyHouse = house;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(house.visual.x, house.visual.y);

    return {
      costWood: def.cost.wood,
      populationBonus: def.populationBonus ?? 0,
      happinessBonus: def.happinessBonus ?? 0,
      position: { x: house.x, y: house.y },
    };
  });

  await sleep(50);
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for House selection.');

  const housePoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__demolitionJourneyHouse;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (house.visual.x - topLeft.x) * camera.zoom,
      y: (house.visual.y - 14 - topLeft.y) * camera.zoom,
    };
  });

  await page.mouse.click(canvasBox.x + housePoint.x, canvasBox.y + housePoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedBuilding === window.__demolitionJourneyHouse;
  }, undefined, { timeout: 3_000 });

  const demolishButton = page.getByRole('button', { name: 'Demolish' });
  await demolishButton.waitFor({ state: 'visible', timeout: 3_000 });

  const before = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__demolitionJourneyHouse;
    return {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      happiness: scene.happiness,
      buildingCount: scene.buildings.getChildren().length,
      registered: scene.buildings.getChildren().includes(house),
    };
  });

  // Two synchronous clicks reproduce the historical rapid-repeat exploit while the
  // same React button node is still available. The demolition transaction must commit once.
  await demolishButton.evaluate((button) => {
    button.click();
    button.click();
  });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__demolitionJourneyHouse;
    return !scene.buildings.getChildren().includes(house)
      && scene.inputManager.selectedBuilding !== house;
  }, undefined, { timeout: 3_000 });

  await sleep(100);
  const after = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__demolitionJourneyHouse;
    return {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      happiness: scene.happiness,
      buildingCount: scene.buildings.getChildren().length,
      registered: scene.buildings.getChildren().includes(house),
      active: house.active,
      selectedBuildingIsHouse: scene.inputManager.selectedBuilding === house,
    };
  });

  const expectedRefund = Math.floor(fixture.costWood * 0.75);
  if (!before.registered) throw new Error('Demolition fixture House was not registered before the UI action.');
  if (after.registered || after.active) throw new Error('Demolished House remained live or registered.');
  if (after.buildingCount !== before.buildingCount - 1) {
    throw new Error(`Demolition removed an unexpected building count: ${before.buildingCount} -> ${after.buildingCount}.`);
  }
  if (after.wood !== before.wood + expectedRefund) {
    throw new Error(`Rapid Demolish clicks changed wood incorrectly: ${before.wood} -> ${after.wood}; expected one ${expectedRefund} refund.`);
  }
  if (after.maxPopulation !== before.maxPopulation - fixture.populationBonus) {
    throw new Error(`House demolition population-cap rollback mismatch: ${before.maxPopulation} -> ${after.maxPopulation}.`);
  }
  if (after.happiness !== before.happiness - fixture.happinessBonus) {
    throw new Error(`House demolition happiness rollback mismatch: ${before.happiness} -> ${after.happiness}.`);
  }
  if (after.selectedBuildingIsHouse) throw new Error('Demolished House remained selected.');
  if (await demolishButton.count() !== 0) throw new Error('Demolish action remained visible after the selected building was removed.');
  if (pageErrors.length > 0) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);

  const evidence = {
    phase: 'complete',
    fixture,
    before,
    after,
    expectedRefund,
    rapidClickCount: 2,
    pageErrors,
  };
  await writeFile(`${ARTIFACT_DIR}/demolition-journey.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/demolition-journey.png`, fullPage: true });
  console.log(JSON.stringify(evidence));
} finally {
  if (browser) await browser.close();
  await stopServer();
}
