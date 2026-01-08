import React, { useState, useEffect } from 'react';
import { MainMenu } from './components/MainMenu';
import { PhaserGame } from './components/PhaserGame';
import { GameUI } from './components/GameUI';
import { FactionType, GameStats, BuildingType } from './types';
import { EVENTS, INITIAL_RESOURCES } from './constants';
import Phaser from 'phaser';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing'>('menu');
  const [faction, setFaction] = useState<FactionType>(FactionType.ROMANS);
  const [gameInstance, setGameInstance] = useState<Phaser.Game | null>(null);
  
  // React State reflecting Phaser State
  const [stats, setStats] = useState<GameStats>({
    population: 0,
    maxPopulation: 10,
    happiness: 100,
    resources: INITIAL_RESOURCES
  });
  const [selectedCount, setSelectedCount] = useState(0);

  const handleStart = (selectedFaction: FactionType) => {
    setFaction(selectedFaction);
    setGameState('playing');
  };

  useEffect(() => {
    if (!gameInstance) return;

    const updateHandler = (newStats: GameStats) => {
        setStats(newStats);
    };

    const selectionHandler = (count: number) => {
        setSelectedCount(count);
    };

    gameInstance.events.on(EVENTS.UPDATE_STATS, updateHandler);
    gameInstance.events.on(EVENTS.SELECTION_CHANGED, selectionHandler);

    return () => {
        gameInstance.events.off(EVENTS.UPDATE_STATS, updateHandler);
        gameInstance.events.off(EVENTS.SELECTION_CHANGED, selectionHandler);
    };
  }, [gameInstance]);

  const handleBuild = (type: BuildingType) => {
    gameInstance?.events.emit('request-build', type);
  };

  const handleSpawnSoldier = () => {
    gameInstance?.events.emit('request-soldier-spawn');
  };

  const handleToggleDemolish = (isActive: boolean) => {
    gameInstance?.events.emit(EVENTS.TOGGLE_DEMOLISH, isActive);
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white relative select-none">
      {gameState === 'menu' && <MainMenu onStart={handleStart} />}
      
      {gameState === 'playing' && (
        <>
          <PhaserGame faction={faction} onGameReady={setGameInstance} />
          <GameUI 
            stats={stats} 
            onBuild={handleBuild} 
            onSpawnUnit={handleSpawnSoldier}
            onToggleDemolish={handleToggleDemolish}
            selectedCount={selectedCount}
          />
        </>
      )}
    </div>
  );
};

export default App;