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
    return Boolean(scene?.isReady && scene?.villagerSystem && scene?.buildingManager && scene?.inputManager && scene?.economySystem && scene?.entityFactory && scene?.pathfinder && scene?.unitSpatialHash);
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

async function unitScreenPoint(page, key) {
  return page.evaluate((probeKey) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__economyProgressionProbe[probeKey];
    const visual = unit.visual;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (visual.x - topLeft.x) * camera.zoom,
      y: (visual.y - 10 - topLeft.y) * camera.zoom,
    };
  }, key);
}

async function cartesianScreenPoint(page, point) {
  return page.evaluate((cart) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const iso = { x: cart.x - cart.y, y: (cart.x + cart.y) * 0.5 };
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, point);
}

async function rightClickThroughFrame(page, x, y, targetKind) {
  await page.mouse.move(x, y);
  const beforeMove = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, beforeMove, { timeout: 30_000 });
  await page.mouse.move(x, y);
  if (targetKind === 'camp' || targetKind === 'enemy') {
    await page.waitForFunction((kind) => {
      const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
      const probe = window.__economyProgressionProbe;
      const target = kind === 'camp' ? probe?.camp : probe?.enemy;
      const pointer = scene?.input?.activePointer;
      if (!scene || !target || !pointer) return false;
      return scene.input.hitTestPointer(pointer)
        .some((hit) => kind === 'camp'
          ? hit.getData?.('building') === target
          : hit.getData?.('unit') === target);
    }, targetKind, { timeout: 30_000 });
  }
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
  if (!box) throw new Error('Game canvas unavailable during building placement.');
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
  await bootNewGame(page);

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
    window.__economyProgressionProbe = { villager, camp, player: null, enemy: null };
    return { wood: scene.resources.wood, villagerId: villager.id };
  });
  await waitForCameraSync(page);
  const canvas = page.locator('canvas').first();
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable.');

  evidence.phase = 'select-villager';
  const villagerPoint = await screenPoint(page, 'villager');
  await page.mouse.click(box.x + villagerPoint.x, box.y + villagerPoint.y, { button: 'left' });
  await page.waitForFunction(() => Boolean(window.__economyProgressionProbe.villager.visual?.getData('workforceSelectionRing')?.active), undefined, { timeout: 30_000 });

  evidence.phase = 'assign-work';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { villager, camp } = window.__economyProgressionProbe;
    scene.cameras.main.centerOn((villager.visual.x + camp.visual.x) * 0.5, (villager.visual.y + camp.visual.y) * 0.5);
  });
  await waitForCameraSync(page);
  const campPoint = await screenPoint(page, 'camp');
  await rightClickThroughFrame(page, box.x + campPoint.x, box.y + campPoint.y, 'camp');
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
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for Barracks selection.');
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
    window.__economyProgressionProbe.player = newest;
    const result = { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, units: units.length, type: newest?.unitType ?? newest?.getData('unitType') };
    scene.gameSpeed = window.__economyPreviousSpeed;
    return result;
  });
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100) throw new Error('Pikesman did not cost exactly 100 food.');
  if (evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman did not cost exactly 50 gold.');
  if (evidence.afterTraining.population !== evidence.beforeTraining.population + 1) throw new Error('Pikesman did not consume exactly one population.');
  if (evidence.afterTraining.units !== evidence.beforeTraining.units + 1 || evidence.afterTraining.type !== 'Pikesman') throw new Error('Visible training action did not create exactly one Pikesman.');

  evidence.phase = 'move-trained-unit';
  evidence.moveTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    scene.inputManager.clearSelection();
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const candidates = [[96, 0], [-96, 0], [0, 96], [0, -96], [72, 72], [-72, -72]];
    for (const [dx, dy] of candidates) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      const endpoint = path?.[path.length - 1];
      if (path?.length > 1 && endpoint && Math.hypot(endpoint.x - target.x, endpoint.y - target.y) <= 36) {
        return { ...target, pathEndpointX: endpoint.x, pathEndpointY: endpoint.y };
      }
    }
    throw new Error('No reachable target found for the trained Pikesman.');
  });
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for army movement.');
  let playerPoint = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + playerPoint.x, box.y + playerPoint.y, { button: 'left' });
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__economyProgressionProbe.player), undefined, { timeout: 30_000 });
  evidence.moveCommandStart = await page.evaluate((target) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    player.setData('__economyJourneyMoveX', player.x);
    player.setData('__economyJourneyMoveY', player.y);
    return {
      x: player.x,
      y: player.y,
      gameTime: scene.gameTime,
      distanceToTarget: Math.hypot(player.x - target.x, player.y - target.y),
    };
  }, evidence.moveTarget);
  let targetPoint = await cartesianScreenPoint(page, evidence.moveTarget);
  await rightClickThroughFrame(page, box.x + targetPoint.x, box.y + targetPoint.y);
  evidence.moveAccepted = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    return {
      gameTime: scene.gameTime,
      speed: player.body?.velocity?.length?.() ?? 0,
      pathLength: player.path?.length ?? 0,
    };
  });
  const minimumSimulationMs = 180;
  try {
    await page.waitForFunction(({ target, start, acceptedGameTime, minimumSimulationMs }) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const player = window.__economyProgressionProbe.player;
      const movedDistance = Math.hypot(player.x - start.x, player.y - start.y);
      const distanceToTarget = Math.hypot(player.x - target.x, player.y - target.y);
      if (movedDistance >= 40 && distanceToTarget <= 48) return true;
      const simulatedMs = scene.gameTime - acceptedGameTime;
      if (simulatedMs < minimumSimulationMs) return false;
      const speed = player.body?.velocity?.length?.() ?? 0;
      const expectedProgress = speed * simulatedMs / 1000;
      return speed > 0
        && movedDistance >= Math.max(8, expectedProgress * 0.75)
        && distanceToTarget < start.distanceToTarget;
    }, {
      target: evidence.moveTarget,
      start: evidence.moveCommandStart,
      acceptedGameTime: evidence.moveAccepted.gameTime,
      minimumSimulationMs,
    }, { timeout: 30_000 });
  } catch (error) {
    evidence.moveFailureState = await page.evaluate((target) => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const player = window.__economyProgressionProbe.player;
      return {
        x: player.x,
        y: player.y,
        gameTime: scene.gameTime,
        simulatedMs: scene.gameTime - window.__economyProgressionProbe.moveAcceptedGameTime,
        speed: player.body?.velocity?.length?.() ?? 0,
        distanceToTarget: Math.hypot(player.x - target.x, player.y - target.y),
        movedDistance: Math.hypot(player.x - player.getData('__economyJourneyMoveX'), player.y - player.getData('__economyJourneyMoveY')),
      };
    }, evidence.moveTarget).catch(() => null);
    throw error;
  }
  evidence.moveArrival = await page.evaluate((target) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    return {
      x: player.x,
      y: player.y,
      gameTime: scene.gameTime,
      distanceToTarget: Math.hypot(player.x - target.x, player.y - target.y),
      pathEndpointDistance: Math.hypot(target.pathEndpointX - target.x, target.pathEndpointY - target.y),
      movedDistance: Math.hypot(player.x - player.getData('__economyJourneyMoveX'), player.y - player.getData('__economyJourneyMoveY')),
      speed: player.body?.velocity?.length?.() ?? 0,
    };
  }, evidence.moveTarget);
  evidence.simulatedMovementMs = evidence.moveArrival.gameTime - evidence.moveAccepted.gameTime;
  if (evidence.moveArrival.movedDistance < 8 || evidence.simulatedMovementMs < minimumSimulationMs || evidence.moveArrival.distanceToTarget >= evidence.moveCommandStart.distanceToTarget) {
    throw new Error(`Trained Pikesman did not make simulation-backed command progress: ${JSON.stringify({ start: evidence.moveCommandStart, accepted: evidence.moveAccepted, target: evidence.moveTarget, arrival: evidence.moveArrival, simulatedMovementMs: evidence.simulatedMovementMs })}`);
  }

  evidence.phase = 'combat';
  evidence.combat = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    window.__economyCombatPreviousSpeed = scene.gameSpeed;
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    const candidates = [[36, 0], [-36, 0], [0, 36], [0, -36]];
    let spawn;
    for (const [dx, dy] of candidates) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (!scene.pathfinder.isBlocked(x, y)) { spawn = { x, y }; break; }
    }
    if (!spawn) throw new Error('No in-range enemy position was available.');
    const enemy = scene.entityFactory.spawnUnit('Pikesman', spawn.x, spawn.y, 1);
    if (!enemy) throw new Error('Could not create deterministic combat enemy.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = scene.gameTime;
    window.__economyProgressionProbe.enemy = enemy;
    window.__economyProgressionProbe.enemyX = enemy.x;
    window.__economyProgressionProbe.enemyY = enemy.y;
    scene.cameras.main.panEffect?.reset();
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn((player.visual.x + enemy.visual.x) * 0.5, (player.visual.y + enemy.visual.y) * 0.5);
    return {
      distance: Math.hypot(player.x - enemy.x, player.y - enemy.y),
      pausedAtGameTime: scene.gameTime,
      previousGameSpeed: window.__economyCombatPreviousSpeed,
    };
  });
  if (evidence.combat.distance > 40) throw new Error(`Deterministic enemy exceeded Pikesman attack range (${evidence.combat.distance.toFixed(2)}px).`);
  await waitForCameraSync(page);
  const combatCameraFrame = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, combatCameraFrame, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__economyProgressionProbe;
    return scene.inputManager.selectedUnits.includes(player)
      && player.visual?.active
      && player.visual.visible
      && enemy.active
      && enemy.visual?.active
      && enemy.visual.visible
      && enemy.visual.alpha > 0;
  }, undefined, { timeout: 30_000 });
  box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for combat.');
  const enemyPoint = await unitScreenPoint(page, 'enemy');
  const enemyPagePoint = { x: box.x + enemyPoint.x, y: box.y + enemyPoint.y };
  await page.mouse.move(enemyPagePoint.x, enemyPagePoint.y);
  evidence.combatPointer = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const pointer = scene.input.activePointer;
    const enemy = window.__economyProgressionProbe.enemy;
    const targets = scene.input.hitTestPointer(pointer);
    const enemyBounds = enemy.visual?.getBounds?.();
    return {
      pointer: { x: pointer.x, y: pointer.y, worldX: pointer.worldX, worldY: pointer.worldY },
      enemyVisual: { x: enemy.visual?.x, y: enemy.visual?.y },
      enemyBounds: enemyBounds ? { x: enemyBounds.x, y: enemyBounds.y, width: enemyBounds.width, height: enemyBounds.height, centerX: enemyBounds.centerX, centerY: enemyBounds.centerY } : null,
      hitCount: targets.length,
      hitsEnemy: targets.some((obj) => obj.getData?.('unit') === enemy),
      hitTypes: targets.map((obj) => obj.getData?.('unit') ? `unit:${obj.getData('unit').getData('owner')}` : obj.getData?.('building') ? `building:${obj.getData('building').getData('owner')}` : obj.type ?? 'unknown'),
    };
  });
  evidence.attackIssuedAtFrame = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await rightClickThroughFrame(page, enemyPagePoint.x, enemyPagePoint.y, 'enemy');
  await page.waitForFunction(() => {
    const { player, enemy } = window.__economyProgressionProbe;
    return player.target === enemy && player.getData('explicitTarget') === true;
  }, undefined, { timeout: 5_000 });

  evidence.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__economyProgressionProbe;
    return {
      acceptedAtFrame: window.__civStrategyGame.loop.frame,
      gameTime: scene.gameTime,
      gameSpeed: scene.gameSpeed,
      targetHp: enemy.active ? enemy.getData('hp') : null,
      targetsEnemy: player.target === enemy,
      explicitTarget: player.getData('explicitTarget') === true,
    };
  });
  if (!evidence.attackCommand.targetsEnemy || !evidence.attackCommand.explicitTarget) {
    throw new Error(`Real combat right-click was not accepted by the trained Pikesman: ${JSON.stringify(evidence.attackCommand)}`);
  }
  if (evidence.attackCommand.gameSpeed !== 0
    || evidence.attackCommand.gameTime !== evidence.combat.pausedAtGameTime
    || evidence.attackCommand.targetHp !== 10) {
    throw new Error(`Simulation advanced during combat command capture: ${JSON.stringify(evidence.attackCommand)}`);
  }

  evidence.combatEnabledAtGameTime = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    player.lastAttackTime = scene.gameTime - 10_000;
    scene.peacefulMode = false;
    scene.gameSpeed = window.__economyCombatPreviousSpeed || 1;
    return scene.gameTime;
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__economyProgressionProbe;
    return !probe.enemy.active
      && !scene.units.getChildren().includes(probe.enemy)
      && !scene.unitSpatialHash.query(probe.enemyX, probe.enemyY, 96).includes(probe.enemy)
      && probe.player.active
      && scene.units.getChildren().includes(probe.player);
  }, undefined, { timeout: 12_000 });

  evidence.phase = 'save';
  evidence.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    const owned = scene.buildings.getChildren().filter((b) => b.getData('owner') === 0);
    const snapshot = {
      x: player.x,
      y: player.y,
      type: player.unitType ?? player.getData('unitType'),
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      houses: owned.filter((b) => b.getData('def')?.type === 'House').length,
      barracks: owned.filter((b) => b.getData('def')?.type === 'Barracks').length,
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
    return scene.units.getChildren().some((unit) => unit.getData?.('owner') === 0
      && (unit.unitType ?? unit.getData?.('unitType')) === saved.type
      && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2);
  }, evidence.beforeSave, { timeout: 20_000 });

  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren()
      .filter((unit) => unit.getData?.('owner') === 0 && (unit.unitType ?? unit.getData?.('unitType')) === saved.type)
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!player) throw new Error('Trained surviving Pikesman was not restored.');
    const owned = scene.buildings.getChildren().filter((b) => b.getData('owner') === 0);
    window.__economyProgressionProbe = { player, enemy: null };
    return {
      x: player.x,
      y: player.y,
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      positionDelta: Math.hypot(player.x - saved.x, player.y - saved.y),
      houses: owned.filter((b) => b.getData('def')?.type === 'House').length,
      barracks: owned.filter((b) => b.getData('def')?.type === 'Barracks').length,
    };
  }, evidence.beforeSave);
  if (evidence.restored.positionDelta > 2) throw new Error('Trained Pikesman position did not survive reload.');
  if (evidence.restored.hp !== evidence.beforeSave.hp) throw new Error('Trained Pikesman HP did not survive reload.');
  if (evidence.restored.population !== evidence.beforeSave.population) throw new Error('Population changed across save/reload.');
  if (evidence.restored.maxPopulation !== evidence.beforeSave.maxPopulation) throw new Error('Housing capacity changed across save/reload.');
  if (evidence.restored.houses !== evidence.beforeSave.houses || evidence.restored.barracks !== evidence.beforeSave.barracks) throw new Error('Player-built House/Barracks continuity changed across save/reload.');

  evidence.phase = 'continue-playing';
  evidence.postLoadTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const candidates = [[64, 0], [-64, 0], [0, 64], [0, -64]];
    for (const [dx, dy] of candidates) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length > 1) {
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
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__economyProgressionProbe.player), undefined, { timeout: 30_000 });
  targetPoint = await cartesianScreenPoint(page, evidence.postLoadTarget);
  await page.mouse.click(box.x + targetPoint.x, box.y + targetPoint.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__economyProgressionProbe.player;
    return Math.hypot(player.x - player.getData('__economyPostLoadX'), player.y - player.getData('__economyPostLoadY')) > 5;
  }, undefined, { timeout: 12_000 });
  evidence.afterContinue = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__economyProgressionProbe.player;
    return {
      selected: scene.inputManager.selectedUnits.includes(player),
      movedDistance: Math.hypot(player.x - player.getData('__economyPostLoadX'), player.y - player.getData('__economyPostLoadY')),
    };
  });
  if (!evidence.afterContinue.selected || evidence.afterContinue.movedDistance <= 5) throw new Error('Restored trained Pikesman could not continue under real player input.');
  if (evidence.browserErrors.length) throw new Error(`Browser errors:\n${evidence.browserErrors.join('\n')}`);

  evidence.phase = 'complete';
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (page) {
    try { await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); } catch {}
  }
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}