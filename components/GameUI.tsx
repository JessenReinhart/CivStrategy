
import React, { useState, useEffect } from 'react';
import { GameStats, BuildingType, MapMode, UnitType } from '../types';
import { BUILDINGS, EVENTS } from '../constants';
import {
    Pickaxe, Wheat, Coins, User, Smile,
    Home, Hammer, Tent, Sword, Trash2,
    Rabbit, Sprout,
    Target, LogOut, Handshake, Clock,
    Menu, FastForward, Flame, Flower,
    X, Shield, Crown
} from 'lucide-react';

interface GameUIProps {
    stats: GameStats;
    onBuild: (type: BuildingType) => void;
    onSpawnUnit: () => void;
    onToggleDemolish: (isActive: boolean) => void;
    onRegrowForest: () => void;
    onQuit: () => void;
    selectedCount: number;
    selectedCounts?: Record<string, number>;
    selectedBuildingType: BuildingType | null;
    onDemolishSelected: () => void;
    onFilterSelection?: (type: UnitType) => void;
}

export const GameUI: React.FC<GameUIProps> = ({
    stats, onBuild, onSpawnUnit, onToggleDemolish, onRegrowForest, onQuit, selectedCount, selectedCounts, selectedBuildingType, onDemolishSelected, onFilterSelection
}) => {
    const [activeCategory, setActiveCategory] = useState<'economy' | 'military' | 'civic' | null>(null);
    const [demolishActive, setDemolishActive] = useState(false);
    const [gameSpeed, setGameSpeed] = useState(0.5); // Match default MainScene speed
    const [showTax, setShowTax] = useState(false);
    const [showMenu, setShowMenu] = useState(false);

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

    // Close build menu when selecting something
    useEffect(() => {
        if ((selectedCount > 0 || selectedBuildingType) && activeCategory !== null) {
            const timer = setTimeout(() => setActiveCategory(null), 0);
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
            <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-auto">
                <div className="flex items-center gap-6 px-8 py-3 bg-black/60 backdrop-blur-xl rounded-full border border-white/10 shadow-2xl text-stone-100 transition-all hover:bg-black/70">
                    <ResourceItem
                        icon={<Pickaxe size={16} className="text-emerald-400" />}
                        value={stats.resources.wood}
                        sub={stats.rates.wood > 0 ? `+${stats.rates.wood}` : undefined}
                    />
                    <div className="w-px h-8 bg-white/10" />
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
                    <div className="w-px h-8 bg-white/10" />
                    <ResourceItem
                        icon={<Coins size={16} className="text-amber-400" />}
                        value={stats.resources.gold}
                        sub={stats.rates.gold > 0 ? `+${stats.rates.gold}` : undefined}
                    />
                    <div className="w-px h-8 bg-white/10" />
                    <ResourceItem
                        icon={<User size={16} className="text-blue-300" />}
                        value={`${stats.population}/${stats.maxPopulation}`}
                    />
                    <div className="w-px h-8 bg-white/10" />
                    <div className="flex flex-col items-center min-w-[60px]">
                        <div className={`flex items-center gap-2 font-bold text-lg ${stats.happiness < 50 ? 'text-red-400' : 'text-green-400'}`}>
                            <Smile size={16} />
                            <span>{stats.happiness}%</span>
                        </div>
                        {stats.happiness < 50 && (
                            <span className="text-[10px] text-red-400 animate-pulse font-bold tracking-wider">REVOLT RISK</span>
                        )}
                    </div>
                </div>
            </div>

            {/* --- TOP RIGHT: SYSTEM CONTROLS --- */}
            <div className="absolute top-6 right-6 flex flex-col items-end gap-3 pointer-events-auto">
                {/* Main Controls Group */}
                <div className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl">
                    {/* Speed */}
                    <div className="flex bg-white/5 rounded-xl p-1 gap-1">
                        {[0.5, 1, 2].map(s => (
                            <button
                                key={s}
                                onClick={() => handleSpeedChange(s)}
                                className={`p-1.5 rounded-lg transition-all min-w-[32px] text-xs font-bold ${gameSpeed === s ? 'bg-amber-600 text-white shadow-lg' : 'text-stone-400 hover:text-white hover:bg-white/10'}`}
                            >
                                {s}x
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-1" />

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
                                <div className="text-[10px] text-stone-500 flex justify-between px-1">
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
                    <div className="flex flex-col gap-2 w-40 animate-in slide-in-from-top-2 fade-in duration-200">
                        <button onClick={onQuit} className="flex items-center gap-3 px-4 py-3 bg-red-900/80 backdrop-blur hover:bg-red-800 text-red-100 rounded-xl border border-red-700/50 shadow-xl transition-all font-bold text-sm">
                            <LogOut size={16} />
                            Quit Game
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
                    <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-1 min-w-[400px] shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300">
                        <div className="flex items-stretch">
                            {/* Icon Section */}
                            <div className="w-24 bg-white/5 rounded-xl flex items-center justify-center shrink-0">
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
                                            <button onClick={() => window.dispatchEvent(new CustomEvent(EVENTS.SELECTION_CHANGED, { detail: 0 }))} className="text-stone-500 hover:text-white">
                                                <X size={16} />
                                            </button>
                                        </h3>
                                        <p className="text-xs text-stone-400 italic leading-tight mt-1">
                                            {BUILDINGS[selectedBuildingType].description}
                                        </p>
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-1 w-full">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Selected Group</span>
                                            <button onClick={() => window.dispatchEvent(new CustomEvent(EVENTS.SELECTION_CHANGED, { detail: 0 }))} className="text-stone-500 hover:text-white">
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
                                                        {type === UnitType.SOLDIER && <Sword size={14} className="text-red-400" />}
                                                        {type === UnitType.ARCHER && <Target size={14} className="text-emerald-400" />}
                                                        {type === UnitType.CAVALRY && <FastForward size={14} className="text-amber-400" />}
                                                        {type === UnitType.VILLAGER && <Pickaxe size={14} className="text-yellow-400" />}
                                                        {type === UnitType.LEGION && <Shield size={14} className="text-blue-400" />}
                                                        <span className="text-xs font-bold text-stone-200 uppercase tracking-wider">{type}</span>
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

                                {/* Demolish Action (Only for buildings) */}
                                {selectedBuildingType && (
                                    <ActionButton onClick={onDemolishSelected} icon={<Trash2 size={18} />} label="Demolish" color="text-red-400" />
                                )}

                                {/* No Actions Placeholder */}
                                {!selectedBuildingType && selectedCount > 0 && (
                                    <div className="text-[10px] text-stone-500 font-bold px-2 uppercase tracking-wide">
                                        Right Click to Move
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* B. BUILD MODE (Visible only when nothing selected) */}
                {!hasSelection && (
                    <div className="flex flex-col items-center gap-3">

                        {/* Expanded Build Panel (Pop-up) */}
                        {activeCategory && (
                            <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200 mb-2">
                                <div className="flex gap-2">
                                    {getBuildingsByCategory(activeCategory, stats, onBuild, onSpawnUnit)}
                                </div>
                            </div>
                        )}

                        {/* Main Dock */}
                        <div className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl">
                            <DockButton
                                isActive={activeCategory === 'economy'}
                                onClick={() => setActiveCategory(activeCategory === 'economy' ? null : 'economy')}
                                icon={<Pickaxe size={20} />}
                                label="Economy"
                            />
                            <DockButton
                                isActive={activeCategory === 'military'}
                                onClick={() => setActiveCategory(activeCategory === 'military' ? null : 'military')}
                                icon={<Sword size={20} />}
                                label="Military"
                            />
                            <DockButton
                                isActive={activeCategory === 'civic'}
                                onClick={() => setActiveCategory(activeCategory === 'civic' ? null : 'civic')}
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
            <span className="font-bold text-lg leading-none">{value}</span>
            {sub && <span className="text-[10px] text-stone-400 font-mono font-bold opacity-80">{sub}</span>}
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
        className={`relative group p-3 rounded-xl transition-all duration-300 flex items-center gap-2
            ${isActive ? 'bg-amber-600 text-white shadow-lg -translate-y-1' : 'text-stone-400 hover:text-white hover:bg-white/10'}
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
        className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-white/10 transition-colors ${color} gap-1 min-w-[60px]`}
    >
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
    </button>
);

// Helper to generate build icons based on category
const getBuildingsByCategory = (cat: string, stats: GameStats, onBuild: (type: BuildingType) => void, onSpawnUnit: () => void) => {
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
    } else if (cat === 'civic') {
        list.push(renderBuildBtn(BuildingType.BONFIRE, <Flame size={18} />));
        list.push(renderBuildBtn(BuildingType.SMALL_PARK, <Flower size={18} />));
    } else if (cat === 'military') {
        list.push(renderBuildBtn(BuildingType.BARRACKS, <Hammer size={18} />));
        // Special Unit Card
        const canAffordUnit = stats.resources.food >= 100 && stats.resources.gold >= 50;
        list.push(
            <button
                key="unit"
                onClick={onSpawnUnit}
                disabled={!canAffordUnit}
                className={`flex flex-col items-center p-2 rounded-xl border transition-all min-w-[70px]
                    ${canAffordUnit
                        ? 'bg-stone-800 border-stone-600 hover:border-red-500 hover:bg-stone-700 cursor-pointer'
                        : 'bg-stone-900/50 border-stone-800 opacity-50 cursor-not-allowed'}
                `}
            >
                <Sword size={20} className="mb-1 text-red-400" />
                <span className="text-[10px] font-bold text-stone-300">Soldier</span>
                <div className="flex gap-1 mt-1">
                    <span className="text-[9px] text-yellow-500">100F</span>
                    <span className="text-[9px] text-amber-500">50G</span>
                </div>
            </button>
        );
    }
    return list;
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
            className={`flex flex-col items-center p-2 rounded-xl border transition-all min-w-[70px] group relative
                ${canAfford
                    ? 'bg-stone-800 border-stone-600 hover:border-amber-500 hover:bg-stone-700 hover:-translate-y-1 shadow-lg'
                    : 'bg-stone-900/50 border-stone-800 opacity-50 cursor-not-allowed grayscale'}
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
