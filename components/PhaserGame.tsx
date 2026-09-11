
import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { PlayerMainScene } from '../game/PlayerMainScene';
import { FactionType, MapMode, MapSize, MapPreset } from '../types';
import { EVENTS } from '../constants';
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
  stressTestConfig: { unitCount?: number; enableEnemies?: boolean; city?: boolean; density?: 'high' | 'medium' | 'low' } | null;
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

    // Speed shortcuts belong to the running-game bridge rather than HUD mount timing.
    // Capture them before HUD-level key listeners so exactly one owner advances the
    // authoritative simulation speed for each physical key press.
    const speedOptions = [0.5, 0.75, 1, 2, 3] as const;
    const handleSpeedKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

      const direction = event.key === '=' || event.key === '+'
        ? 1
        : event.key === '-' || event.key === '_'
          ? -1
          : 0;
      if (direction === 0) return;

      const scene = game.scene.getScene('MainScene') as PlayerMainScene | undefined;
      if (!scene || !scene.scene.isActive() || typeof scene.gameSpeed !== 'number') return;

      const currentIndex = speedOptions.indexOf(scene.gameSpeed as typeof speedOptions[number]);
      if (currentIndex < 0) return;

      const nextIndex = Math.max(0, Math.min(speedOptions.length - 1, currentIndex + direction));
      const nextSpeed = speedOptions[nextIndex];
      if (nextSpeed === scene.gameSpeed) return;

      event.preventDefault();
      // Keep capture-phase diagnostics observable, but prevent the event from reaching
      // the legacy HUD bubble listener and double-stepping 1x -> 2x -> 3x.
      event.stopPropagation();
      game.events.emit(EVENTS.SET_GAME_SPEED, nextSpeed);
      scene.economySystem?.updateStats();
    };
    window.addEventListener('keydown', handleSpeedKeyDown, true);

    // Seed the explicit React stress config before MainScene.init() runs. The
    // scene's legacy development URL fallback only executes when this is null.
    const mainScene = new PlayerMainScene();
    mainScene.stressTestConfig = stressTestConfig;
    game.scene.add('MainScene', mainScene);

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
      window.removeEventListener('keydown', handleSpeedKeyDown, true);
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
