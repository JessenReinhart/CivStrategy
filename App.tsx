import React, { useState, useEffect, useRef } from 'react';
import { MainMenu } from './components/MainMenu';
import { PhaserGame } from './components/PhaserGame';
import { GameUI } from './components/GameUI';
import { GameTimeIndicator } from './components/GameTimeIndicator';
import { LoadingScreen } from './components/LoadingScreen';
import { StressTestOverlay } from './components/StressTestOverlay';
import { FactionType, GameStats, BuildingType, MapMode, MapSize, MapPreset, UnitType, FormationType, UnitStance, Age, Season, GameResult, VictoryType } from './types';
import { EVENTS, INITIAL_RESOURCES } from './constants';
import { addResearchWindowListener } from './utils/researchWindowListener';
import { createLoadingCompletionDelay } from './utils/loadingCompletionDelay';
import { scheduleStressUrlBootstrap } from './utils/stressUrlBootstrap';
import type { StressUrlConfig } from './utils/stressUrlBootstrap';
import {
  GAME_LOADING_EVENTS,
  INITIAL_GAME_LOAD_PROGRESS,
  normalizeGameLoadProgress,
} from './utils/gameLoading';
import Phaser from 'phaser';

type StressTestConfig = StressUrlConfig;

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'stress-test'>('menu');
  const [isGameLoading, setIsGameLoading] = useState<boolean>(true);
  const [loadStatus, setLoadStatus] = useState(INITIAL_GAME_LOAD_PROGRESS);
  const [gameUiSession, setGameUiSession] = useState(0);
  const loadingCompletionDelayRef = useRef(
    createLoadingCompletionDelay(() => setIsGameLoading(false), 500),
  );

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
    loadingCompletionDelayRef.current.cancel();
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
    setLoadStatus(INITIAL_GAME_LOAD_PROGRESS);
    setGameState('playing');
  };

  const handleStressTestStart = (config: StressTestConfig) => {
    loadingCompletionDelayRef.current.cancel();
    setFaction(FactionType.ROMANS);
    setMapMode(MapMode.FIXED);
    setMapSize(MapSize.LARGE);
    setFowEnabled(false);
    setPeacefulMode(!config.enableEnemies);
    setTreatyLength(0);
    setAiDisabled(false);
    setStressTestConfig(config);
    setIsGameLoading(true);
    setLoadStatus(INITIAL_GAME_LOAD_PROGRESS);
    setGameState('stress-test');
  };

  const handleQuit = () => {
    loadingCompletionDelayRef.current.cancel();
    setGameInstance(null);
    setGameState('menu');
    setIsGameLoading(true);
    setLoadStatus(INITIAL_GAME_LOAD_PROGRESS);
    setSelectedCount(0);
    setSelectedCounts({});
    setSelectedBuildingType(null);
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
    const loadingCompletionDelay = loadingCompletionDelayRef.current;
    const progressHandler = (e: Event) => {
      const next = normalizeGameLoadProgress((e as CustomEvent).detail);
      setLoadStatus((previous) => (
        next.progress < previous.progress
          ? { ...next, progress: previous.progress }
          : next
      ));
    };
    const completeHandler = () => {
      // Keep the final state visible briefly so the 100% transition reads cleanly.
      loadingCompletionDelay.schedule();
    };
    const stressTestHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      handleStressTestStart(customEvent.detail);
    };

    window.addEventListener(GAME_LOADING_EVENTS.PROGRESS, progressHandler);
    window.addEventListener(GAME_LOADING_EVENTS.COMPLETE, completeHandler);
    window.addEventListener('stressTestStart', stressTestHandler);

    // Defer URL-driven stress mode until after this effect has installed loading listeners.
    const cancelStressUrlBootstrap = scheduleStressUrlBootstrap(
      window.location.search,
      handleStressTestStart,
    );

    return () => {
      cancelStressUrlBootstrap();
      loadingCompletionDelay.cancel();
      window.removeEventListener(GAME_LOADING_EVENTS.PROGRESS, progressHandler);
      window.removeEventListener(GAME_LOADING_EVENTS.COMPLETE, completeHandler);
      window.removeEventListener('stressTestStart', stressTestHandler);
    };
  }, []);

  useEffect(() => {
    if (!gameInstance) return;

    const updateHandler = (newStats: GameStats) => {
      setStats(newStats);
    };

    const selectionHandler = (data: number | { count: number; counts: Record<string, number> }) => {
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

    const clearSelectionHandler = () => {
      gameInstance.events.emit('clear-selection');
    };

    const saveGameHandler = () => {
      gameInstance.events.emit('save-game');
    };
    const loadGameHandler = () => {
      gameInstance.events.emit('load-game');
      // Loading replaces the playable world state; discard transient HUD popovers/menu state too.
      setGameUiSession((session) => session + 1);
    };

    window.addEventListener('set-tax-rate-ui', taxHandler);
    window.addEventListener('center-camera-ui', centerCameraHandler);
    window.addEventListener('set-game-speed-ui', speedHandler);
    window.addEventListener('set-bloom-intensity-ui', bloomHandler);
    window.addEventListener('request-set-formation-ui', formationHandler);
    window.addEventListener('request-set-stance-ui', stanceHandler);
    const removeResearchListener = addResearchWindowListener(window, researchHandler);
    window.addEventListener('clear-selection', clearSelectionHandler);
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
      window.removeEventListener('set-bloom-intensity-ui', bloomHandler);
      window.removeEventListener('request-set-formation-ui', formationHandler);
      window.removeEventListener('request-set-stance-ui', stanceHandler);
      removeResearchListener();
      window.removeEventListener('clear-selection', clearSelectionHandler);
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

  const handleFilterSelection = (type: UnitType) => {
    gameInstance?.events.emit('filter-selection', type);
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
          {isGameLoading && <LoadingScreen status={loadStatus} />}
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
            <>
              <GameUI
                key={gameUiSession}
                stats={stats}
                onBuild={handleBuild}
                onSpawnUnit={handleSpawnUnit}
                onToggleDemolish={handleToggleDemolish}
                onRegrowForest={handleRegrowForest}
                onQuit={handleQuit}
                selectedCount={selectedCount}
                selectedCounts={selectedCounts}
                selectedBuildingType={selectedBuildingType}
                onFilterSelection={handleFilterSelection}
                onDemolishSelected={() => gameInstance?.events.emit(EVENTS.DEMOLISH_SELECTED)}
                onAdvanceAge={handleAdvanceAge}
                onReleaseGarrison={handleReleaseGarrison}
                currentAge={stats.currentAge}
                ageProgress={stats.ageProgress}
                nextAge={stats.nextAge}
              />
              <GameTimeIndicator gameInstance={gameInstance} />
            </>
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