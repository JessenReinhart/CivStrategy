import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { MainScene } from '../game/MainScene';
import { FactionType } from '../types';

interface PhaserGameProps {
  faction: FactionType;
  onGameReady: (game: Phaser.Game) => void;
}

export const PhaserGame: React.FC<PhaserGameProps> = ({ faction, onGameReady }) => {
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
          debug: false, // Set to true to see hitboxes
        }
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [MainScene]
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;
    
    // Pass initial data to scene once ready
    game.events.once('ready', () => {
        game.scene.start('MainScene', { faction });
        onGameReady(game);
    });

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [faction, onGameReady]);

  return (
    <div id="game-container" className="absolute inset-0 z-0" />
  );
};
