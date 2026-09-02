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

async function authoritativeUnitScreenPoint(page, key) {
  return page.evaluate(async (probeKey) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__canonicalVerticalProbe[probeKey];
    const { toIsoElev } = await import('/game/utils/iso.ts');
    const height = scene.terrainSystem.getHeightAt(unit.x, unit.y);
    const projected = toIsoElev(unit.x, unit.y, height);
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (projected.x - topLeft.x) * camera.zoom, y: (projected.y - 10 - topLeft.y) * camera.zoom };
  }, key);
}

async function enemyTargetScreenPoint(page, box) {
  const visual = await unitScreenPoint(page, 'enemy');
  const authoritative = await authoritativeUnitScreenPoint(page, 'enemy');
  const candidates = [
    { ...visual, source: 'visual-center' },
    ...[[0, -8], [0, 8], [-8, 0], [8, 0], [0, -16], [0, 16], [-16, 0], [16, 0]].map(([dx, dy]) => ({
      x: visual.x + dx,
      y: visual.y + dy,
      source: `visual-offset:${dx},${dy}`,
    })),
    { ...authoritative, source: 'authoritative' },
  ];

  for (const candidate of candidates) {
    const insideCanvas = candidate.x >= 0 && candidate.y >= 0 && candidate.x <= box.width && candidate.y <= box.height;
    if (!insideCanvas) continue;
    await page.mouse.move(box.x + candidate.x, box.y + candidate.y);
    const hitsEnemy = await page.evaluate(() => {
      const scene = window.__civStrategyGame.scene.getScene('MainScene');
      const enemy = window.__canonicalVerticalProbe.enemy;
      return scene.input.hitTestPointer(scene.input.activePointer).some((obj) => obj.getData?.('unit') === enemy);
    });
    if (hitsEnemy) return candidate;
  }

  throw new Error(`Spawned combat target is not visibly targetable: visual=${JSON.stringify(visual)} authoritative=${JSON.stringify(authoritative)} canvas=${JSON.stringify({ width: box.width, height: box.height })}`);
}

async function cartesianScreenPoint(page, target) {
  return screenPointForIso(page, { x: target.x - target.y, y: (target.x + target.y) * 0.5 });
}

async function preparePlacement(page, type) {
  return page.evaluate(async (buildingType) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const manager = scene.buildingManager;
    const tc = scene.buildings.getChildren().find((b) => b.getData('owner') === 0 && b.getData('def')?.type === 'Town Center');
    if (!tc) throw new Error('Player Town Center missing.');
    const { BUILDINGS } = await import('/constants.ts');
    const def = BUILDINGS[buildingType];
    if (!def) throw new Error(`${buildingType} definition missing.`);
    const grid = 16;
    const snap = (v) => Math.floor(v / grid) * grid;
    let center = null;
    for (let oy = 0; oy <= 640 && !center; oy += grid) {
      for (let ox = 0; ox <= 640; ox += grid) {
        const candidate = { x: snap(tc.x - 320) + ox + def.width / 2, y: snap(tc.y - 320) + oy + def.height / 2 };
        if (manager.getBuildValidity(candidate.x, candidate.y, buildingType).valid) { center = candidate; break; }
      }
    }
    if (!center) throw new Error(`No valid ${buildingType} placement found.`);
    const iso = { x: center.x - center.y, y: (center.x + center.y) * 0.5 };
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(iso.x, iso.y);
    window.__canonicalPlacementBaseline = new Set(scene.buildings.getChildren());
    return { center, iso };
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
    const baseline = window.__canonicalPlacementBaseline;
    return scene.buildings.getChildren().some((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
  }, type, { timeout: 5_000 });
  const result = await page.evaluate((t) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const baseline = window.__canonicalPlacementBaseline;
    const building = scene.buildings.getChildren().find((b) => !baseline.has(b) && b.getData('owner') === 0 && b.getData('def')?.type === t);
    window.__canonicalVerticalProbe ??= {};
    window.__canonicalVerticalProbe[t === 'Barracks' ? 'barracks' : 'house'] = building;
    return { wood: scene.resources.wood, population: scene.population, maxPopulation: scene.maxPopulation, x: building.x, y: building.y };
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
  if (!page) return;
  try { await page.screenshot({ path: `${ARTIFACT_DIR}/canonical-placement-combat-save.png`, fullPage: true }); } catch {}
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
    return { wood: scene.resources.wood, food: scene.resources.food, gold: scene.resources.gold, population: scene.population, maxPopulation: scene.maxPopulation };
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
  if (!box) throw new Error('Canvas unavailable for Barracks selection.');
  const barracksPoint = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const building = window.__canonicalVerticalProbe.barracks;
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return { x: (building.visual.x - topLeft.x) * camera.zoom, y: (building.visual.y - 24 - topLeft.y) * camera.zoom };
  });
  await page.mouse.click(box.x + barracksPoint.x, box.y + barracksPoint.y, { button: 'left' });
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
    const units = scene.units.getChildren().filter((u) => u.getData('owner') === 0);
    const player = units[units.length - 1];
    window.__canonicalVerticalProbe.player = player;
    scene.gameSpeed = 0.75;
    return { food: scene.resources.food, gold: scene.resources.gold, population: scene.population, type: player.unitType ?? player.getData('unitType') };
  });
  if (evidence.afterTraining.type !== 'Pikesman') throw new Error('Barracks UI did not train a Pikesman.');
  if (evidence.afterTraining.food !== evidence.beforeTraining.food - 100 || evidence.afterTraining.gold !== evidence.beforeTraining.gold - 50) throw new Error('Pikesman training charged the wrong resources.');

  evidence.phase = 'move';
  evidence.moveTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    const barracks = window.__canonicalVerticalProbe.barracks;
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    const towardX = Math.sign(barracks.x - player.x) || -1;
    const towardY = Math.sign(barracks.y - player.y) || -1;
    const offsets = [
      [towardX * 96, 0],
      [0, towardY * 96],
      [towardX * 72, towardY * 72],
      [-towardX * 96, 0],
      [0, -towardY * 96],
    ];
    for (const [dx, dy] of offsets) {
      const target = { x: player.x + dx, y: player.y + dy };
      if (scene.pathfinder.isBlocked(target.x, target.y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, target);
      if (path?.length > 1) {
        player.setData('__journeyStartX', player.x);
        player.setData('__journeyStartY', player.y);
        return target;
      }
    }
    throw new Error('No walkable move target for trained Pikesman.');
  });
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas unavailable for movement.');
  let point = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  await page.waitForFunction(() => window.__civStrategyGame.scene.getScene('MainScene').inputManager.selectedUnits.includes(window.__canonicalVerticalProbe.player), undefined, { timeout: 5_000 });
  point = await cartesianScreenPoint(page, evidence.moveTarget);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
  await page.waitForFunction(() => {
    const player = window.__canonicalVerticalProbe.player;
    return Math.hypot(player.x - player.getData('__journeyStartX'), player.y - player.getData('__journeyStartY')) > 5;
  }, undefined, { timeout: 12_000 });

  evidence.phase = 'combat';
  evidence.combat = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    const previousGameSpeed = scene.gameSpeed;
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    let enemy = null;
    for (const [dx, dy] of [[36, 0], [-36, 0], [0, 36], [0, -36], [28, 28]]) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (scene.pathfinder.isBlocked(x, y)) continue;
      const path = scene.pathfinder.findPath({ x: player.x, y: player.y }, { x, y });
      if (!path?.length) continue;
      enemy = scene.entityFactory.spawnUnit('Pikesman', x, y, 1);
      break;
    }
    if (!enemy) throw new Error('Could not spawn deterministic combat target.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = scene.gameTime;
    window.__canonicalVerticalProbe.enemy = enemy;
    window.__canonicalVerticalProbe.enemyX = enemy.x;
    window.__canonicalVerticalProbe.enemyY = enemy.y;
    window.__canonicalVerticalProbe.previousGameSpeed = previousGameSpeed;
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn((player.visual.x + enemy.visual.x) * 0.5, (player.visual.y + enemy.visual.y) * 0.5);
    return { distance: Math.hypot(player.x - enemy.x, player.y - enemy.y), pausedAtGameTime: scene.gameTime };
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    return Boolean(probe.enemy?.visual)
      && Number.isFinite(probe.enemy.visual.x)
      && Number.isFinite(probe.enemy.visual.y)
      && scene.inputManager.selectedUnits.includes(probe.player);
  }, undefined, { timeout: 5_000 });
  await waitForCameraSync(page);
  const targetPoint = await enemyTargetScreenPoint(page, box);
  evidence.targetAcquisition = { source: targetPoint.source, x: targetPoint.x, y: targetPoint.y };
  await page.mouse.click(box.x + targetPoint.x, box.y + targetPoint.y, { button: 'right' });
  evidence.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__canonicalVerticalProbe;
    return {
      targetsEnemy: probe.player.target === probe.enemy,
      explicitTarget: probe.player.getData('explicitTarget') === true,
      state: probe.player.state,
      selected: scene.inputManager.selectedUnits.includes(probe.player),
      gameSpeed: scene.gameSpeed,
      gameTime: scene.gameTime,
      targetHp: probe.enemy.active ? probe.enemy.getData('hp') : null,
    };
  });
  if (!evidence.attackCommand.targetsEnemy || !evidence.attackCommand.explicitTarget) {
    throw new Error(`Attack command was not accepted by the selected Pikesman: ${JSON.stringify(evidence.attackCommand)}`);
  }
  if (evidence.attackCommand.gameSpeed !== 0 || evidence.attackCommand.gameTime !== evidence.combat.pausedAtGameTime || evidence.attackCommand.targetHp !== 10) {
    throw new Error(`Simulation advanced during attack-command capture: ${JSON.stringify(evidence.attackCommand)}`);
  }
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
    const saved = { x: player.x, y: player.y, hp: player.getData('hp'), type: player.unitType ?? player.getData('unitType'), population: scene.population, maxPopulation: scene.maxPopulation };
    window.dispatchEvent(new Event('save-game'));
    return saved;
  });
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
  await page.evaluate(() => window.dispatchEvent(new Event('load-game')));
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
    return { x: player.x, y: player.y, hp: player.getData('hp'), population: scene.population, maxPopulation: scene.maxPopulation };
  }, evidence.beforeSave);
  if (Math.hypot(evidence.restored.x - evidence.beforeSave.x, evidence.restored.y - evidence.beforeSave.y) > 2) throw new Error('Trained survivor position changed across reload.');
  if (evidence.restored.hp !== evidence.beforeSave.hp || evidence.restored.population !== evidence.beforeSave.population || evidence.restored.maxPopulation !== evidence.beforeSave.maxPopulation) throw new Error('Canonical combat state changed across reload.');

  evidence.phase = 'continue-playing';
  evidence.postLoadTarget = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__canonicalVerticalProbe.player;
    for (const [dx, dy] of [[64, 0], [-64, 0], [0, 64], [0, -64]]) {
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
  await waitForCameraSync(page);
  box = await canvas.boundingBox();
  point = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'left' });
  point = await cartesianScreenPoint(page, evidence.postLoadTarget);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
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