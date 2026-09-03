import { readFile } from 'node:fs/promises';

const path = 'artifacts/combat-save-continuity-telemetry.json';
const telemetry = JSON.parse(await readFile(path, 'utf8'));

if (telemetry.phase !== 'complete') {
  throw new Error(`Combat save continuity journey did not finish successfully (phase: ${telemetry.phase ?? 'unknown'}).`);
}

if (!telemetry.gather?.simulation?.assigned) {
  throw new Error('Canonical session did not preserve the real villager-to-Lumber-Camp assignment.');
}

if (!Number.isFinite(telemetry.gather?.simulation?.depositedWood) || telemetry.gather.simulation.depositedWood <= 0) {
  throw new Error(`Canonical session did not deposit gathered wood (delta: ${telemetry.gather?.simulation?.depositedWood ?? 'missing'}).`);
}

if (!Number.isFinite(telemetry.preparation?.maxPopulationBefore)
  || !Number.isFinite(telemetry.preparation?.maxPopulationAfterHousing)
  || telemetry.preparation.maxPopulationAfterHousing <= telemetry.preparation.maxPopulationBefore) {
  throw new Error(
    `Canonical session did not prove housing capacity progression `
    + `(${telemetry.preparation?.maxPopulationBefore ?? 'missing'} -> ${telemetry.preparation?.maxPopulationAfterHousing ?? 'missing'}).`,
  );
}

if (telemetry.afterTraining?.type !== 'Pikesman') {
  throw new Error(`Expected the Barracks-trained survivor to be a Pikesman (got: ${telemetry.afterTraining?.type ?? 'missing'}).`);
}

if (!Number.isFinite(telemetry.beforeTraining?.population)
  || telemetry.afterTraining?.population !== telemetry.beforeTraining.population + 1) {
  throw new Error(
    `Pikesman training did not consume one population slot `
    + `(${telemetry.beforeTraining?.population ?? 'missing'} -> ${telemetry.afterTraining?.population ?? 'missing'}).`,
  );
}

if (!Number.isFinite(telemetry.trainingSpend?.food) || telemetry.trainingSpend.food <= 0) {
  throw new Error(
    `Pikesman training did not produce a positive net food spend in the live economy `
    + `(delta: ${telemetry.trainingSpend?.food ?? 'missing'}).`,
  );
}

if (!Number.isFinite(telemetry.trainingSpend?.gold) || telemetry.trainingSpend.gold <= 0) {
  throw new Error(
    `Pikesman training did not produce a positive net gold spend in the live economy `
    + `(delta: ${telemetry.trainingSpend?.gold ?? 'missing'}).`,
  );
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

if (Array.isArray(telemetry.browserErrors) && telemetry.browserErrors.length > 0) {
  throw new Error(`Canonical browser session recorded errors: ${telemetry.browserErrors.join(' | ')}`);
}

console.log(
  `Canonical session verified: gathered ${telemetry.gather.simulation.depositedWood} wood, `
  + `housing ${telemetry.preparation.maxPopulationBefore}->${telemetry.preparation.maxPopulationAfterHousing}, `
  + `training spend food ${telemetry.trainingSpend.food}, gold ${telemetry.trainingSpend.gold}, `
  + `trained Pikesman HP ${telemetry.restored.hp}, `
  + `population ${telemetry.restored.population}/${telemetry.restored.maxPopulation}, `
  + `post-load move ${telemetry.afterContinue.movedDistance.toFixed(2)}px.`,
);
