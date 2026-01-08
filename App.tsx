
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
    happinessChange: 0,
    resources: INITIAL_RESOURCES,
    rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
    taxRate: 0
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType | null>(null);

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

    const buildingSelectionHandler = (type: BuildingType | null) => {
        setSelectedBuildingType(type);
    };

    gameInstance.events.on(EVENTS.UPDATE_STATS, updateHandler);
    gameInstance.events.on(EVENTS.SELECTION_CHANGED, selectionHandler);
    gameInstance.events.on(EVENTS.BUILDING_SELECTED, buildingSelectionHandler);
    
    // Setup UI event listener
    const taxHandler = (e: Event) => {
        const customEvent = e as CustomEvent;
        gameInstance.events.emit(EVENTS.SET_TAX_RATE, customEvent.detail);
    };
    window.addEventListener('set-tax-rate-ui', taxHandler);

    return () => {
        gameInstance.events.off(EVENTS.UPDATE_STATS, updateHandler);
        gameInstance.events.off(EVENTS.SELECTION_CHANGED, selectionHandler);
        gameInstance.events.off(EVENTS.BUILDING_SELECTED, buildingSelectionHandler);
        window.removeEventListener('set-tax-rate-ui', taxHandler);
    };
  }, [gameInstance]);

  const handleBuild = (type: BuildingType) => {
    gameInstance?.events.emit('request-build', type);
  };

  const handleSpawnSoldier = () => {
    gameInstance?.events.emit('request-soldier-spawn');
  };
  
  const handleRegrowForest = () => {
    gameInstance?.events.emit(EVENTS.REGROW_FOREST);
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
            onRegrowForest={handleRegrowForest}
            selectedCount={selectedCount}
            selectedBuildingType={selectedBuildingType}
          />
        </>
      )}
    </div>
  );
};

export default App;
