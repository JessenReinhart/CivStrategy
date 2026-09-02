import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4188;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/canonical-gather-build.json`;
const POINTER_TIMEOUT_MS = 30_000;
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

async function waitForCameraSync(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    const mainCamera = scene?.cameras?.main;
    const uiCamera = scene?.uiCamera;
    return Boolean(mainCamera && uiCamera)
      && Math.abs(mainCamera.scrollX - uiCamera.scrollX) < 0.5
      && Math.abs(mainCamera.scrollY - uiCamera.scrollY) < 0.5
      && Math.abs(mainCamera.zoom - uiCamera.zoom) < 0.001;
  }, undefined, { timeout: POINTER_TIMEOUT_MS });
}

async function visualScreenPoint(page, kind) {
  return page.evaluate((targetKind) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalGatherBuildProbe;
    const visual = targetKind === 'villager' ? probe.villager.visual : probe.camp.visual;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    let worldX = visual.x;
    let worldY = visual.y - 8;
    if (targetKind === 'camp') {
      const hitArea = visual.input?.hitArea;
      const localX = typeof hitArea?.centerX === 'number' ? hitArea.centerX : 0;
      const localY = typeof hitArea?.centerY === 'number' ? hitArea.centerY : -24;
      const transformed = visual.getWorldTransformMatrix().transformPoint(localX, localY);
      worldX = transformed.x;
      worldY = transformed.y;
    }
    return { x: (worldX - topLeft.x) * camera.zoom, y: (worldY - topLeft.y) * camera.zoom };
  }, kind);
}

async function pressRightButtonThroughGameFrame(page, canvasBox, point) {
  const targetX = canvasBox.x + point.x;
  const targetY = canvasBox.y + point.y;
  await page.mouse.move(targetX, targetY);
  const frameBeforeMove = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, frameBeforeMove, { timeout: POINTER_TIMEOUT_MS });
  await page.mouse.move(targetX, targetY);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const camp = window.__canonicalGatherBuildProbe.camp;
    return scene.input.hitTestPointer(scene.input.activePointer)
      .some((target) => target.getData?.('building') === camp);
  }, undefined, { timeout: POINTER_TIMEOUT_MS });
  const frameBeforeDown = await page.evaluate(() => window.__civStrategyGame.loop.frame);
  await page.mouse.down({ button: 'right' });
  try {
    await page.waitForFunction((frame) => window.__civStrategyGame.loop.frame > frame, frameBeforeDown, { timeout: POINTER_TIMEOUT_MS });
  } finally {
    await page.mouse.up({ button: 'right' });
  }
}

async function prepareHousePlacement(page) {
  return page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing.');
    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS.House;
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    for (let oy = 0; oy <= 640; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const center = {
          x: snap(tc.x - 320) + ox + def.width / 2,
          y: snap(tc.y - 320) + oy + def.height / 2,
        };
        if (!scene.buildingManager.getBuildValidity(center.x, center.y, 'House').valid) continue;
        const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
        scene.cameras.main.setZoom(1.5);
        scene.cameras.main.centerOn(iso.x, iso.y);
        window.__canonicalGatherBuildProbe.beforeHouseBuildings = new Set(scene.buildings.getChildren());
        return iso;
      }
    }
    throw new Error('No valid House placement found.');
  });
}

async function isoScreenPoint(page, iso) {
  return page.evaluate((point) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (point.x - topLeft.x) * camera.zoom, y: (point.y - topLeft.y) * camera.zoom };
  }, iso);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/canonical-gather-build.png`, fullPage: true }); } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.villagerSystem && scene?.buildingManager && scene?.inputManager && scene?.entityFactory);
  }, undefined, { timeout: 45_000 });

  evidence.phase = 'setup-gather';
  evidence.setup = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.economySystem.assignJobs = () => {};
    const villager = scene.villagerSystem.getIdleVillagers(0)[0];
    if (!villager?.visual) throw new Error('No idle player villager is available.');
    const trees = scene.trees.getChildren().filter((tree) => tree.active && !tree.getData('isGoldMine') && !tree.getData('isChopped'));
    let nearestTree = null;
    let nearestDistance = Infinity;
    for (const tree of trees) {
      const distance = Math.hypot(tree.x - villager.x, tree.y - villager.y);
      if (distance < nearestDistance) { nearestTree = tree; nearestDistance = distance; }
    }
    if (!nearestTree || nearestDistance > 280) throw new Error(`No deterministic nearby tree (${nearestDistance.toFixed(1)}px).`);
    const dx = nearestTree.x - villager.x;
    const dy = nearestTree.y - villager.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const camp = scene.entityFactory.spawnBuilding(
      'Lumber Camp',
      villager.x + (-dy / length) * 64,
      villager.y + (dx / length) * 64,
      0,
    );
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(villager.visual.x, villager.visual.y);
    window.__canonicalGatherBuildProbe = { villager, camp };
    return { wood: scene.resources.wood, maxPopulation: scene.maxPopulation, villagerId: villager.id };
  });
  await waitForCameraSync(page);
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas was not measurable.');

  evidence.phase = 'select-villager';
  const villagerPoint = await visualScreenPoint(page, 'villager');
  await page.mouse.click(canvasBox.x + villagerPoint.x, canvasBox.y + villagerPoint.y);
  await page.waitForFunction(() => {
    const villager = window.__canonicalGatherBuildProbe?.villager;
    return Boolean(villager?.visual?.getData('workforceSelectionRing')?.active);
  }, undefined, { timeout: POINTER_TIMEOUT_MS });

  evidence.phase = 'assign-work';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { villager, camp } = window.__canonicalGatherBuildProbe;
    scene.cameras.main.centerOn((villager.visual.x + camp.visual.x) * 0.5, (villager.visual.y + camp.visual.y) * 0.5);
  });
  await waitForCameraSync(page);
  const campPoint = await visualScreenPoint(page, 'camp');
  await pressRightButtonThroughGameFrame(page, canvasBox, campPoint);
  await page.waitForFunction(() => {
    const { villager, camp } = window.__canonicalGatherBuildProbe;
    return villager.jobBuilding === camp && camp.getData('assignedWorker') === villager;
  }, undefined, { timeout: POINTER_TIMEOUT_MS });

  evidence.phase = 'gather-deposit';
  evidence.gather = await page.evaluate((initialWood) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    let simulatedMs = 0;
    for (let i = 0; i < 2_000 && scene.resources.wood <= initialWood; i++) {
      scene.villagerSystem.update(scene.gameTime + simulatedMs, 100);
      simulatedMs += 100;
    }
    return { simulatedMs, wood: scene.resources.wood };
  }, evidence.setup.wood);
  if (evidence.gather.wood <= evidence.setup.wood) throw new Error('Selected villager did not complete a wood gather/deposit loop.');

  evidence.phase = 'transition-to-build';
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__canonicalGatherBuildProbe.villager.visual?.getData('workforceSelectionRing')?.active, undefined, { timeout: POINTER_TIMEOUT_MS });
  evidence.beforeHouse = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { wood: scene.resources.wood, maxPopulation: scene.maxPopulation };
  });

  const houseIso = await prepareHousePlacement(page);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: /Economy/i }).click();
  await page.getByRole('button', { name: /House/i }).click();
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === 'House', undefined, { timeout: 5_000 });
  const housePoint = await isoScreenPoint(page, houseIso);
  await page.mouse.move(canvasBox.x + housePoint.x, canvasBox.y + housePoint.y);
  await page.mouse.click(canvasBox.x + housePoint.x, canvasBox.y + housePoint.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__canonicalGatherBuildProbe.beforeHouseBuildings;
    return scene.buildings.getChildren().some((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === 'House');
  }, undefined, { timeout: 5_000 });
  evidence.afterHouse = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return { wood: scene.resources.wood, maxPopulation: scene.maxPopulation };
  });

  evidence.phase = 'assert';
  if (evidence.afterHouse.wood !== evidence.beforeHouse.wood - 50) throw new Error('House did not deduct exactly 50 wood from the post-gather economy state.');
  if (evidence.afterHouse.maxPopulation !== evidence.beforeHouse.maxPopulation + 8) throw new Error('House did not add 8 population capacity after the gather-to-build transition.');
  if (evidence.browserErrors.length) throw new Error(`Browser page errors:\n${evidence.browserErrors.join('\n')}`);

  evidence.phase = 'passed';
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
