import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAVE_KEY = 'civstrategy-save';
const TIMEOUT_MS = 30_000;
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
      if ((await fetch(BASE_URL)).ok) return;
    } catch {}
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
    return Boolean(scene?.isReady && scene?.inputManager && scene?.pathfinder && scene?.unitSpatialHash && scene?.entityFactory);
  }, undefined, { timeout: 45_000 });
}

async function bootGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
}

async function openGameMenu(page) {
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10_000 });
  await menuButton.click();
}

async function waitForCameraSync(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.__civStrategyGame.scene.getScene('MainScene').events.once('postupdate', resolve);
  }));
}

async function unitScreenPoint(page, key) {
  return page.evaluate((probeKey) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const unit = window.__restoredArmyCombatProbe[probeKey];
    const camera = scene.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      x: (unit.visual.x - topLeft.x) * camera.zoom,
      y: (unit.visual.y - 10 - topLeft.y) * camera.zoom,
    };
  }, key);
}

let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootGame(page);

  evidence.phase = 'prepare-save';
  evidence.beforeSave = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.gameSpeed = 0;
    const townCenter = scene.buildings.getChildren().find((building) => building.getData('owner') === 0 && building.getData('def')?.type === 'Town Center');
    if (!townCenter) throw new Error('Player Town Center missing.');

    let player = null;
    for (const [dx, dy] of [[96, 0], [-96, 0], [0, 96], [0, -96], [72, 72], [-72, -72]]) {
      const x = townCenter.x + dx;
      const y = townCenter.y + dy;
      if (scene.pathfinder.isBlocked(x, y)) continue;
      player = scene.entityFactory.spawnUnit('Pikesman', x, y, 0);
      break;
    }
    if (!player?.visual) throw new Error('Could not create deterministic player Pikesman.');
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    window.__restoredArmyCombatProbe = { player };
    return {
      x: player.x,
      y: player.y,
      hp: player.getData('hp'),
      type: player.unitType ?? player.getData('unitType'),
    };
  });

  await waitForCameraSync(page);
  await openGameMenu(page);
  await page.getByRole('button', { name: /Save game/i }).click();
  await page.waitForFunction((key) => Boolean(localStorage.getItem(key)), SAVE_KEY, { timeout: 10_000 });

  evidence.phase = 'reload';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await bootGame(page);
  await page.evaluate(() => {
    window.__restoredArmyCombatPreLoadGame = window.__civStrategyGame;
    window.__civStrategyGame.scene.getScene('MainScene').gameSpeed = 0;
  });
  await openGameMenu(page);
  await page.getByRole('button', { name: /Load game/i }).click();
  await page.waitForFunction((saved) => {
    const game = window.__civStrategyGame;
    if (!game || game === window.__restoredArmyCombatPreLoadGame) return false;
    const scene = game.scene?.getScene?.('MainScene');
    if (!scene?.isReady || !scene?.units?.getChildren) return false;
    return scene.units.getChildren().some((unit) => unit.getData('owner') === 0
      && (unit.unitType ?? unit.getData('unitType')) === saved.type
      && Math.hypot(unit.x - saved.x, unit.y - saved.y) <= 2);
  }, evidence.beforeSave, { timeout: 45_000 });

  evidence.phase = 'restore-player';
  evidence.restored = await page.evaluate((saved) => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.gameSpeed = 0;
    scene.peacefulMode = true;
    const player = scene.units.getChildren()
      .filter((unit) => unit.getData('owner') === 0 && (unit.unitType ?? unit.getData('unitType')) === saved.type)
      .sort((a, b) => Math.hypot(a.x - saved.x, a.y - saved.y) - Math.hypot(b.x - saved.x, b.y - saved.y))[0];
    if (!player?.visual) throw new Error('Saved Pikesman did not restore.');
    window.__restoredArmyCombatProbe = { player };
    scene.inputManager.clearSelection();
    scene.inputManager.deselectBuilding?.();
    scene.cameras.main.setZoom(1.5);
    scene.cameras.main.centerOn(player.visual.x, player.visual.y);
    return {
      positionDelta: Math.hypot(player.x - saved.x, player.y - saved.y),
      hp: player.getData('hp'),
    };
  }, evidence.beforeSave);
  if (evidence.restored.positionDelta > 2 || evidence.restored.hp !== evidence.beforeSave.hp) {
    throw new Error(`Restored Pikesman state changed: ${JSON.stringify(evidence.restored)}`);
  }

  await waitForCameraSync(page);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas unavailable after reload.');

  evidence.phase = 'select-restored-army';
  let point = await unitScreenPoint(page, 'player');
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    return scene.inputManager.selectedUnits.includes(window.__restoredArmyCombatProbe.player);
  }, undefined, { timeout: TIMEOUT_MS });

  evidence.phase = 'prepare-post-load-combat';
  evidence.combat = await page.evaluate(async () => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const player = window.__restoredArmyCombatProbe.player;
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
    if (!enemy?.visual) throw new Error('Could not create reachable post-load enemy.');
    enemy.setData('hp', 10);
    enemy.setData('stance', 'Hold');
    enemy.setData('anchor', { x: enemy.x, y: enemy.y });
    player.lastAttackTime = scene.gameTime;
    window.__restoredArmyCombatProbe.enemy = enemy;
    window.__restoredArmyCombatProbe.enemyX = enemy.x;
    window.__restoredArmyCombatProbe.enemyY = enemy.y;
    return { targetScreen, pausedAtGameTime: scene.gameTime };
  });

  await page.mouse.move(box.x + evidence.combat.targetScreen.x, box.y + evidence.combat.targetScreen.y);
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const enemy = window.__restoredArmyCombatProbe.enemy;
    return scene.input.hitTestPointer(scene.input.activePointer).some((hit) => hit.getData?.('unit') === enemy);
  }, undefined, { timeout: TIMEOUT_MS });

  evidence.phase = 'issue-post-load-attack';
  await page.mouse.click(box.x + evidence.combat.targetScreen.x, box.y + evidence.combat.targetScreen.y, { button: 'right' });
  evidence.attackCommand = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player, enemy } = window.__restoredArmyCombatProbe;
    return {
      targetsEnemy: player.target === enemy,
      explicitTarget: player.getData('explicitTarget') === true,
      selected: scene.inputManager.selectedUnits.includes(player),
      gameSpeed: scene.gameSpeed,
      gameTime: scene.gameTime,
      enemyHp: enemy.getData('hp'),
    };
  });
  if (!evidence.attackCommand.targetsEnemy || !evidence.attackCommand.explicitTarget || !evidence.attackCommand.selected) {
    throw new Error(`Restored army did not accept attack command: ${JSON.stringify(evidence.attackCommand)}`);
  }
  if (evidence.attackCommand.gameSpeed !== 0 || evidence.attackCommand.gameTime !== evidence.combat.pausedAtGameTime || evidence.attackCommand.enemyHp !== 10) {
    throw new Error('Simulation advanced while validating the restored-army attack command.');
  }

  evidence.phase = 'resolve-post-load-combat';
  await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const { player } = window.__restoredArmyCombatProbe;
    player.lastAttackTime = scene.gameTime - 10_000;
    scene.peacefulMode = false;
    scene.gameSpeed = 1;
  });
  await page.waitForFunction(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    const probe = window.__restoredArmyCombatProbe;
    return !probe.enemy.active
      && !scene.units.getChildren().includes(probe.enemy)
      && !scene.unitSpatialHash.query(probe.enemyX, probe.enemyY, 96).includes(probe.enemy)
      && probe.player.active
      && scene.units.getChildren().includes(probe.player);
  }, undefined, { timeout: 15_000 });

  if (evidence.browserErrors.length) throw new Error(`Browser errors observed: ${evidence.browserErrors.join(' | ')}`);
  evidence.phase = 'complete';
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
