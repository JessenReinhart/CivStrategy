import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4196;
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

let browser;
let page;
let evidence;
const pageErrors = [];
try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.entityFactory && scene?.inputManager);
  }, undefined, { timeout: 45_000 });

  evidence = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const [{ BuildingType, UnitType }] = await Promise.all([import('/types.ts')]);
    scene.peacefulMode = true;

    const tc = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === BuildingType.TOWN_CENTER
    ));
    if (!tc) throw new Error('Player Town Center missing.');

    const hostileCastle = scene.entityFactory.spawnBuilding(BuildingType.CASTLE, tc.x + 220, tc.y, 1);
    hostileCastle.setData('garrison', { [UnitType.PIKESMAN]: 2 });
    const beforeHostileRelease = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    scene.inputManager.selectedBuilding = hostileCastle;
    scene.game.events.emit('release-garrison');
    const afterHostileRelease = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    const hostileGarrisonAfter = hostileCastle.getData('garrison');

    const playerCastle = scene.entityFactory.spawnBuilding(BuildingType.CASTLE, tc.x - 220, tc.y, 0);
    playerCastle.setData('garrison', { [UnitType.PIKESMAN]: 2 });
    const beforePlayerRelease = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    scene.inputManager.selectedBuilding = playerCastle;
    scene.game.events.emit('release-garrison');
    const afterPlayerRelease = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0).length;
    const playerGarrisonAfter = playerCastle.getData('garrison');

    return {
      pikesmanKey: UnitType.PIKESMAN,
      hostileCastleOwner: hostileCastle.getData('owner'),
      playerCastleOwner: playerCastle.getData('owner'),
      beforeHostileRelease,
      afterHostileRelease,
      hostileGarrisonAfter,
      beforePlayerRelease,
      afterPlayerRelease,
      playerGarrisonAfter,
    };
  });

  await writeFile(
    `${ARTIFACT_DIR}/garrison-release-ownership.json`,
    `${JSON.stringify({ evidence, pageErrors }, null, 2)}\n`,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/garrison-release-ownership.png`, fullPage: true });

  if (evidence.afterHostileRelease !== evidence.beforeHostileRelease) {
    throw new Error(`Hostile Castle released player-owned units: ${JSON.stringify(evidence)}`);
  }
  if (evidence.hostileGarrisonAfter?.[evidence.pikesmanKey] !== 2) {
    throw new Error(`Hostile Castle garrison mutated on rejected release: ${JSON.stringify(evidence)}`);
  }
  if (evidence.afterPlayerRelease !== evidence.beforePlayerRelease + 2) {
    throw new Error(`Player Castle did not release exactly two units: ${JSON.stringify(evidence)}`);
  }
  if (Object.keys(evidence.playerGarrisonAfter ?? {}).length !== 0) {
    throw new Error(`Player Castle garrison was not cleared after release: ${JSON.stringify(evidence)}`);
  }
  if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join(' | ')}`);

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} catch (error) {
  if (page && !evidence) {
    await page.screenshot({ path: `${ARTIFACT_DIR}/garrison-release-ownership-failure.png`, fullPage: true }).catch(() => {});
  }
  await writeFile(
    `${ARTIFACT_DIR}/garrison-release-ownership-failure.json`,
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error), evidence, pageErrors, serverOutput }, null, 2)}\n`,
  ).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
