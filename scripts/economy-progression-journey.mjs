import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4183;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/economy-progression-journey.json`;
const SCREENSHOT_PATH = `${ARTIFACT_DIR}/economy-progression-journey.png`;
const JOURNEY_TIMEOUT_MS = 30_000;
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
    try {
      if ((await fetch(BASE_URL)).ok) return;
    } catch {}
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
    return Boolean(
      scene?.isReady
      && scene?.villagerSystem
      && scene?.buildingManager
      && scene?.economySystem
      && scene?.entityFactory
      && scene?.inputManager
      && scene?.pathfinder
      && scene?.unitSpatialHash,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
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
  }, undefined, { timeout: JOURNEY_TIMEOUT_MS });
}

async function preparePlacement(page, type) {
  return page.evaluate(async (buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { BUILDINGS } = await import('/constants.ts');
    const tc = scene.buildings.getChildren().find(
      (building) => building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center',
    );
    const def = BUILDINGS[buildingType];
    if (!tc || !def) throw new Error(`Cannot prepare ${buildingType} placement.`);

    const grid = 16;
    const snap = (value) => Math.floor(value / grid) * grid;
    for (let oy = 0; oy <= 640; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const center = {
          x: snap(tc.x - 320) + ox + def.width / 2,
          y: snap(tc.y - 320) + oy + def.height / 2,
        };
        if (!scene.buildingManager.getBuildValidity(center.x, center.y, buildingType).valid) continue;
        const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
        scene.cameras.main.setZoom(1.5);
        scene.cameras.main.centerOn(iso.x, iso.y);
        window.__economyPlacementBaseline = new Set(scene.buildings.getChildren());
        return iso;
      }
    }
    throw new Error(`No valid ${buildingType} placement found.`);
  }, type);
}

async function isoScreenPoint(page, iso) {
  return page.evaluate((point) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (point.x - topLeft.x) * camera.zoom,
      y: (point.y - topLeft.y) * camera.zoom,
    };
  }, iso);
}

async function unitScreenPoint(page, probeKey) {
  return page.evaluate((key) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__economyProgressionProbe[key];
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  }, probeKey);
}

async function cartesianScreenPoint(page, point) {
  return page.evaluate(async (cart) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const { toIsoElev } = await import('/utils/coords');
    const projected = toIsoElev(cart.x, cart.y, scene.terrainSystem.getHeightAt(cart.x, cart.y));
    return {
      x: (projected.x - topLeft.x) * camera.zoom,
      y: (projected.y - topLeft.y) * camera.zoom,
    };
  }, point);
}

async function placeThroughUi(page, canvas, category, type) {
  const iso = await preparePlacement(page, type);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: new RegExp(category, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  await page.waitForFunction(
    (buildingType) => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === buildingType,
    type,
    { timeout: 5_000 },
  );
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable during placement.');
  const point = await isoScreenPoint(page, iso);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some(
      (building) => !window.__economyPlacementBaseline.has(building)
        && building.getData('owner') === 0
        && building.getData('def')?.type === buildingType,
    );
  }, type, { timeout: 5_000 });

  return page.evaluate((buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren().find(
      (candidate) => !window.__economyPlacementBaseline.has(candidate)
        && candidate.getData('owner') === 0
        && candidate.getData('def')?.type === buildingType,
    );
    window.__economyLastBuilding = building;
    return {
      wood: scene.resources.wood,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      x: building.x,
      y: building.y,
      constructionComplete: building.getData('constructionComplete'),
      constructionRemainingMs: (building.getData('constructionCompletesAt') ?? scene.gameTime) - scene.gameTime,
      alpha: building.visual?.alpha ?? building.alpha ?? null,
    };
  }, type);
}

async function rightClickThroughFrame(page, x, y) {
  await page.mouse.move(x, y);
  const before = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.mouse.down({ button: 'right' });
  try {
    await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, before, { timeout: JOURNEY_TIMEOUT_MS });
  } finally {
    await page.mouse.up({ button: 'right' });
  }
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.phase = 'gather-setup';
  evidence.gatherSetup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    const startingResources = { ...scene.resources };
    const seedVillager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!seedVillager?.visual) throw new Error('No idle player villager available.');

    const trees = scene.trees.getChildren()
      .filter((tree) => tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped'))
      .sort((a, b) => Math.hypot(a.x - seedVillager.x, a.y - seedVillager.y) - Math.hypot(b.x - seedVillager.x, b.y - seedVillager.y));
    if (!trees.length) throw new Error('No live wood source available.');

    const manager = scene.buildingManager;
    const baseline = new Set(scene.buildings.getChildren());
    manager.enterBuildMode('Lumber Camp');
    let camp = null;
    let sourceTree = null;
    for (const tree of trees.slice(0, 12)) {
      for (const radius of [48, 64, 80, 96, 112, 128]) {
        for (let step = 0; step < 16; step++) {
          const angle = (step / 16) * Math.PI * 2;
          const cartX = tree.x + Math.cos(angle) * radius;
          const cartY = tree.y + Math.sin(angle) * radius;
          manager.tryBuild(cartX - cartY, (cartX + cartY) * 0.5);
          camp = scene.buildings.getChildren().find(
            (building) => !baseline.has(building)
              && building.getData('owner') === 0
              && building.getData('def')?.type === 'Lumber Camp',
          );
          if (camp) {
            sourceTree = tree;
            break;
          }
        }
        if (camp) break;
      }
      if (camp) break;
    }
    manager.cancelBuildMode();
    if (!camp || !sourceTree) throw new Error('No valid Lumber Camp placement found near live wood.');

    scene.economySystem.assignJobs();
    const villager = scene.villagerSystem.getAllVillagers().find(
      (candidate) => candidate.owner === 0 && candidate.jobBuilding === camp,
    );
    if (!villager?.visual || camp.getData('assignedWorker') !== villager) {
      throw new Error('Lumber Camp did not receive an idle villager through workforce slots.');
    }

    window.__economyProgressionProbe = { villager, camp, player: null, enemy: null };
    return {
      startingResources,
      afterCamp: { ...scene.resources },
      campCostWood: startingResources.wood - scene.resources.wood,
      assignedToCamp: villager.jobBuilding === camp,
      campAssignedWorkerMatches: camp.getData('assignedWorker') === villager,
    };
  });
  if (evidence.gatherSetup.campCostWood !== 25) throw new Error(`Lumber Camp cost drifted: ${JSON.stringify(evidence.gatherSetup)}`);
  if (!evidence.gatherSetup.assignedToCamp || !evidence.gatherSetup.campAssignedWorkerMatches) throw new Error('Workforce assignment did not stick.');

  evidence.phase = 'gather-deposit';
  evidence.gather = await page.evaluate((initialWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    let simulatedMs = 0;
    for (let i = 0; i < 2_000 && scene.resources.wood <= initialWood; i++) {
      scene.villagerSystem.update(scene.gameTime + simulatedMs, 100);
      simulatedMs += 100;
    }
    return {
      simulatedMs,
      initialWood,
      finalWood: scene.resources.wood,
      assigned: window.__economyProgressionProbe.villager.jobBuilding === window.__economyProgressionProbe.camp,
    };
  }, evidence.gatherSetup.afterCamp.wood);
  if (evidence.gather.finalWood <= evidence.gather.initialWood || !evidence.gather.assigned) {
    throw new Error(`Workforce gathering did not produce a live deposit: ${JSON.stringify(evidence.gather)}`);
  }

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Economy/i }).waitFor({ state: 'visible', timeout: 10_000 });
  const canvas = page.locator('canvas').first();

  evidence.phase = 'house-placement';
  const beforeHouse = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { wood: scene.resources.wood, maxPopulation: scene.maxPopulation };
  });
  evidence.housePlaced = await placeThroughUi(page, canvas, 'Economy', 'House');
  if (evidence.housePlaced.wood !== beforeHouse.wood - 50) throw new Error('House did not cost exactly 50 wood after gathering.');
  if (evidence.housePlaced.maxPopulation !== beforeHouse.maxPopulation) throw new Error('House granted population capacity before construction completed.');
  if (evidence.housePlaced.constructionComplete !== false || evidence.housePlaced.constructionRemainingMs <= 0) {
    throw new Error(`Placed House did not enter a real construction state: ${JSON.stringify(evidence.housePlaced)}`);
  }
  if (Math.abs((evidence.housePlaced.alpha ?? 0) - 0.55) > 0.02) {
    throw new Error(`Under-construction House did not expose the expected subdued visual state: ${JSON.stringify(evidence.housePlaced)}`);
  }

  evidence.phase = 'house-completion';
  evidence.houseCompleted = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const house = window.__economyLastBuilding;
    scene.gameTime = house.getData('constructionCompletesAt');
    scene.buildingManager.update();
    return {
      active: Boolean(house.active),
      inScene: scene.buildings.getChildren().includes(house),
      maxPopulation: scene.maxPopulation,
      constructionComplete: house.getData('constructionComplete'),
      alpha: house.visual?.alpha ?? house.alpha ?? null,
    };
  });
  if (!evidence.houseCompleted.active || !evidence.houseCompleted.inScene || evidence.houseCompleted.constructionComplete !== true) {
    throw new Error(`House did not complete coherently: ${JSON.stringify(evidence.houseCompleted)}`);
  }
  if (evidence.houseCompleted.maxPopulation !== beforeHouse.maxPopulation + 8) throw new Error('Completed House did not add exactly 8 population capacity.');
  if (Math.abs((evidence.houseCompleted.alpha ?? 0) - 1) > 0.02) throw new Error('Completed House did not return to full opacity.');
  await page.keyboard.press('Escape');

  evidence.phase = 'barracks';
  evidence.barracks = await placeThroughUi(page, canvas, 'Military', 'Barracks');
  await page.keyboard.press('Escape');

  evidence.phase = 'train';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__economyLastBuilding;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await waitForCameraSync(page);
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for Barracks selection.');
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__economyLastBuilding;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (building.visual.x - topLeft.x) * camera.zoom,
      y: (building.visual.y - 24 - topLeft.y) * camera.zoom,
    };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y, { button: 'left' });
  await page.waitForFunction(
    () => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__economyLastBuilding,
    undefined,
    { timeout: 5_000 },
  );
  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    window.__economyPreviousSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      units: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.population === before.population + 1
      && scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length === before.units + 1;
  }, evidence.beforeTraining, { timeout: 5_000 });
  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    const player = units[units.length - 1];
    window.__economyProgressionProbe.player = player;
    const result = {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      units: units.length,
      type: player?.unitType ?? player?.getData('unitType'),
    };
    scene.gameSpeed = window.__economyPreviousSpeed;
    return result;
  });
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100) throw new Error('Pikesman did not cost exactly 100 food.');
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman did not cost exactly 50 gold.');
  if (evidence.afterTraining.population !== evidence.beforeTraining.population + 1) throw new Error('Pikesman did not consume exactly one population.');
  if (evidence.afterTraining.units !== evidence.beforeTraining.units + 1 || evidence.afterTraining.type !== 'Pikesman') throw new Error('Visible training did not create exactly one Pikesman.');

  evidence.phase = 'move-trained-unit';
  evidence.move = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    scene.inputManager.clearSelection();
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    for (const [dx, dy] of [[96, 0], [-96, 0], [0, 96], [0, -96], [72, 72], [-72, -72]]) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if ((path?.length ?? 0) > 1) {
        player.setData('__economyMoveStartX', player.x);
        player.setData('__economyMoveStartY', player.y);
        return target;
      }
    }
    throw new Error('No reachable movement target found.');
  });
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for army movement.');
  let playerPoint = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + playerPoint.x, box.y + playerPoint.y, { button: 'left' });
  await page.waitForFunction(
    () => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__economyProgressionProbe.player),
    undefined,
    { timeout: JOURNEY_TIMEOUT_MS },
  );
  let targetPoint = await cartesianScreenPoint(page, evidence.move);
  await rightClickThroughFrame(page, box.x + targetPoint.x, box.y + targetPoint.y);
  await page.waitForFunction(() => {
    const player = window.__economyProgressionProbe.player;
    return Math.hypot(player.x - player.getData('__economyMoveStartX'), player.y - player.getData('__economyMoveStartY')) > 8;
  }, undefined, { timeout: 12_000 });

  evidence.phase = 'combat';
  evidence.combatSetup = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    const { toIsoElev } = await import('/utils/coords');
    scene.peacefulMode = true;
    window.__economyCombatSpeed = scene.gameSpeed;
    scene.gameSpeed = 0;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    let enemy = null;
    let targetScreen = null;
    for (const [dx, dy] of [[36, 0], [-36, 0], [0, 36], [0, -36], [48, 0], [-48, 0], [0, 48], [0, -48]]) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (scene.pathfinder.isBlocked(x, y)) continue;
      const projected = toIsoElev(x, y, scene.terrainSystem.getHeightAt(x, y));
      const screen = {
        x: (projected.x - topLeft.x) * camera.zoom,
        y: (projected.y - 10 - topLeft.y) * camera.zoom,
      };
      if (screen.x < 120 || screen.x > 1320 || screen.y < 120 || screen.y > 780) continue;
      enemy = scene.entityFactory.spawnUnit('Pikesman', x, y, 1);
      targetScreen = screen;
      break;
    }
    if (!enemy || !targetScreen) throw new Error('No reachable on-screen enemy position available.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = scene.gameTime;
    window.__economyProgressionProbe.enemy = enemy;
    window.__economyProgressionProbe.enemyX = enemy.x;
    window.__economyProgressionProbe.enemyY = enemy.y;
    return {
      playerHp: player.getData('hp'),
      enemyHp: enemy.getData('hp'),
      pausedAtGameTime: scene.gameTime,
      targetScreen,
    };
  });
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for combat.');
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__economyProgressionProbe;
    return Boolean(probe.enemy?.visual) && scene.inputManager.selectedUnits.includes(probe.player);
  }, undefined, { timeout: 5_000 });
  await page.mouse.move(box.x + evidence.combatSetup.targetScreen.x, box.y + evidence.combatSetup.targetScreen.y);
  const targetHit = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const enemy = window.__economyProgressionProbe.enemy;
    return scene.input.hitTestPointer(scene.input.activePointer).some((obj) => obj.getData?.('unit') === enemy);
  });
  if (!targetHit) throw new Error(`On-screen combat target was not hit-testable at ${JSON.stringify(evidence.combatSetup.targetScreen)}.`);
  await page.mouse.click(
    box.x + evidence.combatSetup.targetScreen.x,
    box.y + evidence.combatSetup.targetScreen.y,
    { button: 'right' },
  );
  evidence.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__economyProgressionProbe;
    return {
      targetsEnemy: player.target === enemy,
      explicitTarget: player.getData('explicitTarget') === true,
      selected: scene.inputManager.selectedUnits.includes(player),
      gameSpeed: scene.gameSpeed,
      gameTime: scene.gameTime,
      targetHp: enemy.active ? enemy.getData('hp') : null,
    };
  });
  if (!evidence.attackCommand.targetsEnemy || !evidence.attackCommand.explicitTarget) {
    throw new Error(`Attack command was not accepted: ${JSON.stringify(evidence.attackCommand)}`);
  }
  if (
    evidence.attackCommand.gameSpeed !== 0
    || evidence.attackCommand.gameTime !== evidence.combatSetup.pausedAtGameTime
    || evidence.attackCommand.targetHp !== 10
  ) {
    throw new Error('Simulation advanced while capturing the attack command.');
  }
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    player.lastAttackTime = scene.gameTime - 10_000;
    scene.peacefulMode = false;
    scene.gameSpeed = window.__economyCombatSpeed || 1;
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy, enemyX, enemyY } = window.__economyProgressionProbe;
    return !enemy.active
      && !scene.units.getChildren().includes(enemy)
      && !scene.unitSpatialHash.query(enemyX, enemyY, 96).includes(enemy)
      && player.active;
  }, undefined, { timeout: 15_000 });

  evidence.phase = 'save';
  evidence.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    const owned = scene.buildings.getChildren().filter((building) => building.getData('owner') === 0);
    const snapshot = {
      x: player.x,
      y: player.y,
      type: player.unitType ?? player.getData('unitType'),
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      houses: owned.filter((building) => building.getData('def')?.type === 'House').length,
      barracks: owned.filter((building) => building.getData('def')?.type === 'Barracks').length,
    };
    window.dispatchEvent(new Event('save-game'));
    return snapshot;
  });
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    if (!scene?.isReady) return false;
    return scene.units.getChildren().some(
      (unit) => unit.getData('owner') === 0
        && (unit.unitType ?? unit.getData('unitType')) === saved.type
        && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2,
    );
  }, evidence.beforeSave, { timeout: 20_000 });

  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren()
      .filter((unit) => unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === saved.type)
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!player) throw new Error('Trained Pikesman was not restored.');
    const owned = scene.buildings.getChildren().filter((building) => building.getData('owner') === 0);
    window.__economyProgressionProbe = { player, enemy: null };
    return {
      x: player.x,
      y: player.y,
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      positionDelta: Math.hypot(player.x - saved.x, player.y - saved.y),
      houses: owned.filter((building) => building.getData('def')?.type === 'House').length,
      barracks: owned.filter((building) => building.getData('def')?.type === 'Barracks').length,
    };
  }, evidence.beforeSave);
  if (evidence.restored.positionDelta > 2 || evidence.restored.hp !== evidence.beforeSave.hp) throw new Error('Trained Pikesman continuity changed across reload.');
  if (evidence.restored.population !== evidence.beforeSave.population || evidence.restored.maxPopulation !== evidence.beforeSave.maxPopulation) throw new Error('Economy/population continuity changed across reload.');
  if (evidence.restored.houses !== evidence.beforeSave.houses || evidence.restored.barracks !== evidence.beforeSave.barracks) throw new Error('Player building continuity changed across reload.');

  evidence.phase = 'continue-playing';
  evidence.postLoadTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    for (const [dx, dy] of [[64, 0], [-64, 0], [0, 64], [0, -64]]) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if ((path?.length ?? 0) > 1) {
        player.setData('__economyPostLoadX', player.x);
        player.setData('__economyPostLoadY', player.y);
        return target;
      }
    }
    throw new Error('No post-load walkable target found.');
  });
  await waitForCameraSync(page);
  const postReloadCanvas = page.locator('canvas').first();
  box = await postReloadCanvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable after reload.');
  playerPoint = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + playerPoint.x, box.y + playerPoint.y, { button: 'left' });
  await page.waitForFunction(
    () => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__economyProgressionProbe.player),
    undefined,
    { timeout: JOURNEY_TIMEOUT_MS },
  );
  targetPoint = await cartesianScreenPoint(page, evidence.postLoadTarget);
  await rightClickThroughFrame(page, box.x + targetPoint.x, box.y + targetPoint.y);
  await page.waitForFunction(() => {
    const player = window.__economyProgressionProbe.player;
    return Math.hypot(player.x - player.getData('__economyPostLoadX'), player.y - player.getData('__economyPostLoadY')) > 5;
  }, undefined, { timeout: 12_000 });

  if (evidence.browserErrors.length) throw new Error(`Browser errors:\n${evidence.browserErrors.join('\n')}`);
  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
