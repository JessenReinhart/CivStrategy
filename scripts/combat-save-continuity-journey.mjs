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
    return Boolean(scene?.isReady && scene?.entityFactory && scene?.inputManager && scene?.pathfinder && scene?.units);
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
    const unit = window.__combatSaveProbe[probeKey];
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
    // Pointer world coordinates are isometric; InputManager converts them back to Cartesian.
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

  telemetry.phase = 'setup';
  telemetry.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    const anchor = scene.units.getChildren().find((unit) => unit.getData?.('owner') === 0);
    if (!anchor) throw new Error('No player military unit available to anchor continuity journey.');

    const bounds = scene.physics.world.bounds;
    const inside = (x, y) => x >= bounds.x + 96 && x <= bounds.right - 96 && y >= bounds.y + 96 && y <= bounds.bottom - 96;
    const origins = [[240, 0], [-240, 0], [0, 240], [0, -240], [240, 240], [-240, -240], [360, 0], [0, 360]];
    const moves = [[64, 0], [-64, 0], [0, 64], [0, -64]];
    let arena = null;

    for (const [ox, oy] of origins) {
      const x = anchor.x + ox;
      const y = anchor.y + oy;
      if (!inside(x, y) || scene.pathfinder.isBlocked(x, y)) continue;
      for (const [mx, my] of moves) {
        const moveX = x + mx;
        const moveY = y + my;
        if (!inside(moveX, moveY) || scene.pathfinder.isBlocked(moveX, moveY)) continue;
        const path = scene.pathfinder.findPath({ x, y }, { x: moveX, y: moveY });
        const endpoint = path?.[path.length - 1];
        if (endpoint && Math.hypot(endpoint.x - moveX, endpoint.y - moveY) <= 32) {
          arena = { x, y, moveX, moveY };
          break;
        }
      }
      if (arena) break;
    }
    if (!arena) throw new Error('Could not find a connected walkable arena.');

    const player = scene.entityFactory.spawnUnit('Pikesman', arena.x, arena.y, 0);
    if (!player) throw new Error('Could not spawn deterministic surviving player unit.');
    player.setData('__continuityStartX', player.x);
    player.setData('__continuityStartY', player.y);
    window.__combatSaveProbe = { player, enemy: null };
    return { arena, initialPopulation: scene.population };
  });

  await page.waitForFunction(() => Boolean(window.__combatSaveProbe?.player?.visual?.active), undefined, { timeout: 5_000 });
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__combatSaveProbe.player;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
  });
  await sleep(80);

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  telemetry.phase = 'pre-combat-move';
  let point = await unitScreenPoint(page, 'player');
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__combatSaveProbe.player);
  }, undefined, { timeout: 3_000 });

  point = await cartesianScreenPoint(page, { x: telemetry.setup.arena.moveX, y: telemetry.setup.arena.moveY });
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__combatSaveProbe.player;
    return Math.hypot(player.x - player.getData('__continuityStartX'), player.y - player.getData('__continuityStartY')) > 5;
  }, undefined, { timeout: 12_000 });

  telemetry.phase = 'combat';
  telemetry.combat = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__combatSaveProbe.player;
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
    window.__combatSaveProbe.enemy = enemy;
    return { distance: Math.hypot(player.x - enemy.x, player.y - enemy.y) };
  });

  await page.waitForFunction(() => Boolean(window.__combatSaveProbe?.enemy?.visual?.active), undefined, { timeout: 5_000 });
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__combatSaveProbe;
    scene.cameras.main.centerOn((player.visual.x + enemy.visual.x) * 0.5, (player.visual.y + enemy.visual.y) * 0.5);
  });
  await sleep(80);
  point = await unitScreenPoint(page, 'enemy');
  await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const enemy = window.__combatSaveProbe.enemy;
    return !enemy.active && !scene.units.getChildren().includes(enemy);
  }, undefined, { timeout: 12_000 });

  telemetry.phase = 'save';
  telemetry.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__combatSaveProbe.player;
    const snapshot = {
      x: player.x,
      y: player.y,
      type: player.unitType ?? player.getData('unitType') ?? 'Pikesman',
      hp: player.getData('hp'),
      population: scene.population,
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
    if (!player) throw new Error('Saved surviving player military unit was not restored.');
    window.__combatSaveProbe = { player, enemy: null };
    return {
      x: player.x,
      y: player.y,
      hp: player.getData('hp'),
      population: scene.population,
      gameTime: scene.gameTime,
      positionDelta: Math.hypot(player.x - saved.x, player.y - saved.y),
    };
  }, telemetry.beforeSave);

  telemetry.phase = 'continue-playing';
  await page.waitForFunction(() => Boolean(window.__combatSaveProbe?.player?.visual?.active), undefined, { timeout: 5_000 });
  telemetry.postLoadMove = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__combatSaveProbe.player;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const candidates = [[64, 0], [-64, 0], [0, 64], [0, -64]];
    for (const [dx, dy] of candidates) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length) {
        player.setData('__postLoadStartX', player.x);
        player.setData('__postLoadStartY', player.y);
        return target;
      }
    }
    throw new Error('Could not find a post-load walkable move target.');
  });
  await sleep(80);

  const reloadedCanvasBox = await canvas.boundingBox();
  if (!reloadedCanvasBox) throw new Error('Game canvas was not measurable after reload.');
  point = await unitScreenPoint(page, 'player');
  await page.mouse.click(reloadedCanvasBox.x + point.x, reloadedCanvasBox.y + point.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__combatSaveProbe.player);
  }, undefined, { timeout: 3_000 });
  point = await cartesianScreenPoint(page, telemetry.postLoadMove);
  await page.mouse.click(reloadedCanvasBox.x + point.x, reloadedCanvasBox.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__combatSaveProbe.player;
    return Math.hypot(player.x - player.getData('__postLoadStartX'), player.y - player.getData('__postLoadStartY')) > 5;
  }, undefined, { timeout: 12_000 });

  telemetry.afterContinue = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__combatSaveProbe.player;
    return {
      x: player.x,
      y: player.y,
      selected: scene.inputManager.selectedUnits.includes(player),
      movedDistance: Math.hypot(player.x - player.getData('__postLoadStartX'), player.y - player.getData('__postLoadStartY')),
      gameTime: scene.gameTime,
    };
  });

  if (telemetry.combat.distance > 40) throw new Error(`Enemy setup exceeded Pikesman attack range (${telemetry.combat.distance.toFixed(2)}px).`);
  if (telemetry.restored.positionDelta > 2) throw new Error(`Surviving unit position drifted ${telemetry.restored.positionDelta.toFixed(2)}px across save/load.`);
  if (telemetry.restored.population !== telemetry.beforeSave.population) throw new Error('Population changed across the combat save/load boundary.');
  if (telemetry.afterContinue.movedDistance <= 5) throw new Error('Restored surviving unit did not respond to a real right-click move command.');
  if (telemetry.browserErrors.length > 0) throw new Error(`Browser page errors during combat save continuity journey:\n${telemetry.browserErrors.join('\n')}`);

  telemetry.phase = 'passed';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
