#!/usr/bin/env node
// Normal-mode visual verification of liquid-combat deformation.
// Stress mode CANNOT show deformation (bodies disabled, LOD_DOT), so this spawns
// two real armies in a normal game, forces them to collide, zooms to LOD_FULL,
// and probes per-soldier `modifiedOffset` + contact-line forces + screenshots.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const VIEWPORT = { width: 1600, height: 900 };
const OUT = 'shots/liquid-combat-normal';

mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

console.log('[setup] navigating to normal game');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

async function clickText(label) {
    const btn = page.locator(`text=${label}`);
    const n = await btn.count();
    if (!n) return false;
    await btn.first().click();
    console.log(`[setup] clicked "${label}"`);
    return true;
}

// Landing -> lobby -> game (fog off so the battle is visible)
await clickText('Start Game');
await page.waitForTimeout(1200); // GSAP crossfade to lobby
const fow = page.locator('text=Fog of War');
if (await fow.count() > 0) {
    await fow.first().click();
    console.log('[setup] disabled Fog of War');
} else {
    console.log('[setup] WARN: Fog of War toggle not found — battle may be hidden');
}
await clickText('Commence');
console.log('[setup] waiting for game scene...');

// Wait for the game scene to be live
await page.waitForFunction(() => {
    const g = window.__civStrategyGame;
    const s = g?.scene?.getScenes?.(true)?.[0];
    return s && s.isReady && s.entityFactory && s.liquidCombat;
}, { timeout: 60000 });
console.log('[setup] scene live');

// ── Spawn two opposing armies and force them to collide ─────────────────
const setup = await page.evaluate(() => {
    const g = window.__civStrategyGame;
    const scene = g.scene.getScenes(true)[0];
    // Ensure enemy units can chase and attack (disable peaceful failsafe)
    scene.peacefulMode = false;
    // Anchor on the player's first building (townhall) — guarantees walkable land
    let anchor = null;
    const blds = scene.buildings?.getChildren?.() ?? [];
    if (blds.length > 0) {
        const b = blds[0];
        anchor = { x: b.x, y: b.y };
    }
    if (!anchor) {
        const units = scene.units.getChildren();
        anchor = { x: units[0].x, y: units[0].y };
    }

    // World bounds clamp (avoid spawning off-map)
    const bounds = scene.physics.world.bounds;
    const minX = bounds.x + 120, minY = bounds.y + 120;
    const maxX = bounds.right - 120, maxY = bounds.bottom - 120;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Spawn away from townhall to avoid pathfinding around buildings
    const cx = clamp(anchor.x + 400, minX, maxX);
    const cy = clamp(anchor.y + 300, minY, maxY);

    // Two 6x4 blocks, 60px apart — within CONTACT_RANGE (100px) so contact lines fire immediately
    const SPAWN_COUNT = 500;
    const gapX = 120;
    const spacing = 14;
    const player = [];
    const enemies = [];
    for (let i = 0; i < SPAWN_COUNT; i++) {
        const ox = (i % 6) * spacing, oy = Math.floor(i / 6) * spacing;
        const p = scene.entityFactory.spawnUnit('Pikesman', clamp(cx - gapX / 2 + ox, minX, maxX), clamp(cy + oy, minY, maxY), 0);
        if (p) player.push(p);
        const e = scene.entityFactory.spawnUnit('Pikesman', clamp(cx + gapX / 2 + ox, minX, maxX), clamp(cy + oy, minY, maxY), 1);
        if (e) enemies.push(e);
    }

    // Issue attack commands both ways
    if (player.length > 0 && enemies.length > 0) {
        scene.unitSystem.commandAttack(player, enemies[0]);
        scene.unitSystem.commandAttack(enemies, player[0]);
    }

    // Camera: center battle in ISO space (world layer is iso-projected) at zoom 2
    // so screenDist/zoom < 800 => guaranteed LOD_FULL soldier rendering.
    const midX = (player[0].x + enemies[0].x) / 2;
    const midY = (player[0].y + enemies[0].y) / 2;
    const ix = midX - midY;
    const iy = (midX + midY) * 0.5;
    scene.cameras.main.setZoom(2);
    scene.cameras.main.centerOn(ix, iy);

    return { playerCount: player.length, enemyCount: enemies.length, midX, midY, anchor };
});

console.log('[setup]', JSON.stringify(setup));
if (setup.playerCount < 20 || setup.enemyCount < 20) {
    console.error('FAIL: could not spawn both armies');
    await browser.close();
    process.exit(1);
}

// ── Probe helpers ────────────────────────────────────────────────────────
async function probe(tag) {
    const data = await page.evaluate(() => {
        const g = window.__civStrategyGame;
        const scene = g.scene.getScenes(true)[0];
        const liquid = scene.liquidCombat;
        const units = scene.units.getChildren().filter(u => u.getData && (u.getData('owner') === 0 || u.getData('owner') === 1));

        let deformed = 0, maxMag = 0, sumMag = 0, frontUnits = 0;
        const samples = [];
        for (const u of units) {
            const mo = u.modifiedOffset;
            if (mo) {
                const mag = Math.hypot(mo.x, mo.y);
                sumMag += mag;
                if (mag > maxMag) maxMag = mag;
                if (mag > 1) deformed++;
                if (samples.length < 8) samples.push({
                    x: +u.x.toFixed(0), y: +u.y.toFixed(0), owner: u.getData('owner'),
                    mo: { x: +mo.x.toFixed(2), y: +mo.y.toFixed(2) }, mag: +mag.toFixed(2),
                    state: u.state, hp: u.getData('hp'),
                });
            }
        }

        // LOD ground truth: how many soldier sprites are actually visible
        let fullLod = 0, lodUnits = 0;
        for (const u of units) {
            const sprites = u.getData('soldierSprites');
            if (!sprites || sprites.length === 0) continue;
            lodUnits++;
            let vis = 0;
            for (let i = 0; i < sprites.length; i++) if (sprites[i].visible) vis++;
            if (vis === sprites.length) fullLod++;
        }

        // Front gap between the two armies (AABB box gap, same metric as contact detection)
        let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
        let eMinX = Infinity, eMaxX = -Infinity, eMinY = Infinity, eMaxY = -Infinity;
        for (const u of units) {
            if (u.getData('owner') === 0) {
                if (u.x < pMinX) pMinX = u.x; if (u.x > pMaxX) pMaxX = u.x;
                if (u.y < pMinY) pMinY = u.y; if (u.y > pMaxY) pMaxY = u.y;
            } else {
                if (u.x < eMinX) eMinX = u.x; if (u.x > eMaxX) eMaxX = u.x;
                if (u.y < eMinY) eMinY = u.y; if (u.y > eMaxY) eMaxY = u.y;
            }
        }
        const gapX = Math.max(0, Math.max(pMinX, eMinX) - Math.min(pMaxX, eMaxX));
        const gapY = Math.max(0, Math.max(pMinY, eMinY) - Math.min(pMaxY, eMaxY));
        const frontGap = +Math.sqrt(gapX * gapX + gapY * gapY).toFixed(1);

        // Contact force sampled at the front midpoint (bx != 0 => contact lines active there)
        const frontX = (Math.max(pMinX, eMinX) + Math.min(pMaxX, eMaxX)) / 2;
        const frontY = (Math.max(pMinY, eMinY) + Math.min(pMaxY, eMaxY)) / 2;
        const f0 = liquid.getContactForce(frontX, frontY, 0);
        const f1 = liquid.getContactForce(frontX, frontY, 1);

        return {
            totalUnits: units.length,
            withModifiedOffset: units.filter(u => u.modifiedOffset).length,
            deformedPx: deformed,
            maxOffsetPx: +maxMag.toFixed(2),
            avgOffsetPx: units.length ? +(sumMag / units.length).toFixed(3) : 0,
            frontGap,
            liquid: {
                enabled: liquid.enabled,
                pressureCells: liquid.pressureCellCount,
                contactLines: liquid.contactLineCount,
            },
            contactForceAtFront: {
                player: { bx: +f0.bx.toFixed(2), by: +f0.by.toFixed(2), lx: +f0.lx.toFixed(2), ly: +f0.ly.toFixed(2) },
                enemy: { bx: +f1.bx.toFixed(2), by: +f1.by.toFixed(2), lx: +f1.lx.toFixed(2), ly: +f1.ly.toFixed(2) },
            },
            lod: { fullLodUnits: fullLod, probedUnits: lodUnits },
            samples,
        };
    });
    console.log(`[probe ${tag}]`, JSON.stringify(data, null, 2));
    return data;
}

// ── Watch the armies collide ─────────────────────────────────────────────
console.log('[verify] armies closing... (15s)');
await new Promise(r => setTimeout(r, 15000));
const p1 = await probe('t1-melee');

await page.screenshot({ path: `${OUT}-t1-melee.png` });
console.log(`[verify] saved ${OUT}-t1-melee.png`);

console.log('[verify] battle continues... (30s)');
await new Promise(r => setTimeout(r, 30000));
const p2 = await probe('t2-late');

await page.screenshot({ path: `${OUT}-t2-late.png` });
console.log(`[verify] saved ${OUT}-t2-late.png`);

// ── Verdict ──────────────────────────────────────────────────────────────
const liquidLive = p1.liquid.enabled && (p1.liquid.pressureCells > 0 || p1.liquid.contactLines > 0);
const forcesApplied = p1.withModifiedOffset > 0;
const visuallyDeformed = p1.deformedPx > 0 && p1.maxOffsetPx > 1;
const contactActive = p1.liquid.contactLines > 0 || p2.liquid.contactLines > 0;
const frontGapValid = p2.frontGap < 100; // CONTACT_RANGE = 100 in LiquidCombatSystem
const contactPersisted = p1.liquid.contactLines > 0 && p2.liquid.contactLines > 0;
// HP loss proves combat actually resolved (not just visual contact)
const allHp = [...p1.samples, ...p2.samples].map(s => s.hp).filter(h => h !== undefined);
const hpMax = allHp.length > 0 ? Math.max(...allHp) : 0;
const hpMin = allHp.length > 0 ? Math.min(...allHp) : 0;
const battleHappened = allHp.length > 0 && hpMin < hpMax;

console.log('\n=== VERDICT ===');
console.log(`liquid system live:     ${liquidLive ? 'PASS' : 'FAIL'} (pressure=${p1.liquid.pressureCells}, contact=${p1.liquid.contactLines})`);
console.log(`contact lines firing:   ${contactActive && frontGapValid ? 'PASS' : 'FAIL'} (front gap ${p2.frontGap}px)`);
console.log(`modifiedOffset applied: ${forcesApplied ? 'PASS' : 'FAIL'} (${p1.withModifiedOffset}/${p1.totalUnits} units)`);
console.log(`visible deformation:    ${visuallyDeformed ? 'PASS' : 'FAIL'} (${p1.deformedPx} units > 1px, max ${p1.maxOffsetPx}px)`);
console.log(`LOD_FULL rendering:     ${p1.lod.fullLodUnits > 0 ? 'PASS' : 'FAIL'} (${p1.lod.fullLodUnits}/${p1.lod.probedUnits} units)`);
console.log(`battle resolved (HP):   ${battleHappened ? 'PASS' : 'FAIL'} (hp range ${hpMin}-${hpMax})`);
console.log(`contact persisted:      ${contactPersisted ? 'PASS' : 'FAIL'} (both probes had contactLines)`);
console.log(`units fighting:         ${battleHappened ? 'INFO' : 'WARN'} (no hp sampled)`);
console.log(`errors:                 ${errors.length === 0 ? 'NONE' : errors.slice(0, 5).join(' | ')}`);

if (!liquidLive || !forcesApplied || !visuallyDeformed || !contactActive || !contactPersisted || !battleHappened || !frontGapValid) {
    console.error('VERIFY FAILED — see probes above');
    process.exit(1);
}
console.log('VERIFY PASSED — screenshots in', OUT);
