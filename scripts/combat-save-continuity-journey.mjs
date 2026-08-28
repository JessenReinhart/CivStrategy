import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
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
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(
      scene?.isReady
      && scene?.entityFactory
      && scene?.buildingManager
      && scene?.inputManager
      && scene?.pathfinder
      && scene?.unitSpatialHash
      && scene?.units,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);
}

async function unitScreenPoint(page, key) {
  return page.evaluate((probeKey) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__trainedSaveProbe[probeKey];
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  }, key);
}

async function cartesianScreenPoint(page, point) {
  return page.evaluate((cart) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    // InputManager receives isometric pointer coordinates and converts them back to Cartesian.
    const iso = { x: cart.x - cart.y, y: (cart.x + cart.y) * 0.5 };
    return {
      x: (iso.x - topLeft.x) * camera.zoom,
      y: (iso.y - topLeft.y) * camera.zoom,
    };
  }, point);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const telemetry = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(
    `${ARTIFACT_DIR}/combat-save-continuity-telemetry.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  if (!page) return;
  try {
    await page.screenshot({ path: `${ARTIFACT_DIR}/combat-save-continuity-journey.png`, fullPage: true });
  } catch {
    // Keep telemetry if Chromium is already unavailable.
  }
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => telemetry.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  telemetry.phase = 'player-preparation';
  telemetry.preparation = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    scene.peacefulMode = true;
    scene.resources.wood = 100_000;
    scene.resources.food = 100_000;
    scene.resources.gold = 100_000;

    const buildings = () => scene.buildings.getChildren();
    const getDef = (building) => building.getData('def');
    const getOwner = (building) => building.getData('owner');
    const townCenter = buildings().find((building) => (
      getOwner(building) === 0 && getDef(building)?.type === 'Town Center'
    ));
    if (!townCenter) throw new Error('Player Town Center was not available.');

    const GRID = 16;
    const dims = {
      House: { width: 48, height: 48 },
      Barracks: { width: 72, height: 72 },
    };
    const snap = (value) => Math.floor(value / GRID) * GRID;
    const toIso = (x, y) => ({ x: x - y, y: (x + y) * 0.5 });

    function findPlacement(type) {
      const def = dims[type];
      const baseX = snap(townCenter.x - 300);
      const baseY = snap(townCenter.y - 300);
      for (let oy = 0; oy <= 600; oy += GRID) {
        for (let ox = 0; ox <= 600; ox += GRID) {
          const center = {
            x: baseX + ox + def.width / 2,
            y: baseY + oy + def.height / 2,
          };
          if (manager.getBuildValidity(center.x, center.y, type).valid) return center;
        }
      }
      throw new Error(`Could not find a valid ${type} placement.`);
    }

    function build(type) {
      const center = findPlacement(type);
      const def = dims[type];
      const input = toIso(center.x - def.width / 2, center.y - def.height / 2);
      const before = new Set(buildings());
      manager.enterBuildMode(type);
      manager.updatePreview(input.x, input.y);
      manager.tryBuild(input.x, input.y);
      manager.cancelBuildMode();
      const created = buildings().find((building) => (
        !before.has(building) && getOwner(building) === 0 && getDef(building)?.type === type
      ));
      if (!created) throw new Error(`${type} was not created.`);
      return created;
    }

    const maxPopulationBefore = scene.maxPopulation;
    const house = build('House');
    if (scene.maxPopulation <= maxPopulationBefore) {
      throw new Error('House did not increase population capacity before training.');
    }
    const barracks = build('Barracks');
    window.__trainedSaveProbe = { barracks, player: null, enemy: null };
    return {
      maxPopulationBefore,
      maxPopulationAfterHousing: scene.maxPopulation,
      barracks: { x: barracks.x, y: barracks.y },
      initialPopulation: scene.population,
    };
  });

  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__trainedSaveProbe.barracks;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await sleep(80);

  const canvas = page.locator('canvas').first();
  let canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for Barracks selection.');

  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__trainedSaveProbe.barracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (barracks.visual.x - topLeft.x) * camera.zoom,
      y: (barracks.visual.y - 18 - topLeft.y) * camera.zoom,
    };
  });
  await page.mouse.click(canvasBox.x + barracksPoint.x, canvasBox.y + barracksPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedBuilding === window.__trainedSaveProbe.barracks;
  }, undefined, { timeout: 3_000 });

  telemetry.phase = 'train';
  telemetry.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      playerMilitary: scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length,
    };
  });

  const pikesmanButton = page.getByRole('button', { name: /Pikesman/i });
  await pikesmanButton.waitFor({ state: 'visible', timeout: 3_000 });
  await pikesmanButton.click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const military = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    return military === before.playerMilitary + 1 && scene.population === before.population + 1;
  }, telemetry.beforeTraining, { timeout: 5_000 });

  telemetry.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const playerUnits = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0);
    const player = playerUnits[playerUnits.length - 1];
    if (!player || (player.unitType ?? player.getData('unitType')) !== 'Pikesman') {
      throw new Error('Barracks UI did not produce a Pikesman as the newest player unit.');
    }
    window.__trainedSaveProbe.player = player;
    return {
      food: scene.resources.food,
      gold: scene.resources.gold,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      playerMilitary: playerUnits.length,
      type: player.unitType ?? player.getData('unitType'),
      position: { x: player.x, y: player.y },
    };
  });

  if (telemetry.afterTraining.food !== telemetry.beforeTraining.food - 100) {
    throw new Error('Pikesman training did not deduct the expected food cost.');
  }
  if (telemetry.afterTraining.gold !== telemetry.beforeTraining.gold - 50) {
    throw new Error('Pikesman training did not deduct the expected gold cost.');
  }

  telemetry.phase = 'move';
  telemetry.moveTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__trainedSaveProbe.player;
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const candidates = [[96, 0], [-96, 0], [0, 96], [0, -96], [72, 72], [-72, -72]];
    for (const [dx, dy] of candidates) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length > 1) {
        player.setData('__journeyMoveStartX', player.x);
        player.setData('__journeyMoveStartY', player.y);
        return target;
      }
    }
    throw new Error('Could not find a walkable target for the trained Pikesman.');
  });
  await sleep(80);

  canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable for unit movement.');
  let point = await unitScreenPoint(page, 'player');
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__trainedSaveProbe.player);
  }, undefined, { timeout: 3_000 });
  point = await cartesianScreenPoint(page, telemetry.moveTarget);
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__trainedSaveProbe.player;
    return Math.hypot(
      player.x - player.getData('__journeyMoveStartX'),
      player.y - player.getData('__journeyMoveStartY'),
    ) > 5;
  }, undefined, { timeout: 12_000 });

  telemetry.phase = 'combat';
  telemetry.combat = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__trainedSaveProbe.player;
    scene.peacefulMode = false;
    const candidates = [[24, 0], [-24, 0], [0, 24], [0, -24], [18, 18], [-18, -18]];
    let target = null;
    for (const [dx, dy] of candidates) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (!scene.pathfinder.isBlocked(x, y)) {
        target = { x, y };
        break;
      }
    }
    if (!target) throw new Error('Could not find an in-range combat position.');
    const enemy = scene.entityFactory.spawnUnit('Pikesman', target.x, target.y, 1);
    if (!enemy) throw new Error('Could not spawn deterministic enemy.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = -10_000;
    window.__trainedSaveProbe.enemy = enemy;
    window.__trainedSaveProbe.enemyX = enemy.x;
    window.__trainedSaveProbe.enemyY = enemy.y;
    return { distance: Math.hypot(player.x - enemy.x, player.y - enemy.y) };
  });
  if (telemetry.combat.distance > 40) {
    throw new Error(`Enemy setup exceeded Pikesman attack range (${telemetry.combat.distance.toFixed(2)}px).`);
  }
  await page.waitForFunction(() => Boolean(window.__trainedSaveProbe?.enemy?.visual?.active), undefined, { timeout: 5_000 });
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__trainedSaveProbe;
    scene.cameras.main.centerOn((player.visual.x + enemy.visual.x) * 0.5, (player.visual.y + enemy.visual.y) * 0.5);
  });
  await sleep(80);
  point = await unitScreenPoint(page, 'enemy');
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__trainedSaveProbe;
    const enemy = probe.enemy;
    return Boolean(
      !enemy.active
      && !scene.units.getChildren().includes(enemy)
      && !scene.unitSpatialHash.query(probe.enemyX, probe.enemyY, 96).includes(enemy)
      && probe.player.active
      && scene.units.getChildren().includes(probe.player),
    );
  }, undefined, { timeout: 12_000 });

  telemetry.phase = 'save';
  telemetry.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__trainedSaveProbe.player;
    const snapshot = {
      x: player.x,
      y: player.y,
      type: player.unitType ?? player.getData('unitType'),
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      gameTime: scene.gameTime,
    };
    window.dispatchEvent(new Event('save-game'));
    return snapshot;
  });
  await page.waitForFunction((saveKey) => Boolean(localStorage.getItem(saveKey)), SAVE_KEY, { timeout: 10_000 });

  telemetry.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    if (!scene?.isReady) return false;
    return scene.units.getChildren().some((unit) => (
      unit.getData?.('owner') === 0
      && (unit.unitType ?? unit.getData?.('unitType')) === saved.type
      && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2
    ));
  }, telemetry.beforeSave, { timeout: 20_000 });

  telemetry.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren()
      .filter((unit) => unit.getData?.('owner') === 0 && (unit.unitType ?? unit.getData?.('unitType')) === saved.type)
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!player) throw new Error('The trained surviving Pikesman was not restored.');
    window.__trainedSaveProbe = { player, enemy: null };
    return {
      x: player.x,
      y: player.y,
      hp: player.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      gameTime: scene.gameTime,
      positionDelta: Math.hypot(player.x - saved.x, player.y - saved.y),
    };
  }, telemetry.beforeSave);

  if (telemetry.restored.positionDelta > 2) throw new Error('Trained Pikesman position did not survive reload.');
  if (telemetry.restored.hp !== telemetry.beforeSave.hp) throw new Error('Trained Pikesman HP did not survive reload.');
  if (telemetry.restored.population !== telemetry.beforeSave.population) throw new Error('Population changed across combat save/reload.');
  if (telemetry.restored.maxPopulation !== telemetry.beforeSave.maxPopulation) throw new Error('Housing capacity changed across combat save/reload.');

  telemetry.phase = 'continue-playing';
  await page.waitForFunction(() => Boolean(window.__trainedSaveProbe?.player?.visual?.active), undefined, { timeout: 5_000 });
  telemetry.postLoadMove = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__trainedSaveProbe.player;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const candidates = [[64, 0], [-64, 0], [0, 64], [0, -64]];
    for (const [dx, dy] of candidates) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length > 1) {
        player.setData('__postLoadStartX', player.x);
        player.setData('__postLoadStartY', player.y);
        return target;
      }
    }
    throw new Error('Could not find a post-load walkable move target.');
  });
  await sleep(80);

  canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable after reload.');
  point = await unitScreenPoint(page, 'player');
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__trainedSaveProbe.player);
  }, undefined, { timeout: 3_000 });
  point = await cartesianScreenPoint(page, telemetry.postLoadMove);
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__trainedSaveProbe.player;
    return Math.hypot(
      player.x - player.getData('__postLoadStartX'),
      player.y - player.getData('__postLoadStartY'),
    ) > 5;
  }, undefined, { timeout: 12_000 });

  telemetry.afterContinue = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__trainedSaveProbe.player;
    return {
      selected: scene.inputManager.selectedUnits.includes(player),
      movedDistance: Math.hypot(
        player.x - player.getData('__postLoadStartX'),
        player.y - player.getData('__postLoadStartY'),
      ),
      gameTime: scene.gameTime,
    };
  });

  if (!telemetry.afterContinue.selected || telemetry.afterContinue.movedDistance <= 5) {
    throw new Error('Restored trained Pikesman could not continue under real player input.');
  }
  if (telemetry.browserErrors.length) {
    throw new Error(`Browser errors observed: ${telemetry.browserErrors.join(' | ')}`);
  }

  telemetry.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.failure = error instanceof Error ? error.message : String(error);
  await persistEvidence();
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
