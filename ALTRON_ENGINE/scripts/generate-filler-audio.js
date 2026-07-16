/**
 * One-off dev script: pre-synthesizes AL-TRON's spoken filler phrases
 * ("thinking", "remembering", "saving") via Hume Octave TTS, using the exact
 * same fixed voice + description as HumeTtsService, and writes the MP3s
 * straight into ../SENSE/assets/audio/. Run manually whenever the filler
 * wording changes - these are bundled as static app assets, not synthesized
 * per-request, so the /ai/prompt/stream status events stay instant.
 *
 * Usage: node scripts/generate-filler-audio.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const HUME_TTS_URL = 'https://api.hume.ai/v0/tts';
const VOICE_DESCRIPTION =
  'A sharp, confident AI assistant voice - direct and efficient, with a calculated, ' +
  'dry wit. No sing-song delivery, no over-enunciation - reads like someone who ' +
  'already knows the answer.';
const FIXED_VOICE = { name: 'Fastidious Robo-Butler', provider: 'HUME_AI' };

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'SENSE', 'assets', 'audio');

const PHRASES = {
  thinking: 'One second.',
  remembering: 'Pulling that from memory.',
  saving: 'Got it. Saving that now.',
};

async function synthesize(text) {
  const response = await fetch(HUME_TTS_URL, {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': process.env.HUME_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      utterances: [{ text, voice: FIXED_VOICE, description: VOICE_DESCRIPTION, speed: 1.05 }],
      format: { type: 'mp3' },
      num_generations: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Hume TTS request failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const audio = data.generations?.[0]?.audio;
  if (!audio) {
    throw new Error(`Hume TTS returned no audio generation for "${text}"`);
  }
  return Buffer.from(audio, 'base64');
}

async function main() {
  if (!process.env.HUME_API_KEY) {
    throw new Error('HUME_API_KEY is not set - check ALTRON_ENGINE/.env');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [stage, text] of Object.entries(PHRASES)) {
    process.stdout.write(`Synthesizing "${stage}" ("${text}")... `);
    const mp3 = await synthesize(text);
    const outPath = path.join(OUTPUT_DIR, `${stage}.mp3`);
    fs.writeFileSync(outPath, mp3);
    console.log(`wrote ${outPath} (${mp3.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
