import React from 'react';
import { Crown } from 'lucide-react';
import { GameLoadProgressDetail } from '../utils/gameLoading';

interface LoadingScreenProps {
    status: GameLoadProgressDetail;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ status }) => {
    const percentage = Math.floor(status.progress * 100);
    const hasWorkCounter = status.total !== undefined && status.processed !== undefined && status.total > 0;
    const failed = status.failed === true;

    return (
        <div className="absolute inset-0 bg-stone-900 flex flex-col items-center justify-center z-[100] transition-opacity duration-500">
            <div className="relative flex flex-col items-center gap-8 w-full max-w-md px-6">
                
                {/* Visual Icon */}
                <div className="relative group">
                    <div className={`absolute inset-0 blur-2xl rounded-full scale-150 ${failed ? 'bg-red-500/15' : 'bg-amber-500/20 animate-pulse'}`} />
                    <div className={`relative w-24 h-24 rounded-full border-4 flex items-center justify-center bg-stone-800/80 shadow-2xl ${failed ? 'border-red-500/30' : 'border-amber-500/30'}`}>
                        <Crown size={48} className={failed ? 'text-red-400' : 'text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]'} />
                    </div>
                    {/* Rotating Rings */}
                    <div className={`absolute -inset-4 border-2 border-dashed rounded-full ${failed ? 'border-red-500/20' : 'border-amber-500/20 animate-[spin_10s_linear_infinite]'}`} />
                    <div className="absolute -inset-8 border border-stone-700 rounded-full" />
                </div>

                {/* Progress Content */}
                <div className="w-full space-y-4">
                    <div className="flex justify-between items-end gap-6">
                        <div className="space-y-1 min-w-0">
                            <h2 className="text-2xl font-serif text-stone-100 font-bold tracking-widest uppercase">
                                {failed ? 'Realm generation failed' : 'Forging Realm'}
                            </h2>
                            <p className={`text-xs font-bold tracking-[0.16em] uppercase ${failed ? 'text-red-400' : 'text-amber-500/90 truncate'}`}>
                                {status.phase}
                            </p>
                        </div>
                        <div className={`font-mono font-bold tabular-nums ${failed ? 'text-base text-red-400 uppercase tracking-wider' : 'text-3xl text-amber-500'}`}>
                            {failed ? 'Failed' : `${percentage}%`}
                        </div>
                    </div>

                    {/* Progress Bar Container */}
                    <div className="h-2 w-full bg-stone-800 rounded-full overflow-hidden border border-white/5 shadow-inner">
                        <div 
                            className={`h-full transition-all duration-150 ease-out relative ${failed ? 'bg-red-500/70' : 'bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600'}`}
                            style={{ width: `${status.progress * 100}%` }}
                        >
                            {!failed && <div className="absolute inset-0 bg-white/20 blur-sm" />}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                        </div>
                    </div>

                    {failed ? (
                        <div role="alert" className="rounded-lg border border-red-500/20 bg-red-950/20 px-4 py-4 space-y-4">
                            <div>
                                <p className="text-[10px] text-red-300/70 font-bold tracking-widest uppercase">World generation stopped</p>
                                <p className="mt-1 text-sm text-stone-200 break-words">{status.detail}</p>
                            </div>
                            <a
                                href="./"
                                className="inline-flex w-full items-center justify-center rounded-md border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-red-100 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-400/60"
                            >
                                Return to main menu
                            </a>
                        </div>
                    ) : (
                        <div className="min-h-12 rounded-lg border border-white/5 bg-black/20 px-3 py-2 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-[10px] text-stone-500 font-bold tracking-widest uppercase">Current process</p>
                                <p className="text-sm text-stone-300 truncate">{status.detail}</p>
                            </div>
                            {hasWorkCounter && (
                                <div className="shrink-0 text-right font-mono tabular-nums">
                                    <p className="text-sm text-stone-200">{status.processed} / {status.total}</p>
                                    <p className="text-[9px] text-stone-600 uppercase tracking-wider">work units</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Aesthetic Footer */}
                <div className="flex items-center gap-4 text-stone-600">
                    <div className="h-px w-10 bg-stone-800" />
                    <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${failed ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                        {failed ? 'Load stopped' : 'Live world generation'}
                    </span>
                    <div className="h-px w-10 bg-stone-800" />
                </div>
            </div>
        </div>
    );
};