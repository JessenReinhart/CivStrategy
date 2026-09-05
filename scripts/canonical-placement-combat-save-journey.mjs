import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/canonical-placement-combat-save.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), sleep(2_000)]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE_URL)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error(`Vite did not become ready.\n${serverOutput}`);
}

async function waitForScene(page) {
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame?.scene?.getScene?.('MainScene');
    return Boolean(scene?.isReady && scene?.buildingManager && scene?.inputManager && scene?.pathfinder && scene?.unitSpatialHash);
  }, undefined, { timeout: 45_000 });
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.events.once('postupdate', resolve);
  }));
}

async function openGameMenu(page) {
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
  await page.getByRole('button', { name: /Save game/i }).waitFor({ state: 'visible', timeout: 5_000 });
}

async function screenPointForIso(page, iso) {
  return page.evaluate((point) => {
    const camera = window.__civStrategyGame.scene.getScene('MainScene').cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (point.x - topLeft.x) * camera.zoom, y: (point.y - topLeft.y) * camera.zoom };
  }, iso);
}

async function unitScreenPoint(page, key) {
  return page.evaluate((probeKey) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__canonicalVerticalProbe[probeKey];
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (unit.visual.x - topLeft.x) * camera.zoom, y: (unit.visual.y - 10 - topLeft.y) * camera.zoom };
  }, key);
}

async function cartesianScreenPoint(page, target) {
  return screenPointForIso(page, { x: target.x - target.y, y: (target.x + target.y) * 0.5 });
}

async function preparePlacement(page, type) {
  return page.evaluate(async (buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing.');
    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS[buildingType];
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    let center = null;
    for (let oy = 0; oy <= 640 && !center; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const candidate = { x: snap(tc.x - 320) + ox + def.width / 2, y: snap(tc.y - 320) + oy + def.height / 2 };
        if (scene.buildingManager.getBuildValidity(candidate.x, candidate.y, buildingType).valid) { center = candidate; break; }
      }
    }
    if (!center) throw new Error(`No valid ${buildingType} placement found.`);
    const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(iso.x, iso.y);
    window.__canonicalPlacementBaseline = new Set(scene.buildings.getChildren());
    return { iso };
  }, type);
}

async function placeThroughUi(page, canvas, category, type) {
  const setup = await preparePlacement(page, type);
  await waitForCameraSync(page);
  await page.getByRole('button', { name: new RegExp(category, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  await page.waitForFunction((t) => window.__civStrategyGame.scene.getScene('MainScene').buildingManager.previewBuildingType === t, type, { timeout: 5_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable for placement.');
  const point = await screenPointForIso(page, setup.iso);
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.buildings.getChildren().some((b) => !window.__canonicalPlacementBaseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
  }, type, { timeout: 5_000 });
  const result = await page.evaluate((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = scene.buildings.getChildren().find((b) => !window.__canonicalPlacementBaseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
    window.__canonicalVerticalProbe[t === 'Barracks' ? 'barracks' : 'house'] = building;
    return { wood: scene.resources.wood, population: scene.population, maxPopulation: scene.maxPopulation };
  }, type);
  await page.keyboard.press('Escape');
  return result;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (page) {
    try { await page.screenshot({ path: `${ARTIFACT_DIR}/canonical-placement-combat-save.png`, fullPage: true }); } catch {}
  }
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);

  evidence.baseline = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.resources.wood = 10_000;
    scene.resources.food = 10_000;
    scene.resources.gold = 10_000;
    scene.economySystem.updateStats();
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    window.__canonicalVerticalProbe = {};
    return { wood: scene.resources.wood, population: scene.population, maxPopulation: scene.maxPopulation };
  });

  const canvas = page.locator('canvas').first();
  evidence.phase = 'house-placement';
  evidence.afterHouse = await placeThroughUi(page, canvas, 'Economy', 'House');
  if (evidence.afterHouse.wood !== evidence.baseline.wood - 50) throw new Error('House placement charged the wrong wood cost.');
  if (evidence.afterHouse.maxPopulation !== evidence.baseline.maxPopulation + 8) throw new Error('House placement did not add 8 population capacity.');

  evidence.phase = 'barracks-placement';
  evidence.afterBarracks = await placeThroughUi(page, canvas, 'Military', 'Barracks');
  if (evidence.afterBarracks.wood >= evidence.afterHouse.wood) throw new Error('Barracks placement did not deduct wood.');

  evidence.phase = 'train';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const barracks = window.__canonicalVerticalProbe.barracks;
    scene.cameras.main.centerOn(barracks.visual.x, barracks.visual.y);
  });
  await waitForCameraSync(page);
  let box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable for training.');
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__canonicalVerticalProbe.barracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (building.visual.x - topLeft.x) * camera.zoom, y: (building.visual.y - 24 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y);
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedBuilding === window.__canonicalVerticalProbe.barracks, undefined, { timeout: 5_000 });
  evidence.beforeTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    return { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, military: scene.units.getChildren().filter((u) => u.getData('owner') === 0).length };
  });
  await page.getByRole('button', { name: /Pikesman/i }).click();
  await page.waitForFunction((before) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.population === before.population + 1 && scene.units.getChildren().filter((u) => u.getData('owner') === 0).length === before.military + 1;
  }, evidence.beforeTraining, { timeout: 5_000 });
  evidence.afterTraining = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren().filter((u) => u.getData('owner') === 0).at(-1);
    window.__canonicalVerticalProbe.player = player;
    scene.gameSpeed = 0.75;
    return { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, type: player.unitType ?? player.getData('unitType') };
  });
  if (evidence.afterTraining.type !== 'Pikesman') throw new Error('Barracks UI did not train a Pikesman.');
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100 || evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman training charged the wrong resources.');

  evidence.phase = 'move';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
  });
  await waitForCameraSync(page);
  evidence.moveTarget = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const { toIsoElev } = await import('/game/utils/iso.ts');
    for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [0, -48], [36, 36], [-36, -36]]) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (!path?.length || path.length <= 1) continue;
      const projected = toIsoElev(target.x, target.y, scene.terrainSystem.getHeightAt(target.x, target.y));
      const screen = { x: (projected.x - topLeft.x) * camera.zoom, y: (projected.y - topLeft.y) * camera.zoom };
      if (screen.x < 160 || screen.x > 1280 || screen.y < 140 || screen.y > 760) continue;
      player.setData('__journeyStartX', player.x);
      player.setData('__journeyStartY', player.y);
      return target;
    }
    throw new Error('No visible walkable move target for trained Pikesman.');
  });
  box = await canvas.boundingBox();
  let point = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__canonicalVerticalProbe.player), undefined, { timeout: 5_000 });
  point = await cartesianScreenPoint(page, evidence.moveTarget);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__canonicalVerticalProbe.player;
    return Math.hypot(player.x - player.getData('__journeyStartX'), player.y - player.getData('__journeyStartY')) > 5;
  }, undefined, { timeout: 12_000 });

  evidence.phase = 'combat';
  evidence.combat = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    const previousGameSpeed = scene.gameSpeed;
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const { toIsoElev } = await import('/game/utils/iso.ts');
    let enemy = null;
    let targetScreen = null;
    for (const [dx, dy] of [[36, 0], [-36, 0], [0, 36], [0, -36], [28, 28], [-28, -28]]) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (scene.pathfinder.isBlocked(x, y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, { x, y });
      if (!path?.length) continue;
      const projected = toIsoElev(x, y, scene.terrainSystem.getHeightAt(x, y));
      const screen = { x: (projected.x - topLeft.x) * camera.zoom, y: (projected.y - 10 - topLeft.y) * camera.zoom };
      if (screen.x < 120 || screen.x > 1320 || screen.y < 120 || screen.y > 780) continue;
      enemy = scene.entityFactory.spawnUnit('Pikesman', x, y, 1);
      targetScreen = screen;
      break;
    }
    if (!enemy) throw new Error('Could not spawn a reachable on-screen combat target.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = scene.gameTime;
    window.__canonicalVerticalProbe.enemy = enemy;
    window.__canonicalVerticalProbe.enemyX = enemy.x;
    window.__canonicalVerticalProbe.enemyY = enemy.y;
    window.__canonicalVerticalProbe.previousGameSpeed = previousGameSpeed;
    return { distance: Math.hypot(player.x - enemy.x, player.y - enemy.y), pausedAtGameTime: scene.gameTime, targetScreen };
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    return Boolean(probe.enemy?.visual) && scene.inputManager.selectedUnits.includes(probe.player);
  }, undefined, { timeout: 5_000 });
  await page.mouse.move(box.x + evidence.combat.targetScreen.x, box.y + evidence.combat.targetScreen.y);
  const hit = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const enemy = window.__canonicalVerticalProbe.enemy;
    return scene.input.hitTestPointer(scene.input.activePointer).some((obj) => obj.getData?.('unit') === enemy);
  });
  if (!hit) throw new Error(`On-screen combat target was not hit-testable at ${JSON.stringify(evidence.combat.targetScreen)}.`);
  await page.mouse.click(box.x + evidence.combat.targetScreen.x, box.y + evidence.combat.targetScreen.y, { button: 'right' });
  evidence.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    return {
      targetsEnemy: probe.player.target === probe.enemy,
      explicitTarget: probe.player.getData('explicitTarget') === true,
      selected: scene.inputManager.selectedUnits.includes(probe.player),
      gameSpeed: scene.gameSpeed,
      gameTime: scene.gameTime,
      targetHp: probe.enemy.active ? probe.enemy.getData('hp') : null,
    };
  });
  if (!evidence.attackCommand.targetsEnemy || !evidence.attackCommand.explicitTarget) throw new Error(`Attack command was not accepted: ${JSON.stringify(evidence.attackCommand)}`);
  if (evidence.attackCommand.gameSpeed !== 0 || evidence.attackCommand.gameTime !== evidence.combat.pausedAtGameTime || evidence.attackCommand.targetHp !== 10) throw new Error('Simulation advanced while capturing the attack command.');
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    probe.player.lastAttackTime = scene.gameTime - 10_000;
    scene.peacefulMode = false;
    scene.gameSpeed = probe.previousGameSpeed || 1;
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    return !probe.enemy.active && !scene.units.getChildren().includes(probe.enemy) && !scene.unitSpatialHash.query(probe.enemyX, probe.enemyY, 96).includes(probe.enemy) && probe.player.active;
  }, undefined, { timeout: 15_000 });

  evidence.phase = 'save';
  evidence.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    return { x: player.x, y: player.y, hp: player.getData('hp'), type: player.unitType ?? player.getData('unitType'), population: scene.population, maxPopulation: scene.maxPopulation };
  });
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await page.waitForFunction((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.units.getChildren().some((unit) => unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === saved.type && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2);
  }, evidence.beforeSave, { timeout: 20_000 });
  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = scene.units.getChildren().filter((unit) => unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === saved.type).sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!player) throw new Error('Trained survivor was not restored.');
    window.__canonicalVerticalProbe = { player };
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    return { x: player.x, y: player.y, hp: player.getData('hp'), population: scene.population, maxPopulation: scene.maxPopulation, gameSpeed: scene.gameSpeed };
  }, evidence.beforeSave);
  if (Math.hypot(evidence.restored.x - evidence.beforeSave.x, evidence.restored.y - evidence.beforeSave.y) > 2) throw new Error('Trained survivor position changed across reload.');
  if (evidence.restored.hp !== evidence.beforeSave.hp || evidence.restored.population !== evidence.beforeSave.population || evidence.restored.maxPopulation !== evidence.beforeSave.maxPopulation) throw new Error('Canonical combat state changed across reload.');

  evidence.phase = 'continue-playing';
  evidence.postLoadTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [0, -48]]) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length > 1) {
        player.setData('__postLoadX', player.x);
        player.setData('__postLoadY', player.y);
        return target;
      }
    }
    throw new Error('No post-load move target.');
  });
  const saveButton = page.getByRole('button', { name: /Save game/i });
  if (await saveButton.isVisible()) {
    await page.locator('button:has(svg.lucide-menu)').first().click();
    await saveButton.waitFor({ state: 'hidden', timeout: 5_000 });
  }
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  point = await unitScreenPoint(page, 'player');
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    return scene.input.hitTestPointer(scene.input.activePointer).some((obj) => obj.getData?.('unit') === player);
  }, undefined, { timeout: 5_000 });
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__canonicalVerticalProbe.player);
  }, undefined, { timeout: 5_000 });
  point = await cartesianScreenPoint(page, evidence.postLoadTarget);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  evidence.postLoadCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    return {
      selected: scene.inputManager.selectedUnits.includes(player),
      gameSpeed: scene.gameSpeed,
      state: player.state,
      pathLength: Array.isArray(player.path) ? player.path.length : null,
    };
  });
  await page.waitForFunction(() => {
    const player = window.__canonicalVerticalProbe.player;
    return Math.hypot(player.x - player.getData('__postLoadX'), player.y - player.getData('__postLoadY')) > 5;
  }, undefined, { timeout: 12_000 });

  if (evidence.browserErrors.length) throw new Error(`Browser errors observed: ${evidence.browserErrors.join(' | ')}`);
  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
