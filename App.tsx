import React, { useState, useEffect } from 'react';
import { MainMenu } from './components/MainMenu';
import { PhaserGame } from './components/PhaserGame';
import { GameUI } from './components/GameUI';
import { LoadingScreen } from './components/LoadingScreen';
import { StressTestOverlay } from './components/StressTestOverlay';
import { FactionType, GameStats, BuildingType, MapMode, MapSize, MapPreset, UnitType, FormationType, UnitStance, Age, Season, GameResult, VictoryType } from './types';
import { EVENTS, INITIAL_RESOURCES } from './constants';
import Phaser from 'phaser';

interface StressTestConfig {
  unitCount: number;
  enableEnemies?: boolean;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'stress-test'>('menu');
  const [isGameLoading, setIsGameLoading] = useState<boolean>(true);
  const [loadProgress, setLoadProgress] = useState<number>(0);

  const [faction, setFaction] = useState<FactionType>(FactionType.ROMANS);
  const [mapMode, setMapMode] = useState<MapMode>(MapMode.FIXED);
  const [mapSize, setMapSize] = useState<MapSize>(MapSize.MEDIUM);
  const [fowEnabled, setFowEnabled] = useState<boolean>(true);
  const [peacefulMode, setPeacefulMode] = useState<boolean>(false);
  const [treatyLength, setTreatyLength] = useState<number>(10);
  const [aiDisabled, setAiDisabled] = useState<boolean>(false);
  const [mapSeed, setMapSeed] = useState<number>(0);
  const [mapPreset, setMapPreset] = useState<MapPreset>(MapPreset.STANDARD);

  const [gameInstance, setGameInstance] = useState<Phaser.Game | null>(null);
  const [stressTestConfig, setStressTestConfig] = useState<StressTestConfig | null>(null);

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
    treatyTimeRemaining: 0,
    bloomIntensity: 1.0,
    currentFormation: FormationType.BOX,
  currentStance: UnitStance.AGGRESSIVE,
  currentAge: Age.VILLAGE,
  ageProgress: 0,
  nextAge: null,
  currentSeason: Season.SUMMER,
  notifications: [],
  activeResearch: null,
  completedTechs: [],
  gameResult: GameResult.PLAYING,
});
const [selectedCount, setSelectedCount] = useState(0);
  const [selectedCounts, setSelectedCounts] = useState<Record<string, number>>({});
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType | null>(null);
  const handleStart = (selectedFaction: FactionType, mode: MapMode, size: MapSize, fow: boolean, peaceful: boolean, treaty: number, disableAI: boolean, seed: number = 0, preset: MapPreset = MapPreset.STANDARD) => {
    setFaction(selectedFaction);
    setMapMode(mode);
    setMapSize(size);
    setFowEnabled(fow);
    setPeacefulMode(peaceful);
    setTreatyLength(treaty);
    setAiDisabled(disableAI);
    setMapSeed(seed);
    setMapPreset(preset);
    setStressTestConfig(null);
    setIsGameLoading(true);
    setLoadProgress(0);
    setGameState('playing');
  };

  const handleStressTestStart = (config: StressTestConfig) => {
    setFaction(FactionType.ROMANS);
    setMapMode(MapMode.FIXED);
    setMapSize(MapSize.LARGE);
    setFowEnabled(false);
    setPeacefulMode(!config.enableEnemies);
    setTreatyLength(0);
    setAiDisabled(false);
    setStressTestConfig(config);
    setIsGameLoading(true);
    setLoadProgress(0);
    setGameState('stress-test');
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
      treatyTimeRemaining: 0,
      bloomIntensity: 1.0,
      currentFormation: FormationType.BOX,
    currentStance: UnitStance.AGGRESSIVE,
      currentAge: Age.VILLAGE,
      ageProgress: 0,
      nextAge: null,
      currentSeason: Season.SUMMER,
      notifications: [],
      activeResearch: null,
      completedTechs: [],
      selectedBuildingInfo: null,
      gameResult: GameResult.PLAYING,
      dominanceProgress: 0,
      playerTerritoryPercent: 0,
      victoryType: VictoryType.CONQUEST,
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
    const stressTestHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      handleStressTestStart(customEvent.detail);
    };

    window.addEventListener('game-load-progress', progressHandler);
    window.addEventListener('game-load-complete', completeHandler);
    window.addEventListener('stressTestStart', stressTestHandler);

    return () => {
      window.removeEventListener('game-load-progress', progressHandler);
      window.removeEventListener('game-load-complete', completeHandler);
      window.removeEventListener('stressTestStart', stressTestHandler);
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

    const ageAdvancedHandler = (age: Age) => {
      setStats(prev => ({ ...prev, currentAge: age, ageProgress: 0, nextAge: null }));
    };

    gameInstance.events.on(EVENTS.UPDATE_STATS, updateHandler);
    gameInstance.events.on(EVENTS.SELECTION_CHANGED, selectionHandler);
    gameInstance.events.on(EVENTS.BUILDING_SELECTED, buildingSelectionHandler);
    gameInstance.events.on(EVENTS.AGE_ADVANCED, ageAdvancedHandler);

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
    const bloomHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      gameInstance.events.emit(EVENTS.SET_BLOOM_INTENSITY, customEvent.detail);
    };
    const formationHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      gameInstance.events.emit('request-set-formation', customEvent.detail);
    };
    const stanceHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      gameInstance.events.emit('request-set-stance', customEvent.detail);
    };

    const researchHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      gameInstance.events.emit(EVENTS.START_RESEARCH, customEvent.detail);
    };

    const selectionUIHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      gameInstance.events.emit(EVENTS.SELECTION_CHANGED, customEvent.detail);
    };

    const saveGameHandler = () => {
      gameInstance.events.emit('save-game');
    };
    const loadGameHandler = () => {
      gameInstance.events.emit('load-game');
    };

    window.addEventListener('set-tax-rate-ui', taxHandler);
    window.addEventListener('center-camera-ui', centerCameraHandler);
    window.addEventListener('set-game-speed-ui', speedHandler);
    window.addEventListener('set-bloom-intensity-ui', bloomHandler);
    window.addEventListener('request-set-formation-ui', formationHandler);
    window.addEventListener('request-set-stance-ui', stanceHandler);
    window.addEventListener('request-start-research', researchHandler);
    window.addEventListener(EVENTS.SELECTION_CHANGED, selectionUIHandler);
    window.addEventListener('save-game', saveGameHandler);
    window.addEventListener('load-game', loadGameHandler);

    return () => {
      if (gameInstance) {
        gameInstance.events.off(EVENTS.UPDATE_STATS, updateHandler);
        gameInstance.events.off(EVENTS.SELECTION_CHANGED, selectionHandler);
        gameInstance.events.off(EVENTS.BUILDING_SELECTED, buildingSelectionHandler);
        gameInstance.events.off(EVENTS.AGE_ADVANCED, ageAdvancedHandler);
      }
      window.removeEventListener('set-tax-rate-ui', taxHandler);
      window.removeEventListener('center-camera-ui', centerCameraHandler);
      window.removeEventListener('set-game-speed-ui', speedHandler);
      window.removeEventListener('set-game-speed-ui', speedHandler);
      window.removeEventListener('set-bloom-intensity-ui', bloomHandler);
      window.removeEventListener(EVENTS.SELECTION_CHANGED, selectionUIHandler);
      window.removeEventListener('save-game', saveGameHandler);
      window.removeEventListener('load-game', loadGameHandler);
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

  const handleAdvanceAge = () => {
    gameInstance?.events.emit(EVENTS.ADVANCE_AGE);
  };

  const handleReleaseGarrison = () => {
    gameInstance?.events.emit('release-garrison');
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white relative select-none">
      {gameState === 'menu' && <MainMenu onStart={handleStart} />}

      {(gameState === 'playing' || gameState === 'stress-test') && (
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
            stressTestConfig={stressTestConfig}
            mapSeed={mapSeed}
            mapPreset={mapPreset}
            onGameReady={setGameInstance}
          />
          {!isGameLoading && gameState === 'playing' && (
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
              onAdvanceAge={handleAdvanceAge}
              onReleaseGarrison={handleReleaseGarrison}
              currentAge={stats.currentAge}
              ageProgress={stats.ageProgress}
              nextAge={stats.nextAge}
            />
          )}
          {!isGameLoading && gameState === 'stress-test' && (
            <StressTestOverlay
              unitCount={stressTestConfig?.unitCount || 0}
              onQuit={handleQuit}
              gameInstance={gameInstance}
            />
          )}
        </>
      )}
    </div>
  );
};

export default App;