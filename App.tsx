import React, { useState, useEffect } from 'react';
import { MainMenu } from './components/MainMenu';
import { PhaserGame } from './components/PhaserGame';
import { GameUI } from './components/GameUI';
import { LoadingScreen } from './components/LoadingScreen';
import { FactionType, GameStats, BuildingType, MapMode, MapSize, UnitType } from './types';
import { EVENTS, INITIAL_RESOURCES } from './constants';
import Phaser from 'phaser';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing'>('menu');
  const [isGameLoading, setIsGameLoading] = useState<boolean>(true);
  const [loadProgress, setLoadProgress] = useState<number>(0);

  const [faction, setFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);

  const [gameInstance, setGameInstance] = useState<Phaser.Game | null>(null);

  const [stats, setStats] = useState<GameStats>({
    population: 0,
    maxPopulation: 10,
    happiness: 100,
    happinessChange: 0,
    resources: INITIAL_RESOURCES,
    rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
    taxRate: 0,
    mapMode: MapMode.FIXED,
    peacefulMode: false,
    treatyTimeRemaining: 0
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedCounts, setSelectedCounts] = useState<Record<string, number>>({});
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType | null>(null);

  const handleStart = (selectedFaction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, disableAI: boolean) => {
    setFaction(selectedFaction);
    setMapMode(mode);
    setMapSize(size);
    setFowEnabled(fow);
    setPeacefulMode(peaceful);
    setTreatyLength(treaty);
    setAiDisabled(disableAI);
    setIsGameLoading(true);
    setLoadProgress(0);
    setGameState('playing');
  };

  const handleQuit = () => {
    if (gameInstance) {
      gameInstance.destroy(true);
      setGameInstance(null);
    }
    setGameState('menu');
    setIsGameLoading(true);
    setStats({
      population: 0,
      maxPopulation: 10,
      happiness: 100,
      happinessChange: 0,
      resources: INITIAL_RESOURCES,
      rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
      taxRate: 0,
      mapMode: MapMode.FIXED,
      peacefulMode: false,
      treatyTimeRemaining: 0
    });
  };

  useEffect(() => {
    const progressHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      setLoadProgress(customEvent.detail);
    };
    const completeHandler = () => {
      // Add a slight artificial delay for smooth transition
      setTimeout(() => setIsGameLoading(false), 500);
    };

    window.addEventListener('game-load-progress', progressHandler);
    window.addEventListener('game-load-complete', completeHandler);

    return () => {
      window.removeEventListener('game-load-progress', progressHandler);
      window.removeEventListener('game-load-complete', completeHandler);
    };
  }, []);

  useEffect(() => {
    if (!gameInstance) return;

    const updateHandler = (newStats: GameStats) => {
      setStats(newStats);
    };

    const selectionHandler = (data: number | { count: number; counts: Record<string, number> }) => {
      // Handle both minimal (count only) and rich (object) payloads
      if (typeof data === 'number') {
        setSelectedCount(data);
        setSelectedCounts({});
      } else {
        setSelectedCount(data.count);
        setSelectedCounts(data.counts || {});
      }
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

  const handleSpawnUnit = (type: UnitType) => {
    gameInstance?.events.emit('request-unit-spawn', type);
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
          {isGameLoading && <LoadingScreen progress={loadProgress} />}
          <PhaserGame
            faction={faction}
            mapMode={mapMode}
            mapSize={mapSize}
            fowEnabled={fowEnabled}
            peacefulMode={peacefulMode}
            treatyLength={treatyLength}
            aiDisabled={aiDisabled}
            onGameReady={setGameInstance}
          />
          {!isGameLoading && (
            <GameUI
              stats={stats}
              onBuild={handleBuild}
              onSpawnUnit={handleSpawnUnit}
              onToggleDemolish={handleToggleDemolish}
              onRegrowForest={handleRegrowForest}
              onQuit={handleQuit}
              selectedCount={selectedCount}
              selectedCounts={selectedCounts}
              selectedBuildingType={selectedBuildingType}
              onDemolishSelected={() => gameInstance?.events.emit(EVENTS.DEMOLISH_SELECTED)}
              onFilterSelection={(type: UnitType) => gameInstance?.events.emit('filter-selection', type)}
            />
          )}
        </>
      )}
    </div>
  );
};

export default App;