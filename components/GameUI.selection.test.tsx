import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameUI } from './GameUI';
import {
  Age,
  BuildingType,
  FormationType,
  GameResult,
  type GameStats,
  MapMode,
  Season,
  UnitStance,
} from '../types';

const baseStats: GameStats = {
  population: 8,
  maxPopulation: 20,
  happiness: 80,
  happinessChange: 0,
  resources: { wood: 500, food: 500, gold: 500 },
  rates: { wood: 0, food: 0, gold: 0, foodConsumption: 0 },
  taxRate: 0,
  gameSpeed: 1,
  mapMode: MapMode.FIXED,
  peacefulMode: false,
  treatyTimeRemaining: 0,
  bloomIntensity: 1,
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
};

const renderSelectedBuilding = (type: BuildingType, owner: number, gameSpeed = baseStats.gameSpeed) => renderToStaticMarkup(
  <GameUI
    stats={{ ...baseStats, gameSpeed, selectedBuildingOwner: owner }}
    onBuild={() => undefined}
    onSpawnUnit={() => undefined}
    onToggleDemolish={() => undefined}
    onRegrowForest={() => undefined}
    onQuit={() => undefined}
    selectedCount={0}
    selectedBuildingType={type}
    onDemolishSelected={() => undefined}
    currentAge={Age.VILLAGE}
    ageProgress={0}
    nextAge={null}
    onAdvanceAge={() => undefined}
    onReleaseGarrison={() => undefined}
  />,
);

describe('GameUI selected building command ownership', () => {
  it('keeps production and waypoint controls visible for a player Barracks', () => {
    const html = renderSelectedBuilding(BuildingType.BARRACKS, 0);

    expect(html).toContain('Pikesman');
    expect(html).toContain('Demolish');
    expect(html).toContain('Right Click map to set waypoint');
    expect(html).not.toContain('Enemy structure · inspection only');
  });

  it('keeps a hostile Barracks inspectable without exposing player commands', () => {
    const html = renderSelectedBuilding(BuildingType.BARRACKS, 1);

    expect(html).toContain('Barracks');
    expect(html).toContain('Enemy structure · inspection only');
    expect(html).not.toContain('Pikesman');
    expect(html).not.toContain('Demolish');
    expect(html).not.toContain('Right Click map to set waypoint');
  });

  it('does not expose other player-only building actions on hostile structures', () => {
    const hostileLumberCamp = renderSelectedBuilding(BuildingType.LUMBER_CAMP, 1);
    const hostileCastle = renderSelectedBuilding(BuildingType.CASTLE, 1);

    expect(hostileLumberCamp).not.toContain('Regrow');
    expect(hostileLumberCamp).not.toContain('Demolish');
    expect(hostileCastle).not.toContain('Release');
    expect(hostileCastle).not.toContain('Demolish');
    expect(hostileCastle).not.toContain('Right Click with units to garrison');
  });

  it('renders a restored authoritative simulation speed instead of an independent UI default', () => {
    const html = renderSelectedBuilding(BuildingType.BARRACKS, 0, 0.75);

    expect(html).toContain('Set speed 0.75×');
    expect(html).toContain('0.75x');
  });
});
