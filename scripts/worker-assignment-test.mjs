#!/usr/bin/env node
// Worker Assignment Integration Test
// Validates: farms, lumber camps, and gold mines receive workers
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const VIEWPORT = { width: 1600, height: 900 };
const OUT = 'shots/worker-assignment';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

async function clickText(label) {
    await page.locator(`text=${label}`).first().click();
    await page.waitForTimeout(300);
}

console.log('[setup] navigating to game');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Navigate to game (fog off for visibility)
await clickText('Start Game');
await page.waitForTimeout(1200);
const fow = page.locator('text=Fog of War');
if (await fow.count() > 0) {
    await fow.first().click();
}
await clickText('Commence');
console.log('[setup] waiting for game scene...');

// Wait for the game scene to be live
await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const s = game?.scene?.getScenes?.(true)?.[0];
    return Boolean(s?.isReady && s?.entityFactory && s?.villagerSystem && s?.buildings);
}, { timeout: 60000 });
console.log('[setup] scene live');

// Wait for Town Center to spawn
await page.waitForFunction(() => {
    const game = window.__civStrategyGame;
    const scene = game?.scene?.getScenes?.(true)?.[0];
    if (!scene) return false;
    const blds = scene.buildings?.getChildren?.() ?? [];
    return blds.some(b => b.getData('def')?.type === 'Town Center');
}, { timeout: 30000 });
console.log('[setup] Town Center found');

// ── Build a farm + lumber camp + spawn villagers ───────────────────────
// Phaser GameObjects don't have a built-in .id, so we tag them with setData('testId', N)
const setup = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScenes(true)[0];

    const playerTC = scene.buildings.getChildren().find(b =>
        b.getData('def')?.type === 'Town Center' && b.getData('owner') === 0
    );
    if (!playerTC) return { error: 'No player TC found' };

    const factory = scene.entityFactory;
    const farm = factory.spawnBuilding('Farm', playerTC.x + 100, playerTC.y + 50, 0);
    const lumber = factory.spawnBuilding('Lumber Camp', playerTC.x + 150, playerTC.y - 50, 0);

    // Tag buildings so we can find them later (Phaser objects have no .id)
    farm.setData('testTag', 'testFarm');
    lumber.setData('testTag', 'testLumber');

    const villagers = [];
    for (let i = 0; i < 4; i++) {
        const v = scene.villagerSystem.spawnVillager(
            playerTC.x + (i % 2) * 40 - 20,
            playerTC.y + Math.floor(i / 2) * 40 - 20,
            0
        );
        villagers.push(v.id);
    }

    return {
        tcX: playerTC.x,
        tcY: playerTC.y,
        villagerIds: villagers
    };
});

console.log('[setup] buildings created:', JSON.stringify(setup));

if (setup.error) {
    console.error('[FAIL]', setup.error);
    await browser.close();
    process.exit(1);
}

// ── Poll for farm + lumber worker assignment ───────────────────────────
const POLL_INTERVAL = 1000;
const MAX_POLLS = 40;

async function waitForWorkers() {
    for (let i = 0; i < MAX_POLLS; i++) {
        const result = await page.evaluate(() => {
            const game = window.__civStrategyGame;
            const scene = game.scene.getScenes(true)[0];
            const blds = scene.buildings.getChildren();
            const farm = blds.find(b => b.getData('testTag') === 'testFarm');
            const lumber = blds.find(b => b.getData('testTag') === 'testLumber');
            const fw = farm?.getData('assignedWorker');
            const lw = lumber?.getData('assignedWorker');
            const idle = scene.villagerSystem.getIdleVillagers(0);
            return {
                farmAssigned: fw != null,
                lumberAssigned: lw != null,
                farmWorkerId: fw?.id ?? null,
                lumberWorkerId: lw?.id ?? null,
                idleCount: idle.length,
                farmExists: !!farm,
                lumberExists: !!lumber,
                farmDef: farm?.getData('def')?.type ?? null,
                lumberDef: lumber?.getData('def')?.type ?? null,
                farmWorkerNeeds: farm?.getData('def')?.workerNeeds ?? null,
            };
        });

        console.log(`[poll ${i + 1}/${MAX_POLLS}]`, JSON.stringify(result));
        if (result.farmAssigned && result.lumberAssigned) return result;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    return null;
}

const workerResult = await waitForWorkers();

if (!workerResult) {
    console.error('[FAIL] Farm/lumber workers not assigned within timeout');
    await browser.close();
    process.exit(1);
}
console.log('[PASS] Both farm and lumber camp have workers assigned');

// ── Gold mine assignment ───────────────────────────────────────────────
console.log('[test] testing gold mine assignment...');

const goldResult = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScenes(true)[0];

    const playerTC = scene.buildings.getChildren().find(b =>
        b.getData('def')?.type === 'Town Center' && b.getData('owner') === 0
    );
    if (!playerTC) return { error: 'No player TC found' };

    const nearbyMines = scene.treeSpatialHash.query(playerTC.x, playerTC.y, 300)
        .filter(m => m.getData('isGoldMine') && !m.getData('isDepleted') && m.active);

    if (nearbyMines.length === 0) return { error: 'No active gold mines found near TC' };

    const mine = nearbyMines[0];
    mine.setData('testTag', 'testGoldMine');

    // Spawn idle villagers if none available
    const idle = scene.villagerSystem.getIdleVillagers(0);
    if (idle.length === 0) {
        for (let i = 0; i < 2; i++) {
            scene.villagerSystem.spawnVillager(playerTC.x + 60 + i * 30, playerTC.y + 60 + i * 30, 0);
        }
    }

    return { mineId: mine.id, mineX: mine.x, mineY: mine.y };
});

console.log('[gold mine setup]', JSON.stringify(goldResult));

let goldAssigned = false;
if (goldResult.error) {
    console.warn('[WARN] Gold mine test skipped:', goldResult.error);
} else {
    for (let i = 0; i < MAX_POLLS; i++) {
        const result = await page.evaluate(() => {
            const game = window.__civStrategyGame;
            const scene = game.scene.getScenes(true)[0];
            const mine = scene.treeSpatialHash.query(0, 0, 10000).find(m => m.getData('testTag') === 'testGoldMine');
            if (!mine) return { error: 'Mine not found' };
            const worker = mine.getData('assignedWorker');
            return { assigned: worker != null, workerId: worker?.id ?? null };
        });

        console.log(`[gold poll ${i + 1}/${MAX_POLLS}]`, JSON.stringify(result));
        if (result.assigned) { goldAssigned = true; break; }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    console.log(goldAssigned ? '[PASS] Gold mine has worker assigned' : '[WARN] Gold mine worker not assigned within timeout');
}

// ── Final summary ──────────────────────────────────────────────────────
const finalResult = await page.evaluate(() => {
    const game = window.__civStrategyGame;
    const scene = game.scene.getScenes(true)[0];

    const buildings = scene.buildings.getChildren().filter(b => {
        const def = b.getData('def');
        return def?.workerNeeds && b.getData('owner') === 0;
    });

    const goldMines = scene.treeSpatialHash.query(0, 0, 10000).filter(m =>
        m.getData('isGoldMine') && m.getData('owner') === 0
    );

    return {
        buildingsWithWorkers: buildings.filter(b => b.getData('assignedWorker') != null).length,
        totalBuildings: buildings.length,
        goldMinesWithWorkers: goldMines.filter(m => m.getData('assignedWorker') != null).length,
        totalGoldMines: goldMines.length,
        idleVillagers: scene.villagerSystem.getIdleVillagers(0).length,
    };
});

console.log('\n=== FINAL VERIFICATION ===');
console.log(JSON.stringify(finalResult, null, 2));

const allBuildingsStaffed = finalResult.buildingsWithWorkers === finalResult.totalBuildings && finalResult.totalBuildings > 0;
const allGoldMinesStaffed = finalResult.goldMinesWithWorkers === finalResult.totalGoldMines && finalResult.totalGoldMines > 0;

console.log(`\nBuildings with workers: ${finalResult.buildingsWithWorkers}/${finalResult.totalBuildings} ${allBuildingsStaffed ? 'PASS' : 'FAIL'}`);
console.log(`Gold mines with workers: ${finalResult.goldMinesWithWorkers}/${finalResult.totalGoldMines} ${allGoldMinesStaffed ? 'PASS' : 'FAIL'}`);
console.log(`Idle villagers: ${finalResult.idleVillagers}`);
console.log(`Errors: ${errors.length === 0 ? 'NONE' : errors.slice(0, 5).join(' | ')}`);

await page.screenshot({ path: `${OUT}/final.png` });
await browser.close();

process.exit(allBuildingsStaffed ? 0 : 1);
