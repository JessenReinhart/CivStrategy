export type MusicMode = 'idle' | 'battle';

export function isPlayerEnemyEngagement(attackerOwner: unknown, targetOwner: unknown): boolean {
  return (attackerOwner === 0 && targetOwner === 1)
    || (attackerOwner === 1 && targetOwner === 0);
}

/**
 * Keeps battle music active briefly after the last observed attack so short
 * target swaps and formation movement do not cause rapid soundtrack flicker.
 */
export class MusicStateController {
  private battleHoldUntilMs = 0;

  constructor(private readonly battleReleaseDelayMs = 8_000) {}

  resolve(nowMs: number, combatActive: boolean): MusicMode {
    if (combatActive) {
      this.battleHoldUntilMs = Math.max(
        this.battleHoldUntilMs,
        nowMs + this.battleReleaseDelayMs,
      );
      return 'battle';
    }

    return nowMs < this.battleHoldUntilMs ? 'battle' : 'idle';
  }

  reset(): void {
    this.battleHoldUntilMs = 0;
  }
}
