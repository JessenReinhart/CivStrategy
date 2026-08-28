import { readFile } from 'node:fs/promises';

const path = 'artifacts/combat-save-continuity-telemetry.json';
const telemetry = JSON.parse(await readFile(path, 'utf8'));

if (telemetry.phase !== 'complete') {
  throw new Error(`Combat save continuity journey did not finish successfully (phase: ${telemetry.phase ?? 'unknown'}).`);
}

if (telemetry.afterTraining?.type !== 'Pikesman') {
  throw new Error(`Expected the Barracks-trained survivor to be a Pikesman (got: ${telemetry.afterTraining?.type ?? 'missing'}).`);
}

if (!Number.isFinite(telemetry.beforeSave?.hp) || !Number.isFinite(telemetry.restored?.hp)) {
  throw new Error('Combat survivor HP telemetry is missing or invalid.');
}

if (telemetry.beforeSave.hp !== telemetry.restored.hp) {
  throw new Error(`Surviving unit HP changed across save/load (${telemetry.beforeSave.hp} -> ${telemetry.restored.hp}).`);
}

if (telemetry.beforeSave?.population !== telemetry.restored?.population) {
  throw new Error(`Population changed across combat save/load (${telemetry.beforeSave?.population} -> ${telemetry.restored?.population}).`);
}

if (telemetry.beforeSave?.maxPopulation !== telemetry.restored?.maxPopulation) {
  throw new Error(`Housing capacity changed across combat save/load (${telemetry.beforeSave?.maxPopulation} -> ${telemetry.restored?.maxPopulation}).`);
}

if (!Number.isFinite(telemetry.restored?.positionDelta) || telemetry.restored.positionDelta > 2) {
  throw new Error(`Trained survivor position continuity is invalid (delta: ${telemetry.restored?.positionDelta ?? 'missing'}).`);
}

if (!telemetry.afterContinue?.selected) {
  throw new Error('Restored surviving unit was not selected through the real post-load canvas input path.');
}

if (!Number.isFinite(telemetry.afterContinue?.movedDistance) || telemetry.afterContinue.movedDistance <= 5) {
  throw new Error('Restored surviving unit did not complete the expected post-load movement evidence.');
}

console.log(
  `Trained combat survivor continuity verified: Pikesman HP ${telemetry.restored.hp}, `
  + `population ${telemetry.restored.population}/${telemetry.restored.maxPopulation}, `
  + `post-load move ${telemetry.afterContinue.movedDistance.toFixed(2)}px.`,
);
