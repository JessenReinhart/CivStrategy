import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const MARKER_WOOD = 4321;
const CARRY_WOOD = 7;
const LUMBER_CAMP = 'Lumber Camp';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

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

async function waitForMainScene(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.resources && scene?.villagerSystem);
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  const beforeSave = await page.evaluate(({ markerWood, carryWood, lumberCampType }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.resources.wood = markerWood;
    // Freeze unrelated simulation so this acceptance can prove exact-once carry
    // continuity without another worker racing the resource assertion.
    scene.gameSpeed = 0;

    const dropsite = scene.buildings.getChildren().find((building) => (
      building.getData?.('owner') === 0
      && building.getData?.('def')?.type === lumberCampType
    ));
    if (!dropsite) throw new Error('No player Lumber Camp available for carry persistence acceptance.');

    let villager = dropsite.getData('assignedWorker');
    if (!villager || villager.owner !== 0) {
      villager = scene.villagerSystem.getVillagersByOwner(0).find((candidate) => !candidate.jobBuilding)
        ?? scene.villagerSystem.getVillagersByOwner(0)[0];
    }
    if (!villager) throw new Error('No player Villager available for carry persistence acceptance.');

    if (villager.jobBuilding && villager.jobBuilding !== dropsite
      && villager.jobBuilding.getData?.('assignedWorker') === villager) {
      villager.jobBuilding.setData('assignedWorker', null);
    }
    dropsite.setData('assignedWorker', villager);
    villager.jobBuilding = dropsite;

    // Place the carrier at its real dropsite. After reload, one real 500 ms
    // VillagerSystem retry tick should settle the load without advancing the
    // rest of the paused game simulation.
    villager.x = dropsite.x;
    villager.y = dropsite.y;
    villager.carryAmount = carryWood;
    villager.carryType = 'wood';
    villager.state = 'carrying';
    villager.path = undefined;
    villager.pathStep = 0;
    villager.gatherTimer = 0;

    window.dispatchEvent(new Event('save-game'));
    return {
      wood: scene.resources.wood,
      villagerId: villager.id,
      carryAmount: villager.carryAmount,
      carryType: villager.carryType,
      gameSpeed: scene.gameSpeed,
      dropsite: {
        type: dropsite.getData('def')?.type,
        x: dropsite.x,
        y: dropsite.y,
      },
    };
  }, { markerWood: MARKER_WOOD, carryWood: CARRY_WOOD, lumberCampType: LUMBER_CAMP });

  await page.waitForFunction((saveKey) => Boolean(localStorage.getItem(saveKey)), SAVE_KEY, { timeout: 10_000 });
  const storedSave = await page.evaluate((saveKey) => JSON.parse(localStorage.getItem(saveKey)), SAVE_KEY);
  if (storedSave.resources?.wood !== MARKER_WOOD) {
    throw new Error(`Stored save wood mismatch: expected ${MARKER_WOOD}, got ${storedSave.resources?.wood}.`);
  }
  if (storedSave.gameSpeed !== 0) throw new Error(`Carry acceptance save did not preserve paused speed: ${storedSave.gameSpeed}.`);
  const storedCarry = storedSave.units?.find((unit) => (
    unit.type === 'Villager'
    && unit.owner === 0
    && unit.carryAmount === CARRY_WOOD
    && unit.carryType === 'wood'
    && unit.state === 'carrying'
  ));
  if (!storedCarry) throw new Error('Stored save did not preserve the Villager wood carry.');
  if (storedCarry.jobBuilding?.type !== LUMBER_CAMP
    || Math.abs(storedCarry.jobBuilding.x - beforeSave.dropsite.x) > 0.5
    || Math.abs(storedCarry.jobBuilding.y - beforeSave.dropsite.y) > 0.5) {
    throw new Error(`Stored carry lost its exact Lumber Camp dropsite: ${JSON.stringify(storedCarry.jobBuilding)}.`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));

  const restored = await page.evaluate(({ carryWood, lumberCampType, savedDropsite }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const villager = scene.villagerSystem.getVillagersByOwner(0).find((candidate) => (
      candidate.carryAmount === carryWood && candidate.carryType === 'wood'
    ));
    if (!villager) throw new Error('Reloaded save did not restore the carrying Villager.');
    const dropsite = villager.jobBuilding;
    if (!dropsite) throw new Error('Reloaded carrying Villager lost its dropsite relationship.');
    if (dropsite.getData?.('owner') !== 0 || dropsite.getData?.('def')?.type !== lumberCampType) {
      throw new Error('Reloaded carrying Villager was rebound to an incompatible dropsite.');
    }
    if (Math.abs(dropsite.x - savedDropsite.x) > 0.5 || Math.abs(dropsite.y - savedDropsite.y) > 0.5) {
      throw new Error(`Reloaded carrying Villager was rebound to the wrong Lumber Camp at ${dropsite.x},${dropsite.y}.`);
    }
    if (dropsite.getData?.('assignedWorker') !== villager) {
      throw new Error('Reloaded Lumber Camp does not reserve the restored carrying Villager.');
    }

    return {
      carryAmount: villager.carryAmount,
      carryType: villager.carryType,
      state: villager.state,
      dropsite: { x: dropsite.x, y: dropsite.y, type: dropsite.getData('def')?.type },
      gameSpeed: scene.gameSpeed,
    };
  }, { carryWood: CARRY_WOOD, lumberCampType: LUMBER_CAMP, savedDropsite: beforeSave.dropsite });

  if (restored.gameSpeed !== 0) throw new Error(`Reload did not preserve paused acceptance snapshot: ${restored.gameSpeed}.`);

  // CARRYING recovery is intentionally cadence-bound. Drive one real retry tick
  // while the outer game remains paused, then assert the durable economy result.
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.villagerSystem.update(0, 500);
  });

  await page.waitForFunction(({ markerWood, carryWood }) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene.resources?.wood === markerWood + carryWood);
  }, { markerWood: MARKER_WOOD, carryWood: CARRY_WOOD }, { timeout: 10_000 });

  const afterLoad = await page.evaluate(({ markerWood, carryWood }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const settledWood = scene.resources.wood;

    const duplicateCarry = scene.villagerSystem.getVillagersByOwner(0).some((villager) => (
      villager.carryAmount === carryWood && villager.carryType === 'wood'
    ));
    if (duplicateCarry) throw new Error('Restored Villager still holds cargo after the economy received it.');
    if (settledWood !== markerWood + carryWood) {
      throw new Error(`Reloaded carry settled incorrectly: expected ${markerWood + carryWood}, got ${settledWood}.`);
    }
    if (scene.gameSpeed !== 0) throw new Error(`Carry settlement unexpectedly advanced the paused game: ${scene.gameSpeed}.`);

    return {
      wood: settledWood,
      deposited: settledWood - markerWood,
      population: scene.population,
      gameTime: scene.gameTime,
      gameSpeed: scene.gameSpeed,
    };
  }, { markerWood: MARKER_WOOD, carryWood: CARRY_WOOD });

  // A second retry tick must not duplicate-credit the settled load.
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.villagerSystem.update(500, 500);
  });
  const frozenWood = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').resources.wood);
  if (frozenWood !== MARKER_WOOD + CARRY_WOOD) {
    throw new Error(`Preserved carry was credited more than once: expected ${MARKER_WOOD + CARRY_WOOD}, got ${frozenWood}.`);
  }
  if (afterLoad.deposited !== CARRY_WOOD) {
    throw new Error(`Preserved carry changed across reload: expected ${CARRY_WOOD}, got ${afterLoad.deposited}.`);
  }
  if (browserErrors.length) throw new Error(`Browser errors during carry reload journey: ${browserErrors.join(' | ')}`);

  await page.screenshot({ path: `${ARTIFACT_DIR}/villager-carry-save-reload.png`, fullPage: true });
  console.log(JSON.stringify({ beforeSave, storedCarry, restored, afterLoad, frozenWood, browserErrors }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
