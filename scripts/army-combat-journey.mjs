import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const TELEMETRY_PATH = `${ARTIFACT_DIR}/army-combat-journey.json`;

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
      && scene?.entityFactory
      && scene?.inputManager
      && scene?.unitSystem
      && scene?.buildings?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForMainScene(page);
}

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
let telemetry = { stage: 'starting' };
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  const setup = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScene('MainScene');
    scene.peacefulMode = false;
    scene.aiDisabled = true;

    const townCenter = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0 && def?.type === 'Town Center';
    });
    if (!townCenter) throw new Error('Player Town Center missing for combat journey setup.');

    const bounds = scene.physics.world.bounds;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const centerX = clamp(townCenter.x + 360, bounds.x + 160, bounds.right - 160);
    const centerY = clamp(townCenter.y + 260, bounds.y + 160, bounds.bottom - 160);

    const player = scene.entityFactory.spawnUnit('Pikesman', centerX - 70, centerY, 0);
    const enemy = scene.entityFactory.spawnUnit('Pikesman', centerX + 70, centerY, 1);
    if (!player || !enemy) throw new Error('Could not spawn deterministic combat pair.');

    player.setData('journeyRole', 'player');
    enemy.setData('journeyRole', 'enemy');
    enemy.setData('hp', Math.min(enemy.getData('hp'), 30));

    scene.cameras.main.setZoom(1.5);
    const midVisualX = (player.visual.x + enemy.visual.x) / 2;
    const midVisualY = (player.visual.y + enemy.visual.y) / 2;
    scene.cameras.main.centerOn(midVisualX, midVisualY);

    return {
      playerStart: { x: player.x, y: player.y },
      enemyStartHp: enemy.getData('hp'),
    };
  });

  await sleep(250);

  const playerScreen = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren().find((unit) => unit.getData('journeyRole') === 'player');
    if (!player?.visual) throw new Error('Player combat visual missing.');
    const camera = scene.cameras.main;
    const canvasRect = scene.game.canvas.getBoundingClientRect();
    return {
      x: canvasRect.left + camera.x + (player.visual.x - camera.worldView.x) * camera.zoom,
      y: canvasRect.top + camera.y + (player.visual.y - camera.worldView.y) * camera.zoom,
    };
  });

  await page.mouse.click(playerScreen.x, playerScreen.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return scene?.inputManager?.selectedUnits?.some?.((unit) => unit.getData('journeyRole') === 'player');
  }, undefined, { timeout: 5_000 });

  const enemyScreen = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const enemy = scene.units.getChildren().find((unit) => unit.getData('journeyRole') === 'enemy');
    if (!enemy?.visual) throw new Error('Enemy combat visual missing.');
    const camera = scene.cameras.main;
    const canvasRect = scene.game.canvas.getBoundingClientRect();
    return {
      x: canvasRect.left + camera.x + (enemy.visual.x - camera.worldView.x) * camera.zoom,
      y: canvasRect.top + camera.y + (enemy.visual.y - camera.worldView.y) * camera.zoom,
    };
  });

  await page.mouse.click(enemyScreen.x, enemyScreen.y, { button: 'right' });

  await page.waitForFunction(({ startX, startY, startHp }) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const units = scene?.units?.getChildren?.() ?? [];
    const player = units.find((unit) => unit.getData('journeyRole') === 'player');
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    const moved = player
      ? Math.hypot(player.x - startX, player.y - startY) > 8
      : false;
    const enemyDamaged = !enemy || enemy.getData('hp') < startHp;
    return moved || enemyDamaged;
  }, { startX: setup.playerStart.x, startY: setup.playerStart.y, startHp: setup.enemyStartHp }, { timeout: 10_000 });

  await page.waitForFunction((startHp) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const units = scene?.units?.getChildren?.() ?? [];
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    return !enemy || enemy.getData('hp') < startHp;
  }, setup.enemyStartHp, { timeout: 15_000 });

  const result = await page.evaluate(({ startX, startY, startHp }) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren();
    const player = units.find((unit) => unit.getData('journeyRole') === 'player');
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    return {
      selectedCount: scene.inputManager.selectedUnits.length,
      playerMovedPx: player ? Math.hypot(player.x - startX, player.y - startY) : null,
      playerState: player?.state ?? 'destroyed',
      enemyStartHp: startHp,
      enemyHp: enemy?.getData('hp') ?? 0,
      enemyResolved: !enemy || !enemy.active || enemy.getData('hp') <= 0,
    };
  }, { startX: setup.playerStart.x, startY: setup.playerStart.y, startHp: setup.enemyStartHp });

  telemetry = {
    stage: 'complete',
    setup,
    input: { playerScreen, enemyScreen },
    result,
    browserErrors,
  };
  await writeFile(TELEMETRY_PATH, `${JSON.stringify(telemetry, null, 2)}\n`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey.png`, fullPage: true });

  if (result.selectedCount < 1) throw new Error('Player army selection was lost before combat resolved.');
  if ((result.playerMovedPx ?? 0) <= 8 && result.enemyHp >= result.enemyStartHp) {
    throw new Error('Selected unit neither moved nor damaged the enemy after right-click attack.');
  }
  if (result.enemyHp >= result.enemyStartHp) {
    throw new Error(`Enemy HP did not change after real pointer attack command: ${result.enemyStartHp} -> ${result.enemyHp}.`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during army combat journey:\n${browserErrors.join('\n')}`);
  }

  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  telemetry = {
    ...telemetry,
    stage: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
  await writeFile(TELEMETRY_PATH, `${JSON.stringify(telemetry, null, 2)}\n`);
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
