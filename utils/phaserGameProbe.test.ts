import { describe, expect, it } from 'vitest';
import { attachPhaserGameProbe, PhaserGameProbeTarget } from './phaserGameProbe';

describe('attachPhaserGameProbe', () => {
  it('clears the probe when cleanup still owns the current game', () => {
    const target: PhaserGameProbeTarget<object> = {};
    const game = {};

    const cleanup = attachPhaserGameProbe(target, game);
    expect(target.__civStrategyGame).toBe(game);

    cleanup();

    expect(target.__civStrategyGame).toBeUndefined();
  });

  it('does not clear a newer replacement game', () => {
    const target: PhaserGameProbeTarget<object> = {};
    const game = {};
    const replacement = {};

    const cleanup = attachPhaserGameProbe(target, game);
    target.__civStrategyGame = replacement;

    cleanup();

    expect(target.__civStrategyGame).toBe(replacement);
  });
});
