import React, { useState } from 'react';
import { GameStats, BuildingType, ResourceType } from '../types';
import { BUILDINGS } from '../constants';
import { Pickaxe, Wheat, Coins, User, Smile, Home, Hammer, Tent, Sword, Trash2 } from 'lucide-react';

interface GameUIProps {
  stats: GameStats;
  onBuild: (type: BuildingType) => void;
  onSpawnUnit: () => void;
  onToggleDemolish: (isActive: boolean) => void;
  selectedCount: number;
}

export const GameUI: React.FC<GameUIProps> = ({ stats, onBuild, onSpawnUnit, onToggleDemolish, selectedCount }) => {
  const [activeTab, setActiveTab] = useState<'economy' | 'military'>('economy');
  const [demolishActive, setDemolishActive] = useState(false);

  const handleDemolishToggle = () => {
    const newState = !demolishActive;
    setDemolishActive(newState);
    onToggleDemolish(newState);
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
      {/* Top Bar - Resources */}
      <div className="bg-stone-900/90 text-stone-200 p-2 flex items-center justify-center gap-8 border-b-2 border-amber-700/50 backdrop-blur pointer-events-auto shadow-lg">
        <ResourceDisplay icon={<Pickaxe size={18} />} value={stats.resources.wood} label="Wood" color="text-emerald-400" />
        <ResourceDisplay icon={<Wheat size={18} />} value={stats.resources.food} label="Food" color="text-yellow-400" />
        <ResourceDisplay icon={<Coins size={18} />} value={stats.resources.gold} label="Gold" color="text-amber-400" />
        
        <div className="w-px h-8 bg-stone-700 mx-2" />
        
        <ResourceDisplay icon={<User size={18} />} value={`${stats.population}/${stats.maxPopulation}`} label="Pop" color="text-blue-300" />
        <ResourceDisplay icon={<Smile size={18} />} value={`${stats.happiness}%`} label="Happiness" color={stats.happiness < 50 ? 'text-red-400' : 'text-green-400'} />
      </div>

      {/* Center Notifications / Alerts area (Empty for now) */}
      <div className="flex-1"></div>

      {/* Bottom Bar - Controls */}
      <div className="bg-stone-900/95 border-t-2 border-amber-700/50 p-4 pointer-events-auto flex gap-6 items-end">
        
        {/* Minimap Placeholder */}
        <div className="w-48 h-48 bg-stone-800 border-2 border-stone-600 rounded hidden md:flex items-center justify-center text-stone-600 text-xs">
          Minimap Unavailable
        </div>

        {/* Action Panel */}
        <div className="flex-1 max-w-2xl bg-stone-800 rounded-lg border border-stone-700 overflow-hidden flex flex-col">
          {/* Tabs */}
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
             </div>
             
             <button 
               onClick={handleDemolishToggle}
               className={`p-1.5 rounded-full border transition-all ${demolishActive ? 'bg-red-900 border-red-500 text-red-200 animate-pulse' : 'bg-stone-700 border-stone-600 text-stone-400 hover:text-red-300'}`}
               title="Toggle Demolish Mode (Refund 75% Wood)"
             >
                <Trash2 size={16} />
             </button>
          </div>

          {/* Grid */}
          <div className="p-4 grid grid-cols-4 gap-3 h-32 overflow-y-auto">
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
                    building={BUILDINGS[BuildingType.TOWN_CENTER]} 
                    stats={stats}
                    onClick={() => onBuild(BuildingType.TOWN_CENTER)}
                    icon={<Tent size={20} />}
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

        {/* Selection Info */}
        <div className="w-64 bg-stone-800 border border-stone-700 rounded-lg p-4 h-48">
           <h3 className="text-amber-500 font-serif font-bold mb-2">Selection</h3>
           {demolishActive ? (
               <div className="text-red-400 text-sm font-bold animate-pulse">
                   DEMOLISH MODE ACTIVE
                   <p className="text-xs text-stone-400 mt-2 font-normal">Click a building to destroy it and refund 75% wood.</p>
                   <p className="text-xs text-stone-500 mt-4 italic">Right click to cancel.</p>
               </div>
           ) : selectedCount > 0 ? (
             <div className="space-y-2">
               <div className="text-stone-300 text-sm">Selected Soldiers: <span className="text-white font-bold">{selectedCount}</span></div>
               <div className="text-xs text-stone-500 italic mt-4">Right click to move.</div>
             </div>
           ) : (
             <div className="text-stone-500 text-sm italic">No soldiers selected.</div>
           )}
        </div>
      </div>
    </div>
  );
};

const ResourceDisplay = ({ icon, value, label, color }: any) => (
  <div className={`flex items-center gap-2 ${color} min-w-[80px]`}>
    {icon}
    <div className="flex flex-col leading-none">
      <span className="font-bold text-lg">{value}</span>
      <span className="text-[10px] uppercase opacity-70 tracking-wider text-stone-400">{label}</span>
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
      
      {/* Tooltip-ish Cost */}
      <div className="flex flex-wrap justify-center gap-1 w-full">
        {building.cost.wood > 0 && <span className="text-[10px] text-emerald-400">{building.cost.wood}W</span>}
        {building.cost.food > 0 && <span className="text-[10px] text-yellow-400">{building.cost.food}F</span>}
        {building.cost.gold > 0 && <span className="text-[10px] text-amber-400">{building.cost.gold}G</span>}
      </div>
    </button>
  );
};