import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const MARKER_WOOD = 4321;

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

async function waitForMainScene(page) {
  await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return Boolean(
      scene?.isReady
      && scene?.resources
      && scene?.inputManager
      && scene?.buildings?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);
}

async function selectStartingVillager(page) {
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const villager = scene.villagerSystem.getVillagersByOwner(0).find((candidate) => candidate.visual?.active);
    if (!villager?.visual) throw new Error('No selectable villager available before load.');
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(villager.visual.x, villager.visual.y);
    window.__saveReloadSelectedVillager = villager;
  });

  // Match the proven workforce journey: let Phaser render the camera change
  // before deriving browser coordinates from the live visual.
  await sleep(80);
  const point = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const villager = window.__saveReloadSelectedVillager;
    if (!villager?.visual?.active) throw new Error('Starting Villager visual became unavailable before click.');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (villager.visual.x - topLeft.x) * camera.zoom,
      y: (villager.visual.y - 8 - topLeft.y) * camera.zoom,
    };
  });

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable before load.');
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const villager = window.__saveReloadSelectedVillager;
    const ring = villager?.visual?.getData?.('workforceSelectionRing');
    return Boolean(ring?.active);
  }, undefined, { timeout: 3_000 });
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

  const beforeSave = await page.evaluate((markerWood) => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    scene.resources.wood = markerWood;
    const townCenter = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0 && def?.type === 'Town Center';
    });
    if (!townCenter) throw new Error('Player Town Center missing before save.');

    const barracks = scene.entityFactory.spawnBuilding(
      'Barracks',
      townCenter.x + 192,
      townCenter.y + 192,
      0,
    );
    if (typeof barracks?.setWaypoint !== 'function') {
      throw new Error('Spawned Barracks does not expose rally waypoint behavior.');
    }
    const rallyWaypoint = { x: barracks.x + 128, y: barracks.y + 64 };
    barracks.setWaypoint(rallyWaypoint.x, rallyWaypoint.y);

    window.dispatchEvent(new Event('save-game'));
    return {
      wood: scene.resources.wood,
      population: scene.population,
      townCenter: { x: townCenter.x, y: townCenter.y },
      barracks: { x: barracks.x, y: barracks.y },
      rallyWaypoint,
      gameTime: scene.gameTime,
    };
  }, MARKER_WOOD);

  await page.waitForFunction((saveKey) => Boolean(localStorage.getItem(saveKey)), SAVE_KEY, { timeout: 10_000 });
  const storedSave = await page.evaluate((saveKey) => JSON.parse(localStorage.getItem(saveKey)), SAVE_KEY);
  if (storedSave.resources?.wood !== MARKER_WOOD) {
    throw new Error(`Stored save did not contain marker wood ${MARKER_WOOD}.`);
  }
  const storedBarracks = storedSave.buildings?.find((building) => (
    building.type === 'Barracks'
    && building.owner === 0
    && building.x === beforeSave.barracks.x
    && building.y === beforeSave.barracks.y
  ));
  if (!storedBarracks) throw new Error('Stored save did not contain the configured Barracks.');
  if (
    storedBarracks.waypoint?.x !== beforeSave.rallyWaypoint.x
    || storedBarracks.waypoint?.y !== beforeSave.rallyWaypoint.y
  ) {
    throw new Error('Stored save did not preserve the Barracks rally waypoint.');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await selectStartingVillager(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));

  await page.waitForFunction((markerWood) => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScene?.('MainScene');
    return scene?.isReady && scene?.resources?.wood === markerWood;
  }, MARKER_WOOD, { timeout: 20_000 });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const oldVillager = window.__saveReloadSelectedVillager;
    const oldRing = oldVillager?.visual?.active
      ? oldVillager.visual.getData?.('workforceSelectionRing')
      : null;
    const currentRing = scene?.villagerSystem?.getVillagersByOwner?.(0)?.some((villager) => (
      Boolean(villager.visual?.getData?.('workforceSelectionRing')?.active)
    ));
    return scene?.isReady && !oldRing?.active && currentRing === false;
  }, undefined, { timeout: 5_000 });

  const afterLoad = await page.evaluate(async ({ markerWood, previousGameTime, barracksPosition }) => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    const townCenter = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0 && def?.type === 'Town Center';
    });
    if (!townCenter) throw new Error('Player Town Center missing after load.');
    const barracks = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0
        && def?.type === 'Barracks'
        && building.x === barracksPosition.x
        && building.y === barracksPosition.y;
    });
    if (!barracks) throw new Error('Configured Barracks missing after load.');

    const loadedWood = scene.resources.wood;
    const loadedPopulation = scene.population;
    const loadedGameTime = scene.gameTime;
    const rallyWaypoint = barracks.getData('waypoint');
    const workforceSelectionCleared = !scene.villagerSystem.getVillagersByOwner(0).some((villager) => (
      Boolean(villager.visual?.getData?.('workforceSelectionRing')?.active)
    ));
    if (loadedWood !== markerWood) throw new Error('Saved resources were not restored at the load boundary.');
    if (loadedGameTime < previousGameTime) throw new Error('Loaded game time regressed below the saved session time.');
    if (!workforceSelectionCleared) throw new Error('Workforce selection survived entity replacement during load.');

    await new Promise((resolve) => setTimeout(resolve, 500));
    const resumedGameTime = scene.gameTime;
    if (resumedGameTime <= loadedGameTime) throw new Error('Simulation did not resume after load.');

    return {
      wood: loadedWood,
      population: loadedPopulation,
      townCenter: { x: townCenter.x, y: townCenter.y },
      barracks: { x: barracks.x, y: barracks.y },
      rallyWaypoint,
      loadedGameTime,
      resumedGameTime,
      workforceSelectionCleared,
    };
  }, {
    markerWood: MARKER_WOOD,
    previousGameTime: beforeSave.gameTime,
    barracksPosition: beforeSave.barracks,
  });

  if (afterLoad.population !== beforeSave.population) {
    throw new Error(`Population changed across reload: ${beforeSave.population} -> ${afterLoad.population}.`);
  }
  if (afterLoad.townCenter.x !== beforeSave.townCenter.x || afterLoad.townCenter.y !== beforeSave.townCenter.y) {
    throw new Error('Town Center position changed across reload.');
  }
  if (afterLoad.barracks.x !== beforeSave.barracks.x || afterLoad.barracks.y !== beforeSave.barracks.y) {
    throw new Error('Barracks position changed across reload.');
  }
  if (
    afterLoad.rallyWaypoint?.x !== beforeSave.rallyWaypoint.x
    || afterLoad.rallyWaypoint?.y !== beforeSave.rallyWaypoint.y
  ) {
    throw new Error('Barracks rally waypoint changed across reload.');
  }

  const cameraBeforeInput = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.cameras.main.scrollX;
  });
  await page.keyboard.down('ArrowRight');
  await sleep(300);
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction((initialScrollX) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return scene?.cameras?.main?.scrollX > initialScrollX;
  }, cameraBeforeInput, { timeout: 5_000 });
  const cameraAfterInput = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.cameras.main.scrollX;
  });

  await page.screenshot({ path: `${ARTIFACT_DIR}/save-reload-journey.png`, fullPage: true });
  console.log(JSON.stringify({ beforeSave, storedRallyWaypoint: storedBarracks.waypoint, afterLoad, cameraBeforeInput, cameraAfterInput }, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during save/reload journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}
