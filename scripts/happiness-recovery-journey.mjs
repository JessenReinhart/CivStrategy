import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = 'artifacts';
const EVIDENCE_PATH = `${ARTIFACT_DIR}/happiness-recovery-journey.json`;
const SCREENSHOT_PATH = `${ARTIFACT_DIR}/happiness-recovery-journey.png`;
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
    return Boolean(scene?.isReady && scene?.economySystem && scene?.villagerSystem);
  }, undefined, { timeout: 45_000 });
}

async function bootNewGame(page) {
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('button', { name: 'Commence' }).click();
  await waitForScene(page);
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let browser;
let page;
const evidence = { phase: 'boot', browserErrors: [] };

async function persistEvidence() {
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!page) return;
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  } catch {}
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await bootNewGame(page);

  evidence.phase = 'recovery';
  evidence.recovery = await page.evaluate(() => {
    const scene = window.__civStrategyGame.scene.getScene('MainScene');
    scene.peacefulMode = true;
    scene.taxRate = 0;
    scene.happiness = 30;
    scene.resources.food = 5_000;

    const start = {
      happiness: scene.happiness,
      population: scene.population,
      maxPopulation: scene.maxPopulation,
      food: scene.resources.food,
      taxRate: scene.taxRate,
      villagers: scene.villagerSystem.getAllVillagers().filter((villager) => villager.owner === 0).length,
    };
    if (start.population > start.maxPopulation * 0.8) {
      throw new Error(`Default New Game is too crowded for the recovery scenario: ${JSON.stringify(start)}`);
    }

    for (let tick = 0; tick < 20; tick++) scene.economySystem.tickEconomy();

    const recovered = {
      happiness: scene.happiness,
      population: scene.population,
      food: scene.resources.food,
    };

    scene.economySystem.tickPopulation();

    const resumed = {
      happiness: scene.happiness,
      population: scene.population,
      food: scene.resources.food,
      villagers: scene.villagerSystem.getAllVillagers().filter((villager) => villager.owner === 0).length,
    };

    return { start, recovered, resumed };
  });

  const { start, recovered, resumed } = evidence.recovery;
  if (recovered.happiness !== 50) {
    throw new Error(`Healthy zero-tax recovery did not reach the population gate: ${JSON.stringify(evidence.recovery)}`);
  }
  if (resumed.population !== recovered.population + 1 || resumed.villagers !== start.villagers + 1) {
    throw new Error(`Population did not resume after happiness recovered: ${JSON.stringify(evidence.recovery)}`);
  }
  if (resumed.food >= recovered.food) {
    throw new Error(`Population growth did not consume food after recovery: ${JSON.stringify(evidence.recovery)}`);
  }
  if (evidence.browserErrors.length) {
    throw new Error(`Browser errors:\n${evidence.browserErrors.join('\n')}`);
  }

  evidence.phase = 'complete';
  await persistEvidence();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.phase = `failed:${evidence.phase}`;
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  await persistEvidence();
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
}
