import { readFile } from 'node:fs/promises';

const path = 'artifacts/combat-save-continuity-telemetry.json';
const telemetry = JSON.parse(await readFile(path, 'utf8'));

if (telemetry.phase !== 'passed') {
  throw new Error(`Combat save continuity journey did not finish successfully (phase: ${telemetry.phase ?? 'unknown'}).`);
}

if (!Number.isFinite(telemetry.beforeSave?.hp) || !Number.isFinite(telemetry.restored?.hp)) {
  throw new Error('Combat survivor HP telemetry is missing or invalid.');
}

if (telemetry.beforeSave.hp !== telemetry.restored.hp) {
  throw new Error(`Surviving unit HP changed across save/load (${telemetry.beforeSave.hp} -> ${telemetry.restored.hp}).`);
}

if (!telemetry.afterContinue?.selected) {
  throw new Error('Restored surviving unit was not selected through the real post-load canvas input path.');
}

if (!Number.isFinite(telemetry.afterContinue?.movedDistance) || telemetry.afterContinue.movedDistance <= 5) {
  throw new Error('Restored surviving unit did not complete the expected post-load movement evidence.');
}

console.log(`Combat survivor continuity verified: HP ${telemetry.restored.hp}, post-load move ${telemetry.afterContinue.movedDistance.toFixed(2)}px.`);
