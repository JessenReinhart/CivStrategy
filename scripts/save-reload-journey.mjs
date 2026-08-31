import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const MARKER_WOOD = 4321;
const POINTER_TIMEOUT_MS = 30_000;
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
    return Boolean(
      scene?.isReady
      && scene?.resources
      && scene?.inputManager
      && scene?.villagerSystem
      && scene?.economySystem
      && scene?.buildings?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);
}

async function waitForCameraSync(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const mainCamera = scene?.cameras?.main;
    const uiCamera = scene?.uiCamera;
    if (!mainCamera || !uiCamera) return false;
    return Math.abs(mainCamera.scrollX - uiCamera.scrollX) < 0.5
      && Math.abs(mainCamera.scrollY - uiCamera.scrollY) < 0.5
      && Math.abs(mainCamera.zoom - uiCamera.zoom) < 0.001;
  }, undefined, { timeout: POINTER_TIMEOUT_MS });
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
  await waitForCameraSync(page);

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
    return Boolean(villager?.visual?.getData?.('workforceSelectionRing')?.active);
  }, undefined, { timeout: 5_000 });
}

async function trainPikesmanFromRestoredBarracks(page, barracksPosition) {
  await page.evaluate((position) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0
        && def?.type === 'Barracks'
        && building.x === position.x
        && building.y === position.y;
    });
    if (!barracks?.visual?.active) throw new Error('Restored Barracks visual unavailable for post-load training.');
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
    window.__saveReloadBarracks = barracks;
  }, barracksPosition);
  await waitForCameraSync(page);

  const point = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__saveReloadBarracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (barracks.visual.x - topLeft.x) * camera.zoom,
      y: (barracks.visual.y - 18 - topLeft.y) * camera.zoom,
    };
  });
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable for restored Barracks selection.');
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedBuilding === window.__saveReloadBarracks;
  }, undefined, { timeout: 5_000 });

  const before = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const gameSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      playerMilitary: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
      gameSpeed,
    };
  });
  if (before.population >= before.maxPopulation) {
    await page.evaluate((gameSpeed) => {
      window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = gameSpeed;
    }, before.gameSpeed);
    throw new Error(`Restored town has no population capacity for training: ${before.population}/${before.maxPopulation}.`);
  }

  let after;
  try {
    await sleep(300);
    const stable = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      return { food: scene.resources.food, gold: scene.resources.gold, gameSpeed: scene.gameSpeed };
    });
    if (stable.gameSpeed !== 0 || stable.food !== before.food || stable.gold !== before.gold) {
      throw new Error(`Post-load training transaction was not isolated from simulation: food ${before.food} -> ${stable.food}, gold ${before.gold} -> ${stable.gold}, speed ${stable.gameSpeed}.`);
    }

    await page.getByRole('button', { name: /Pikesman/i }).click();
    await page.waitForFunction((snapshot) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const military = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
      return military === snapshot.playerMilitary + 1 && scene.population === snapshot.population + 1;
    }, before, { timeout: 5_000 });

    after = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const units = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
      const newest = units[units.length - 1];
      return {
        food: scene.resources.food,
        gold: scene.resources.gold,
        population: scene.population,
        maxPopulation: scene.maxPopulation,
        playerMilitary: units.length,
        newestType: newest?.unitType ?? newest?.getData('unitType') ?? null,
      };
    });
  } finally {
    await page.evaluate((gameSpeed) => {
      window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = gameSpeed;
    }, before.gameSpeed);
  }

  const restoredGameSpeed = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').gameSpeed);
  if (restoredGameSpeed !== before.gameSpeed) {
    throw new Error(`Post-load training did not restore game speed: expected ${before.gameSpeed}, got ${restoredGameSpeed}.`);
  }
  if (!after) throw new Error('Post-load training did not produce a measurable result.');
  if (after.playerMilitary !== before.playerMilitary + 1) throw new Error('Post-load training did not create exactly one player military unit.');
  if (after.population !== before.population + 1) throw new Error('Post-load training did not increment player population by one.');
  if (after.maxPopulation !== before.maxPopulation) throw new Error('Post-load training changed population capacity.');
  if (after.population > after.maxPopulation) throw new Error('Post-load training exceeded restored population capacity.');
  if (after.food !== before.food - 100 || after.gold !== before.gold - 50) {
    throw new Error(`Post-load Pikesman cost mismatch: food ${before.food} -> ${after.food}, gold ${before.gold} -> ${after.gold}.`);
  }
  if (after.food < 0 || after.gold < 0) throw new Error('Post-load training produced negative resources.');
  if (after.newestType !== 'Pikesman') throw new Error(`Expected post-load Pikesman, got ${after.newestType ?? 'unknown'}.`);
  return { before, after, restoredGameSpeed };
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
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.resources.wood = markerWood;
    const townCenter = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center'
    ));
    if (!townCenter) throw new Error('Player Town Center missing before save.');

    const goldMines = scene.trees.getChildren().filter((node) => node.getData('isGoldMine')).slice(0, 2);
    if (goldMines.length < 2) throw new Error('Need two seeded gold mines for save/reload depletion continuity.');
    const [partialMine, depletedMine] = goldMines;
    partialMine.setData('goldRemaining', 37);
    partialMine.setData('isDepleted', false);
    partialMine.setData('isChopped', false);
    partialMine.setData('depletedAt', 0);
    const depletedAt = Math.max(0, scene.gameTime - 1_000);
    depletedMine.setData('goldRemaining', 0);
    depletedMine.setData('isDepleted', true);
    depletedMine.setData('isChopped', true);
    depletedMine.setData('depletedAt', depletedAt);
    depletedMine.setData('visualTexture', 'stump');
    depletedMine.setData('visualTint', 0xffffff);
    depletedMine.setData('visualScale', 0.075);
    if (depletedMine.visual?.active) {
      depletedMine.visual.setTexture('stump');
      depletedMine.visual.setTint(0xffffff);
      depletedMine.visual.setScale(0.075);
    }

    const maxPopulationBeforeHousing = scene.maxPopulation;
    const house = scene.entityFactory.spawnBuilding('House', townCenter.x - 192, townCenter.y + 192, 0);
    if (!house || scene.maxPopulation <= maxPopulationBeforeHousing) {
      throw new Error('Live House did not increase player population capacity before save.');
    }

    const barracks = scene.entityFactory.spawnBuilding('Barracks', townCenter.x + 192, townCenter.y + 192, 0);
    if (typeof barracks?.setWaypoint !== 'function') throw new Error('Spawned Barracks does not expose rally waypoint behavior.');
    const rallyWaypoint = { x: barracks.x + 128, y: barracks.y + 64 };
    barracks.setWaypoint(rallyWaypoint.x, rallyWaypoint.y);

    const villager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!villager?.visual) throw new Error('No idle player Villager is available for the save/load economy probe.');
    const trees = scene.trees.getChildren().filter((tree) => (
      tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped')
    ));
    let nearestTree = null;
    let nearestDistance = Infinity;
    for (const tree of trees) {
      const distance = Math.hypot(tree.x - villager.x, tree.y - villager.y);
      if (distance < nearestDistance) {
        nearestTree = tree;
        nearestDistance = distance;
      }
    }
    if (!nearestTree || nearestDistance > 280) {
      throw new Error(`No live tree is close enough for a deterministic post-load lumber loop (${nearestDistance.toFixed(1)}px).`);
    }
    const dx = nearestTree.x - villager.x;
    const dy = nearestTree.y - villager.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const lumberCamp = scene.entityFactory.spawnBuilding(
      'Lumber Camp',
      villager.x + (-dy / length) * 64,
      villager.y + (dx / length) * 64,
      0,
    );
    scene.economySystem.assignJobs();
    const assignedWorker = lumberCamp.getData('assignedWorker');
    if (!assignedWorker || assignedWorker.jobBuilding !== lumberCamp) {
      throw new Error('Pre-save Lumber Camp did not receive a Villager through normal economy assignment.');
    }

    window.dispatchEvent(new Event('save-game'));
    return {
      wood: scene.resources.wood,
      population: scene.population,
      maxPopulationBeforeHousing,
      maxPopulation: scene.maxPopulation,
      townCenter: { x: townCenter.x, y: townCenter.y },
      house: { x: house.x, y: house.y },
      barracks: { x: barracks.x, y: barracks.y },
      lumberCamp: { x: lumberCamp.x, y: lumberCamp.y },
      assignedWorkerId: assignedWorker.id,
      rallyWaypoint,
      goldMines: [
        { x: partialMine.x, y: partialMine.y, goldRemaining: 37, isDepleted: false, isChopped: false, depletedAt: 0 },
        { x: depletedMine.x, y: depletedMine.y, goldRemaining: 0, isDepleted: true, isChopped: true, depletedAt },
      ],
      gameTime: scene.gameTime,
    };
  }, MARKER_WOOD);

  await page.waitForFunction((saveKey) => Boolean(localStorage.getItem(saveKey)), SAVE_KEY, { timeout: 10_000 });
  const storedSave = await page.evaluate((saveKey) => JSON.parse(localStorage.getItem(saveKey)), SAVE_KEY);
  if (storedSave.resources?.wood !== MARKER_WOOD) throw new Error(`Stored save did not contain marker wood ${MARKER_WOOD}.`);

  const storedHouse = storedSave.buildings?.find((building) => (
    building.type === 'House' && building.owner === 0
    && building.x === beforeSave.house.x && building.y === beforeSave.house.y
  ));
  if (!storedHouse) throw new Error('Stored save did not contain the population-cap House.');
  const storedBarracks = storedSave.buildings?.find((building) => (
    building.type === 'Barracks' && building.owner === 0
    && building.x === beforeSave.barracks.x && building.y === beforeSave.barracks.y
  ));
  if (!storedBarracks) throw new Error('Stored save did not contain the configured Barracks.');
  const storedLumberCamp = storedSave.buildings?.find((building) => (
    building.type === 'Lumber Camp' && building.owner === 0
    && building.x === beforeSave.lumberCamp.x && building.y === beforeSave.lumberCamp.y
  ));
  if (!storedLumberCamp) throw new Error('Stored save did not contain the Lumber Camp economy probe.');
  if (storedBarracks.waypoint?.x !== beforeSave.rallyWaypoint.x || storedBarracks.waypoint?.y !== beforeSave.rallyWaypoint.y) {
    throw new Error('Stored save did not preserve the Barracks rally waypoint.');
  }
  for (const expected of beforeSave.goldMines) {
    const storedMine = storedSave.resourceNodes?.goldMines?.find((mine) => mine.x === expected.x && mine.y === expected.y);
    if (!storedMine) throw new Error(`Stored save did not contain gold mine at ${expected.x},${expected.y}.`);
    if (storedMine.goldRemaining !== expected.goldRemaining
      || storedMine.isDepleted !== expected.isDepleted
      || storedMine.isChopped !== expected.isChopped
      || storedMine.depletedAt !== expected.depletedAt) {
      throw new Error(`Stored gold mine state changed before reload at ${expected.x},${expected.y}.`);
    }
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await selectStartingVillager(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));

  await page.waitForFunction((markerWood) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return scene?.isReady && scene?.resources?.wood === markerWood;
  }, MARKER_WOOD, { timeout: 20_000 });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const oldVillager = window.__saveReloadSelectedVillager;
    const oldRing = oldVillager?.visual?.active ? oldVillager.visual.getData?.('workforceSelectionRing') : null;
    const currentRing = scene?.villagerSystem?.getVillagersByOwner?.(0)?.some((villager) => (
      Boolean(villager.visual?.getData?.('workforceSelectionRing')?.active)
    ));
    return scene?.isReady && !oldRing?.active && currentRing === false;
  }, undefined, { timeout: 5_000 });

  const afterLoad = await page.evaluate(async ({ markerWood, previousGameTime, housePosition, barracksPosition, lumberCampPosition, goldMines }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const findBuilding = (type, position) => scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0
      && building.getData('def')?.type === type
      && building.x === position.x
      && building.y === position.y
    ));
    const townCenter = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center'
    ));
    const house = findBuilding('House', housePosition);
    const barracks = findBuilding('Barracks', barracksPosition);
    const lumberCamp = findBuilding('Lumber Camp', lumberCampPosition);
    if (!townCenter || !house || !barracks || !lumberCamp) throw new Error('One or more saved player buildings are missing after load.');

    const restoredGoldMines = goldMines.map((expected) => {
      const mine = scene.trees.getChildren().find((node) => (
        node.getData('isGoldMine')
        && Math.abs(node.x - expected.x) <= 0.5
        && Math.abs(node.y - expected.y) <= 0.5
      ));
      if (!mine) throw new Error(`Restored seeded gold mine missing at ${expected.x},${expected.y}.`);
      const actual = {
        x: mine.x,
        y: mine.y,
        goldRemaining: mine.getData('goldRemaining'),
        isDepleted: mine.getData('isDepleted') === true,
        isChopped: mine.getData('isChopped') === true,
        depletedAt: mine.getData('depletedAt') ?? 0,
        visualTexture: mine.visual?.texture?.key ?? mine.getData('visualTexture') ?? null,
      };
      if (actual.goldRemaining !== expected.goldRemaining
        || actual.isDepleted !== expected.isDepleted
        || actual.isChopped !== expected.isChopped
        || actual.depletedAt !== expected.depletedAt) {
        throw new Error(`Gold mine state replenished or changed across reload at ${expected.x},${expected.y}: ${JSON.stringify(actual)}.`);
      }
      if (expected.isDepleted && actual.visualTexture !== 'stump') {
        throw new Error(`Depleted gold mine did not keep stump visual after reload: ${actual.visualTexture ?? 'missing'}.`);
      }
      return actual;
    });

    const loadedWood = scene.resources.wood;
    const loadedPopulation = scene.population;
    const loadedMaxPopulation = scene.maxPopulation;
    const loadedGameTime = scene.gameTime;
    const rallyWaypoint = barracks.getData('waypoint');
    const workforceSelectionCleared = !scene.villagerSystem.getVillagersByOwner(0).some((villager) => (
      Boolean(villager.visual?.getData?.('workforceSelectionRing')?.active)
    ));
    if (loadedWood !== markerWood) throw new Error('Saved resources were not restored at the load boundary.');
    if (loadedGameTime < previousGameTime) throw new Error('Loaded game time regressed below the saved session time.');
    if (!workforceSelectionCleared) throw new Error('Workforce selection survived entity replacement during load.');

    const assignedWorker = lumberCamp.getData('assignedWorker');
    if (!assignedWorker || assignedWorker.jobBuilding !== lumberCamp) {
      throw new Error('Restored Lumber Camp did not reconnect to a Villager through normal post-load job assignment.');
    }

    let simulatedMs = 0;
    for (let i = 0; i < 2_000 && scene.resources.wood <= loadedWood; i++) {
      scene.villagerSystem.update(scene.gameTime + simulatedMs, 100);
      simulatedMs += 100;
    }
    const resumedWood = scene.resources.wood;
    if (resumedWood <= loadedWood) {
      throw new Error(`Restored worker economy did not deposit wood after ${simulatedMs}ms of VillagerSystem time.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    const resumedGameTime = scene.gameTime;
    if (resumedGameTime <= loadedGameTime) throw new Error('Simulation did not resume after load.');

    return {
      wood: loadedWood,
      resumedWood,
      woodDeposited: resumedWood - loadedWood,
      population: loadedPopulation,
      maxPopulation: loadedMaxPopulation,
      townCenter: { x: townCenter.x, y: townCenter.y },
      house: { x: house.x, y: house.y },
      barracks: { x: barracks.x, y: barracks.y },
      lumberCamp: { x: lumberCamp.x, y: lumberCamp.y },
      assignedWorkerId: assignedWorker.id,
      assignedWorkerState: assignedWorker.state,
      rallyWaypoint,
      restoredGoldMines,
      loadedGameTime,
      resumedGameTime,
      simulatedMs,
      workforceSelectionCleared,
    };
  }, {
    markerWood: MARKER_WOOD,
    previousGameTime: beforeSave.gameTime,
    housePosition: beforeSave.house,
    barracksPosition: beforeSave.barracks,
    lumberCampPosition: beforeSave.lumberCamp,
    goldMines: beforeSave.goldMines,
  });

  if (afterLoad.population !== beforeSave.population) {
    throw new Error(`Population changed across reload: ${beforeSave.population} -> ${afterLoad.population}.`);
  }
  if (afterLoad.maxPopulation !== beforeSave.maxPopulation) {
    throw new Error(`Population capacity changed across reload: ${beforeSave.maxPopulation} -> ${afterLoad.maxPopulation}.`);
  }
  if (afterLoad.maxPopulation <= afterLoad.population) throw new Error('Loaded population capacity leaves no room for continued training.');
  if (afterLoad.townCenter.x !== beforeSave.townCenter.x || afterLoad.townCenter.y !== beforeSave.townCenter.y) throw new Error('Town Center position changed across reload.');
  if (afterLoad.house.x !== beforeSave.house.x || afterLoad.house.y !== beforeSave.house.y) throw new Error('Population-cap House position changed across reload.');
  if (afterLoad.barracks.x !== beforeSave.barracks.x || afterLoad.barracks.y !== beforeSave.barracks.y) throw new Error('Barracks position changed across reload.');
  if (afterLoad.lumberCamp.x !== beforeSave.lumberCamp.x || afterLoad.lumberCamp.y !== beforeSave.lumberCamp.y) throw new Error('Lumber Camp position changed across reload.');
  if (afterLoad.rallyWaypoint?.x !== beforeSave.rallyWaypoint.x || afterLoad.rallyWaypoint?.y !== beforeSave.rallyWaypoint.y) {
    throw new Error('Barracks rally waypoint changed across reload.');
  }

  const postLoadTraining = await trainPikesmanFromRestoredBarracks(page, beforeSave.barracks);

  const cameraBeforeInput = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').cameras.main.scrollX);
  await page.keyboard.down('ArrowRight');
  await sleep(300);
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction((initialScrollX) => (
    window.__civStrategyGame?.scene?.getScene?.('MainScene')?.cameras?.main?.scrollX > initialScrollX
  ), cameraBeforeInput, { timeout: 5_000 });
  const cameraAfterInput = await page.evaluate(() => window.__civStrategyGame.scene.getScene('MainScene').cameras.main.scrollX);

  await page.screenshot({ path: `${ARTIFACT_DIR}/save-reload-journey.png`, fullPage: true });
  console.log(JSON.stringify({
    beforeSave,
    storedRallyWaypoint: storedBarracks.waypoint,
    afterLoad,
    postLoadTraining,
    cameraBeforeInput,
    cameraAfterInput,
  }, null, 2));

  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during save/reload journey:\n${browserErrors.join('\n')}`);
  }
} finally {
  if (browser) await browser.close();
  await stopServer();
}