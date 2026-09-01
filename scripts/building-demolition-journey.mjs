import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/building-demolition-journey.json`;
const LOG_PATH = `${ARTIFACT_DIR}/building-demolition-journey.log`;

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = { phase: 'starting', checkpoints: [], pageErrors: [] };

async function checkpoint(phase, details = {}) {
  evidence.phase = phase;
  evidence.checkpoints.push({ phase, ...details });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}

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
let page;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.buildings?.getChildren?.().length);
  }, undefined, { timeout: 45_000 });
  await checkpoint('world-ready');

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
    const input = toIso(center.x, center.y);
    manager.tryBuild(input.x, input.y);
    manager.cancelBuildMode();

    const house = buildings().find(
      (building) => !beforeBuildings.has(building)
        && getOwner(building) === 0
        && getDef(building)?.type === 'House',
    );
    if (!house) throw new Error('Live House was not created for demolition acceptance.');

    const def = getDef(house);
    window.__buildingDemolitionJourneyHouse = house;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(house.visual.x, house.visual.y);

    return {
      costWood: def.cost.wood,
      populationBonus: def.populationBonus ?? 0,
      happinessBonus: def.happinessBonus ?? 0,
      position: { x: house.x, y: house.y },
    };
  });
  evidence.fixture = fixture;
  await checkpoint('house-created', fixture);

  // Match the stable canvas-input path used by the placement and army journeys:
  // move the real browser pointer onto the rendered object, allow Phaser a frame
  // to consume it, then click and prove the exact live object became selected.
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for House selection.');

  const housePoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__buildingDemolitionJourneyHouse;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (house.visual.x - topLeft.x) * camera.zoom,
      y: (house.visual.y - 14 - topLeft.y) * camera.zoom,
    };
  });

  const selectX = canvasBox.x + housePoint.x;
  const selectY = canvasBox.y + housePoint.y;
  await page.mouse.move(selectX, selectY);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  await page.mouse.click(selectX, selectY, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedBuilding === window.__buildingDemolitionJourneyHouse;
  }, undefined, { timeout: 5_000 });
  await checkpoint('house-selected');

  const demolishButton = page.getByRole('button', { name: 'Demolish', exact: true });
  await demolishButton.waitFor({ state: 'visible', timeout: 5_000 });
  const buttonBox = await demolishButton.boundingBox();
  if (!buttonBox) throw new Error('Visible Demolish action did not have a clickable bounding box.');

  const before = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__buildingDemolitionJourneyHouse;
    return {
      wood: scene.resources.wood,
      maxPopulation: scene.maxPopulation,
      happiness: scene.happiness,
      buildingCount: scene.buildings.getChildren().length,
      registered: scene.buildings.getChildren().includes(house),
      active: house.active,
    };
  });
  evidence.before = before;
  await checkpoint('before-demolition', before);

  // Send an actual rapid double-click at the visible action's screen position.
  // The first click is allowed to remove the React button. Any second pointer
  // activation that arrives during that transition must not duplicate the refund.
  const actionX = buttonBox.x + buttonBox.width / 2;
  const actionY = buttonBox.y + buttonBox.height / 2;
  await page.mouse.click(actionX, actionY, { button: 'left', clickCount: 2, delay: 0 });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__buildingDemolitionJourneyHouse;
    return !scene.buildings.getChildren().includes(house)
      && scene.inputManager.selectedBuilding !== house;
  }, undefined, { timeout: 5_000 });

  // Give React and the simulation one frame to publish the post-demolition UI/state.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));

  const after = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__buildingDemolitionJourneyHouse;
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
  evidence.after = after;

  const expectedRefund = Math.floor(fixture.costWood * 0.75);
  evidence.expectedRefund = expectedRefund;
  evidence.rapidClickCount = 2;

  if (!before.registered || !before.active) {
    throw new Error('Demolition fixture House was not live and registered before the UI action.');
  }
  if (after.registered || after.active) throw new Error('Demolished House remained live or registered.');
  if (after.buildingCount !== before.buildingCount - 1) {
    throw new Error(`Demolition removed an unexpected building count: ${before.buildingCount} -> ${after.buildingCount}.`);
  }
  if (after.wood !== before.wood + expectedRefund) {
    throw new Error(`Rapid Demolish input changed wood incorrectly: ${before.wood} -> ${after.wood}; expected exactly one ${expectedRefund} refund.`);
  }
  if (after.maxPopulation !== before.maxPopulation - fixture.populationBonus) {
    throw new Error(`House demolition population-cap rollback mismatch: ${before.maxPopulation} -> ${after.maxPopulation}; expected -${fixture.populationBonus}.`);
  }
  if (after.happiness !== before.happiness - fixture.happinessBonus) {
    throw new Error(`House demolition happiness rollback mismatch: ${before.happiness} -> ${after.happiness}; expected -${fixture.happinessBonus}.`);
  }
  if (after.selectedBuildingIsHouse) throw new Error('Demolished House remained selected.');
  if (await demolishButton.count() !== 0) throw new Error('Demolish action remained visible after the selected building was removed.');
  if (evidence.pageErrors.length > 0) throw new Error(`Browser page errors: ${evidence.pageErrors.join(' | ')}`);

  evidence.phase = 'complete';
  await checkpoint('complete', { expectedRefund });
  await page.screenshot({ path: `${ARTIFACT_DIR}/building-demolition-journey.png`, fullPage: true });
  await writeFile(LOG_PATH, 'Building demolition browser journey completed successfully.\n');
  console.log(JSON.stringify(evidence));
} catch (error) {
  evidence.phase = 'failed';
  evidence.error = error instanceof Error ? error.message : String(error);
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(LOG_PATH, `${evidence.error}\n\nVite output:\n${serverOutput}\n`);
  if (page) {
    await page.screenshot({ path: `${ARTIFACT_DIR}/building-demolition-journey-failure.png`, fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
