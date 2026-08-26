import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
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
  if (page) {
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/army-combat-journey.png`, fullPage: true });
    } catch {
      // Preserve telemetry even if the browser has already closed.
    }
  }
}

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
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const baseX = clamp(existing.x + 220, bounds.x + 180, bounds.right - 360);
    const baseY = clamp(existing.y + 120, bounds.y + 180, bounds.bottom - 180);
    const player = scene.entityFactory.spawnUnit('Pikesman', baseX, baseY, 0);
    const enemy = scene.entityFactory.spawnUnit('Pikesman', baseX + 180, baseY, 1);
    if (!player || !enemy) throw new Error('Could not spawn deterministic combat units.');

    enemy.setData('hp', Math.min(enemy.getData('hp'), 40));
    enemy.setData('maxHp', Math.max(enemy.getData('maxHp'), enemy.getData('hp')));

    const midX = (player.visual.x + enemy.visual.x) / 2;
    const midY = (player.visual.y + enemy.visual.y) / 2;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(midX, midY);

    window.__armyCombatProbe = { player, enemy };
    return {
      playerStart: { x: player.x, y: player.y, hp: player.getData('hp') },
      enemyStart: { x: enemy.x, y: enemy.y, hp: enemy.getData('hp') },
    };
  });

  await sleep(100);
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  const getScreenPoint = (which) => page.evaluate((key) => {
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
  const playerPoint = await getScreenPoint('player');
  await page.mouse.click(canvasBox.x + playerPoint.x, canvasBox.y + playerPoint.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__armyCombatProbe.player);
  }, undefined, { timeout: 3_000 });
  telemetry.selectedCount = await page.evaluate(() => (
    window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.length
  ));

  telemetry.phase = 'attack-command';
  const enemyPoint = await getScreenPoint('enemy');
  await page.mouse.click(canvasBox.x + enemyPoint.x, canvasBox.y + enemyPoint.y, { button: 'right' });

  const observation = await page.waitForFunction(() => {
    const { player, enemy } = window.__armyCombatProbe;
    if (!player?.active || !enemy?.active) {
      return {
        playerActive: Boolean(player?.active),
        enemyActive: Boolean(enemy?.active),
        playerX: player?.x ?? null,
        playerY: player?.y ?? null,
        enemyHp: enemy?.getData?.('hp') ?? 0,
        playerState: player?.state ?? null,
      };
    }
    const start = window.__armyCombatStart;
    const moved = start ? Math.hypot(player.x - start.x, player.y - start.y) > 5 : false;
    const damaged = enemy.getData('hp') < 40;
    if (!moved && !damaged) return false;
    return {
      playerActive: player.active,
      enemyActive: enemy.active,
      playerX: player.x,
      playerY: player.y,
      enemyHp: enemy.getData('hp'),
      playerState: player.state,
      moved,
      damaged,
    };
  }, undefined, { timeout: 12_000 }).then((handle) => handle.jsonValue());

  telemetry.observation = observation;
  telemetry.phase = 'resolve-combat';
  await page.waitForFunction(() => {
    const { enemy } = window.__armyCombatProbe;
    return !enemy.active || enemy.getData('hp') < 40;
  }, undefined, { timeout: 12_000 });

  telemetry.final = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__armyCombatProbe;
    return {
      selected: scene.inputManager.selectedUnits.includes(player),
      player: { active: player.active, x: player.x, y: player.y, state: player.state },
      enemy: { active: enemy.active, hp: enemy.getData('hp'), state: enemy.state },
    };
  });

  telemetry.phase = 'assert';
  await persistEvidence();
  const movedDistance = Math.hypot(
    telemetry.final.player.x - telemetry.setup.playerStart.x,
    telemetry.final.player.y - telemetry.setup.playerStart.y,
  );
  telemetry.movedDistance = movedDistance;

  if (telemetry.selectedCount < 1 || !telemetry.final.selected) {
    throw new Error('Real pointer selection did not keep the spawned player military unit selected.');
  }
  if (movedDistance <= 5) {
    throw new Error(`Right-click attack did not move the selected unit (${movedDistance.toFixed(2)}px).`);
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
  telemetry.phase = `failed:${telemetry.phase}`;
  telemetry.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(telemetry, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
