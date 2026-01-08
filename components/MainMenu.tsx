import React from 'react';
import { FactionType } from '../types';
import { FACTION_COLORS } from '../constants';
import { Shield, Users, Sword } from 'lucide-react';

interface MainMenuProps {
  onStart: (faction: FactionType) => void;
}

const FACTION_INFO = {
  [FactionType.ROMANS]: {
    desc: 'Balanced economy and strong infantry. Easy to play.',
    bonus: '+10% Gold Generation',
    icon: Shield
  },
  [FactionType.GAULS]: {
    desc: 'Fast movement and cheap buildings. Aggressive playstyle.',
    bonus: '-10% Building Cost',
    icon: Sword
  },
  [FactionType.CARTHAGE]: {
    desc: 'Naval and trade focus. High population cap.',
    bonus: '+5 Max Population',
    icon: Users
  }
};

export const MainMenu: React.FC<MainMenuProps> = ({ onStart }) => {
  return (
    <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center text-stone-100 z-50 bg-[url('https://picsum.photos/1920/1080?grayscale&blur=2')] bg-cover">
      <div className="absolute inset-0 bg-black/60" />
      
      <div className="relative z-10 max-w-4xl w-full p-8">
        <h1 className="text-6xl font-serif text-center mb-4 text-amber-500 drop-shadow-lg tracking-wider">CIV STRATEGY</h1>
        <p className="text-center text-stone-300 mb-12 text-xl italic">Choose your civilization to conquer the ancient realms</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {Object.values(FactionType).map((faction) => {
            const info = FACTION_INFO[faction];
            const Icon = info.icon;
            const colorHex = '#' + FACTION_COLORS[faction].toString(16).padStart(6, '0');
            
            return (
              <button
                key={faction}
                onClick={() => onStart(faction)}
                className="group relative bg-stone-800/80 backdrop-blur-sm border-2 border-stone-600 rounded-xl p-6 hover:border-amber-500 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:shadow-amber-500/20 text-left"
              >
                <div 
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4 mx-auto transition-transform group-hover:scale-110"
                  style={{ backgroundColor: colorHex }}
                >
                   <Icon size={32} className="text-white" />
                </div>
                
                <h3 className="text-2xl font-bold text-center mb-2 text-stone-100">{faction}</h3>
                <p className="text-stone-400 text-sm text-center mb-4 min-h-[40px]">{info.desc}</p>
                
                <div className="bg-stone-900/50 rounded p-2 text-center">
                  <span className="text-amber-400 text-xs font-bold uppercase tracking-widest">Bonus</span>
                  <p className="text-stone-300 text-sm">{info.bonus}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
