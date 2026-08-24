export interface PhaserGameProbeTarget<TGame> {
  __civStrategyGame?: TGame;
}

export const attachPhaserGameProbe = <TGame, TTarget extends object>(
  target: TTarget,
  game: TGame,
) => {
  const probeTarget = target as TTarget & PhaserGameProbeTarget<TGame>;
  probeTarget.__civStrategyGame = game;

  return () => {
    if (probeTarget.__civStrategyGame === game) {
      delete probeTarget.__civStrategyGame;
    }
  };
};
