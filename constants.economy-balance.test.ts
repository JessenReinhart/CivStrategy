import { describe, expect, it } from 'vitest';
import { BUILDINGS, INITIAL_RESOURCES } from './constants';
import { BuildingType } from './types';

describe('early wood economy balance', () => {
  it('keeps the lumber camp cheap enough to bootstrap wood production', () => {
    const lumberCost = BUILDINGS[BuildingType.LUMBER_CAMP].cost.wood;
    const houseCost = BUILDINGS[BuildingType.HOUSE].cost.wood;

    // The lumber camp enables the wood economy, so it must be cheap enough to
    // place immediately instead of consuming the resource it is meant to unlock.
    expect(lumberCost).toBe(25);
    expect(lumberCost).toBeLessThanOrEqual(houseCost / 2);
    expect(lumberCost).toBeLessThanOrEqual(INITIAL_RESOURCES.wood * 0.1);
  });
});
