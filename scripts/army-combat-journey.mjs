import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
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

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const telemetry = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(
    `${ARTIFACT_DIR}/army-combat-telemetry.json`,
    `${JSON.stringify(telemetry, null, 2)}\n`,
    'utf8',
  );
  if (!page) return;
  try {
    await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey.png`, fullPage: true });
  } catch {
    // JSON telemetry remains useful if Chromium has already closed.
  }
}

const readRuntimeProbe = () => page.evaluate(() => {
  const scene = window.__civStrategyGame.scene.getScene('MainScene');
  const player = window.__armyCombatProbe?.player;
  const enemy = window.__armyCombatProbe?.enemy;
  const body = player?.body;
  const flags = (value) => value ? {
    left: Boolean(value.left), right: Boolean(value.right),
    up: Boolean(value.up), down: Boolean(value.down), none: Boolean(value.none),
  } : null;
  return {
    gameTime: scene.gameTime,
    actualFps: scene.game.loop.actualFps,
    perfFps: window.__perf?.latest?.fps ?? null,
    physics: {
      isPaused: scene.physics.world.isPaused,
      timeScale: scene.physics.world.timeScale,
    },
    player: player ? {
      x: player.x,
      y: player.y,
      state: player.state,
      pathStep: player.pathStep,
      pathLength: player.path?.length ?? 0,
      body: body ? {
        enable: body.enable,
        moves: body.moves,
        immovable: body.immovable,
        velocity: { x: body.velocity.x, y: body.velocity.y },
        position: { x: body.position.x, y: body.position.y },
        center: { x: body.center.x, y: body.center.y },
        blocked: flags(body.blocked),
        touching: flags(body.touching),
      } : null,
    } : null,
    enemy: enemy ? {
      x: enemy.x,
      y: enemy.y,
      active: enemy.active,
      hp: enemy.getData('hp'),
      state: enemy.state,
    } : null,
  };
});

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => telemetry.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.entityFactory && scene?.inputManager && scene?.unitSystem);
  }, undefined, { timeout: 45_000 });

  telemetry.phase = 'setup-battle';
  telemetry.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = false;
    const existing = scene.units.getChildren().find((unit) => unit.getData?.('owner') === 0);
    if (!existing) throw new Error('No player unit available to anchor combat scenario.');

    const bounds = scene.physics.world.bounds;
    const insideWorld = (x, y) => (
      x >= bounds.x + 96 && x <= bounds.right - 96
      && y >= bounds.y + 96 && y <= bounds.bottom - 96
    );
    const originOffsets = [
      [240, 0], [-240, 0], [0, 240], [0, -240],
      [240, 240], [240, -240], [-240, 240], [-240, -240],
      [360, 0], [-360, 0], [0, 360], [0, -360],
    ];
    // Keep the duel just outside the 40 px Pikesman range. The CI software
    // renderer may only advance a few hundred milliseconds of simulation in
    // 12 wall-clock seconds, so the journey must not require seconds of chase
    // time before it can exercise real combat resolution.
    const enemyOffsets = [[56, 0], [-56, 0], [0, 56], [0, -56]];
    let arena = null;

    for (const [originX, originY] of originOffsets) {
      const playerX = existing.x + originX;
      const playerY = existing.y + originY;
      if (!insideWorld(playerX, playerY) || scene.pathfinder.isBlocked(playerX, playerY)) continue;

      for (const [enemyXOffset, enemyYOffset] of enemyOffsets) {
        const enemyX = playerX + enemyXOffset;
        const enemyY = playerY + enemyYOffset;
        if (!insideWorld(enemyX, enemyY) || scene.pathfinder.isBlocked(enemyX, enemyY)) continue;

        const path = scene.pathfinder.findPath(
          { x: playerX, y: playerY },
          { x: enemyX, y: enemyY },
        );
        const endpoint = path?.[path.length - 1];
        if (!path || path.length < 1 || !endpoint) continue;
        if (Math.hypot(endpoint.x - enemyX, endpoint.y - enemyY) > 32) continue;

        arena = { playerX, playerY, enemyX, enemyY, pathLength: path.length };
        break;
      }
      if (arena) break;
    }

    if (!arena) throw new Error('Could not find a connected walkable arena for the combat journey.');

    const player = scene.entityFactory.spawnUnit('Pikesman', arena.playerX, arena.playerY, 0);
    const enemy = scene.entityFactory.spawnUnit('Pikesman', arena.enemyX, arena.enemyY, 1);
    if (!player || !enemy) throw new Error('Could not spawn deterministic combat units.');

    enemy.setData('hp', Math.min(enemy.getData('hp'), 40));
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = -10_000;
    player.setData('__journeyStartX', player.x);
    player.setData('__journeyStartY', player.y);
    window.__armyCombatProbe = { player, enemy };

    return {
      arena,
      gameTime: scene.gameTime,
      actualFps: scene.game.loop.actualFps,
      playerStart: { x: player.x, y: player.y, hp: player.getData('hp') },
      enemyStart: { x: enemy.x, y: enemy.y, hp: enemy.getData('hp') },
    };
  });

  await sleep(150);
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__armyCombatProbe;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(
      (player.visual.x + enemy.visual.x) / 2,
      (player.visual.y + enemy.visual.y) / 2,
    );
  });
  await sleep(50);

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  const screenPoint = (which) => page.evaluate((key) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__armyCombatProbe[key];
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  }, which);

  telemetry.phase = 'select-player';
  const playerPoint = await screenPoint('player');
  await page.mouse.click(
    canvasBox.x + playerPoint.x,
    canvasBox.y + playerPoint.y,
    { button: 'left' },
  );
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__armyCombatProbe.player);
  }, undefined, { timeout: 3_000 });
  telemetry.selectedCount = await page.evaluate(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.length
  ));

  telemetry.phase = 'attack-command';
  const enemyPoint = await screenPoint('enemy');
  await page.mouse.click(
    canvasBox.x + enemyPoint.x,
    canvasBox.y + enemyPoint.y,
    { button: 'right' },
  );
  telemetry.attackStarted = await readRuntimeProbe();

  telemetry.phase = 'move-into-combat';
  await page.waitForFunction(() => {
    const { player } = window.__armyCombatProbe;
    return Math.hypot(
      player.x - player.getData('__journeyStartX'),
      player.y - player.getData('__journeyStartY'),
    ) > 5;
  }, undefined, { timeout: 12_000 });
  telemetry.afterMovement = await readRuntimeProbe();

  telemetry.phase = 'resolve-combat';
  await page.waitForFunction(() => {
    const { enemy } = window.__armyCombatProbe;
    return !enemy.active || enemy.getData('hp') < 40;
  }, undefined, { timeout: 12_000 });

  telemetry.final = await readRuntimeProbe();
  telemetry.movedDistance = Math.hypot(
    telemetry.final.player.x - telemetry.setup.playerStart.x,
    telemetry.final.player.y - telemetry.setup.playerStart.y,
  );
  telemetry.simulationElapsedMs = telemetry.final.gameTime - telemetry.attackStarted.gameTime;

  telemetry.phase = 'assert';
  await persistEvidence();
  if (telemetry.selectedCount < 1) {
    throw new Error('Real pointer selection did not select the player military unit.');
  }
  if (telemetry.movedDistance <= 5) {
    throw new Error(`Right-click attack did not move the selected unit (${telemetry.movedDistance.toFixed(2)}px).`);
  }
  if (telemetry.final.enemy.active && telemetry.final.enemy.hp >= telemetry.setup.enemyStart.hp) {
    throw new Error(`Combat did not change enemy HP/state (HP ${telemetry.final.enemy.hp}).`);
  }
  if (telemetry.browserErrors.length > 0) {
    throw new Error(`Browser page errors during army combat journey:\n${telemetry.browserErrors.join('\n')}`);
  }

  telemetry.phase = 'passed';
  await persistEvidence();
  console.log(JSON.stringify(telemetry, null, 2));
} catch (error) {
  if (page) {
    try {
      telemetry.failureRuntime = await readRuntimeProbe();
      if (telemetry.attackStarted && telemetry.failureRuntime) {
        telemetry.simulationElapsedMs = telemetry.failureRuntime.gameTime - telemetry.attackStarted.gameTime;
      }
    } catch {
      // Preserve the original failure if the page is already unavailable.
    }
  }
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
