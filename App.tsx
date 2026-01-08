
import React, { useState, useEffect } from 'react';
import { MainMenu } from './components/MainMenu';
import { PhaserGame } from './components/PhaserGame';
import { GameUI } from './components/GameUI';
import { FactionType, GameStats, BuildingType, MapMode, MapSize } from './types';
import { EVENTS, INITIAL_RESOURCES } from './constants';
import Phaser from 'phaser';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing'>('menu');
  const [faction, setFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [gameInstance, setGameInstance] = useState<Phaser.Game | null>(null);
  
  const [stats, setStats] = useState<GameStats>({
    population: 0,
    maxPopulation: 10,
    happiness: 100,
    happinessChange: 0,
    resources: INITIAL_RESOURCES,
    rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
    taxRate: 0,
    mapMode: MapMode.FIXED
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType | null>(null);

  const handleStart = (selectedFaction: FactionType, mode: MapMode, size: MapSize, fow: boolean) => {
    setFaction(selectedFaction);
    setMapMode(mode);
    setMapSize(size);
    setFowEnabled(fow);
    setGameState('playing');
  };

  const handleQuit = () => {
    if (gameInstance) {
        gameInstance.destroy(true);
        setGameInstance(null);
    }
    setGameState('menu');
    setStats({
        population: 0,
        maxPopulation: 10,
        happiness: 100,
        happinessChange: 0,
        resources: INITIAL_RESOURCES,
        rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
        taxRate: 0,
        mapMode: MapMode.FIXED
    });
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
    
    const taxHandler = (e: Event) => {
        const customEvent = e as CustomEvent;
        gameInstance.events.emit(EVENTS.SET_TAX_RATE, customEvent.detail);
    };
    const centerCameraHandler = () => {
        gameInstance.events.emit(EVENTS.CENTER_CAMERA);
    };
    const speedHandler = (e: Event) => {
        const customEvent = e as CustomEvent;
        gameInstance.events.emit(EVENTS.SET_GAME_SPEED, customEvent.detail);
    };

    window.addEventListener('set-tax-rate-ui', taxHandler);
    window.addEventListener('center-camera-ui', centerCameraHandler);
    window.addEventListener('set-game-speed-ui', speedHandler);

    return () => {
        if (gameInstance) {
            gameInstance.events.off(EVENTS.UPDATE_STATS, updateHandler);
            gameInstance.events.off(EVENTS.SELECTION_CHANGED, selectionHandler);
            gameInstance.events.off(EVENTS.BUILDING_SELECTED, buildingSelectionHandler);
        }
        window.removeEventListener('set-tax-rate-ui', taxHandler);
        window.removeEventListener('center-camera-ui', centerCameraHandler);
        window.removeEventListener('set-game-speed-ui', speedHandler);
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
          <PhaserGame 
            faction={faction} 
            mapMode={mapMode} 
            mapSize={mapSize}
            fowEnabled={fowEnabled}
            onGameReady={setGameInstance} 
          />
          <GameUI 
            stats={stats} 
            onBuild={handleBuild} 
            onSpawnUnit={handleSpawnSoldier}
            onToggleDemolish={handleToggleDemolish}
            onRegrowForest={handleRegrowForest}
            onQuit={handleQuit}
            selectedCount={selectedCount}
            selectedBuildingType={selectedBuildingType}
          />
        </>
      )}
    </div>
  );
};

export default App;
