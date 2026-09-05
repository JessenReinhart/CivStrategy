import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/repeated-save-load-continuity.json`;
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
    return Boolean(scene?.isReady && scene?.inputManager && scene?.villagerSystem && scene?.entityFactory && scene?.pathfinder);
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
}

async function openGameMenu(page) {
  const saveButton = page.getByRole('button', { name: /Save game/i });
  if (await saveButton.isVisible().catch(() => false)) return;
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
  await saveButton.waitFor({ state: 'visible', timeout: 5_000 });
}

async function closeGameMenu(page) {
  const saveButton = page.getByRole('button', { name: /Save game/i });
  if (!(await saveButton.isVisible().catch(() => false))) return;
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.click();
  await saveButton.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function saveThroughUi(page) {
  const previousSave = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction(({ key, previous }) => {
    const current = localStorage.getItem(key);
    return Boolean(current) && current !== previous;
  }, { key: SAVE_KEY, previous: previousSave }, { timeout: 10_000 });
}

async function reloadAndLoadThroughUi(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await page.evaluate(() => { window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = 0; });
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await page.waitForFunction(() => window.__civStrategyGame?.scene?.getScene?.('MainScene')?.isReady, undefined, { timeout: 20_000 });
  // A player closes the system menu before issuing world commands. Keeping the menu
  // open here made the persistence probe exercise a UI-overlay edge case instead of
  // the intended save/load continuation contract.
  await closeGameMenu(page);
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.events.once('postupdate', resolve);
  }));
}

async function findMoveTarget(page, start) {
  return page.evaluate((origin) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    for (const [dx, dy] of [[64, 0], [-64, 0], [0, 64], [0, -64], [48, 48], [-48, -48]]) {
      const target = { x: origin.x + dx, y: origin.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath(origin, target);
      if (path?.length > 1) return target;
    }
    throw new Error('No reachable move target for repeated persistence probe.');
  }, start);
}

async function screenPointForCartesian(page, target) {
  return page.evaluate((point) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const iso = { x: point.x - point.y, y: (point.x + point.y) * 0.5 };
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (iso.x - topLeft.x) * camera.zoom, y: (iso.y - topLeft.y) * camera.zoom };
  }, target);
}

async function selectAndMoveArmy(page, player, target) {
  await page.evaluate(({ x, y }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = scene.units.getChildren().find((candidate) => (
      candidate.getData('owner') === 0
      && (candidate.unitType ?? candidate.getData('unitType')) === 'Pikesman'
      && Math.hypot(candidate.x - x, candidate.y - y) <= 2
    ));
    if (!unit?.visual) throw new Error('Persisted Pikesman is not selectable.');
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(unit.visual.x, unit.visual.y);
    window.__repeatedSaveLoadPlayer = unit;
  }, player);
  await waitForCameraSync(page);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable for repeated persistence movement.');
  const unitPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__repeatedSaveLoadPlayer;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (unit.visual.x - topLeft.x) * camera.zoom, y: (unit.visual.y - 10 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + unitPoint.x, box.y + unitPoint.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__repeatedSaveLoadPlayer);
  }, undefined, { timeout: 5_000 });

  const targetPoint = await screenPointForCartesian(page, target);
  const before = await page.evaluate(() => {
    const unit = window.__repeatedSaveLoadPlayer;
    return { x: unit.x, y: unit.y };
  });
  await page.evaluate(() => { window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = 1; });
  await page.mouse.click(box.x + targetPoint.x, box.y + targetPoint.y, { button: 'right' });
  await page.waitForFunction((start) => {
    const unit = window.__repeatedSaveLoadPlayer;
    return Math.hypot(unit.x - start.x, unit.y - start.y) > 5;
  }, before, { timeout: 12_000 });
  return page.evaluate(() => {
    const unit = window.__repeatedSaveLoadPlayer;
    return { x: unit.x, y: unit.y, hp: unit.getData('hp'), type: unit.unitType ?? unit.getData('unitType') };
  });
}

async function waitForArmyArrival(page, target) {
  await page.waitForFunction((destination) => {
    const unit = window.__repeatedSaveLoadPlayer;
    return unit && Math.hypot(unit.x - destination.x, unit.y - destination.y) <= 10;
  }, target, { timeout: 15_000 });
  return page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__repeatedSaveLoadPlayer;
    scene.gameSpeed = 0;
    return { x: unit.x, y: unit.y, hp: unit.getData('hp'), type: unit.unitType ?? unit.getData('unitType') };
  });
}

async function inspectRestoredState(page, expected) {
  return page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    scene.economySystem.assignJobs = () => {};
    const nearest = (items, point) => items.slice().sort((a, b) => (
      Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y)
    ))[0];
    const player = nearest(scene.units.getChildren().filter((unit) => (
      unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === 'Pikesman'
    )), saved.player);
    const camp = nearest(scene.buildings.getChildren().filter((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Lumber Camp'
    )), saved.camp);
    const house = nearest(scene.buildings.getChildren().filter((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'House'
    )), saved.house);
    const barracks = nearest(scene.buildings.getChildren().filter((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Barracks'
    )), saved.barracks);
    if (!player?.visual || !camp?.visual || !house?.visual || !barracks?.visual) {
      throw new Error('Repeated save/load did not restore the canonical army/building set.');
    }
    const villager = camp.getData('assignedWorker');
    if (!villager?.visual || villager.owner !== 0 || villager.jobBuilding !== camp) {
      throw new Error('Repeated save/load broke the Lumber Camp workforce relationship.');
    }
    return {
      player: { x: player.x, y: player.y, hp: player.getData('hp') },
      camp: { x: camp.x, y: camp.y },
      house: { x: house.x, y: house.y },
      barracks: { x: barracks.x, y: barracks.y },
      wood: scene.resources.wood,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      workforceCoherent: villager.jobBuilding === camp && camp.getData('assignedWorker') === villager,
    };
  }, expected);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/repeated-save-load-continuity.png`, fullPage: true }); } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.phase = 'setup';
  evidence.initial = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    const townCenter = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center'
    ));
    const villager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!townCenter || !villager?.visual) throw new Error('Canonical persistence setup is unavailable.');
    const house = scene.entityFactory.spawnBuilding('House', townCenter.x - 192, townCenter.y + 192, 0);
    const barracks = scene.entityFactory.spawnBuilding('Barracks', townCenter.x + 192, townCenter.y + 192, 0);
    const camp = scene.entityFactory.spawnBuilding('Lumber Camp', villager.x + 64, villager.y + 64, 0);
    scene.economySystem.assignJobs();
    const assigned = camp.getData('assignedWorker');
    if (!assigned || assigned.jobBuilding !== camp) throw new Error('Lumber Camp did not receive a worker before first save.');

    const buildings = scene.buildings.getChildren();
    let armySpawn = null;
    for (const radius of [160, 192, 224, 256]) {
      for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, -radius], [-radius, -radius]]) {
        const point = { x: townCenter.x + dx, y: townCenter.y + dy };
        if (scene.pathfinder.isBlocked(point.x, point.y)) continue;
        const tooCloseToBuilding = buildings.some((building) => Math.hypot(building.x - point.x, building.y - point.y) < 80);
        if (tooCloseToBuilding) continue;
        const hasExit = [[64, 0], [-64, 0], [0, 64], [0, -64]].some(([mx, my]) => {
          const target = { x: point.x + mx, y: point.y + my };
          if (scene.pathfinder.isBlocked(target.x, target.y)) return false;
          return (scene.pathfinder.findPath(point, target)?.length ?? 0) > 1;
        });
        if (hasExit) { armySpawn = point; break; }
      }
      if (armySpawn) break;
    }
    if (!armySpawn) throw new Error('Could not place deterministic Pikesman on open pathable terrain.');
    const player = scene.entityFactory.spawnUnit('Pikesman', armySpawn.x, armySpawn.y, 0);

    scene.resources.wood = 777;
    scene.resources.food = 555;
    scene.resources.gold = 333;
    return {
      player: { x: player.x, y: player.y, hp: player.getData('hp') },
      camp: { x: camp.x, y: camp.y },
      house: { x: house.x, y: house.y },
      barracks: { x: barracks.x, y: barracks.y },
      wood: scene.resources.wood,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  });

  evidence.phase = 'first-save';
  await saveThroughUi(page);
  evidence.phase = 'first-reload';
  await reloadAndLoadThroughUi(page);
  evidence.firstRestored = await inspectRestoredState(page, evidence.initial);
  for (const key of ['wood', 'food', 'gold', 'population', 'maxPopulation']) {
    if (evidence.firstRestored[key] !== evidence.initial[key]) throw new Error(`${key} drifted on first save/load.`);
  }

  evidence.phase = 'first-continuation-move';
  const firstTarget = await findMoveTarget(page, evidence.firstRestored.player);
  evidence.firstTarget = firstTarget;
  evidence.afterFirstMove = await selectAndMoveArmy(page, evidence.firstRestored.player, firstTarget);
  evidence.afterFirstArrival = await waitForArmyArrival(page, firstTarget);

  evidence.phase = 'second-save';
  const secondSnapshot = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__repeatedSaveLoadPlayer;
    scene.gameSpeed = 0;
    const camp = scene.buildings.getChildren().find((building) => building.getData('owner') === 0 && building.getData('def')?.type === 'Lumber Camp');
    const house = scene.buildings.getChildren().find((building) => building.getData('owner') === 0 && building.getData('def')?.type === 'House');
    const barracks = scene.buildings.getChildren().find((building) => building.getData('owner') === 0 && building.getData('def')?.type === 'Barracks');
    return {
      player: { x: player.x, y: player.y, hp: player.getData('hp') },
      camp: { x: camp.x, y: camp.y },
      house: { x: house.x, y: house.y },
      barracks: { x: barracks.x, y: barracks.y },
      wood: scene.resources.wood,
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  });
  evidence.secondSaved = secondSnapshot;
  await saveThroughUi(page);

  evidence.phase = 'second-reload';
  await reloadAndLoadThroughUi(page);
  evidence.secondRestored = await inspectRestoredState(page, secondSnapshot);
  for (const key of ['wood', 'food', 'gold', 'population', 'maxPopulation']) {
    if (evidence.secondRestored[key] !== secondSnapshot[key]) throw new Error(`${key} drifted on second-generation save/load.`);
  }
  if (Math.hypot(evidence.secondRestored.player.x - secondSnapshot.player.x, evidence.secondRestored.player.y - secondSnapshot.player.y) > 2) {
    throw new Error('Continued army position drifted across the second save/load cycle.');
  }
  for (const key of ['camp', 'house', 'barracks']) {
    if (Math.hypot(evidence.secondRestored[key].x - secondSnapshot[key].x, evidence.secondRestored[key].y - secondSnapshot[key].y) > 2) {
      throw new Error(`${key} drifted across the second save/load cycle.`);
    }
  }
  if (!evidence.secondRestored.workforceCoherent) throw new Error('Workforce relationship was not coherent after the second reload.');

  evidence.phase = 'second-continuation-move';
  const secondTarget = await findMoveTarget(page, evidence.secondRestored.player);
  evidence.secondTarget = secondTarget;
  evidence.afterSecondMove = await selectAndMoveArmy(page, evidence.secondRestored.player, secondTarget);
  if (Math.hypot(evidence.afterSecondMove.x - evidence.secondRestored.player.x, evidence.afterSecondMove.y - evidence.secondRestored.player.y) <= 5) {
    throw new Error('Second-restored army could not continue playing through real canvas movement.');
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
