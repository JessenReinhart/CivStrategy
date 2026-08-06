/**
 * SFXAssetLoader — Preloads AI-generated MP3 sound effects as Web Audio buffers.
 * Decoded buffers are stored by key (matching filenames in assets/audio/sfx/).
 * Call loadAll() once; subsequent playBuffer() calls use cached decoded buffers.
 */
export interface SFXBufferMap {
    [key: string]: AudioBuffer;
}

const SFX_FILES = [
    'sword-clash',
    'bow-release',
    'unit-fallen',
    'building-placement',
    'construction',
    'demolition',
    'attack-impact',
    'siege-impact',
    'wood-chop',
    'ui-click',
    'command-ack',
    'age-advance',
    'animal-deer',
    'animal-wolf',
    'resource-gather',
    'research-complete',
    'ambient-wind',
] as const;

const BASE_PATH = '/assets/audio/sfx';

/**
 * Fetch and decode an MP3 into an AudioBuffer.
 */
async function fetchAndDecode(
    ctx: AudioContext,
    key: string
): Promise<AudioBuffer | null> {
    const url = `${BASE_PATH}/${key}.mp3`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[SFXAssets] ${key}: HTTP ${res.status}`);
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuf);
    } catch (e) {
        console.warn(`[SFXAssets] Failed to load ${key}:`, e);
        return null;
    }
}

/**
 * Load all SFX files into decoded AudioBuffers.
 * Returns a map of key → AudioBuffer (skips failed loads).
 */
export async function loadAllSFXBuffers(
    ctx: AudioContext,
    onProgress?: (loaded: number, total: number) => void
): Promise<SFXBufferMap> {
    const buffers: SFXBufferMap = {};
    let loaded = 0;
    const total = SFX_FILES.length;

    // Load in parallel batches of 4 to avoid overwhelming the decoder
    for (let i = 0; i < SFX_FILES.length; i += 4) {
        const batch = SFX_FILES.slice(i, i + 4);
        const results = await Promise.all(
            batch.map(async (key) => {
                const buf = await fetchAndDecode(ctx, key);
                return { key, buf };
            })
        );
        for (const { key, buf } of results) {
            if (buf) buffers[key] = buf;
            loaded++;
        }
        onProgress?.(loaded, total);
    }

    return buffers;
}
