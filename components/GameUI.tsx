
import React, { useState, useEffect, useRef } from 'react';
import { GameStats, BuildingType, MapMode, UnitType, FormationType, UnitStance, Age, GameResult, VictoryType, TechId } from '../types';
import { BUILDINGS, AGE_CONFIGS, TECH_DEFS, UNIT_DAMAGE, UNIT_STATS, UNIT_ARMOR, DOMINANCE_HOLD_TIME_MS, UNIT_ABILITIES, ABILITY_CONFIG, BUILDING_UPKEEP } from '../constants';
import {
    Pickaxe, Wheat, Coins, User, Smile,
    Home, Hammer, Tent, Sword, Trash2,
    Rabbit, Sprout,
    Target, LogOut, Handshake,
    FastForward, Flame, Flower,
    X, Shield, Crown, Church,
    Zap, Crosshair, BookOpen, Check, Plus, Minus, GitBranch, Save, Circle, Activity, Grid, Triangle, Hand, Wrench,
    TreeDeciduous, Scroll, Settings
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
    onRequestRepair?: () => void;
    onFilterSelection?: (type: UnitType) => void;
    currentAge: Age;
    ageProgress: number;
    nextAge: Age | null;
    onAdvanceAge: () => void;
    onReleaseGarrison?: () => void;
    onDismissNotification?: (id: number) => void;
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

type GameNotification = GameStats['notifications'][number];

const notificationPresentation = (notification: GameNotification): { category: string; icon: React.ReactNode } => {
    const text = notification.text.toLowerCase();

    if (notification.personality || notification.senderName) {
        return { category: notification.senderName ?? 'Diplomacy', icon: <Sword size={19} strokeWidth={1.7} /> };
    }
    if (text.includes('research') || text.includes('technology') || text.includes('tech ')) {
        return { category: 'Research', icon: <BookOpen size={19} strokeWidth={1.7} /> };
    }
    if (text.includes('treaty') || text.includes('peace') || text.includes('diplom')) {
        return { category: 'Diplomacy', icon: <Handshake size={19} strokeWidth={1.7} /> };
    }
    if (text.includes('villager') || text.includes('population') || text.includes('happiness') || text.includes('peasant')) {
        return { category: 'Population', icon: <User size={19} strokeWidth={1.7} /> };
    }
    if (text.includes('enemy') || text.includes('attack') || text.includes('destroyed') || text.includes('lost')) {
        return { category: 'Military', icon: <Sword size={19} strokeWidth={1.7} /> };
    }
    if (text.includes('built') || text.includes('building') || text.includes('construction')) {
        return { category: 'Construction', icon: <Hammer size={19} strokeWidth={1.7} /> };
    }
    if (
        text.includes('food') || text.includes('wood') || text.includes('gold')
        || text.includes('resource') || text.includes('tax') || text.includes('depleted')
    ) {
        return { category: 'Economy', icon: <Wheat size={19} strokeWidth={1.7} /> };
    }

    return { category: 'Event', icon: <Circle size={18} strokeWidth={1.7} /> };
};

const formatNotificationAge = (timestamp: number): string => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 5) return 'now';
    if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
    const minutes = Math.floor(elapsedSeconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
};


export const GameUI: React.FC<GameUIProps> = ({
    stats, onBuild, onSpawnUnit, onToggleDemolish, onRegrowForest, onQuit, selectedCount, selectedCounts, selectedBuildingType, onDemolishSelected, onRequestRepair, onFilterSelection,
    onAdvanceAge, onReleaseGarrison, onDismissNotification
}) => {
    const [activeCategory, setActiveCategory] = useState<'economy' | 'military' | 'civic' | null>(null);
    const [demolishActive, setDemolishActive] = useState(false);
    const [gameSpeed, setGameSpeed] = useState(stats.gameSpeed);
    const [showTax, setShowTax] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [tiltShiftEnabled, setTiltShiftEnabled] = useState(stats.tiltShiftEnabled);
    const [tiltShiftBlur, setTiltShiftBlur] = useState(stats.tiltShiftBlur);

    useEffect(() => {
        setTiltShiftEnabled(stats.tiltShiftEnabled);
    }, [stats.tiltShiftEnabled]);

    useEffect(() => {
        setTiltShiftBlur(stats.tiltShiftBlur);
    }, [stats.tiltShiftBlur]);

    const handleSetTiltShift = (enabled: boolean) => {
        setTiltShiftEnabled(enabled);
        window.dispatchEvent(new CustomEvent('set-tilt-shift-enabled-ui', { detail: enabled }));
    };

    const handleToggleTiltShift = () => {
        handleSetTiltShift(!tiltShiftEnabled);
    };

    const handleTiltShiftBlurChange = (blur: number) => {
        setTiltShiftBlur(blur);
        window.dispatchEvent(new CustomEvent('set-tilt-shift-blur-ui', { detail: blur }));
    };
    const [showResearch, setShowResearch] = useState(false);
    const [showTreeView, setShowTreeView] = useState(true);
    const [ageCelebration, setAgeCelebration] = useState<string | null>(null);
    const prevAgeRef = useRef(stats.currentAge);

    useEffect(() => {
        setGameSpeed(stats.gameSpeed);
    }, [stats.gameSpeed]);

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
        const SPEED_OPTIONS = [0.5, 0.75, 1, 2, 3];
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
    const isPlayerBuildingSelected = selectedBuildingType !== null && stats.selectedBuildingOwner === 0;

    const netFood = stats.rates.food - stats.rates.foodConsumption;

    return (

        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 overflow-hidden">

            <div className="hud-top-row">
                <div className="hud-surface hud-main-ribbon pointer-events-auto flex items-center h-9 px-3 gap-3.5 bg-[#080808]/95 border border-white/10 rounded-lg shadow-2xl backdrop-blur-md text-stone-100 select-none">
                    {/* Wood */}
                    <div className="flex items-center gap-1.5" title="Wood">
                        <Pickaxe size={15} className="text-[#897f73]" />
                        <span className="font-bold text-xs text-[#b6b6b6] tabular-nums">{stats.resources.wood}</span>
                        <span className="text-[10px] text-[#88918c] tabular-nums font-mono">{stats.rates.wood >= 0 ? `+${stats.rates.wood}` : stats.rates.wood}</span>
                    </div>

                    {/* Food */}
                    <div className="flex items-center gap-1.5 relative" title="Food">
                        <Wheat size={15} className="text-[#a89858]" />
                        <div className="flex flex-col justify-center">
                            <div className="flex items-baseline gap-1">
                                <span className="font-bold text-xs text-[#e4e4e4] tabular-nums">{stats.resources.food}</span>
                                <span className={`text-[10px] tabular-nums font-mono ${netFood < 0 ? 'text-[#e06666] font-semibold' : 'text-[#88918c]'}`}>
                                    {netFood >= 0 ? `+${netFood}` : netFood}
                                </span>
                            </div>
                            {netFood < 0 && (
                                <span className="text-[7px] uppercase font-bold text-[#e06666] tracking-tighter leading-none -mt-0.5">
                                    DECLINING
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Gold */}
                    <div className="flex items-center gap-1.5" title="Gold">
                        <Coins size={15} className="text-[#b0a98c]" />
                        <span className="font-bold text-xs text-[#e0e0e0] tabular-nums">{stats.resources.gold}</span>
                        <span className="text-[10px] text-[#6b7a73] tabular-nums font-mono">+{stats.rates.gold}</span>
                    </div>

                    {/* Population with progress underline */}
                    <div className="flex flex-col justify-center min-w-[48px]" title="Population">
                        <div className="flex items-center gap-1.5">
                            <User size={15} className="text-[#7f90a0]" />
                            <span className="font-bold text-xs text-[#f0f1f5] tabular-nums">
                                {stats.population}/{stats.maxPopulation}
                            </span>
                        </div>
                        <div className="w-full h-[2px] bg-[#142020] rounded-full mt-0.5 overflow-hidden">
                            <div
                                className="h-full bg-[#596c73] transition-all duration-300"
                                style={{ width: `${Math.min(100, stats.maxPopulation > 0 ? (stats.population / stats.maxPopulation) * 100 : 0)}%` }}
                            />
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-4 bg-white/10 self-center" />

                    {/* Morale / Happiness */}
                    <div className="flex items-center gap-1 text-xs" title="Morale">
                        <Smile size={14} className={stats.happiness < 50 ? 'text-rose-400' : 'text-[#8da79e]'} />
                        <span className="text-xs text-[#848889] tabular-nums font-medium">{stats.happiness}%</span>
                    </div>

                    {/* Season */}
                    <div className="flex items-center gap-1.5 text-xs" title="Season">
                        <TreeDeciduous size={15} className="text-[#e99e65]" />
                        <span className="text-[9px] uppercase font-semibold tracking-wider text-[#8d8d8b]">
                            {stats.currentSeason}
                        </span>
                    </div>

                    {/* Diplomacy */}
                    <div className="flex items-center gap-1.5 text-xs" title="Diplomacy">
                        <Scroll size={15} className="text-[#e5d8c7]" />
                        <span className="text-[8.5px] uppercase font-semibold tracking-wider text-[#808281]">
                            {stats.peacefulMode ? 'PEACE' : stats.treatyTimeRemaining > 0 ? `TREATY: ${Math.ceil(stats.treatyTimeRemaining / 1000)}s` : 'AT WAR'}
                        </span>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-4 bg-white/10 self-center" />

                    {/* Age (Advance Age Button) */}
                    <button
                        type="button"
                        onClick={onAdvanceAge}
                        title={stats.nextAge ? `Advance to ${stats.nextAge}` : `Age: ${stats.currentAge}`}
                        className="flex items-center gap-1.5 text-xs group cursor-pointer hover:opacity-80 transition-opacity focus:outline-none"
                    >
                        <Zap size={14} className={stats.nextAge ? 'text-amber-300 animate-pulse' : 'text-[#8e908f]'} />
                        <span className="text-[8.5px] uppercase font-bold tracking-wider text-[#aeaeac] group-hover:text-white">
                            {stats.currentAge}
                        </span>
                    </button>

                    {/* Speed Controls Pill */}
                    <div className="flex items-center bg-[#1f201f] border border-[#2a2a28] rounded-full px-1.5 py-0.5 gap-1">
                        <button
                            type="button"
                            onClick={() => handleSpeedChange(Math.max(0.5, gameSpeed - 0.5))}
                            disabled={gameSpeed <= 0.5}
                            className="p-0.5 rounded text-[#9b9b99] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Decrease speed (-)"
                        >
                            <Minus size={11} />
                        </button>
                        {[
                            { speed: 0.5, label: '0.5×' },
                            { speed: 0.75, label: '0.75×' },
                            { speed: 1, label: '1×' },
                            { speed: 2, label: '2×' },
                            { speed: 3, label: '3×' },
                        ].map(({ speed, label }) => (
                            <button
                                key={speed}
                                type="button"
                                aria-label={label}
                                onClick={() => handleSpeedChange(speed)}
                                title={`Set speed ${label}`}
                                className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${
                                    gameSpeed === speed
                                        ? 'bg-[#414141] text-[#bfbfbf] font-bold'
                                        : 'text-[#6d6d6d] hover:text-stone-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => handleSpeedChange(Math.min(3, gameSpeed + 0.5))}
                            disabled={gameSpeed >= 3}
                            className="p-0.5 rounded text-[#989898] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="Increase speed (+)"
                        >
                            <Plus size={11} />
                        </button>
                    </div>

                    {/* Settings Icon (Gear) with Menu Dropdown */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowMenu(!showMenu)}
                            title="Settings"
                            className={`p-1 rounded text-[#9f9f9f] hover:text-white transition-colors cursor-pointer ${showMenu ? 'text-white' : ''}`}
                        >
                            <Settings size={15} />
                        </button>

                        {/* Menu Dropdown */}
                        {showMenu && (
                            <div className="hud-surface absolute top-9 right-0 flex flex-col gap-2 w-56 rounded-lg p-2 animate-in slide-in-from-top-2 fade-in duration-200 bg-stone-900/95 border border-white/10 shadow-2xl backdrop-blur-xl z-50">
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
                                <div className="px-2 py-1">
                                    <div className="flex justify-between items-center mb-2">
                                        <span
                                            onClick={handleToggleTiltShift}
                                            className="hud-kicker cursor-pointer select-none hover:text-amber-200 transition-colors"
                                        >
                                            Tilt-shift
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className={`font-mono text-[10px] ${tiltShiftEnabled ? 'text-amber-300' : 'text-stone-500'}`}>
                                                {tiltShiftEnabled ? `${Math.round(tiltShiftBlur * 100)}%` : 'OFF'}
                                            </span>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={tiltShiftEnabled}
                                                aria-label="Toggle tilt-shift effect"
                                                onClick={handleToggleTiltShift}
                                                className={`w-8 h-4 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer ${
                                                    tiltShiftEnabled ? 'bg-amber-600' : 'bg-stone-700'
                                                }`}
                                            >
                                                <span
                                                    className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                                                        tiltShiftEnabled ? 'translate-x-4' : 'translate-x-0'
                                                    }`}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                    {tiltShiftEnabled && (
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="2.5"
                                            step="0.05"
                                            value={tiltShiftBlur}
                                            onChange={(e) => handleTiltShiftBlurChange(parseFloat(e.target.value))}
                                            className="w-full accent-amber-500 h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer"
                                            title="Tilt-shift blur intensity"
                                        />
                                    )}
                                </div>
                                <div className="hud-rule h-px w-full" />
                                <button onClick={() => window.dispatchEvent(new CustomEvent('save-game'))} className="flex items-center gap-3 px-3 py-2 text-stone-200 hover:text-amber-200 hover:bg-white/5 rounded-md transition-colors text-sm cursor-pointer">
                                    <Save size={15} /> Save game <span className="ml-auto hud-kicker">Ctrl S</span>
                                </button>
                                <button onClick={() => window.dispatchEvent(new CustomEvent('load-game'))} className="flex items-center gap-3 px-3 py-2 text-stone-200 hover:text-amber-200 hover:bg-white/5 rounded-md transition-colors text-sm cursor-pointer">
                                    <BookOpen size={15} /> Load game
                                </button>
                                <button onClick={onQuit} className="flex items-center gap-3 px-3 py-2 text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-md transition-colors text-sm cursor-pointer">
                                    <LogOut size={15} /> Exit to menu
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Crown Icon (Tax) with Tax Slider Popover */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowTax(!showTax)}
                            title="Taxation"
                            className={`p-1 rounded text-[#a5a5a5] hover:text-amber-400 transition-colors cursor-pointer ${showTax ? 'text-amber-400' : ''}`}
                        >
                            <Crown size={15} />
                        </button>

                        {/* Floating Tax Slider Popover */}
                        {showTax && (
                            <div className="absolute top-9 right-0 w-64 p-4 bg-stone-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl flex flex-col gap-2 animate-in slide-in-from-top-2 fade-in duration-200 z-50">
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
                                <div className="text-[10px] text-stone-500 flex justify-between px-1">
                                    <span>Benevolent</span>
                                    <span>Tyrant</span>
                                </div>
                                <div className="mt-2 text-xs bg-white/5 p-2 rounded text-stone-300 text-center">
                                    Income: <span className="text-amber-400 font-bold">+{0.5 + stats.taxRate}g</span> / pop
                                </div>
                                <p className="text-[10px] text-stone-400">
                                    0% tax restores 1 happiness per second when food is available and housing is at most 80% full.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* --- DOMINANCE PROGRESS BAR --- */}
                {typeof stats.dominanceProgress === 'number' && stats.dominanceProgress > 0 && (
                    <div className="hud-dominance w-64 pointer-events-none">
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
                                        <h3 className="text-lg font-serif font-bold text-stone-100 flex items-center justify-between">
                                            {BUILDINGS[selectedBuildingType].name}
                                            <button onClick={() => window.dispatchEvent(new CustomEvent('clear-selection'))} className="text-stone-500 hover:text-white">
                                                <X size={16} />
                                            </button>
                                        </h3>
                                        <p className="text-xs text-stone-400 italic leading-tight mt-1">
                                            {BUILDINGS[selectedBuildingType].description}
                                        </p>
                                        {stats.selectedBuildingOwner !== null && stats.selectedBuildingOwner !== undefined && stats.selectedBuildingOwner !== 0 && (
                                            <span className="text-[10px] font-bold text-red-300 bg-red-950/40 border border-red-500/20 px-1.5 py-0.5 rounded w-fit mt-1.5">
                                                Enemy structure · inspection only
                                            </span>
                                        )}
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
                                                {stats.selectedBuildingInfo.production && (
                                                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/40 border border-emerald-400/20 px-1.5 py-0.5 rounded tabular-nums">
                                                        +{stats.selectedBuildingInfo.production.perTick} {stats.selectedBuildingInfo.production.resource}/tick
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-1 w-full">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Selected Group</span>
                                            <button onClick={() => window.dispatchEvent(new CustomEvent('clear-selection'))} className="text-stone-500 hover:text-white">
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
                                {isPlayerBuildingSelected && selectedBuildingType === BuildingType.LUMBER_CAMP && (
                                    <ActionButton onClick={onRegrowForest} icon={<Sprout size={18} />} label="Regrow" color="text-emerald-400" />
                                )}

                                {/* Barracks Actions */}
                                {isPlayerBuildingSelected && selectedBuildingType === BuildingType.BARRACKS && (
                                    <div className="flex gap-1 border-r border-white/10 pr-2 mr-2">
                                        <TrainButton
                                            unitType={UnitType.PIKESMAN}
                                            label="Pikesman"
                                            cost={{ food: 100, gold: 50 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.PIKESMAN)}
                                            icon={<Sword size={16} />}
                                        />
                                        <TrainButton
                                            unitType={UnitType.ARCHER}
                                            label="Archer"
                                            cost={{ food: 80, gold: 40 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.ARCHER)}
                                            icon={<Target size={16} />}
                                        />
                                        <TrainButton
                                            unitType={UnitType.CAVALRY}
                                            label="Cavalry"
                                            cost={{ food: 150, gold: 100 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.CAVALRY)}
                                            icon={<FastForward size={16} />}
                                        />
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.SLINGER) && (
                                          <TrainButton
                                            unitType={UnitType.SLINGER}
                                            label="Slinger"
                                            cost={{ food: 40, gold: 20 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.SLINGER)}
                                            icon={<Crosshair size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.AXEMAN) && (
                                          <TrainButton
                                            unitType={UnitType.AXEMAN}
                                            label="Axeman"
                                            cost={{ food: 120, gold: 60 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.AXEMAN)}
                                            icon={<Triangle size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.HOPLITE) && (
                                          <TrainButton
                                            unitType={UnitType.HOPLITE}
                                            label="Hoplite"
                                            cost={{ food: 200, gold: 150 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.HOPLITE)}
                                            icon={<Shield size={16} />}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.CHARIOT) && (
                                          <TrainButton
                                            unitType={UnitType.CHARIOT}
                                            label="Chariot"
                                            cost={{ food: 250, gold: 200 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.CHARIOT)}
                                            icon={<span className="text-cyan-400"><FastForward size={16} /></span>}
                                          />
                                        )}
                                        {AGE_CONFIGS[stats.currentAge].unlocksUnits.includes(UnitType.RAM) && (
                                          <TrainButton
                                            unitType={UnitType.RAM}
                                            label="Ram"
                                            cost={{ food: 100, gold: 80 }}
                                            stats={stats}
                                            onClick={() => onSpawnUnit(UnitType.RAM)}
                                            icon={<Shield size={16} />}
                                          />
                                        )}
                                    </div>
                                )}

                                {/* Repair Action (Only for player buildings below full HP) */}
                                {isPlayerBuildingSelected && selectedBuildingType && onRequestRepair
                                    && stats.selectedBuildingInfo && stats.selectedBuildingInfo.hp < stats.selectedBuildingInfo.maxHp && (
                                    <ActionButton
                                        onClick={onRequestRepair}
                                        icon={<Wrench size={18} />}
                                        label={stats.selectedBuildingInfo.isRepairing ? 'Repairing…' : 'Repair'}
                                        color={stats.selectedBuildingInfo.isRepairing ? 'text-emerald-400' : 'text-sky-400'}
                                    />
                                )}

                                {/* Demolish Action (Only for player buildings) */}
                                {isPlayerBuildingSelected && selectedBuildingType && (
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
                                        <div className="text-[10px] text-stone-500 font-bold px-2 uppercase tracking-wide">
                                            Right Click to Move
                                        </div>
                                    </div>
                                )}
                                {isPlayerBuildingSelected && selectedBuildingType === BuildingType.BARRACKS && (
                                    <div className="text-[10px] text-stone-500 font-bold px-2 uppercase tracking-wide max-w-[100px] leading-tight">
                                        Right Click map to set waypoint
                                    </div>
                                )}
                                {isPlayerBuildingSelected && selectedBuildingType === BuildingType.CASTLE && (
                                    <div className="flex flex-col gap-1.5 items-end">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-amber-400 bg-amber-900/30 px-2 py-1 rounded">
                                                🏰 Garrison: {stats.selectedBuildingInfo?.garrisonCount ?? 0} units
                                            </span>
                                        </div>
                                        {(stats.selectedBuildingInfo?.garrisonCount ?? 0) > 0 && onReleaseGarrison && (
                                            <ActionButton onClick={onReleaseGarrison} icon={<LogOut size={18} />} label="Release" color="text-emerald-400" />
                                        )}
                                        <div className="text-[10px] text-stone-500 font-bold px-2 uppercase tracking-wide max-w-[100px] leading-tight">
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
                                    <h3 className="text-sm font-bold text-stone-100 uppercase tracking-widest flex items-center gap-2">
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
                            <DockButton
                                isActive={activeCategory === 'economy'}
                                onClick={() => { setActiveCategory(activeCategory === 'economy' ? null : 'economy'); setShowResearch(false); }}
                                icon={<Pickaxe size={20} />}
                                label="Economy"
                            />
                            <DockButton
                                isActive={activeCategory === 'military'}
                                onClick={() => { setActiveCategory(activeCategory === 'military' ? null : 'military'); setShowResearch(false); }}
                                icon={<Sword size={20} />}
                                label="Military"
                            />
                            <DockButton
                                isActive={activeCategory === 'civic'}
                                onClick={() => { setActiveCategory(activeCategory === 'civic' ? null : 'civic'); if (activeCategory === 'civic') setShowResearch(false); }}
                                icon={<Tent size={20} />}
                                label="Civic"
                            />

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

            {/* AAA event feed: neutral surfaces, semantic hierarchy, and soft edge fade. */}
            {stats.notifications && stats.notifications.length > 0 && (
                <div
                    className="hud-notification-stack absolute top-16 xl:top-24 right-5 z-15 flex max-h-[calc(100vh-12rem)] w-[min(29rem,calc(100vw-2.5rem))] flex-col gap-2 overflow-y-auto pointer-events-auto"
                    aria-label="Recent events"
                >
                    <div className="px-4 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.24em] text-stone-500">
                        Recent events
                    </div>
                    {stats.notifications.slice(-5).reverse().map((notification, index) => {
                        const presentation = notificationPresentation(notification);
                        const isTaunt = !!notification.personality;
                        return (
                            <article
                                key={notification.id}
                                className={`hud-notification-card group flex min-h-[72px] items-center gap-3 px-4 py-3 text-stone-100 ${index >= 3 ? 'hidden xl:flex' : ''}`}
                                style={{ opacity: Math.max(0.48, 1 - index * 0.12) }}
                                data-severity={notification.severity}
                            >
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/25 text-stone-300">
                                    {presentation.icon}
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="mb-1 flex items-center gap-2">
                                        <span className="truncate text-[9px] font-semibold uppercase tracking-[0.2em] text-stone-500">
                                            {presentation.category}
                                        </span>
                                        {notification.severity === 'danger' && (
                                            <span className="text-[8px] font-medium uppercase tracking-[0.16em] text-stone-600">Critical</span>
                                        )}
                                    </div>
                                    <div className={`text-[14px] font-medium leading-snug text-stone-100 ${isTaunt ? 'italic' : ''}`}>
                                        {notification.text}
                                    </div>
                                </div>

                                <div className="flex shrink-0 self-start items-center gap-1.5 pt-0.5">
                                    <time className="whitespace-nowrap text-[10px] tabular-nums text-stone-500">
                                        {formatNotificationAge(notification.timestamp)}
                                    </time>
                                    <button
                                        type="button"
                                        onClick={() => onDismissNotification?.(notification.id)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-600 opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-white/[0.05] hover:text-stone-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                                        aria-label={`Dismiss notification: ${notification.text}`}
                                    >
                                        <X size={14} strokeWidth={1.6} />
                                    </button>
                                </div>
                            </article>
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
        <span className={`text-xs font-bold uppercase tracking-wider transition-all duration-300 ${isActive ? 'max-w-[100px] opacity-100 ml-1' : 'max-w-0 opacity-0 overflow-hidden'}`}>
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

    const renderBuildBtn = (type: BuildingType, icon: React.ReactNode) => (
        <BuildCard key={type} type={type} stats={stats} onClick={() => onBuild(type)} icon={icon} />
    );

    if (cat === 'economy') {
        list.push(renderBuildBtn(BuildingType.HOUSE, <Home size={18} />));
        list.push(renderBuildBtn(BuildingType.FARM, <Wheat size={18} />));
        list.push(renderBuildBtn(BuildingType.LUMBER_CAMP, <Pickaxe size={18} />));
        list.push(renderBuildBtn(BuildingType.HUNTERS_LODGE, <Rabbit size={18} />));
        list.push(renderBuildBtn(BuildingType.TOWN_CENTER, <Tent size={18} />));
        list.push(renderBuildBtn(BuildingType.MARKET, <Coins size={18} />));
    } else if (cat === 'civic') {
        list.push(renderBuildBtn(BuildingType.BONFIRE, <Flame size={18} />));
        list.push(renderBuildBtn(BuildingType.SMALL_PARK, <Flower size={18} />));
        list.push(renderBuildBtn(BuildingType.CATHEDRAL, <Church size={18} />));
    } else if (cat === 'military') {
        list.push(renderBuildBtn(BuildingType.BARRACKS, <Hammer size={18} />));
        list.push(renderBuildBtn(BuildingType.WALL, <Shield size={18} />));
        list.push(renderBuildBtn(BuildingType.CASTLE, <Crown size={18} />));
    }
    return list;
};

interface TrainButtonProps {
    label: string;
    unitType?: UnitType;
    cost: { food: number; gold: number };
    stats: GameStats;
    onClick: () => void;
    icon: React.ReactNode;
}

const TrainButton: React.FC<TrainButtonProps> = ({ label, unitType, cost, stats, onClick, icon }) => {
    const canAfford = stats.resources.food >= cost.food && stats.resources.gold >= cost.gold;
    const uStats = unitType ? UNIT_STATS[unitType] : undefined;
    const uDmg = unitType ? UNIT_DAMAGE[unitType] : undefined;
    const uArmor = unitType ? UNIT_ARMOR[unitType] : undefined;

    return (
        <div className="relative group">
            <button
                onClick={onClick}
                disabled={!canAfford}
                className={`flex flex-col items-center p-1.5 rounded-md border transition-all min-w-[64px] w-full
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

            {/* Unit Stats Tooltip */}
            {uStats && (
                <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-stone-900/95 border border-[var(--hud-line)] rounded-lg shadow-2xl pointer-events-none z-30 text-left backdrop-blur-md">
                    <div className="text-[11px] font-bold text-red-300 pb-1 border-b border-white/10 mb-1.5 flex items-center justify-between">
                        <span>{label}</span>
                        <span className="text-[9px] text-stone-400 font-mono">Squad: {uStats.squadSize}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] font-mono">
                        <div className="flex justify-between">
                            <span className="text-stone-400">HP:</span>
                            <span className="text-emerald-400 font-bold">{uStats.maxHp}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-400">Speed:</span>
                            <span className="text-stone-200">{uStats.speed}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-400">Range:</span>
                            <span className="text-stone-200">{uStats.range}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-stone-400">Atk Spd:</span>
                            <span className="text-stone-200">{(uStats.attackSpeed / 1000).toFixed(1)}s</span>
                        </div>
                    </div>

                    {/* Attack by Damage Type */}
                    {uDmg && (
                        <div className="mt-1.5 pt-1 border-t border-white/10">
                            <div className="text-[8px] text-stone-400 uppercase tracking-wider mb-0.5 font-bold">Attack</div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {Object.entries(uDmg).length > 0 ? (
                                    Object.entries(uDmg).map(([dmgType, val]) => (
                                        val ? (
                                            <span key={dmgType} className="text-[8px] font-mono px-1 py-0.2 rounded bg-stone-800 text-amber-300 border border-amber-500/20">
                                                {dmgType}: {val}
                                            </span>
                                        ) : null
                                    ))
                                ) : (
                                    <span className="text-[8px] text-stone-500 font-mono">None (0)</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Armor */}
                    {uArmor && (
                        <div className="mt-1 pt-1 border-t border-white/10">
                            <div className="text-[8px] text-stone-400 uppercase tracking-wider mb-0.5 font-bold">Armor</div>
                            <div className="grid grid-cols-3 gap-1 text-[8px] font-mono text-center">
                                <div className="bg-stone-800/80 px-1 py-0.5 rounded border border-white/5">
                                    <span className="text-stone-400 block text-[7px]">Hack</span>
                                    <span className="text-stone-200 font-bold">{uArmor.Hack ?? 0}</span>
                                </div>
                                <div className="bg-stone-800/80 px-1 py-0.5 rounded border border-white/5">
                                    <span className="text-stone-400 block text-[7px]">Pierce</span>
                                    <span className="text-stone-200 font-bold">{uArmor.Pierce ?? 0}</span>
                                </div>
                                <div className="bg-stone-800/80 px-1 py-0.5 rounded border border-white/5">
                                    <span className="text-stone-400 block text-[7px]">Crush</span>
                                    <span className="text-stone-200 font-bold">{uArmor.Crush ?? 0}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
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
    const upkeep = BUILDING_UPKEEP[type];
    const canAfford =
        stats.resources.wood >= b.cost.wood &&
        stats.resources.food >= b.cost.food &&
        stats.resources.gold >= b.cost.gold;

    return (
        <div className="relative group">
            <button
                onClick={onClick}
                disabled={!canAfford}
                className={`flex flex-col items-center p-2 rounded-md border transition-all min-w-[70px] w-full
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
                    {upkeep && upkeep.gold ? (
                        <div
                            className="flex items-center gap-0.5 text-[8px] font-mono text-amber-500 hover:text-amber-400"
                            title={`Passive upkeep drain: -${upkeep.gold} gold/tick`}
                        >
                            <Coins size={9} className="text-amber-400 shrink-0" />
                            <span>-{upkeep.gold} gold/tick</span>
                        </div>
                    ) : null}
                </div>
            </button>

            {/* Building Stats Tooltip */}
            <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 p-2 bg-stone-900/95 border border-[var(--hud-line)] rounded-lg shadow-2xl pointer-events-none z-30 text-left backdrop-blur-md">
                <div className="text-[11px] font-bold text-amber-300 pb-1 border-b border-white/10 mb-1.5 flex items-center justify-between">
                    <span>{b.name}</span>
                </div>
                {b.description && (
                    <p className="text-[9px] text-stone-400 italic mb-2 leading-tight">{b.description}</p>
                )}
                <div className="space-y-1 text-[9px] font-mono">
                    <div className="flex justify-between">
                        <span className="text-stone-400">HP:</span>
                        <span className="text-emerald-400 font-bold">{b.maxHp}</span>
                    </div>
                    {b.territoryRadius !== undefined && (
                        <div className="flex justify-between">
                            <span className="text-stone-400">Territory:</span>
                            <span className="text-sky-300">+{b.territoryRadius}</span>
                        </div>
                    )}
                    {b.populationBonus !== undefined && (
                        <div className="flex justify-between">
                            <span className="text-stone-400">Pop Bonus:</span>
                            <span className="text-amber-300">+{b.populationBonus}</span>
                        </div>
                    )}
                    {b.workerNeeds !== undefined && (
                        <div className="flex justify-between">
                            <span className="text-stone-400">Worker Slots:</span>
                            <span className="text-stone-200">{b.workerNeeds}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-stone-400">Build Time:</span>
                        <span className="text-stone-300">{b.type === BuildingType.HOUSE ? '5s' : 'Instant'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const FORMATION_TOOLTIPS: Record<FormationType, { label: string; desc: string }> = {
    [FormationType.LINE]: { label: 'Line', desc: '+20% Attack, -20% Speed' },
    [FormationType.CIRCLE]: { label: 'Circle', desc: '+25% Defense, -30% Speed' },
    [FormationType.SKIRMISH]: { label: 'Skirmish', desc: '+15% Dodge, +10% Speed' },
    [FormationType.WEDGE]: { label: 'Wedge', desc: '+10% Attack, +20% Speed' },
    [FormationType.BOX]: { label: 'Box', desc: 'Balanced (no modifiers)' }
};

const FormationButton: React.FC<{ type: FormationType, current: FormationType, icon: React.ReactNode }> = ({ type, current, icon }) => {
    const isActive = type === current;
    const tooltip = FORMATION_TOOLTIPS[type];
    return (
        <div className="relative group">
            <button
                onClick={() => window.dispatchEvent(new CustomEvent('request-set-formation-ui', { detail: type }))}
                className={`p-2 rounded-md border transition-colors ${isActive
                    ? 'bg-amber-600/90 border-amber-300/70 text-white shadow-[0_0_12px_rgba(212,175,55,.2)]'
                    : 'bg-black/20 border-[var(--hud-line)] text-stone-400 hover:bg-white/[.06] hover:text-stone-200'
                    }`}
            >
                {icon}
            </button>
            <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-stone-900/95 border border-[var(--hud-line)] rounded text-center whitespace-nowrap shadow-xl pointer-events-none z-30">
                <div className="text-xs font-semibold text-amber-300">{tooltip.label}</div>
                <div className="text-[10px] text-stone-300 font-mono">{tooltip.desc}</div>
            </div>
        </div>
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