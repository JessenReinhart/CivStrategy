import React from 'react';
import { Crown } from 'lucide-react';

interface LoadingScreenProps {
    progress: number;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress }) => {
    return (
        <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center z-[100] transition-opacity duration-500">
            <div className="relative flex flex-col items-center gap-8 w-full max-w-md px-6">
                
                {/* Visual Icon */}
                <div className="relative group">
                    <div className="absolute inset-0 bg-amber-500/20 blur-2xl rounded-full scale-150 animate-pulse" />
                    <div className="relative w-24 h-24 rounded-full border-4 border-amber-500/30 flex items-center justify-center bg-stone-800/80 shadow-2xl">
                        <Crown size={48} className="text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                    </div>
                    {/* Rotating Rings */}
                    <div className="absolute -inset-4 border-2 border-dashed border-amber-500/20 rounded-full animate-[spin_10s_linear_infinite]" />
                    <div className="absolute -inset-8 border border-stone-700 rounded-full" />
                </div>

                {/* Progress Content */}
                <div className="w-full space-y-4">
                    <div className="flex justify-between items-end">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-serif text-stone-100 font-bold tracking-widest uppercase">Forging Realm</h2>
                            <p className="text-xs text-stone-500 font-bold tracking-[0.2em] uppercase">Constructing ancient foundations</p>
                        </div>
                        <div className="text-3xl font-mono text-amber-500 font-bold">
                            {Math.floor(progress * 100)}%
                        </div>
                    </div>

                    {/* Progress Bar Container */}
                    <div className="h-2 w-full bg-stone-800 rounded-full overflow-hidden border border-white/5 shadow-inner">
                        <div 
                            className="h-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600 transition-all duration-300 ease-out relative"
                            style={{ width: `${progress * 100}%` }}
                        >
                            {/* Shine Effect */}
                            <div className="absolute inset-0 bg-white/20 blur-sm" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                        </div>
                    </div>
                </div>

                {/* Aesthetic Footer */}
                <div className="flex items-center gap-4 text-stone-600">
                    <div className="h-px w-12 bg-stone-800" />
                    <span className="text-[10px] font-bold tracking-widest uppercase">Ancient Strategy</span>
                    <div className="h-px w-12 bg-stone-800" />
                </div>
            </div>
        </div>
    );
};