
import React, { useState, useEffect, useRef } from 'react';
import { GameStats, BuildingType, MapMode, UnitType, FormationType, UnitStance, Age, GameResult, VictoryType, TechId } from '../types';
import { BUILDINGS, AGE_CONFIGS, TECH_DEFS, UNIT_DAMAGE, UNIT_STATS, DOMINANCE_HOLD_TIME_MS, UNIT_ABILITIES, ABILITY_CONFIG } from '../constants';
import { HudTooltip } from './HudTooltip';
import {
    Pickaxe, Wheat, Coins, User, Smile,
    Home, Hammer, Tent, Sword, Trash2,
    Rabbit, Sprout,
    Target, LogOut, Handshake, Clock,
    Menu, FastForward, Flame, Flower,
    X, Shield, Crown, Church,
    Zap, Crosshair, BookOpen, Check, Plus, Minus, GitBranch, Save, Circle, Activity, Grid, Triangle, Hand
} from 'lucide-react';

interface GameUIProps {
    stats: GameStats;
    onBuild: (type: BuildingType) => void;
    onSpawnUnit: (type: UnitType) => void;
    onToggleDemolish: (isActive: boolean) => void;
    onRegrowForest: () => void;
    onQuit: () => void;
    selectedCount: number;
    selectedCounts?: Record<string, number>;
    selectedBuildingType: BuildingType | null;
    onDemolishSelected: () => void;
    onFilterSelection?: (type: UnitType) => void;
    currentAge: Age;
    ageProgress: number;
    nextAge: Age | null;
    onAdvanceAge: () => void;
    onReleaseGarrison?: () => void;
}

const getDamageTag = (type: UnitType): { label: string; color: string } | null => {
    const profile = UNIT_DAMAGE[type];
    if (!profile || Object.keys(profile).length === 0) return null;
    const primary = Object.entries(profile).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
    const [dmgType, value] = primary;
    const colors: Record<string, string> = {
        'Hack': 'bg-red-900/50 text-red-300 border-red-700/50',
        'Pierce': 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
        'Crush': 'bg-amber-900/50 text-amber-300 border-amber-700/50',
    };
    return { label: `${dmgType} ${value}`, color: colors[dmgType] || 'bg-stone-800 text-stone-400' };
};

/** Buildings grouped by HUD dock category, used to populate the pop-up build panel and tooltip counts. */
const CATEGORY_BUILDINGS: Record<'economy' | 'military' | 'civic', { type: BuildingType; icon: React.ReactNode }[]> = {
    economy: [
        { type: BuildingType.HOUSE, icon: <Home size={18} /> },
        { type: BuildingType.FARM, icon: <Wheat size={18} /> },
        { type: BuildingType.LUMBER_CAMP, icon: <Pickaxe size={18} /> },
        { type: BuildingType.HUNTERS_LODGE, icon: <Rabbit size={18} /> },
        { type: BuildingType.TOWN_CENTER, icon: <Tent size={18} /> },
        { type: BuildingType.MARKET, icon: <Coins size={18} /> },
    ],
    civic: [
        { type: BuildingType.BONFIRE, icon: <Flame size={18} /> },
        { type: BuildingType.SMALL_PARK, icon: <Flower size={18} /> },
        { type: BuildingType.CATHEDRAL, icon: <Church size={18} /> },
    ],
    military: [
        { type: BuildingType.BARRACKS, icon: <Hammer size={18} /> },
        { type: BuildingType.WALL, icon: <Shield size={18} /> },
        { type: BuildingType.CASTLE, icon: <Crown size={18} /> },
    ],
};

export const GameUI: React.FC<GameUIProps> = ({
    stats, onBuild, onSpawnUnit, onToggleDemolish, onRegrowForest, onQuit, selectedCount, selectedCounts, selectedBuildingType, onDemolishSelected, onFilterSelection,
    onAdvanceAge, onReleaseGarrison
}) => {
    const [activeCategory, setActiveCategory] = useState<'economy' | 'military' | 'civic' | null>(null);
    const [demolishActive, setDemolishActive] = useState(false);
    const [gameSpeed, setGameSpeed] = useState(1);
    const [showTax, setShowTax] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showResearch, setShowResearch] = useState(false);
    const [showTreeView, setShowTreeView] = useState(true);
    const [ageCelebration, setAgeCelebration] = useState<string | null>(null);
    const prevAgeRef = useRef(stats.currentAge);

    // Detect age advancement and show celebration banner
    useEffect(() => {
        if (stats.currentAge !== prevAgeRef.current) {
            prevAgeRef.current = stats.currentAge;
            const ageName = AGE_CONFIGS[stats.currentAge]?.name ?? stats.currentAge;
            setAgeCelebration(ageName);
            const timer = setTimeout(() => setAgeCelebration(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [stats.currentAge]);

    // Toggle Demolish
    const handleDemolishToggle = () => {
        const newState = !demolishActive;
        setDemolishActive(newState);
        onToggleDemolish(newState);
        if (newState) setActiveCategory(null);
    };

    // Tax Handler
    const handleTaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        const event = new CustomEvent('set-tax-rate-ui', { detail: val });
        window.dispatchEvent(event);
    };

    // Camera Center
    const handleCenterCamera = () => {
        const event = new CustomEvent('center-camera-ui');
        window.dispatchEvent(event);
    };

    // Minimap Click Handler
    const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Calculate distance from center to ensure we are clicking inside the circle
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));

        if (dist <= cx) {
            const event = new CustomEvent('minimap-click-ui', { detail: { x, y, width: rect.width, height: rect.height } });
            window.dispatchEvent(event);
        }
    };

    // Speed Handler
    const handleSpeedChange = (speed: number) => {
        setGameSpeed(speed);
        const event = new CustomEvent('set-game-speed-ui', { detail: speed });
        window.dispatchEvent(event);
    };


    // Keyboard shortcuts for game speed
    useEffect(() => {
        const SPEED_OPTIONS = [1, 2, 3];
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                setGameSpeed(prev => {
                    const idx = SPEED_OPTIONS.indexOf(prev);
                    const next = idx < SPEED_OPTIONS.length - 1 ? SPEED_OPTIONS[idx + 1] : prev;
                    if (next !== prev) {
                        const event = new CustomEvent('set-game-speed-ui', { detail: next });
                        window.dispatchEvent(event);
                    }
                    return next;
                });
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                setGameSpeed(prev => {
                    const idx = SPEED_OPTIONS.indexOf(prev);
                    const next = idx > 0 ? SPEED_OPTIONS[idx - 1] : prev;
                    if (next !== prev) {
                        const event = new CustomEvent('set-game-speed-ui', { detail: next });
                        window.dispatchEvent(event);
                    }
                    return next;
                });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Ctrl+S to save
    useEffect(() => {
        const handleSaveKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('save-game'));
            }
        };
        window.addEventListener('keydown', handleSaveKey);
        return () => window.removeEventListener('keydown', handleSaveKey);
    }, []);

    // Close build menu when selecting something
    useEffect(() => {
        if ((selectedCount > 0 || selectedBuildingType) && activeCategory !== null) {
            const timer = setTimeout(() => { setActiveCategory(null); if (activeCategory !== 'civic') setShowResearch(false); }, 0);
            return () => clearTimeout(timer);
        }
    }, [selectedCount, selectedBuildingType, activeCategory]);

    const hasSelection = selectedCount > 0 || selectedBuildingType !== null;

    // Format Time
    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const netFood = stats.rates.food - stats.rates.foodConsumption;
    const netFoodSign = netFood >= 0 ? '+' : '';
    const netFoodColor = netFood >= 0 ? 'text-emerald-400' : 'text-red-400';

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 overflow-hidden">

            {/* --- TOP BAR: RESOURCES --- */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-auto max-w-[calc(100vw-2rem)]">
                <div
                    className="hud-surface flex items-center gap-5 px-5 py-2.5 rounded-xl text-stone-100 transition-colors hover:border-amber-500/30"
                    style={{
                        border: '1px solid',
                        borderImage: 'linear-gradient(180deg, rgba(203,163,116,0.4), rgba(168,106,66,0.15)) 1',
                        boxShadow: '0 18px 48px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.04)',
                    }}
                >
                    <HudTooltip
                        placement="bottom"
                        title={`Wood · ${stats.resources.wood}`}
                        body={
                            <>
                                <span className="text-emerald-300">+{stats.rates.wood}/s</span> from lumber camps
                                <br />
                                Built from felled trees
                            </>
                        }
                    >
                        <div>
                            <ResourceItem
                                icon={<Pickaxe size={16} className="text-emerald-400" />}
                                value={stats.resources.wood}
                                sub={stats.rates.wood > 0 ? `+${stats.rates.wood}` : undefined}
                            />
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title={`Food · ${stats.resources.food}`}
                        body={
                            <>
                                <span className="text-emerald-300">+{stats.rates.food}/s</span> from farms
                                <br />
                                <span className="text-red-300">-{stats.rates.foodConsumption}/s</span> consumption
                                <br />
                                Net: {netFoodSign}{netFood}/s
                            </>
                        }
                    >
                        <div>
                            <ResourceItem
                                icon={<Wheat size={16} className="text-yellow-400" />}
                                value={
                                    <span className="flex items-baseline gap-1">
                                        {stats.resources.food}
                                        <span className={`text-[10px] ${netFoodColor} font-bold opacity-80`}>
                                            {`(${netFoodSign}${netFood})`}
                                        </span>
                                    </span>
                                }
                            />
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title={`Gold · ${stats.resources.gold}`}
                        body={
                            <>
                                <span className="text-emerald-300">+{stats.rates.gold}/s</span> from markets
                                <br />
                                Income boosted by tax rate
                            </>
                        }
                    >
                        <div>
                            <ResourceItem
                                icon={<Coins size={16} className="text-amber-400" />}
                                value={stats.resources.gold}
                                sub={stats.rates.gold > 0 ? `+${stats.rates.gold}` : undefined}
                            />
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title="Population"
                        body={
                            <>
                                {stats.population} of {stats.maxPopulation} housed
                                <br />
                                Grows with surplus food
                            </>
                        }
                    >
                        <div>
                            <ResourceItem
                                icon={<User size={16} className="text-blue-300" />}
                                value={`${stats.population}/${stats.maxPopulation}`}
                            />
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title={stats.currentAge === Age.CITY_STATE && !stats.nextAge
                            ? 'Maximum Advancement'
                            : `${AGE_CONFIGS[stats.currentAge]?.name ?? stats.currentAge}`}
                        body={
                            stats.currentAge === Age.CITY_STATE && !stats.nextAge ? (
                                <>All ages unlocked — enjoy your realm</>
                            ) : (() => {
                                const next = stats.nextAge ?? Age.CITY_STATE;
                                const cfg = AGE_CONFIGS[next];
                                const cost = cfg?.cost;
                                return (
                                    <>
                                        Next: {cfg?.name ?? next}
                                        {cost && (cost.wood > 0 || cost.food > 0 || cost.gold > 0) && (
                                            <>
                                                <br />
                                                Cost: {cost.wood}W
                                                {cost.food > 0 ? ` · ${cost.food}F` : ''}
                                                {cost.gold > 0 ? ` · ${cost.gold}G` : ''}
                                            </>
                                        )}
                                        <br />
                                        Progress: {Math.round(stats.ageProgress * 100)}%
                                    </>
                                );
                            })()
                        }
                    >
                        <div
                            className={`flex items-center gap-2 px-1 cursor-pointer hover:bg-white/5 rounded-lg transition-colors ${stats.nextAge ? 'age-block-advance pulsing' : ''}`}
                            onClick={onAdvanceAge}
                            tabIndex={0}
                            role="button"
                            aria-label="Advance Age"
                        >
                          <Zap size={16} className={
                            stats.nextAge ? 'text-amber-400' :
                            stats.currentAge === Age.CITY_STATE ? 'text-amber-400' :
                            stats.currentAge === Age.TOWN ? 'text-yellow-400' :
                            'text-stone-400'
                          } />
                          <div className="flex flex-col leading-tight">
                            <span className="text-[10px] font-cinzel font-semibold text-stone-200 uppercase tracking-widest">{stats.currentAge}</span>
                            {stats.nextAge && stats.ageProgress > 0 && (
                              <div className="w-12 h-1 bg-stone-700 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 rounded-full transition-all" style={{width: (stats.ageProgress * 100) + '%'}} />
                              </div>
                            )}
                            {!stats.nextAge && stats.currentAge === Age.CITY_STATE && (
                              <span className="text-[8px] text-amber-400 font-cinzel font-semibold tracking-widest">MAX</span>
                            )}
                            {!stats.nextAge && stats.currentAge !== Age.CITY_STATE && (
                              <span className="text-[8px] text-stone-300 font-inter">Click TC to advance</span>
                            )}
                          </div>
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title="Happiness"
                        body={
                            stats.happiness < 50
                                ? 'Unrest spreading — build parks, cathedrals or lower taxes'
                                : 'Your citizens are content'
                        }
                    >
                        <div className="flex flex-col items-center min-w-[60px]">
                            <div className={`flex items-center gap-2 font-cinzel font-semibold text-lg tracking-wider ${stats.happiness < 50 ? 'text-red-400' : 'text-green-400'}`}>
                                <Smile size={16} />
                                <span>{stats.happiness}%</span>
                            </div>
                            {stats.happiness < 50 && (
                                <span className="text-[10px] text-red-400 animate-pulse font-cinzel font-semibold tracking-widest uppercase">REVOLT RISK</span>
                            )}
                        </div>
                    </HudTooltip>
                    <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title={`${stats.currentSeason.charAt(0).toUpperCase() + stats.currentSeason.slice(1)}`}
                        body={<>Season cycles affect yields and growth</>}
                    >
                        <div className="flex items-center gap-2 px-1">
                            <span className={`text-sm font-bold ${
                                stats.currentSeason === 'spring' ? 'text-emerald-400' :
                                stats.currentSeason === 'summer' ? 'text-yellow-400' :
                                stats.currentSeason === 'autumn' ? 'text-orange-400' :
                                'text-blue-300'
                            }`}>
                                {stats.currentSeason === 'spring' ? '🌱' : stats.currentSeason === 'summer' ? '☀️' : stats.currentSeason === 'autumn' ? '🍂' : '❄️'}
                            </span>
                            <span className="text-[10px] font-cinzel font-semibold text-stone-300 uppercase tracking-widest">{stats.currentSeason}</span>
                        </div>
                    </HudTooltip>
                    {typeof stats.playerTerritoryPercent === 'number' && stats.playerTerritoryPercent > 0 && (
                        <HudTooltip
                            placement="bottom"
                            title="Territory"
                            body={<>You control {Math.round(stats.playerTerritoryPercent * 100)}% of the map</>}
                        >
                            <div className="flex items-center gap-1 px-1">
                                <span className="text-[10px] font-cinzel font-semibold text-cyan-400 tracking-widest">🏰 {Math.round(stats.playerTerritoryPercent * 100)}%</span>
                            </div>
                        </HudTooltip>
                    )}
                     <div className="hud-rule w-px h-7 divider-diamond" />
                    <HudTooltip
                        placement="bottom"
                        title="Diplomacy"
                        body={
                            stats.peacefulMode
                                ? <>Peaceful mode — no AI aggression</>
                                : stats.treatyTimeRemaining > 0
                                ? <>Treaty {Math.ceil(stats.treatyTimeRemaining / 1000)}s remaining</>
                                : <>You are at war with the AI</>
                        }
                    >
                        <div className="flex items-center gap-1">
                            {stats.peacefulMode ? (
                                <span className="text-[10px] font-cinzel font-semibold text-emerald-400 tracking-widest uppercase">🕊️ Peace</span>
                            ) : stats.treatyTimeRemaining > 0 ? (
                                <span className="text-[10px] font-cinzel font-semibold text-amber-400 tracking-widest uppercase">⏱ Treaty {Math.ceil(stats.treatyTimeRemaining / 1000)}s</span>
                            ) : (
                                <span className="text-[10px] font-cinzel font-semibold text-red-400 tracking-widest uppercase">⚔️ War</span>
                            )}
                        </div>
                    </HudTooltip>
                </div>
            </div>

            {/* --- DOMINANCE PROGRESS BAR --- */}
            {typeof stats.dominanceProgress === 'number' && stats.dominanceProgress > 0 && (
                <div className="absolute top-[72px] left-1/2 -translate-x-1/2 w-64 pointer-events-none">
                    <div className="text-xs text-amber-400 text-center mb-1 font-bold tracking-wide">
                        ⚔️ Dominance: {Math.round(stats.dominanceProgress / 1000)}s / {DOMINANCE_HOLD_TIME_MS / 1000}s
                    </div>
                    <div className="h-2 bg-stone-800 rounded-full overflow-hidden border border-amber-900/50">
                        <div
                            className="h-full bg-amber-500 transition-all duration-1000"
                            style={{ width: `${(stats.dominanceProgress / DOMINANCE_HOLD_TIME_MS) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* --- TOP RIGHT: SYSTEM CONTROLS --- */}
            <div className="absolute top-6 right-6 flex flex-col items-end gap-3 pointer-events-auto">
                {/* Main Controls Group */}
                <div className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl">
                    {/* Speed Controls */}
                    <div className="flex items-center bg-white/5 rounded-xl p-1 gap-0.5">
                        <button
                            onClick={() => handleSpeedChange(Math.max(0.5, gameSpeed - 0.5))}
                            disabled={gameSpeed <= 0.5}
                            className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            title="Decrease speed (-)"
                        >
                            <Minus size={14} />
                        </button>
                        {[
                            { speed: 0.5, icon: '▸', label: '0.5×' },
                            { speed: 1, icon: '▶', label: '1×' },
                            { speed: 2, icon: '▶▶', label: '2×' },
                            { speed: 3, icon: '▶▶▶', label: '3×' },
                        ].map(({ speed, label }) => (
                            <button
                                key={speed}
                                onClick={() => handleSpeedChange(speed)}
                                className={`px-2 py-1 rounded-lg transition-all min-w-[36px] text-xs font-bold ${
                                    gameSpeed === speed
                                        ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
                                        : 'text-stone-400 hover:text-white hover:bg-white/10'
                                }`}
                                title={`Set speed ${label}`}
                            >
                                {label}
                            </button>
                        ))}
                        <button
                            onClick={() => handleSpeedChange(Math.min(3, gameSpeed + 0.5))}
                            disabled={gameSpeed >= 3}
                            className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            title="Increase speed (+)"
                        >
                            <Plus size={14} />
                        </button>
                        <span className="ml-1 text-amber-400 font-mono text-[10px] font-bold tabular-nums">
                            {gameSpeed.toFixed(1)}x
                        </span>
                    </div>

                    {/* Tax Toggle */}
                    <div className="relative">
                        <button
                            onClick={() => setShowTax(!showTax)}
                            className={`p-2 rounded-xl transition-colors ${showTax ? 'bg-amber-500/20 text-amber-400' : 'text-stone-400 hover:text-amber-400 hover:bg-white/5'}`}
                        >
                            <Crown size={20} />
                        </button>

                        {/* Floating Tax Slider Popover */}
                        {showTax && (
                            <div className="absolute top-12 right-0 w-64 p-4 bg-stone-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl flex flex-col gap-2 animate-in slide-in-from-top-2 fade-in duration-200">
                                <div className="flex justify-between items-center text-xs font-bold text-stone-400 uppercase tracking-wider">
                                    <span>Tax Rate</span>
                                    <span className="text-amber-400">{stats.taxRate * 20}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="5"
                                    step="1"
                                    value={stats.taxRate}
                                    onChange={handleTaxChange}
                                    className="w-full accent-amber-500 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                />
                                <div className="text-[10px] text-stone-300 flex justify-between px-1">
                                    <span>Benevolent</span>
                                    <span>Tyrant</span>
                                </div>
                                <div className="mt-2 text-xs bg-white/5 p-2 rounded text-stone-300 text-center">
                                    Income: <span className="text-amber-400 font-bold">+{0.5 + stats.taxRate}g</span> / pop
                                </div>
                            </div>
                        )}
                    </div>


                    {/* Menu Toggle */}
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className={`p-2 rounded-xl transition-colors ${showMenu ? 'bg-red-500/20 text-red-400' : 'text-stone-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <Menu size={20} />
                    </button>
                </div>

                {/* Menu Dropdown */}
                {showMenu && (
                    <div className="hud-surface flex flex-col gap-2 w-56 rounded-lg p-2 animate-in slide-in-from-top-2 fade-in duration-200">
                        <div className="px-2 py-1">
                            <div className="flex justify-between items-center mb-2">
                                <span className="hud-kicker">Bloom intensity</span>
                                <span className="font-mono text-[10px] text-amber-300">{Math.round(stats.bloomIntensity * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="3"
                                step="0.1"
                                value={stats.bloomIntensity}
                                onChange={(e) => window.dispatchEvent(new CustomEvent('set-bloom-intensity-ui', { detail: parseFloat(e.target.value) }))}
                                className="w-full accent-amber-500 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                        <div className="hud-rule h-px w-full" />
                        <button onClick={() => window.dispatchEvent(new CustomEvent('save-game'))} className="flex items-center gap-3 px-3 py-2 text-stone-200 hover:text-amber-200 hover:bg-white/5 rounded-md transition-colors text-sm">
                            <Save size={15} /> Save game <span className="ml-auto hud-kicker">Ctrl S</span>
                        </button>
                        <button onClick={() => window.dispatchEvent(new CustomEvent('load-game'))} className="flex items-center gap-3 px-3 py-2 text-stone-200 hover:text-amber-200 hover:bg-white/5 rounded-md transition-colors text-sm">
                            <BookOpen size={15} /> Load game
                        </button>
                        <button onClick={onQuit} className="flex items-center gap-3 px-3 py-2 text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-md transition-colors text-sm">
                            <LogOut size={15} /> Exit to menu
                        </button>
                    </div>
                )}

                {/* Diplomacy Status Widget */}
                {(stats.peacefulMode || stats.treatyTimeRemaining > 0) && (
                    <div className="flex items-center gap-3 px-4 py-2 bg-black/60 backdrop-blur-xl rounded-full border border-white/10 shadow-lg animate-in slide-in-from-right fade-in">
                        {stats.peacefulMode ? (
                            <>
                                <Handshake size={16} className="text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Peaceful Mode</span>
                            </>
                        ) : (
                            <>
                                <Clock size={16} className="text-blue-400" />
                                <span className="text-xs font-bold text-blue-400 uppercase tracking-wide font-mono">{formatTime(stats.treatyTimeRemaining)}</span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* --- BOTTOM LEFT: MAP / RADAR --- */}
            <div className="absolute bottom-6 left-6 pointer-events-auto flex flex-col gap-4">
                <div className="w-48 h-48 rounded-full relative overflow-hidden group">

                    {/* Interaction Layer */}
                    <div
                        className="absolute inset-0 cursor-crosshair z-10"
                        onClick={handleMinimapClick}
                        title="Click to Navigate"
                    />

                    {/* Map Controls Overlay */}
                    <div className="absolute bottom-4 right-0 left-0 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none">
                        <div className="bg-black/80 px-2 py-0.5 rounded-full text-[9px] text-stone-400 font-bold border border-white/10">
                            {stats.mapMode === MapMode.FIXED ? 'FIXED' : 'INFINITE'}
                        </div>
                    </div>
                </div>
            </div>

            {/* --- BOTTOM CENTER: COMMAND DOCK --- */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 pointer-events-auto">

                {/* A. SELECTION MODE */}
                {hasSelection && (
                    <div className="hud-surface min-w-[min(620px,calc(100vw-2rem))] rounded-xl p-1.5 animate-in slide-in-from-bottom-4 fade-in duration-300">
                        <div className="flex items-stretch">
                            {/* Icon Section */}
                            <div className="w-20 bg-white/[.035] border-r border-[var(--hud-line)] rounded-lg flex items-center justify-center shrink-0">
                                {selectedBuildingType ? (
                                    <Home size={32} className="text-amber-500 opacity-80" />
                                ) : (
                                    <div className="flex flex-col items-center gap-1">
                                        <User size={32} className="text-blue-400 opacity-80" />
                                    </div>
                                )}
                            </div>

                            {/* Stats Section */}
                            <div className="flex-1 px-4 py-2 flex flex-col justify-center">
                                {selectedBuildingType ? (
                                    <>
                                        <h3 className="text-lg font-cinzel font-semibold text-stone-100 flex items-center justify-between tracking-wider">
                                            {BUILDINGS[selectedBuildingType].name}
                                            <button onClick={() => window.dispatchEvent(new CustomEvent('clear-selection'))} className="text-stone-300 hover:text-white">
                                                <X size={16} />
                                            </button>
                                        </h3>
                                        <p className="text-xs text-stone-400 italic leading-tight mt-1">
                                            {BUILDINGS[selectedBuildingType].description}
                                        </p>
                                        {stats.selectedBuildingInfo && (
                                            <div className="flex items-center gap-2 mt-1.5">
                                                {stats.selectedBuildingInfo.hasWorker ? (
                                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded">✓ Working</span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">⚠ No Worker</span>
                                                )}
                                                {stats.selectedBuildingInfo.nearbyResources > 0 && (
                                                    <span className="text-[10px] text-stone-300">
                                                        {stats.selectedBuildingInfo.nearbyResources} {stats.selectedBuildingInfo.resourceLabel}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-1 w-full">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-cinzel font-semibold text-stone-400 uppercase tracking-widest">Selected Group</span>
                                            <button onClick={() => window.dispatchEvent(new CustomEvent('clear-selection'))} className="text-stone-300 hover:text-white">
                                                <X size={16} />
                                            </button>
                                        </div>
                                        {/* Grouped Unit Icons */}
                                        <div className="flex gap-2 overflow-x-auto pb-1">
                                            {selectedCounts && Object.keys(selectedCounts).length > 0 ? (
                                                Object.entries(selectedCounts).map(([type, count]) => (
                                                    <button
                                                        key={type}
                                                        onClick={() => onFilterSelection && onFilterSelection(type as UnitType)}
                                                        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all hover:scale-105 active:scale-95 group min-w-[100px]"
                                                    >
                                                        {type === UnitType.PIKESMAN && <Sword size={14} className="text-red-400" />}
                                                        {type === UnitType.ARCHER && <Target size={14} className="text-emerald-400" />}
                                                        {type === UnitType.CAVALRY && <FastForward size={14} className="text-amber-400" />}
                                                        {type === UnitType.VILLAGER && <Pickaxe size={14} className="text-yellow-400" />}
                                                        {type === UnitType.LEGION && <Shield size={14} className="text-blue-400" />}
                                                        {type === UnitType.SLINGER && <Circle size={14} className="text-orange-400" />}
                                                        {type === UnitType.AXEMAN && <Zap size={14} className="text-purple-400" />}
                                                        {type === UnitType.HOPLITE && <Shield size={14} className="text-cyan-400" />}
                                                        {type === UnitType.CHARIOT && <Activity size={14} className="text-pink-400" />}
                                                        {type === UnitType.RAM && <Shield size={14} className="text-stone-400" />}
                                                        <span className="text-xs font-bold text-stone-200 uppercase tracking-wider">{type}</span>
                                                        {(() => {
                                                            const tag = getDamageTag(type as UnitType);
                                                            return tag ? <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${tag.color}`}>{tag.label}</span> : null;
                                                        })()}
                                                        {(() => {
                                                            const hp = UNIT_STATS[type as UnitType]?.maxHp;
                                                            return hp ? <span className="text-[9px] font-mono text-stone-400">HP:{hp}</span> : null;
                                                        })()}
                                                        <span className="text-xs font-mono text-stone-400 ml-auto bg-black/40 px-1.5 rounded">{count}</span>
                                                    </button>
                                                ))
                                            ) : (
                                                <span className="text-sm font-bold text-stone-200">Total: {selectedCount}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Actions Section */}
                            <div className="flex items-center gap-2 px-2 border-l border-white/10">
                                {/* Building Actions */}
                                {selectedBuildingType === BuildingType.LUMBER_CAMP && (
                                    <ActionButton onClick={onRegrowForest} icon={<Sprout size={18} />} label="Regrow" color="text-emerald-400" />
                                )}

                                {/* Barracks Actions */}
                                {selectedBuildingType === BuildingType.BARRACKS && (
                                    <div className="flex gap-1 border-r border-white/10 pr-2 mr-2">
                                        <TrainButton
                                            label="Pikesman"
                                            cost={{ food: 100, gold: 50 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.PIKESMAN)}
                                            icon={<Sword size={16} />}
                                        />
                                        <TrainButton
                                            label="Archer"
                                            cost={{ food: 80, gold: 40 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.ARCHER)}
                                            icon={<Target size={16} />}
                                        />
                                        <TrainButton
                                            label="Cavalry"
                                            cost={{ food: 150, gold: 100 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.CAVALRY)}
                                            icon={<FastForward size={16} />}
                                        />
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.SLINGER) && (
                                          <TrainButton
                                            label="Slinger"
                                            cost={{ food: 40, gold: 20 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.SLINGER)}
                                            icon={<Crosshair size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.AXEMAN) && (
                                          <TrainButton
                                            label="Axeman"
                                            cost={{ food: 120, gold: 60 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.AXEMAN)}
                                            icon={<Triangle size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.HOPLITE) && (
                                          <TrainButton
                                            label="Hoplite"
                                            cost={{ food: 200, gold: 150 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.HOPLITE)}
                                            icon={<Shield size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.CHARIOT) && (
                                          <TrainButton
                                            label="Chariot"
                                            cost={{ food: 250, gold: 200 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.CHARIOT)}
                                            icon={<span className="text-cyan-400"><FastForward size={16} /></span>}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.RAM) && (
                                          <TrainButton
                                            label="Ram"
                                            cost={{ food: 100, gold: 80 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.RAM)}
                                            icon={<Shield size={16} />}
                                          />
                                        )}
                                    </div>
                                )}

                                {/* Demolish Action (Only for buildings) */}
                                {selectedBuildingType && (
                                    <ActionButton onClick={onDemolishSelected} icon={<Trash2 size={18} />} label="Demolish" color="text-red-400" />
                                )}

                                {/* No Actions Placeholder */}
                                {!selectedBuildingType && selectedCount > 0 && (
                                    <div className="flex flex-col gap-1 items-end">
                                        {/* FORMATION CONTROLS */}
                                        <div className="flex gap-1 bg-black/40 p-1 rounded-lg">
                                            <FormationButton type={FormationType.BOX} current={stats.currentFormation} icon={<Grid size={16} />} />
                                            <FormationButton type={FormationType.LINE} current={stats.currentFormation} icon={<Minus size={16} />} />
                                            <FormationButton type={FormationType.CIRCLE} current={stats.currentFormation} icon={<Circle size={16} />} />
                                            <FormationButton type={FormationType.SKIRMISH} current={stats.currentFormation} icon={<Activity size={16} />} />
                                            <FormationButton type={FormationType.WEDGE} current={stats.currentFormation} icon={<Triangle size={16} />} />
                                        </div>
                                        {/* STANCE CONTROLS */}
                                        <div className="flex gap-1 bg-black/40 p-1 rounded-lg mt-1">
                                            <StanceButton type={UnitStance.AGGRESSIVE} current={stats.currentStance} icon={<Sword size={16} />} />
                                            <StanceButton type={UnitStance.DEFENSIVE} current={stats.currentStance} icon={<Shield size={16} />} />
                                            <StanceButton type={UnitStance.HOLD} current={stats.currentStance} icon={<Hand size={16} />} />
                                        </div>
                                        {/* ABILITY CONTROLS */}
                                        {selectedCounts && Object.keys(selectedCounts).some(type => UNIT_ABILITIES[type as UnitType]) && (
                                            <div className="flex gap-1 bg-black/40 p-1 rounded-lg mt-1">
                                                {Object.entries(selectedCounts)
                                                    .filter(([type]) => UNIT_ABILITIES[type as UnitType])
                                                    .map(([type]) => {
                                                        const ability = UNIT_ABILITIES[type as UnitType]!;
                                                        const config = ABILITY_CONFIG[ability];
                                                        return (
                                                            <button
                                                                key={type}
                                                                onClick={() => window.dispatchEvent(new CustomEvent('activate-ability', { detail: type }))}
                                                                className="flex items-center gap-1 px-2 py-1 bg-amber-900/50 hover:bg-amber-800/70 border border-amber-500/50 rounded text-xs transition-all"
                                                                title={`${config.description} (${config.cooldown / 1000}s CD)`}
                                                            >
                                                                <Zap size={14} className="text-amber-400" />
                                                                <span className="text-amber-200 font-bold uppercase">Q</span>
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        )}
                                        <div className="text-[10px] text-stone-300 font-bold px-2 uppercase tracking-wide">
                                            Right Click to Move
                                        </div>
                                    </div>
                                )}
                                {selectedBuildingType === BuildingType.BARRACKS && (
                                    <div className="text-[10px] text-stone-300 font-bold px-2 uppercase tracking-wide max-w-[100px] leading-tight">
                                        Right Click map to set waypoint
                                    </div>
                                )}
                                {selectedBuildingType === BuildingType.CASTLE && (
                                    <div className="flex flex-col gap-1.5 items-end">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 px-2 py-1 rounded">
                                                🏰 Garrison: {stats.selectedBuildingInfo?.garrisonCount ?? 0} units
                                            </span>
                                        </div>
                                        {(stats.selectedBuildingInfo?.garrisonCount ?? 0) > 0 && onReleaseGarrison && (
                                            <ActionButton onClick={onReleaseGarrison} icon={<LogOut size={18} />} label="Release" color="text-emerald-400" />
                                        )}
                                        <div className="text-[10px] text-stone-300 font-bold px-2 uppercase tracking-wide max-w-[100px] leading-tight">
                                            Right Click with units to garrison
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* B. BUILD MODE (Visible only when nothing selected) */}
                {!hasSelection && (
                    <div className="flex flex-col items-center gap-3">

                        {/* Research Panel */}
                        {showResearch && activeCategory === 'civic' && (
                                <div className={`bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200 mb-2 ${showTreeView ? 'w-[640px]' : 'w-[420px] overflow-hidden'}`}>
                                {/* Header with toggle */}
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-cinzel font-semibold text-stone-100 uppercase tracking-widest flex items-center gap-2">
                                        <BookOpen size={16} className="text-blue-400" />
                                        Research
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setShowTreeView(!showTreeView)}
                                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${showTreeView ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-stone-400 hover:text-stone-200'}`}
                                            title={showTreeView ? 'Switch to list view' : 'Switch to tree view'}
                                        >
                                            <GitBranch size={12} />
                                            Tree
                                        </button>
                                        <button onClick={() => setShowResearch(false)} className="text-stone-500 hover:text-white">
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Active Research Progress */}
                                {stats.activeResearch && (
                                    <div className="mb-3 p-2 bg-blue-900/30 rounded-lg border border-blue-500/30">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-blue-300 font-bold">Researching: {TECH_DEFS[stats.activeResearch.techId]?.name}</span>
                                            <span className="text-blue-400 font-mono">{Math.round(stats.activeResearch.progress * 100)}%</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-stone-700 rounded-full mt-1 overflow-hidden">
                                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: (stats.activeResearch.progress * 100) + '%' }} />
                                        </div>
                                    </div>
                                )}

                                {/* ── Tree View ── */}
                                {showTreeView && (() => {
                                    const ages = [Age.VILLAGE, Age.TOWN, Age.CITY_STATE];
                                    const ageIdx = (a: Age) => ages.indexOf(a);
                                    const isAgeUnlocked = (a: Age) => ageIdx(stats.currentAge) >= ageIdx(a);
                                    const treeData = ages.map(age => ({
                                        age,
                                        name: AGE_CONFIGS[age]?.name ?? age,
                                        techs: Object.values(TECH_DEFS)
                                            .filter(d => d.requiredAge === age)
                                            .map(def => ({
                                                def,
                                                status: (
                                                    stats.completedTechs.includes(def.id) ? 'complete' :
                                                    stats.activeResearch?.techId === def.id ? 'researching' :
                                                    (() => {
                                                        const prereqsMet = def.prereqs.every(p => stats.completedTechs.includes(p));
                                                        const canAfford = stats.resources.wood >= def.cost.wood && stats.resources.food >= def.cost.food && stats.resources.gold >= def.cost.gold;
                                                        return isAgeUnlocked(def.requiredAge) && prereqsMet && !stats.activeResearch && canAfford ? 'available' : 'locked';
                                                    })()
                                                )
                                            }))
                                    }));

                                    // Column positions for connector lines
                                    const BW = 160, BH = 104, CX = 190, GY = 24;
                                    const bx = (ci: number) => 20 + ci * CX;
                                    const by = (_ci: number, ti: number) => 30 + ti * (BH + GY);

                                    // Build connector lines from prereqs
                                    const conns: { x1: number; y1: number; x2: number; y2: number }[] = [];
                                    const findPos = (tid: TechId): { x: number; y: number } | null => {
                                        for (let ai = 0; ai < treeData.length; ai++) {
                                            const ti = treeData[ai].techs.findIndex(t => t.def.id === tid);
                                            if (ti >= 0) return { x: bx(ai) + BW, y: by(ai, ti) + BH / 2 };
                                        }
                                        return null;
                                    };
                                    for (let ai = 0; ai < treeData.length; ai++) {
                                        treeData[ai].techs.forEach((t, ti) => {
                                            t.def.prereqs.forEach(pid => {
                                                const from = findPos(pid);
                                                if (!from) return;
                                                conns.push({
                                                    x1: from.x, y1: from.y,
                                                    x2: bx(ai), y2: by(ai, ti) + BH / 2
                                                });
                                            });
                                        });
                                    }

                                    // Status → colors
                                    const borderC = (s: string) => s === 'complete' ? 'border-emerald-500/50' : s === 'researching' ? 'border-blue-500/50' : s === 'available' ? 'border-amber-500/40' : 'border-stone-700/50';
                                    const bgC = (s: string) => s === 'complete' ? 'bg-emerald-900/40' : s === 'researching' ? 'bg-blue-900/40' : s === 'available' ? 'bg-amber-900/20' : 'bg-stone-900/40';
                                    const nameC = (s: string) => s === 'complete' ? 'text-emerald-300' : s === 'researching' ? 'text-blue-300' : s === 'available' ? 'text-amber-200' : 'text-stone-500';
                                    const descC = (s: string) => s === 'complete' ? 'text-emerald-500/70' : s === 'researching' ? 'text-blue-400/70' : s === 'available' ? 'text-amber-400/60' : 'text-stone-600';
                                    const cur = (s: string) => s === 'available' ? 'cursor-pointer hover:brightness-125' : '';
                                    const connColor = (tid: TechId) => {
                                        const s = treeData.flatMap(a => a.techs).find(t => t.def.id === tid);
                                        if (!s) return 'rgba(120,110,100,0.35)';
                                        if (s.status === 'complete') return 'rgba(52,211,153,0.5)';
                                        if (s.status === 'researching') return 'rgba(96,165,250,0.4)';
                                        if (s.status === 'available') return 'rgba(251,191,36,0.3)';
                                        return 'rgba(120,110,100,0.25)';
                                    };

                                    const treeH = Math.max(...treeData.map(a => by(a.age === Age.VILLAGE ? 0 : a.age === Age.TOWN ? 1 : 2, a.techs.length - 1) + BH + 10));

                                    return (
                                        <div className="relative overflow-y-auto" style={{ minHeight: treeH, maxHeight: '55vh' }}>
                                            {/* Connector SVG */}
                                            {conns.length > 0 && (
                                                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ left: 10, top: 0, width: 'calc(100% - 10px)' }}>
                                                    {conns.map((c, i) => {
                                                        const destTech = treeData.flatMap(a => a.techs).find(t => {
                                                            const pos = findPos(t.def.id);
                                                            return pos && Math.abs(pos.x - c.x2) < 1 && Math.abs(pos.y - c.y2) < 1;
                                                        });
                                                        const mx = (c.x1 + c.x2) / 2;
                                                        return (
                                                            <path
                                                                key={i}
                                                                d={c.y1 === c.y2
                                                                    ? `M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`
                                                                    : `M ${c.x1} ${c.y1} L ${mx} ${c.y1} L ${mx} ${c.y2} L ${c.x2} ${c.y2}`}
                                                                fill="none"
                                                                stroke={destTech ? connColor(destTech.def.id) : 'rgba(120,110,100,0.3)'}
                                                                strokeWidth={2}
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                strokeDasharray={destTech?.status === 'locked' ? '6 4' : 'none'}
                                                            />
                                                        );
                                                    })}
                                                </svg>
                                            )}

                                            {/* Age columns */}
                                            <div className="flex gap-5 relative">
                                                {treeData.map((col, _ci) => (
                                                    <div key={col.age} className="flex flex-col gap-0" style={{ width: BW, minWidth: BW }}>
                                                        <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 text-center ${isAgeUnlocked(col.age) ? 'text-amber-400' : 'text-stone-600'}`}>
                                                            {col.name}
                                                        </div>
                                                        <div className="flex flex-col" style={{ gap: GY }}>
                                                            {col.techs.map((t, _ti) => {
                                                                const { def, status } = t;
                                                                const isActive = status === 'researching';
                                                                return (
                                                                    <div
                                                                        key={def.id}
                                                                        className={`rounded-lg border p-2 transition-all ${borderC(status)} ${bgC(status)} ${cur(status)} ${isActive ? 'ring-1 ring-blue-500/50' : ''}`}
                                                                        style={{ minHeight: BH, maxHeight: BH, overflow: 'hidden' }}
                                                                        onClick={() => {
                                                                            if (status === 'available') {
                                                                                window.dispatchEvent(new CustomEvent('request-start-research', { detail: def.id }));
                                                                            }
                                                                        }}
                                                                    >
                                                                        <div className="flex items-center gap-1.5 mb-1">
                                                                            {status === 'complete' ? <Check size={11} className="text-emerald-400 shrink-0" /> : <BookOpen size={11} className={isActive ? 'text-blue-400 shrink-0' : 'text-stone-500 shrink-0'} />}
                                                                            <span className={`text-[11px] font-bold truncate ${nameC(status)}`}>{def.name}</span>
                                                                        </div>
                                                                        <div className={`text-[9px] mb-1.5 line-clamp-2 ${descC(status)}`}>{def.description}</div>
                                                                        {status !== 'complete' && !isActive && (
                                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                                {def.cost.food > 0 && <span className="flex items-center gap-0.5 text-[9px] text-stone-400"><Wheat size={8} className="text-yellow-400" />{def.cost.food}</span>}
                                                                                {def.cost.gold > 0 && <span className="flex items-center gap-0.5 text-[9px] text-stone-400"><Coins size={8} className="text-amber-400" />{def.cost.gold}</span>}
                                                                            </div>
                                                                        )}
                                                                        {isActive && stats.activeResearch && (
                                                                            <div className="mt-1">
                                                                                <div className="w-full h-1 bg-stone-700 rounded-full overflow-hidden">
                                                                                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: (stats.activeResearch.progress * 100) + '%' }} />
                                                                                </div>
                                                                                <div className="text-[8px] text-blue-400 font-mono mt-0.5">{Math.round(stats.activeResearch.progress * 100)}%</div>
                                                                            </div>
                                                                        )}
                                                                        {status === 'locked' && def.prereqs.length > 0 && (
                                                                            <div className="text-[8px] text-stone-600 mt-0.5 truncate">Requires: {def.prereqs.map(p => TECH_DEFS[p]?.name).join(', ')}</div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ── List View (existing, fallback) ── */}
                                {!showTreeView && [Age.VILLAGE, Age.TOWN, Age.CITY_STATE].map(age => {
                                    const techs = Object.values(TECH_DEFS).filter(d => d.requiredAge === age);
                                    if (techs.length === 0) return null;
                                    const ageLabel = AGE_CONFIGS[age]?.name ?? age;
                                    const ageUnlocked = stats.currentAge === age || [Age.VILLAGE, Age.TOWN, Age.CITY_STATE].indexOf(stats.currentAge) >= [Age.VILLAGE, Age.TOWN, Age.CITY_STATE].indexOf(age);
                                    return (
                                        <div key={age} className="mb-2">
                                            <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${ageUnlocked ? 'text-amber-400' : 'text-stone-600'}`}>{ageLabel}</div>
                                            <div className="flex flex-col gap-1">
                                                {techs.map(def => {
                                                    const isCompleted = stats.completedTechs.includes(def.id);
                                                    const isActive = stats.activeResearch?.techId === def.id;
                                                    const canAfford = stats.resources.wood >= def.cost.wood && stats.resources.food >= def.cost.food && stats.resources.gold >= def.cost.gold;
                                                    const isAvailable = ageUnlocked && !isCompleted && !stats.activeResearch && canAfford;
                                                    return (
                                                        <div
                                                            key={def.id}
                                                            className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                                                                isCompleted ? 'bg-emerald-900/30 border-emerald-500/30' :
                                                                isActive ? 'bg-blue-900/30 border-blue-500/30' :
                                                                isAvailable ? 'bg-white/5 border-white/10 hover:bg-white/10 cursor-pointer' :
                                                                'bg-stone-900/30 border-stone-700/30 opacity-50'
                                                            }`}
                                                            onClick={() => {
                                                                if (isAvailable) {
                                                                    window.dispatchEvent(new CustomEvent('request-start-research', { detail: def.id }));
                                                                }
                                                            }}
                                                        >
                                                            <div className="w-6 h-6 flex items-center justify-center">
                                                                {isCompleted ? <Check size={14} className="text-emerald-400" /> : <BookOpen size={14} className={isActive ? 'text-blue-400' : 'text-stone-500'} />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className={`text-xs font-bold ${isCompleted ? 'text-emerald-300' : 'text-stone-200'}`}>{def.name}</div>
                                                                <div className="text-[10px] text-stone-400 truncate">{def.description}</div>
                                                            </div>
                                                            {!isCompleted && (
                                                                <div className="flex items-center gap-2 text-[10px] shrink-0">
                                                                    {def.cost.food > 0 && <span className="flex items-center gap-1"><Wheat size={10} className="text-yellow-400" />{def.cost.food}</span>}
                                                                    {def.cost.gold > 0 && <span className="flex items-center gap-1"><Coins size={10} className="text-amber-400" />{def.cost.gold}</span>}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Expanded Build Panel (Pop-up) */}
                        {activeCategory && !showResearch && (
                            <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200 mb-2">
                                <div className="flex gap-2">
                                    {getBuildingsByCategory(activeCategory, stats, onBuild)}
                                    {activeCategory === 'civic' && (
                                        <button
                                            onClick={() => setShowResearch(true)}
                                            className="flex flex-col items-center gap-1.5 p-3 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/30 rounded-xl transition-all min-w-[80px]"
                                        >
                                            <BookOpen size={18} className="text-blue-400" />
                                            <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider">Research</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Main Dock */}
                        <div className="hud-surface flex items-center gap-2 p-1.5 rounded-xl">
                            <HudTooltip
                                title="Economy"
                                body={<>Available: 6 building types (House, Farm, Lumber Camp, Hunter's Lodge, Town Center, Market)</>}
                            >
                                <DockButton
                                    isActive={activeCategory === 'economy'}
                                    onClick={() => { setActiveCategory(activeCategory === 'economy' ? null : 'economy'); setShowResearch(false); }}
                                    icon={<Pickaxe size={20} />}
                                    label="Economy"
                                />
                            </HudTooltip>
                            <HudTooltip
                                title="Military"
                                body={<>Available: 3 building types (Barracks, Wall, Castle)</>}
                            >
                                <DockButton
                                    isActive={activeCategory === 'military'}
                                    onClick={() => { setActiveCategory(activeCategory === 'military' ? null : 'military'); setShowResearch(false); }}
                                    icon={<Sword size={20} />}
                                    label="Military"
                                />
                            </HudTooltip>
                            <HudTooltip
                                title="Civic"
                                body={<>Available: 3 building types (Bonfire, Small Park, Cathedral)</>}
                            >
                                <DockButton
                                    isActive={activeCategory === 'civic'}
                                    onClick={() => { setActiveCategory(activeCategory === 'civic' ? null : 'civic'); if (activeCategory === 'civic') setShowResearch(false); }}
                                    icon={<Tent size={20} />}
                                    label="Civic"
                                />
                            </HudTooltip>

                            <div className="w-px h-8 bg-white/10 mx-1" />

                            {/* Center Camera Button */}
                            <button
                                onClick={handleCenterCamera}
                                className="p-3 rounded-xl transition-all duration-300 text-stone-400 hover:text-white hover:bg-white/5"
                                title="Cycle Town Centers"
                            >
                                <Target size={20} />
                            </button>

                            {/* Demolish Tool */}
                            <button
                                onClick={handleDemolishToggle}
                                className={`p-3 rounded-xl transition-all duration-300 ${demolishActive ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] scale-110' : 'text-stone-400 hover:text-red-400 hover:bg-white/5'}`}
                                title="Demolish Mode"
                            >
                                <Trash2 size={20} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Event ledger: compact, readable feedback anchored away from the command dock. */}
            {stats.notifications && stats.notifications.length > 0 && (
                <div className="absolute top-20 right-4 flex flex-col gap-1.5 pointer-events-auto w-[min(21rem,calc(100vw-2rem))]">
                    <div className="hud-kicker font-inter">Recent events</div>
                    {stats.notifications.slice(-4).map((n) => {
                        const isTaunt = !!n.personality;
                        const colors = isTaunt
                            ? 'bg-[#281512]/95 border-orange-400/50 text-orange-100'
                            : {
                                info: 'bg-[#171d23]/95 border-sky-400/40 text-sky-100',
                                warning: 'bg-[#282116]/95 border-amber-400/45 text-amber-100',
                                danger: 'bg-[#281619]/95 border-red-400/45 text-red-100',
                                success: 'bg-[#14231d]/95 border-emerald-400/40 text-emerald-100',
                            }[n.severity];
                        return (
                            <div key={n.id} className={`${colors} border rounded-md px-3 py-2 backdrop-blur-md shadow-lg text-sm leading-snug`}>
                                {isTaunt && n.senderName && (
                                    <div className="text-[10px] text-orange-300/80 font-semibold uppercase tracking-wider mb-0.5">{n.senderName}</div>
                                )}
                                <div className={isTaunt ? 'font-medium italic' : 'font-medium'}>{n.text}</div>
                                <div className="h-px mt-2 rounded bg-white/15 overflow-hidden">
                                    <div className="h-full bg-[var(--gold-leaf)]/70 shrink-toast-bar" style={{ animationDuration: `${n.duration}ms` }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {/* --- AGE CELEBRATION BANNER --- */}
            {ageCelebration && (
                <div className="absolute top-[15%] left-1/2 -translate-x-1/2 pointer-events-none age-celebration-banner z-50">
                    <div className="px-12 py-4 rounded-xl border-2 border-amber-500/60 shadow-[0_0_40px_rgba(212,175,55,0.3)]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(212,175,55,0.15) 0%, rgba(26,22,18,0.9) 50%, rgba(212,175,55,0.1) 100%)',
                            backdropFilter: 'blur(12px)',
                        }}
                    >
                        <div className="text-center" style={{ fontFamily: 'Cinzel, serif' }}>
                            <div className="text-3xl font-bold tracking-wider" style={{ color: '#D4AF37', textShadow: '0 0 20px rgba(212,175,55,0.5)' }}>
                                🏛️ {ageCelebration}
                            </div>
                            <div className="text-sm text-stone-300 mt-1 tracking-widest uppercase">A new era begins</div>
                        </div>
                    </div>
                </div>
            )}
            {/* --- GAME OVER OVERLAY --- */}
            {stats.gameResult && stats.gameResult !== GameResult.PLAYING && (
                <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto"
                    style={{ background: stats.gameResult === GameResult.WON
                        ? 'radial-gradient(ellipse at center, rgba(34,197,94,0.15) 0%, rgba(0,0,0,0.7) 100%)'
                        : 'radial-gradient(ellipse at center, rgba(239,68,68,0.15) 0%, rgba(0,0,0,0.7) 100%)'
                    }}
                >
                    <div className="text-center" style={{ fontFamily: 'Cinzel, serif' }}>
                        <div className={`text-6xl font-bold tracking-wider mb-4 ${stats.gameResult === GameResult.WON ? 'text-emerald-400' : 'text-red-400'}`}
                            style={{
                                textShadow: stats.gameResult === GameResult.WON
                                    ? '0 0 30px rgba(34,197,94,0.6), 0 0 60px rgba(34,197,94,0.3)'
                                    : '0 0 30px rgba(239,68,68,0.6), 0 0 60px rgba(239,68,68,0.3)',
                            }}
                        >
                            {stats.gameResult === GameResult.WON ? '🏆 VICTORY' : '💀 DEFEAT'}
                        </div>
                        <div className="text-lg text-stone-300 mb-8 tracking-widest uppercase">
                            {stats.gameResult === GameResult.WON
                                ? (stats.victoryType === VictoryType.DOMINANCE
                                    ? 'Territorial dominance achieved'
                                    : 'The enemy civilization has fallen')
                                : 'Your civilization has been destroyed'}
                        </div>
                        <button
                            onClick={onQuit}
                            className="px-8 py-3 rounded-lg text-lg font-semibold tracking-wider transition-all duration-200 hover:scale-105 active:scale-95"
                            style={{
                                background: stats.gameResult === GameResult.WON
                                    ? 'linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(16,185,129,0.15) 100%)'
                                    : 'linear-gradient(135deg, rgba(239,68,68,0.3) 0%, rgba(185,28,28,0.15) 100%)',
                                border: `1px solid ${stats.gameResult === GameResult.WON ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
                                color: stats.gameResult === GameResult.WON ? '#4ade80' : '#f87171',
                            }}
                        >
                            Back to Menu
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- SUBCOMPONENTS ---

interface ResourceItemProps {
    icon: React.ReactNode;
    value: React.ReactNode;
    sub?: string;
}

const ResourceItem: React.FC<ResourceItemProps> = ({ icon, value, sub }) => (
    <div className="flex items-center gap-2">
        <div className="flex items-center justify-center">
            {icon}
        </div>
        <div className="flex items-baseline gap-1">
            <span className="font-cinzel font-semibold tracking-wide text-lg leading-none text-stone-100">{value}</span>
            {sub && <span className="text-[10px] text-stone-400 font-cinzel font-semibold tracking-wider opacity-80">{sub}</span>}
        </div>
    </div>
);

interface DockButtonProps {
    isActive: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}

const DockButton: React.FC<DockButtonProps> = ({ isActive, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`relative group p-2.5 rounded-md border transition-colors duration-200 flex items-center gap-2
            ${isActive ? 'bg-amber-600/90 border-amber-300/70 text-white shadow-[0_0_14px_rgba(212,175,55,.2)]' : 'border-transparent text-stone-400 hover:text-stone-100 hover:bg-white/[.06]'}
        `}
    >
        {icon}
        <span className={`text-xs font-cinzel font-semibold uppercase tracking-wider transition-all duration-300 ${isActive ? 'max-w-[100px] opacity-100 ml-1' : 'max-w-0 opacity-0 overflow-hidden'}`}>
            {label}
        </span>
        {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full"></div>}
    </button>
);

interface ActionButtonProps {
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    color: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, icon, label, color }) => (
    <button
        onClick={onClick}
        className={`flex flex-col items-center justify-center p-2 rounded-md border border-transparent hover:border-[var(--hud-line)] hover:bg-white/[.05] transition-colors ${color} gap-1 min-w-[60px]`}
    >
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
    </button>
);

// Helper to generate build icons based on category
const getBuildingsByCategory = (cat: string, stats: GameStats, onBuild: (type: BuildingType) => void) => {
    const list: React.ReactNode[] = [];
    const items = CATEGORY_BUILDINGS[cat as keyof typeof CATEGORY_BUILDINGS] ?? [];
    items.forEach(({ type, icon }) => {
        list.push(
            <BuildCard key={type} type={type} stats={stats} onClick={() => onBuild(type)} icon={icon} />
        );
    });
    return list;
};

interface TrainButtonProps {
    label: string;
    cost: { food: number; gold: number };
    stats: GameStats;
    onClick: () => void;
    icon: React.ReactNode;
}

const TrainButton: React.FC<TrainButtonProps> = ({ label, cost, stats, onClick, icon }) => {
    const canAfford = stats.resources.food >= cost.food && stats.resources.gold >= cost.gold;
    return (
        <button
            onClick={onClick}
            disabled={!canAfford}
            className={`flex flex-col items-center p-1.5 rounded-md border transition-all min-w-[64px]
                ${canAfford
                    ? 'bg-[#211d18] border-[var(--hud-line)] hover:border-red-400/70 hover:bg-[#30271f]'
                    : 'bg-black/20 border-white/5 opacity-40 cursor-not-allowed grayscale'}
            `}
        >
            <div className={`mb-0.5 ${canAfford ? 'text-red-400' : 'text-stone-600'}`}>{icon}</div>
            <span className="text-[9px] font-bold text-stone-300">{label}</span>
            <div className="flex gap-1 mt-0.5">
                <span className="text-[8px] text-yellow-500 font-mono">{cost.food}F</span>
                <span className="text-[8px] text-amber-500 font-mono">{cost.gold}G</span>
            </div>
        </button>
    );
};

interface BuildCardProps {
    type: BuildingType;
    stats: GameStats;
    onClick: () => void;
    icon: React.ReactNode;
}

const BuildCard: React.FC<BuildCardProps> = ({ type, stats, onClick, icon }) => {
    const b = BUILDINGS[type];
    const canAfford =
        stats.resources.wood >= b.cost.wood &&
        stats.resources.food >= b.cost.food &&
        stats.resources.gold >= b.cost.gold;

    return (
        <button
            onClick={onClick}
            disabled={!canAfford}
            className={`flex flex-col items-center p-2 rounded-md border transition-all min-w-[70px] group relative
                ${canAfford
                    ? 'bg-[#211d18] border-[var(--hud-line)] hover:border-amber-400/70 hover:bg-[#30271f]'
                    : 'bg-black/20 border-white/5 opacity-50 cursor-not-allowed grayscale'}
            `}
        >
            <div className={`mb-1 transition-colors ${canAfford ? 'text-stone-300 group-hover:text-amber-400' : 'text-stone-600'}`}>{icon}</div>
            <span className="text-[10px] font-bold text-stone-300 text-center leading-tight">{b.name}</span>

            {/* Cost Tooltip */}
            <div className="flex flex-col items-center mt-1 w-full gap-0.5">
                {b.cost.wood > 0 && <span className="text-[9px] text-emerald-400 font-mono">{b.cost.wood}W</span>}
                {b.cost.food > 0 && <span className="text-[9px] text-yellow-400 font-mono">{b.cost.food}F</span>}
                {b.cost.gold > 0 && <span className="text-[9px] text-amber-400 font-mono">{b.cost.gold}G</span>}
            </div>
        </button>
    );
};

const FormationButton: React.FC<{ type: FormationType, current: FormationType, icon: React.ReactNode }> = ({ type, current, icon }) => {
    const isActive = type === current;
    return (
        <button
            onClick={() => window.dispatchEvent(new CustomEvent('request-set-formation-ui', { detail: type }))}
            className={`p-2 rounded-md border transition-colors ${isActive
                ? 'bg-amber-600/90 border-amber-300/70 text-white shadow-[0_0_12px_rgba(212,175,55,.2)]'
                : 'bg-black/20 border-[var(--hud-line)] text-stone-400 hover:bg-white/[.06] hover:text-stone-200'
                }`}
            title={`Set Formation: ${type}`}
        >
            {icon}
        </button>
    );
};

const StanceButton: React.FC<{ type: UnitStance, current: UnitStance, icon: React.ReactNode }> = ({ type, current, icon }) => {
    const isActive = type === current;
    // Helper to map enum number to string or readable name
    const labels = {
        [UnitStance.AGGRESSIVE]: 'Aggressive',
        [UnitStance.DEFENSIVE]: 'Defensive',
        [UnitStance.HOLD]: 'Hold'
    };

    return (
        <button
            onClick={() => window.dispatchEvent(new CustomEvent('request-set-stance-ui', { detail: type }))}
            className={`p-2 rounded-md border transition-colors ${isActive
                ? 'bg-red-600/90 border-red-300/70 text-white shadow-[0_0_12px_rgba(239,68,68,.2)]'
                : 'bg-black/20 border-[var(--hud-line)] text-stone-400 hover:bg-white/[.06] hover:text-stone-200'
                }`}
            title={`Set Stance: ${labels[type]}`}
        >
            {icon}
        </button>
    );
};
