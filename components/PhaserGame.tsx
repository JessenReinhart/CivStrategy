
import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { MainScene } from '../game/MainScene';
import { FactionType, MapMode, MapSize, MapPreset } from '../types';
import { attachPhaserGameProbe } from '../utils/phaserGameProbe';
import { attachPhaserReadyHandler } from '../utils/phaserReadyLifecycle';

interface PhaserGameProps {
  faction: FactionType;
  mapMode: MapMode;
  mapSize: MapSize;
  fowEnabled: boolean;
  peacefulMode: boolean;
  treatyLength: number; // minutes
  aiDisabled: boolean;
  stressTestConfig: { unitCount: number; enableEnemies?: boolean } | null;
  mapSeed: number;
  mapPreset: MapPreset;
  onGameReady: (game: Phaser.Game) => void;
}
export const PhaserGame: React.FC<PhaserGameProps> = ({ faction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled, stressTestConfig, mapSeed, mapPreset, onGameReady }) => {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: 'game-container',
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#000000',
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
        }
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      // IMPORTANT: Do not add MainScene to this array. 
      // We will add and start it manually to ensure data is passed correctly.
      scene: []
    };

    const game = new Phaser.Game(config);
    // DEV-ONLY-PROBE: PathCritic profiling hook. Keep it out of production builds.
    const removeGameProbe = import.meta.env.DEV
      ? attachPhaserGameProbe(window, game)
      : () => undefined;
    gameRef.current = game;

    // Manually add the scene class
    game.scene.add('MainScene', MainScene);

    // Start the scene with data immediately
    // We don't need to wait for 'ready' if we are manually managing the scene lifecycle here
    // but wrapping in a small timeout or ready check is safer for asset loading manager initialization
    const removeReadyHandler = attachPhaserReadyHandler(game.events, () => {
      // console.log("Phaser Ready. Starting MainScene with:", { faction, peacefulMode, treatyLength, aiDisabled });
      game.scene.start('MainScene', {
        faction,
        mapMode,
        mapSize,
        fowEnabled,
        peacefulMode,
        treatyLength, // minutes
        aiDisabled,
        stressTestConfig,
        mapSeed,
        mapPreset
      });
      onGameReady(game);
    });

    return () => {
      removeReadyHandler();
      removeGameProbe();
      game.destroy(true);
      gameRef.current = null;
    };
  }, [faction, mapMode, mapSize, fowEnabled, peacefulMode, treatyLength, aiDisabled, stressTestConfig, mapSeed, mapPreset, onGameReady]);

  return (
    <div id="game-container" className="absolute inset-0 z-0" />
  );
};