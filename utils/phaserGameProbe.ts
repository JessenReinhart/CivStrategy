export interface PhaserGameProbeTarget<TGame> {
  __civStrategyGame?: TGame;
}

export const attachPhaserGameProbe = <TGame>(
  target: PhaserGameProbeTarget<TGame>,
  game: TGame,
) => {
  target.__civStrategyGame = game;

  return () => {
    if (target.__civStrategyGame === game) {
      delete target.__civStrategyGame;
    }
  };
};
