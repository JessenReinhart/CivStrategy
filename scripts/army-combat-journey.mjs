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
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
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

async function screenPointForRole(page, role) {
  return page.evaluate((journeyRole) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = scene.units.getChildren().find((candidate) => candidate.getData('journeyRole') === journeyRole);
    if (!unit?.visual) throw new Error(`${journeyRole} combat visual missing.`);
    const camera = scene.cameras.main;
    const rect = scene.game.canvas.getBoundingClientRect();
    return {
      x: rect.left + camera.x + (unit.visual.x - camera.worldView.x) * camera.zoom,
      y: rect.top + camera.y + (unit.visual.y - camera.worldView.y) * camera.zoom,
    };
  }, role);
}

await mkdir(ARTIFACT_DIR, { recursive: true });

let browser;
let page;
let telemetry = { stage: 'starting' };
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);
  telemetry.stage = 'booted';

  const setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = false;
    scene.aiDisabled = true;

    const townCenter = scene.buildings.getChildren().find((building) => {
      const def = building.getData('def');
      return building.getData('owner') === 0 && def?.type === 'Town Center';
    });
    if (!townCenter) throw new Error('Player Town Center missing for combat journey setup.');

    const bounds = scene.physics.world.bounds;
    const insideBounds = (x, y) => (
      x > bounds.x + 80
      && x < bounds.right - 80
      && y > bounds.y + 80
      && y < bounds.bottom - 80
    );

    let pair = null;
    for (let radius = 180; radius <= 520 && !pair; radius += 40) {
      for (let index = 0; index < 16 && !pair; index++) {
        const angle = (index / 16) * Math.PI * 2;
        const playerX = townCenter.x + Math.cos(angle) * radius;
        const playerY = townCenter.y + Math.sin(angle) * radius;
        const enemyX = playerX + Math.cos(angle + Math.PI / 2) * 80;
        const enemyY = playerY + Math.sin(angle + Math.PI / 2) * 80;
        if (!insideBounds(playerX, playerY) || !insideBounds(enemyX, enemyY)) continue;
        const route = scene.pathfinder.findPath(
          new Phaser.Math.Vector2(playerX, playerY),
          new Phaser.Math.Vector2(enemyX, enemyY),
        );
        if (!route || route.length < 2) continue;
        pair = { playerX, playerY, enemyX, enemyY, routeLength: route.length };
      }
    }
    if (!pair) throw new Error('Could not find a short routed combat lane near the player base.');

    const player = scene.entityFactory.spawnUnit('Pikesman', pair.playerX, pair.playerY, 0);
    const enemy = scene.entityFactory.spawnUnit('Pikesman', pair.enemyX, pair.enemyY, 1);
    if (!player || !enemy) throw new Error('Could not spawn deterministic combat pair.');

    player.setData('journeyRole', 'player');
    enemy.setData('journeyRole', 'enemy');
    enemy.setData('hp', Math.min(enemy.getData('hp'), 20));
    scene.cameras.main.setZoom(1.5);

    return {
      pair,
      playerStart: { x: player.x, y: player.y },
      enemyStartHp: enemy.getData('hp'),
    };
  });

  // Let UnitSystem project newly spawned units into their rendered isometric positions.
  await sleep(250);
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren();
    const player = units.find((unit) => unit.getData('journeyRole') === 'player');
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    if (!player?.visual || !enemy?.visual) throw new Error('Combat visuals did not settle.');
    scene.cameras.main.centerOn(
      (player.visual.x + enemy.visual.x) / 2,
      (player.visual.y + enemy.visual.y) / 2,
    );
  });
  await sleep(100);

  const playerScreen = await screenPointForRole(page, 'player');
  await page.mouse.click(playerScreen.x, playerScreen.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return scene?.inputManager?.selectedUnits?.some?.((unit) => unit.getData('journeyRole') === 'player');
  }, undefined, { timeout: 5_000 });
  telemetry.stage = 'selected';

  const enemyScreen = await screenPointForRole(page, 'enemy');
  await page.mouse.click(enemyScreen.x, enemyScreen.y, { button: 'right' });

  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const units = scene?.units?.getChildren?.() ?? [];
    const player = units.find((unit) => unit.getData('journeyRole') === 'player');
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    return Boolean(player && enemy && player.target === enemy && player.getData('explicitTarget') === true);
  }, undefined, { timeout: 5_000 });
  telemetry.stage = 'attack-bound';

  // First prove the real right-click chase is not a stuck-unit dead end.
  await page.waitForFunction(({ startX, startY }) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const player = scene?.units?.getChildren?.().find((unit) => unit.getData('journeyRole') === 'player');
    return Boolean(player && Math.hypot(player.x - startX, player.y - startY) > 8);
  }, setup.playerStart, { timeout: 8_000 });
  telemetry.stage = 'chase-moved';

  // Terrain/pathfinding has already been exercised above. Put the same live target into
  // contact range so combat resolution is deterministic rather than terrain-seed dependent.
  const contact = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const units = scene.units.getChildren();
    const player = units.find((unit) => unit.getData('journeyRole') === 'player');
    const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
    if (!player || !enemy) throw new Error('Combat pair disappeared before contact.');
    const enemyBody = enemy.body;
    const contactX = player.x + 18;
    const contactY = player.y;
    if (enemyBody?.reset) enemyBody.reset(contactX, contactY);
    else enemy.setPosition(contactX, contactY);
    return { distance: Math.hypot(player.x - enemy.x, player.y - enemy.y) };
  });
  telemetry.stage = 'contact-forced';

  await page.waitForFunction((startHp) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const enemy = scene?.units?.getChildren?.().find((unit) => unit.getData('journeyRole') === 'enemy');
    return !enemy || enemy.getData('hp') < startHp;
  }, setup.enemyStartHp, { timeout: 5_000 });
  telemetry.stage = 'damage-observed';

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
    contact,
    result,
    browserErrors,
  };
  await writeFile(TELEMETRY_PATH, `${JSON.stringify(telemetry, null, 2)}\n`);
  await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey.png`, fullPage: true });

  if (result.selectedCount < 1) throw new Error('Player army selection was lost before combat resolved.');
  if ((result.playerMovedPx ?? 0) <= 8) throw new Error('Real right-click chase did not move the selected unit.');
  if (result.enemyHp >= result.enemyStartHp) {
    throw new Error(`Enemy HP did not change after live combat contact: ${result.enemyStartHp} -> ${result.enemyHp}.`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`Browser page errors during army combat journey:\n${browserErrors.join('\n')}`);
  }

  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  let failureState;
  if (page) {
    try {
      failureState = await page.evaluate(() => {
        const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
        const units = scene?.units?.getChildren?.() ?? [];
        const player = units.find((unit) => unit.getData('journeyRole') === 'player');
        const enemy = units.find((unit) => unit.getData('journeyRole') === 'enemy');
        return {
          selectedCount: scene?.inputManager?.selectedUnits?.length ?? null,
          distance: player && enemy ? Math.hypot(player.x - enemy.x, player.y - enemy.y) : null,
          player: player ? {
            x: player.x,
            y: player.y,
            state: player.state,
            hp: player.getData('hp'),
            explicitTarget: player.getData('explicitTarget') === true,
            targetIsEnemy: player.target === enemy,
            pathLength: player.path?.length ?? 0,
            pathStep: player.pathStep ?? 0,
            velocityX: player.body?.velocity?.x ?? null,
            velocityY: player.body?.velocity?.y ?? null,
          } : null,
          enemy: enemy ? {
            x: enemy.x,
            y: enemy.y,
            state: enemy.state,
            hp: enemy.getData('hp'),
            active: enemy.active,
          } : null,
        };
      });
      await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey-failed.png`, fullPage: true });
    } catch {
      // Preserve the original failure if the page is already gone.
    }
  }
  telemetry = {
    ...telemetry,
    failedStage: telemetry.stage,
    stage: 'failed',
    error: error instanceof Error ? error.message : String(error),
    failureState,
  };
  await writeFile(TELEMETRY_PATH, `${JSON.stringify(telemetry, null, 2)}\n`);
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
