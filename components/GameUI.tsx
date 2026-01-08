
import React, { useState } from 'react';
import { GameStats, BuildingType, MapMode } from '../types';
import { BUILDINGS, EVENTS } from '../constants';
import { Pickaxe, Wheat, Coins, User, Smile, Home, Hammer, Tent, Sword, Trash2, Rabbit, Flower, Flame, Sprout, AlertTriangle, Map as MapIcon, Infinity as InfinityIcon, Target, LogOut } from 'lucide-react';

interface GameUIProps {
  stats: GameStats;
  onBuild: (type: BuildingType) => void;
  onSpawnUnit: () => void;
  onToggleDemolish: (isActive: boolean) => void;
  onRegrowForest: () => void;
  onQuit: () => void;
  selectedCount: number;
  selectedBuildingType: BuildingType | null;
}

export const GameUI: React.FC<GameUIProps> = ({ stats, onBuild, onSpawnUnit, onToggleDemolish, onRegrowForest, onQuit, selectedCount, selectedBuildingType }) => {
  const [activeTab, setActiveTab] = useState<'economy' | 'military' | 'civic'>('economy');
  const [demolishActive, setDemolishActive] = useState(false);

  const handleDemolishToggle = () => {
    const newState = !demolishActive;
    setDemolishActive(newState);
    onToggleDemolish(newState);
  };

  const handleTaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const event = new CustomEvent('set-tax-rate-ui', { detail: parseInt(e.target.value) });
      window.dispatchEvent(event);
  };

  const handleCenterCamera = () => {
      const event = new CustomEvent('center-camera-ui');
      window.dispatchEvent(event);
  };

  const happinessTrend = stats.happinessChange > 0 ? `+${stats.happinessChange}` : `${stats.happinessChange}`;
  const happinessColor = stats.happiness < 40 ? 'text-red-500' : stats.happiness < 70 ? 'text-yellow-400' : 'text-green-400';
  const isLowEfficiency = stats.happiness < 50;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
      {/* Top Bar - Resources */}
      <div className="bg-stone-900/90 text-stone-200 p-2 flex items-center justify-between px-6 border-b-2 border-amber-700/50 backdrop-blur pointer-events-auto shadow-lg">
        {/* Left Side Controls */}
        <div className="flex items-center gap-2">
            <button
                onClick={onQuit}
                className="bg-red-900/40 hover:bg-red-900 text-red-200 border border-red-800 p-1.5 rounded flex items-center gap-2 text-xs transition-colors"
                title="Quit to Menu"
            >
                <LogOut size={14} />
                <span className="font-bold">QUIT</span>
            </button>
            <div className="flex items-center gap-4 bg-stone-800/50 px-3 py-1 rounded-full border border-stone-700 ml-2">
                 <div className="text-amber-500" title={stats.mapMode}>
                     {stats.mapMode === MapMode.FIXED ? <MapIcon size={18}/> : <InfinityIcon size={18}/>}
                 </div>
                 <button 
                    onClick={handleCenterCamera}
                    className="text-stone-400 hover:text-amber-500 transition-colors"
                    title="Center Camera on Town Center"
                 >
                     <Target size={18} />
                 </button>
            </div>
        </div>

        {/* Center Resources */}
        <div className="flex items-center gap-6">
            <ResourceDisplay 
                icon={<Pickaxe size={18} />} 
                value={stats.resources.wood} 
                label="Wood" 
                color="text-emerald-400" 
                rate={`+${stats.rates.wood}`}
            />
            <ResourceDisplay 
                icon={<Wheat size={18} />} 
                value={stats.resources.food} 
                label="Food" 
                color="text-yellow-400" 
                rate={`+${stats.rates.food} / -${stats.rates.foodConsumption}`}
            />
            <ResourceDisplay 
                icon={<Coins size={18} />} 
                value={stats.resources.gold} 
                label="Gold" 
                color="text-amber-400" 
                rate={`+${stats.rates.gold}`}
            />
            
            <div className="w-px h-8 bg-stone-700 mx-2" />
            
            <ResourceDisplay icon={<User size={18} />} value={`${stats.population}/${stats.maxPopulation}`} label="Pop" color="text-blue-300" />
            <div className="flex flex-col items-center">
                 <ResourceDisplay 
                    icon={<Smile size={18} />} 
                    value={`${stats.happiness}%`} 
                    label="Happiness" 
                    color={happinessColor} 
                    rate={happinessTrend}
                />
                {isLowEfficiency && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-900/50 px-1 rounded animate-pulse">
                        <AlertTriangle size={10} />
                        <span>Low Efficiency</span>
                    </div>
                )}
            </div>
        </div>
        
        {/* Spacer for right alignment balance */}
        <div className="w-24"></div>
      </div>

      {/* Tax Controls (Top Right) */}
      <div className="absolute top-20 right-4 pointer-events-auto bg-stone-800 p-4 rounded border border-stone-600 shadow-xl">
          <div className="flex items-center gap-2 mb-2">
              <Coins size={16} className="text-amber-400"/>
              <span className="font-bold text-sm text-stone-200">Tax Rate</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="5" 
            step="1" 
            value={stats.taxRate || 0} 
            onChange={handleTaxChange}
            className="w-32 accent-amber-500"
          />
          <div className="flex justify-between text-[10px] text-stone-400 mt-1">
              <span>Low</span>
              <span>Cruel</span>
          </div>
          <div className="mt-2 text-xs text-center text-stone-300">
              <div className="mb-1 text-amber-400 font-bold">Income: {0.5 + stats.taxRate}g / pop</div>
              {stats.taxRate === 0 && "Happy (+1 ☺/s)"}
              {stats.taxRate > 0 && `${[1, 0, -1, -3, -6, -10][stats.taxRate]} Happiness/s`}
          </div>
      </div>

      {/* Bottom Bar - Controls */}
      <div className="bg-stone-900/95 border-t-2 border-amber-700/50 p-4 pointer-events-auto flex gap-6 items-end">
        <div className="w-48 h-48 bg-stone-800 border-2 border-stone-600 rounded flex flex-col items-center justify-center text-stone-600 text-xs gap-2">
          <MapIcon size={24} className="opacity-20" />
          <span className="opacity-50">Strategic Map</span>
          <span className="text-[10px] text-amber-900">{stats.mapMode}</span>
        </div>

        <div className="flex-1 max-w-2xl bg-stone-800 rounded-lg border border-stone-700 overflow-hidden flex flex-col">
          <div className="flex border-b border-stone-700 items-center justify-between pr-2">
             <div className="flex">
                <button 
                className={`px-6 py-2 text-sm font-bold transition-colors ${activeTab === 'economy' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}
                onClick={() => setActiveTab('economy')}
                >
                Economy
                </button>
                <button 
                className={`px-6 py-2 text-sm font-bold transition-colors ${activeTab === 'military' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}
                onClick={() => setActiveTab('military')}
                >
                Military
                </button>
                <button 
                className={`px-6 py-2 text-sm font-bold transition-colors ${activeTab === 'civic' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'}`}
                onClick={() => setActiveTab('civic')}
                >
                Civic
                </button>
             </div>
             
             <button 
               onClick={handleDemolishToggle}
               className={`p-1.5 rounded-full border transition-all ${demolishActive ? 'bg-red-900 border-red-500 text-red-200 animate-pulse' : 'bg-stone-700 border-stone-600 text-stone-400 hover:text-red-300'}`}
               title="Toggle Demolish Mode"
             >
                <Trash2 size={16} />
             </button>
          </div>

          <div className="p-4 grid grid-cols-5 gap-3 h-32 overflow-y-auto">
            {activeTab === 'economy' && (
              <>
                 <BuildButton 
                    building={BUILDINGS[BuildingType.HOUSE]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.HOUSE)}
                    icon={<Home size={20} />}
                 />
                 <BuildButton 
                    building={BUILDINGS[BuildingType.FARM]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.FARM)}
                    icon={<Wheat size={20} />}
                 />
                 <BuildButton 
                    building={BUILDINGS[BuildingType.LUMBER_CAMP]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.LUMBER_CAMP)}
                    icon={<Pickaxe size={20} />}
                 />
                 <BuildButton 
                    building={BUILDINGS[BuildingType.HUNTERS_LODGE]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.HUNTERS_LODGE)}
                    icon={<Rabbit size={20} />}
                 />
                  <BuildButton 
                    building={BUILDINGS[BuildingType.TOWN_CENTER]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.TOWN_CENTER)}
                    icon={<Tent size={20} />}
                 />
              </>
            )}

            {activeTab === 'civic' && (
              <>
                 <BuildButton 
                    building={BUILDINGS[BuildingType.BONFIRE]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.BONFIRE)}
                    icon={<Flame size={20} />}
                 />
                 <BuildButton 
                    building={BUILDINGS[BuildingType.SMALL_PARK]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.SMALL_PARK)}
                    icon={<Flower size={20} />}
                 />
              </>
            )}

            {activeTab === 'military' && (
              <>
                <BuildButton 
                    building={BUILDINGS[BuildingType.BARRACKS]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.BARRACKS)}
                    icon={<Hammer size={20} />}
                 />
                 <button 
                   onClick={onSpawnUnit}
                   className="flex flex-col items-center justify-center p-2 bg-stone-700 rounded hover:bg-stone-600 active:scale-95 transition-all border border-stone-600 hover:border-red-500 group"
                   disabled={stats.resources.food < 100 || stats.resources.gold < 50}
                 >
                    <Sword size={24} className="mb-1 text-red-400 group-hover:text-red-200" />
                    <span className="text-xs font-bold text-stone-200">Train Soldier</span>
                    <div className="flex flex-col text-[9px] text-yellow-500 mt-1 leading-tight">
                        <span>100 Food</span>
                        <span>50 Gold</span>
                    </div>
                 </button>
              </>
            )}
          </div>
        </div>

        <div className="w-64 bg-stone-800 border border-stone-700 rounded-lg p-4 h-48">
           <h3 className="text-amber-500 font-serif font-bold mb-2">Selection</h3>
           {demolishActive ? (
               <div className="text-red-400 text-sm font-bold animate-pulse">
                   DEMOLISH MODE ACTIVE
                   <p className="text-xs text-stone-400 mt-2 font-normal">Refund 75% Wood.</p>
               </div>
           ) : selectedBuildingType ? (
               <div className="space-y-3">
                   <div className="text-stone-200 font-bold border-b border-stone-600 pb-1">{selectedBuildingType}</div>
                   <div className="text-xs text-stone-400">{BUILDINGS[selectedBuildingType].description}</div>
                   {selectedBuildingType === BuildingType.LUMBER_CAMP && (
                       <button 
                           onClick={onRegrowForest}
                           disabled={stats.resources.wood < 50}
                           className="w-full mt-2 flex items-center justify-center gap-2 p-2 bg-emerald-900/50 hover:bg-emerald-800 border border-emerald-700 rounded transition-colors disabled:opacity-50"
                       >
                           <Sprout size={16} className="text-emerald-400" />
                           <span className="text-xs font-bold text-emerald-100">Regrow (50W)</span>
                       </button>
                   )}
               </div>
           ) : selectedCount > 0 ? (
             <div className="space-y-2">
               <div className="text-stone-300 text-sm">Units: <span className="text-white font-bold">{selectedCount}</span></div>
               <div className="text-xs text-stone-500 italic mt-4">Right click to move.</div>
             </div>
           ) : (
             <div className="text-stone-500 text-sm italic">Nothing selected.</div>
           )}
        </div>
      </div>
    </div>
  );
};

const ResourceDisplay = ({ icon, value, label, color, rate }: any) => (
  <div className={`flex items-center gap-2 ${color} min-w-[80px]`}>
    {icon}
    <div className="flex flex-col leading-none">
      <span className="font-bold text-lg">{value}</span>
      <div className="flex gap-2 items-center">
        <span className="text-[10px] uppercase opacity-70 tracking-wider text-stone-400">{label}</span>
        {rate && <span className="text-[9px] font-mono opacity-80">{rate}</span>}
      </div>
    </div>
  </div>
);

const BuildButton = ({ building, stats, onClick, icon }: any) => {
  const canAfford = 
    stats.resources.wood >= building.cost.wood &&
    stats.resources.food >= building.cost.food &&
    stats.resources.gold >= building.cost.gold;

  return (
    <button 
      onClick={onClick}
      disabled={!canAfford}
      className={`relative flex flex-col items-center justify-center p-2 rounded border transition-all group
        ${canAfford 
          ? 'bg-stone-700 hover:bg-stone-600 border-stone-600 hover:border-amber-500 active:scale-95' 
          : 'bg-stone-800 border-stone-700 opacity-50 cursor-not-allowed grayscale'}`}
    >
      <div className={`mb-1 ${canAfford ? 'text-amber-200' : 'text-stone-500'}`}>{icon}</div>
      <span className="text-xs font-bold text-stone-200 text-center leading-tight mb-1">{building.name}</span>
      <div className="flex flex-wrap justify-center gap-1 w-full">
        {building.cost.wood > 0 && <span className="text-[10px] text-emerald-400">{building.cost.wood}W</span>}
        {building.cost.food > 0 && <span className="text-[10px] text-yellow-400">{building.cost.food}F</span>}
        {building.cost.gold > 0 && <span className="text-[10px] text-amber-400">{building.cost.gold}G</span>}
      </div>
    </button>
  );
};
