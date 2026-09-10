import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4198;
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
    const { BuildingType, UnitType } = await import('/types.ts');
    scene.peacefulMode = true;
    scene.maxPopulation = Math.max(scene.maxPopulation, scene.population + 10);
    scene.resources.food = Math.max(scene.resources.food, 500);
    scene.resources.gold = Math.max(scene.resources.gold, 500);

    const townCenter = scene.buildings.getChildren().find((building) => (
      building.getData('owner') === 0 && building.getData('def')?.type === BuildingType.TOWN_CENTER
    ));
    if (!townCenter) throw new Error('Player Town Center missing.');

    const staleBarracks = scene.entityFactory.spawnBuilding(
      BuildingType.BARRACKS,
      townCenter.x - 180,
      townCenter.y,
      0,
    );
    const liveBarracks = scene.entityFactory.spawnBuilding(
      BuildingType.BARRACKS,
      townCenter.x + 180,
      townCenter.y,
      0,
    );

    scene.inputManager.selectedBuilding = staleBarracks;
    const stalePosition = { x: staleBarracks.x, y: staleBarracks.y };
    staleBarracks.destroy();
    const staleActiveAfterDestroy = staleBarracks.active;

    const unitsBefore = new Set(scene.units.getChildren());
    const foodBefore = scene.resources.food;
    const goldBefore = scene.resources.gold;

    scene.handleUnitSpawnRequest(UnitType.PIKESMAN);

    const trainedUnits = scene.units.getChildren().filter((unit) => !unitsBefore.has(unit));
    const trained = trainedUnits[0] ?? null;
    const selectedRestoredToStaleObject = scene.inputManager.selectedBuilding === staleBarracks;

    return {
      staleActiveAfterDestroy,
      stalePosition,
      livePosition: { x: liveBarracks.x, y: liveBarracks.y },
      trainedCount: trainedUnits.length,
      trainedPosition: trained ? { x: trained.x, y: trained.y } : null,
      trainedOwner: trained?.getData('owner'),
      foodBefore,
      foodAfter: scene.resources.food,
      goldBefore,
      goldAfter: scene.resources.gold,
      selectedRestoredToStaleObject,
    };
  });

  await writeFile(
    `${ARTIFACT_DIR}/training-source-lifecycle.json`,
    `${JSON.stringify({ evidence, pageErrors }, null, 2)}\n`,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/training-source-lifecycle.png`, fullPage: true });

  if (evidence.staleActiveAfterDestroy !== false) {
    throw new Error(`Destroyed Barracks did not become inactive: ${JSON.stringify(evidence)}`);
  }
  if (evidence.trainedCount !== 1 || evidence.trainedOwner !== 0) {
    throw new Error(`Expected exactly one player unit from live fallback Barracks: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.trainedPosition) {
    throw new Error(`Training produced no unit position evidence: ${JSON.stringify(evidence)}`);
  }
  const liveDistance = Math.hypot(
    evidence.trainedPosition.x - evidence.livePosition.x,
    evidence.trainedPosition.y - evidence.livePosition.y,
  );
  const staleDistance = Math.hypot(
    evidence.trainedPosition.x - evidence.stalePosition.x,
    evidence.trainedPosition.y - evidence.stalePosition.y,
  );
  if (!(liveDistance < staleDistance)) {
    throw new Error(`Trained unit was not spawned from the live fallback Barracks: ${JSON.stringify({ evidence, liveDistance, staleDistance })}`);
  }
  if (evidence.foodAfter >= evidence.foodBefore || evidence.goldAfter >= evidence.goldBefore) {
    throw new Error(`Successful training did not consume resources: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.selectedRestoredToStaleObject) {
    throw new Error(`PlayerMainScene did not restore InputManager selection after bounded training sanitization: ${JSON.stringify(evidence)}`);
  }
  if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join(' | ')}`);

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${ARTIFACT_DIR}/training-source-lifecycle-failure.png`, fullPage: true }).catch(() => {});
  }
  await writeFile(
    `${ARTIFACT_DIR}/training-source-lifecycle-failure.json`,
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error), evidence, pageErrors, serverOutput }, null, 2)}\n`,
  ).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}