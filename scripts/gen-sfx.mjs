// fallow-ignore-file unused-file

/**
 * Generate game SFX via ElevenLabs API.
 * Run: node --env-file=.env scripts/gen-sfx.mjs
 * Output: assets/audio/sfx/*.mp3
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'assets', 'audio', 'sfx');

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
    console.error('Missing ELEVENLABS_API_KEY in .env');
    process.exit(1);
}

const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';

// SFX definitions: { file, prompt, duration_seconds }
const SFX = [
    {
        file: 'sword-clash',
        prompt: 'Medieval sword clashing metal impact, sharp steel-on-steel clang, short combat sound effect',
        duration_seconds: 1.5,
    },
    {
        file: 'bow-release',
        prompt: 'Bow arrow release and flight whoosh, archery shot with string snap and arrow flying through air',
        duration_seconds: 1.2,
    },
    {
        file: 'unit-fallen',
        prompt: 'Medieval soldier grunt and body falling on battlefield, short impactful combat casualty sound',
        duration_seconds: 1.5,
    },
    {
        file: 'building-placement',
        prompt: 'Heavy wooden structure placement thud, building foundation hitting ground, stone and wood settling',
        duration_seconds: 1.0,
    },
    {
        file: 'construction',
        prompt: 'Medieval construction hammering on wood and stone, rhythmic building sounds, carpentry and masonry',
        duration_seconds: 2.0,
    },
    {
        file: 'demolition',
        prompt: 'Building collapse and rubble crash, wooden structure breaking apart, destruction crash sound',
        duration_seconds: 2.0,
    },
    {
        file: 'attack-impact',
        prompt: 'Weapon hitting flesh and armor impact thud, medieval combat strike, hack and pierce damage',
        duration_seconds: 1.0,
    },
    {
        file: 'siege-impact',
        prompt: 'Siege weapon battering ram hitting stone wall, massive stone cracking impact, castle siege',
        duration_seconds: 2.0,
    },
    {
        file: 'wood-chop',
        prompt: 'Axe chopping into wood log, single powerful wood split chop, lumberjack sound effect',
        duration_seconds: 0.8,
    },
    {
        file: 'ui-click',
        prompt: 'Short crisp UI button click sound, clean interface tap, minimal digital click',
        duration_seconds: 0.5,
    },
    {
        file: 'command-ack',
        prompt: 'Military command acknowledgment horn, short trumpet call, unit order confirmation',
        duration_seconds: 1.0,
    },
    {
        file: 'age-advance',
        prompt: 'Triumphant ancient fanfare, brass trumpets and drums celebration, civilization age advancement fanfare, epic ascending',
        duration_seconds: 3.0,
    },
    {
        file: 'animal-deer',
        prompt: 'Deer buck call and snort, forest animal alert sound, gentle woodland creature',
        duration_seconds: 1.5,
    },
    {
        file: 'animal-wolf',
        prompt: 'Wolf howl in the wild, lone wolf call, forest night animal sound',
        duration_seconds: 2.0,
    },
    {
        file: 'resource-gather',
        prompt: 'Resource gathering pickup chime, short positive collection sound, game item collect',
        duration_seconds: 0.5,
    },
    {
        file: 'research-complete',
        prompt: 'Research technology discovery chime, magical ascending sparkle, tech advancement completion',
        duration_seconds: 1.5,
    },
    {
        file: 'ambient-wind',
        prompt: 'Gentle outdoor wind ambient, soft breeze through open plains, nature background atmosphere, looping',
        duration_seconds: 5.0,
    },
];

async function generateSFX(entry) {
    const outPath = join(OUT_DIR, `${entry.file}.mp3`);
    if (existsSync(outPath)) {
        console.log(`  skip (exists): ${entry.file}`);
        return;
    }

    console.log(`  generating: ${entry.file} (${entry.duration_seconds}s)...`);
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'xi-api-key': API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: entry.prompt,
            duration_seconds: entry.duration_seconds,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error(`  FAIL ${entry.file}: ${res.status} ${errText}`);
        return;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`  OK: ${entry.file} (${(buf.length / 1024).toFixed(1)}KB)`);
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    console.log(`Generating ${SFX.length} SFX via ElevenLabs...`);
    console.log(`Output: ${OUT_DIR}\n`);

    // Sequential to respect rate limits (2 concurrent on free tier)
    for (const entry of SFX) {
        await generateSFX(entry);
        // Small delay between requests
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('\nDone!');
}

main().catch(console.error);
