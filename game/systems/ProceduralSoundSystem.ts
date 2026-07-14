import { MainScene } from '../MainScene';
import { toIso } from '../utils/iso';

/**
 * ProceduralSoundSystem — Zero-dependency SFX via Web Audio API.
 *
 * All sounds are synthesized at runtime. No audio files are loaded.
 * Designed for a gritty, atmospheric pre-medieval aesthetic.
 *
 * Node graph contract: every effect builds `source → [filter] → gain`
 * (the envelope `gain` is the chain tail). Scheduling (`start`/`stop` +
 * `activeSources` eviction) is separated from connection. The chain tail
 * is wired to output via `applyPan`, which is the SOLE connection to
 * `masterGain` — no raw source/oscillator ever connects directly to it.
 */
export class ProceduralSoundSystem {
    private scene: MainScene;
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private ambienceGain: GainNode | null = null;
    private windNode: AudioBufferSourceNode | null = null;
    private windFilter: BiquadFilterNode | null = null;
    private windLfo: OscillatorNode | null = null;
    private windLfoGain: GainNode | null = null;
    private initialized = false;
    private activeSources: AudioBufferSourceNode[] = [];
    private readonly MAX_CONCURRENT = 16;

    // Pre-generated noise buffers (created once at init)
    private noiseBufferShort: AudioBuffer | null = null;
    private noiseBufferMedium: AudioBuffer | null = null;
    private noiseBufferLong: AudioBuffer | null = null;

    private _muted = false;
    private _volume = 0.6;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    /**
     * Lazy-initialize AudioContext on first user interaction.
     * Browsers block AudioContext creation until a user gesture.
     */
    private ensureAudioContext(): AudioContext | null {
        if (this._muted) return null;
        if (!this.ctx) {
            try {
                const AudioCtx =
                    window.AudioContext ||
                    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (!AudioCtx) return null;
                this.ctx = new AudioCtx();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = this._volume;
                this.masterGain.connect(this.ctx.destination);

                this.ambienceGain = this.ctx.createGain();
                this.ambienceGain.gain.value = 0.15;
                this.ambienceGain.connect(this.masterGain);

                this.preGenerateNoiseBuffers();
            } catch (e) {
                console.warn('[ProceduralSound] AudioContext not available:', e);
                return null;
            }
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    private preGenerateNoiseBuffers(): void {
        const ctx = this.ctx!;
        const sampleRate = ctx.sampleRate;

        // Short noise burst (5-50ms) — for impacts, clicks, transients
        this.noiseBufferShort = ctx.createBuffer(1, sampleRate * 0.05, sampleRate);
        this.fillNoiseBuffer(this.noiseBufferShort, true);

        // Medium noise (50-200ms) — for swishes, chops, body sounds
        this.noiseBufferMedium = ctx.createBuffer(1, sampleRate * 0.2, sampleRate);
        this.fillNoiseBuffer(this.noiseBufferMedium, false);

        // Long noise (200ms-1s) — for rumbles, demolition, ambient
        this.noiseBufferLong = ctx.createBuffer(1, sampleRate * 1.0, sampleRate);
        this.fillNoiseBuffer(this.noiseBufferLong, false);
    }

    private fillNoiseBuffer(buffer: AudioBuffer, shortBurst: boolean): void {
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            if (shortBurst) {
                const envelope = Math.exp(-i / (data.length * 0.15));
                data[i] = (Math.random() * 2 - 1) * envelope;
            } else {
                data[i] = Math.random() * 2 - 1;
            }
        }
    }

    /**
     * Trim and evict finished source nodes to prevent memory leaks and to
     * enforce the MAX_CONCURRENT cap.
     */
    private cleanupFinishedSources(): void {
        while (this.activeSources.length > this.MAX_CONCURRENT) {
            this.activeSources.shift();
        }
    }

    /**
     * Schedule a source node: evict the oldest if at capacity, then start/stop
     * it and track it in `activeSources`. This does NOT connect the node to
     * anything — connection is the caller's responsibility (via `applyPan`).
     */
    private scheduleSource(source: AudioBufferSourceNode | OscillatorNode, duration: number): void {
        this.cleanupFinishedSources();

        if (this.activeSources.length >= this.MAX_CONCURRENT) {
            const oldest = this.activeSources.shift();
            try { oldest?.stop(); } catch { /* already stopped */ }
        }

        const startTime = this.ctx!.currentTime;
        source.start(startTime);
        source.stop(startTime + duration + 0.1);
        this.activeSources.push(source as AudioBufferSourceNode);
    }

    /**
     * Create a filtered noise burst with configurable envelope.
     * Builds `source → filter → gain` and returns the envelope `gain` (the
     * chain tail) for the caller to route through `applyPan`.
     */
    private noiseBurst(
        filterType: BiquadFilterType,
        frequency: number,
        q: number,
        attackSec: number,
        decaySec: number,
        volume: number,
        buffer: AudioBuffer | null = null
    ): GainNode {
        const ctx = this.ctx!;
        const source = ctx.createBufferSource();
        source.buffer = buffer || this.noiseBufferMedium!;

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

        this.scheduleSource(source, attackSec + decaySec + 0.05);
        return gain;
    }

    /**
     * Create an oscillator-based tone with envelope.
     * Builds `osc → gain` and returns the envelope `gain` (the chain tail).
     */
    private tone(
        type: OscillatorType,
        frequency: number,
        attackSec: number,
        decaySec: number,
        volume: number,
        detune: number = 0
    ): GainNode {
        const ctx = this.ctx!;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = frequency;
        if (detune) osc.detune.value = detune;

        const gain = ctx.createGain();
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + attackSec);
        gain.gain.exponentialRampToValueAtTime(0.001, now + attackSec + decaySec);

        osc.connect(gain);

        this.scheduleSource(osc, attackSec + decaySec + 0.05);
        return gain;
    }

    /**
     * Get stereo pan value (-1 = full left, 1 = full right) based on world position.
     */
    private getPan(worldX: number, worldY: number): number {
        const iso = toIso(worldX, worldY);
        const cam = this.scene.cameras.main;
        const screenX = iso.x - cam.scrollX;
        const screenMid = cam.width / 2;
        return Phaser.Math.Clamp((screenX - screenMid) / (cam.width * 0.4), -1, 1);
    }

    /**
     * Get distance-based gain and filter cutoff for spatial audio.
     */
    private getDistanceGain(worldX: number, worldY: number): { gain: number; filterFreq: number } {
        const iso = toIso(worldX, worldY);
        const cam = this.scene.cameras.main;
        const screenX = iso.x - cam.scrollX;
        const screenY = iso.y - cam.scrollY;
        const centerX = cam.width / 2;
        const centerY = cam.height / 2;
        const dist = Math.sqrt((screenX - centerX) ** 2 + (screenY - centerY) ** 2);
        const maxDist = Math.max(cam.width, cam.height) * 0.6;
        const t = Phaser.Math.Clamp(dist / maxDist, 0, 1);
        return {
            gain: 1 - t * 0.85,
            filterFreq: 3000 - t * 2600
        };
    }

    /**
     * Apply stereo panning to the chain's tail node (the envelope `gain`).
     * This is the SOLE connection to `masterGain` — no separate centered path.
     */
    private applyPan(pan: number, gainNode: GainNode): void {
        const ctx = this.ctx!;
        const merger = ctx.createChannelMerger(2);
        const leftGain = ctx.createGain();
        const rightGain = ctx.createGain();
        leftGain.gain.value = Phaser.Math.Clamp(1 - pan, 0, 1);
        rightGain.gain.value = Phaser.Math.Clamp(1 + pan, 0, 1);
        gainNode.connect(leftGain);
        gainNode.connect(rightGain);
        leftGain.connect(merger, 0, 0);
        rightGain.connect(merger, 0, 1);
        merger.connect(this.masterGain!);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC SOUND EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // peacefulMode (combat-only suppression) — INTENTIONAL product behavior:
    // In peaceful mode only COMBAT sounds (sword/bow/death/demolition) are
    // suppressed. Non-combat gameplay and UI/ambience sounds — placement,
    // construction, wood chop, UI click, command ack, age advance — remain
    // audible so the world still feels alive. Do NOT extend the guard to those
    // methods; that asymmetry is by design, not a bug.

    /**
     * Melee sword/shield clash — metallic ring + noise body.
     */
    public playSwordClash(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx || this.scene.peacefulMode) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.35 * distGain;

        const source1 = this.noiseBurst('bandpass', Math.min(filterFreq, 1200), 8, 0.01, 0.25, volume * 0.7);
        const source2 = this.noiseBurst('lowpass', 400, 1, 0.005, 0.3, volume * 0.5);
        const source3 = this.noiseBurst('highpass', 3000, 1, 0.002, 0.04, volume * 0.3);
        const osc = this.tone('triangle', 600, 0.01, 0.15, volume * 0.2, -100);

        this.applyPan(pan, source1);
        this.applyPan(pan, source2);
        this.applyPan(pan, source3);
        this.applyPan(pan, osc);
    }

    /**
     * Bow release — quick snap + string twang.
     */
    public playBowRelease(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx || this.scene.peacefulMode) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.25 * distGain;

        const snap = this.noiseBurst('bandpass', Math.min(filterFreq, 2500), 3, 0.002, 0.06, volume);
        const string = this.tone('triangle', 280, 0.005, 0.18, volume * 0.6);
        const body = this.tone('sine', 140, 0.01, 0.25, volume * 0.2);

        this.applyPan(pan, snap);
        this.applyPan(pan, string);
        this.applyPan(pan, body);
    }

    /**
     * Unit death — low rumble + fading exhale.
     */
    public playDeath(worldX: number, worldY: number, isUnit: boolean): void {
        const ctx = this.ensureAudioContext();
        if (!ctx || this.scene.peacefulMode) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = isUnit ? 0.3 : 0.2;
        const finalVol = volume * distGain;

        const rumble = this.noiseBurst('lowpass', Math.min(filterFreq, 350), 2, 0.15, 0.7, finalVol);
        const exhale = this.noiseBurst('bandpass', 800, 2, 0.1, 0.5, finalVol * 0.4);

        const ctx2 = this.ctx!;
        const osc = ctx2.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, ctx2.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, ctx2.currentTime + 0.5);
        const oscGain = ctx2.createGain();
        oscGain.gain.setValueAtTime(finalVol * 0.3, ctx2.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.6);
        osc.connect(oscGain);
        this.scheduleSource(osc, 0.7);

        this.applyPan(pan, rumble);
        this.applyPan(pan, exhale);
        this.applyPan(pan, oscGain);
    }

    /**
     * Building placement — heavy stone/earth thud.
     */
    public playPlacement(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.4 * distGain;

        const thud = this.tone('sine', 60, 0.01, 0.5, volume);
        const earth = this.noiseBurst('lowpass', Math.min(filterFreq, 200), 1, 0.02, 0.4, volume * 0.6);
        const stone = this.noiseBurst('bandpass', Math.min(filterFreq, 1500), 2, 0.005, 0.1, volume * 0.3);

        this.applyPan(pan, thud);
        this.applyPan(pan, earth);
        this.applyPan(pan, stone);
    }

    /**
     * Construction hammer rhythm — rhythmic thud sequence.
     */
    public playConstruction(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.25 * distGain;
        const now = ctx.currentTime;

        for (let i = 0; i < 3; i++) {
            const t = now + i * 0.08;
            const thud = ctx.createOscillator();
            thud.type = 'sine';
            thud.frequency.value = 50 + i * 10;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.001, t);
            g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            thud.connect(g);
            this.scheduleSource(thud, 0.15);
            this.applyPan(pan, g);
        }

        const creak = this.noiseBurst('bandpass', Math.min(filterFreq, 800), 3, 0.02, 0.15, volume * 0.4);
        this.applyPan(pan, creak);
    }

    /**
     * Demolition / building destruction — crumbling bursts.
     */
    public playDemolition(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx || this.scene.peacefulMode) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.5 * distGain;
        const now = ctx.currentTime;

        for (let i = 0; i < 3; i++) {
            const t = now + i * 0.12;
            const burst = ctx.createBufferSource();
            burst.buffer = this.noiseBufferLong!;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = Math.max(150, filterFreq - i * 400);
            filter.Q.value = 2;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.001, t);
            g.gain.exponentialRampToValueAtTime(volume * (1 - i * 0.25), t + 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + i * 0.1);
            burst.connect(filter);
            filter.connect(g);
            this.applyPan(pan, g);
            this.scheduleSource(burst, 0.6 + i * 0.1);
        }

        const grind = this.noiseBurst('bandpass', 300, 4, 0.05, 0.4, volume * 0.3);
        this.applyPan(pan, grind);

        const thud = this.tone('sine', 45, 0.02, 0.6, volume * 0.5);
        this.applyPan(pan, thud);
    }

    /**
     * Wood chop — sharp transient + woody resonance.
     */
    public playWoodChop(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.3 * distGain;

        const impact = this.noiseBurst('bandpass', Math.min(filterFreq, 3000), 5, 0.003, 0.05, volume);

        const ctx2 = this.ctx!;
        const osc = ctx2.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 120;
        const lfo = ctx2.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 8;
        const lfoGain = ctx2.createGain();
        lfoGain.gain.value = 15;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0.001, ctx2.currentTime);
        g.gain.exponentialRampToValueAtTime(volume * 0.5, ctx2.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.2);
        osc.connect(g);
        this.scheduleSource(osc, 0.25);
        this.scheduleSource(lfo, 0.25);
        this.applyPan(pan, g);

        const crack = this.noiseBurst('highpass', 2000, 1, 0.002, 0.08, volume * 0.3);

        this.applyPan(pan, impact);
        this.applyPan(pan, crack);
    }

    /**
     * UI click — subtle, low tick.
     */
    public playUIClick(): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const volume = 0.08;

        const tick = this.noiseBurst('highpass', 3000, 1, 0.001, 0.02, volume);
        const click = this.tone('sine', 1200, 0.002, 0.03, volume * 0.5);

        this.applyPan(0, tick);
        this.applyPan(0, click);
    }

    /**
     * Command acknowledgement — soft military tone.
     */
    public playCommandAck(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const { gain: distGain } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.12 * distGain;

        const ctx2 = this.ctx!;
        const osc = ctx2.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx2.currentTime);
        osc.frequency.exponentialRampToValueAtTime(330, ctx2.currentTime + 0.08);
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0.001, ctx2.currentTime);
        g.gain.exponentialRampToValueAtTime(volume, ctx2.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.12);
        osc.connect(g);
        this.scheduleSource(osc, 0.15);

        this.applyPan(pan, g);
    }

    /**
     * Age advancement — dramatic low horn swell.
     */
    public playAgeAdvance(worldX: number, worldY: number): void {
        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const { gain: distGain,  filterFreq } = this.getDistanceGain(worldX, worldY);
        const pan = this.getPan(worldX, worldY);
        const volume = 0.45 * distGain;
        const now = ctx.currentTime;

        const ctx2 = this.ctx!;
        const osc1 = ctx2.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(80, now);
        osc1.frequency.exponentialRampToValueAtTime(180, now + 1.5);
        const filter1 = ctx2.createBiquadFilter();
        filter1.type = 'lowpass';
        filter1.frequency.setValueAtTime(200, now);
        filter1.frequency.exponentialRampToValueAtTime(Math.min(filterFreq, 2500), now + 1.5);
        filter1.Q.value = 2;
        const g1 = ctx2.createGain();
        g1.gain.setValueAtTime(0.001, now);
        g1.gain.exponentialRampToValueAtTime(volume, now + 0.5);
        g1.gain.setValueAtTime(volume, now + 1.5);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
        osc1.connect(filter1);
        filter1.connect(g1);
        this.scheduleSource(osc1, 3.2);

        const osc2 = ctx2.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(400, now);
        osc2.frequency.exponentialRampToValueAtTime(900, now + 1.5);
        const g2 = ctx2.createGain();
        g2.gain.setValueAtTime(0.001, now);
        g2.gain.exponentialRampToValueAtTime(volume * 0.25, now + 0.8);
        g2.gain.setValueAtTime(volume * 0.25, now + 1.5);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
        osc2.connect(g2);
        this.scheduleSource(osc2, 2.7);

        const rumble = ctx2.createOscillator();
        rumble.type = 'sine';
        rumble.frequency.value = 40;
        const rg = ctx2.createGain();
        rg.gain.setValueAtTime(0.001, now);
        rg.gain.exponentialRampToValueAtTime(volume * 0.6, now + 0.3);
        rg.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
        rumble.connect(rg);
        this.scheduleSource(rumble, 2.2);

        this.applyPan(pan, g1);
        this.applyPan(pan, g2);
        this.applyPan(pan, rg);
    }

    /**
     * Start continuous ambient wind loop.
     */
    public startAmbientWind(): void {
        // Stop any existing wind loop first so restart / setMuted(false)
        // cannot stack windNode + windLfo loops (P2b).
        this.stopAmbientWind();

        const ctx = this.ensureAudioContext();
        if (!ctx) return;

        const bufferSize = ctx.sampleRate * 4;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        let lastOut = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            data[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = data[i];
            data[i] *= 3.5;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        filter.Q.value = 1;

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.15;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 200;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);

        const gain = ctx.createGain();
        gain.gain.value = 0.06;

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ambienceGain || this.masterGain!);

        const startTime = ctx.currentTime;
        source.start(startTime);
        lfo.start(startTime);

        this.windNode = source;
        this.windFilter = filter;
        this.windLfo = lfo;
        this.windLfoGain = lfoGain;
    }

    /**
     * Stop ambient wind.
     */
    public stopAmbientWind(): void {
        try { this.windNode?.stop(); } catch { /* already stopped */ }
        try { this.windLfo?.stop(); } catch { /* already stopped */ }
        this.windNode = null;
        this.windLfo = null;
    }

    /**
     * Set master volume (0.0 to 1.0).
     */
    public setVolume(volume: number): void {
        this._volume = Phaser.Math.Clamp(volume, 0, 1);
        if (this.masterGain) {
            this.masterGain.gain.value = this._volume;
        }
    }

    /**
     * Mute/unmute all sounds.
     */
    public setMuted(muted: boolean): void {
        this._muted = muted;
        if (muted) {
            if (this.masterGain) this.masterGain.gain.value = 0;
            this.stopAmbientWind();
        } else {
            if (this.masterGain) this.masterGain.gain.value = this._volume;
            this.startAmbientWind();
        }
    }

    /**
     * Call once per frame to clean up completed audio nodes.
     */
    public update(): void {
        if (!this.ctx || this.ctx.state === 'closed') return;
        this.cleanupFinishedSources();
    }

    /**
     * Fully destroy the audio context and all nodes.
     */
    public destroy(): void {
        this.stopAmbientWind();
        this.cleanupFinishedSources();
        if (this.ctx && this.ctx.state !== 'closed') {
            this.ctx.close();
        }
        this.ctx = null;
        this.masterGain = null;
        this.ambienceGain = null;
        this.noiseBufferShort = null;
        this.noiseBufferMedium = null;
        this.noiseBufferLong = null;
    }
}
