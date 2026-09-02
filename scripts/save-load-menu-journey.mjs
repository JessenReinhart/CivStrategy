import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const MARKER_WOOD = 4321;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/save-load-menu-journey.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE_URL)).ok) return;
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

async function waitForScene(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(
      scene?.isReady
      && scene?.resources
      && scene?.inputManager
      && scene?.pathfinder
      && scene?.units?.getChildren?.().length,
    );
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
}

async function openGameMenu(page) {
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
  await page.getByRole('button', { name: /Save game/i }).waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.events.once('postupdate', resolve);
  }));
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (page) {
    try {
      await page.screenshot({ path: `${ARTIFACT_DIR}/save-load-menu-journey.png`, fullPage: true });
    } catch {
      // Screenshot evidence is best effort after browser-level failures.
    }
  }
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.phase = 'prepare-save-state';
  evidence.beforeSave = await page.evaluate((markerWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = scene.units.getChildren().find((candidate) => candidate.getData('owner') === 0 && candidate.visual?.active);
    if (!unit) throw new Error('No player military unit is available for save/load menu continuity.');

    scene.peacefulMode = true;
    scene.resources.wood = markerWood;
    scene.economySystem.updateStats();

    return {
      wood: scene.resources.wood,
      type: unit.unitType ?? unit.getData('unitType'),
      x: unit.x,
      y: unit.y,
      hp: unit.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  }, MARKER_WOOD);

  evidence.phase = 'save-through-menu';
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });
  evidence.savedBytes = await page.evaluate((key) => localStorage.getItem(key)?.length ?? 0, SAVE_KEY);
  if (evidence.savedBytes <= 0) throw new Error('Save game menu action did not create persistent save data.');

  evidence.phase = 'reload-app';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.phase = 'load-through-menu';
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await page.waitForFunction((expected) => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene.resources?.wood === expected.wood);
  }, evidence.beforeSave, { timeout: 20_000 });

  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = scene.units.getChildren()
      .filter((candidate) => candidate.getData('owner') === 0 && (candidate.unitType ?? candidate.getData('unitType')) === saved.type)
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!unit?.visual?.active) throw new Error('Saved player military unit was not restored with an active visual.');
    window.__saveLoadMenuProbe = unit;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(unit.visual.x, unit.visual.y);
    return {
      wood: scene.resources.wood,
      type: unit.unitType ?? unit.getData('unitType'),
      x: unit.x,
      y: unit.y,
      hp: unit.getData('hp'),
      population: scene.population,
      maxPopulation: scene.maxPopulation,
    };
  }, evidence.beforeSave);

  if (evidence.restored.wood !== evidence.beforeSave.wood) throw new Error('Wood state changed across menu-driven save/load.');
  if (evidence.restored.type !== evidence.beforeSave.type) throw new Error('Saved unit type changed across menu-driven save/load.');
  if (Math.hypot(evidence.restored.x - evidence.beforeSave.x, evidence.restored.y - evidence.beforeSave.y) > 2) {
    throw new Error('Saved unit position changed across menu-driven save/load.');
  }
  if (evidence.restored.hp !== evidence.beforeSave.hp) throw new Error('Saved unit HP changed across menu-driven save/load.');
  if (evidence.restored.population !== evidence.beforeSave.population || evidence.restored.maxPopulation !== evidence.beforeSave.maxPopulation) {
    throw new Error('Population state changed across menu-driven save/load.');
  }

  evidence.phase = 'continue-playing';
  await waitForCameraSync(page);
  evidence.move = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__saveLoadMenuProbe;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const { toIsoElev } = await import('/game/utils/iso.ts');

    for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [0, -48], [36, 36], [-36, -36]]) {
      const target = { x: unit.x + dx, y: unit.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: unit.x, y: unit.y }, target);
      if (!path?.length || path.length <= 1) continue;

      const projected = toIsoElev(target.x, target.y, scene.terrainSystem.getHeightAt(target.x, target.y));
      const targetScreen = {
        x: (projected.x - topLeft.x) * camera.zoom,
        y: (projected.y - topLeft.y) * camera.zoom,
      };
      const unitScreen = {
        x: (unit.visual.x - topLeft.x) * camera.zoom,
        y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
      };
      if (targetScreen.x < 120 || targetScreen.x > 1320 || targetScreen.y < 120 || targetScreen.y > 780) continue;

      return {
        start: { x: unit.x, y: unit.y },
        target,
        targetScreen,
        unitScreen,
      };
    }
    throw new Error('No visible walkable post-load move target is available.');
  });

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas was not measurable after load.');
  await page.mouse.click(box.x + evidence.move.unitScreen.x, box.y + evidence.move.unitScreen.y, { button: 'left' });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__saveLoadMenuProbe);
  }, undefined, { timeout: 5_000 });

  await page.mouse.click(box.x + evidence.move.targetScreen.x, box.y + evidence.move.targetScreen.y, { button: 'right' });
  await page.waitForFunction((start) => {
    const unit = window.__saveLoadMenuProbe;
    return Math.hypot(unit.x - start.x, unit.y - start.y) > 5;
  }, evidence.move.start, { timeout: 12_000 });

  evidence.afterContinue = await page.evaluate(() => ({
    x: window.__saveLoadMenuProbe.x,
    y: window.__saveLoadMenuProbe.y,
  }));

  if (evidence.browserErrors.length > 0) {
    throw new Error(`Browser page errors:\n${evidence.browserErrors.join('\n')}`);
  }

  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
