/**
 * UI Audio — Standalone lazy Web Audio helper for menu click sounds.
 * Initializes AudioContext synchronously on first call (must be from a user gesture).
 * Reuses the same subtle 'ui-click' procedural tone as ProceduralSoundSystem.
 */

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let initialized = false;

function ensureAudioContext(): AudioContext | null {
    if (initialized) return audioContext;
    try {
        const AudioCtx =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        audioContext = new AudioCtx();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.6;
        masterGain.connect(audioContext.destination);
        initialized = true;
    } catch (e) {
        console.warn('[uiAudio] AudioContext not available:', e);
        return null;
    }
    if (audioContext!.state === 'suspended') {
        audioContext!.resume();
    }
    return audioContext;
}

function noiseBurst(
    filterType: BiquadFilterType,
    frequency: number,
    q: number,
    attackSec: number,
    decaySec: number,
    volume: number,
    ctx: AudioContext
): GainNode {
    const source = ctx.createBufferSource();
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const envelope = Math.exp(-i / (data.length * 0.15));
        data[i] = (Math.random() * 2 - 1) * envelope;
    }
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackSec);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attackSec + decaySec);

    source.connect(filter);
    filter.connect(gain);
    source.start(now);
    source.stop(now + attackSec + decaySec + 0.05);
    return gain;
}

function tone(
    type: OscillatorType,
    frequency: number,
    attackSec: number,
    decaySec: number,
    volume: number,
    ctx: AudioContext
): GainNode {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attackSec);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attackSec + decaySec);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + attackSec + decaySec + 0.05);
    return gain;
}

/**
 * Apply stereo panning and connect the chain tail to masterGain.
 * This is the SOLE connection to masterGain — no direct source→masterGain.
 */
function applyPan(pan: number, gainNode: GainNode): void {
    const ctx = audioContext!;
    const merger = ctx.createChannelMerger(2);
    const leftGain = ctx.createGain();
    const rightGain = ctx.createGain();
    leftGain.gain.value = Math.max(0, Math.min(1, 1 - pan));
    rightGain.gain.value = Math.max(0, Math.min(1, 1 + pan));
    gainNode.connect(leftGain);
    gainNode.connect(rightGain);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
    merger.connect(masterGain!);
}

/**
 * Play a subtle UI click sound.
 * Safe to call multiple times; AudioContext created lazily on first call.
 */
export function uiClick(): void {
    const ctx = ensureAudioContext();
    if (!ctx || !masterGain) return;

    const volume = 0.08;

    // Highpass noise burst (same as ProceduralSoundSystem.playUIClick)
    const tickGain = noiseBurst('highpass', 3000, 1, 0.001, 0.02, volume, ctx);
    // Sine tick
    const clickGain = tone('sine', 1200, 0.002, 0.03, volume * 0.5, ctx);

    // Center pan (0) for UI sounds
    applyPan(0, tickGain);
    applyPan(0, clickGain);
}