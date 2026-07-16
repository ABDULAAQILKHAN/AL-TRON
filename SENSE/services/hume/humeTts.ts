import axios from 'axios';
import { File, Paths } from 'expo-file-system';
import { base64ToUint8Array } from './base64';

/**
 * Hume Octave TTS - the standalone text-to-speech REST API, deliberately
 * separate from EVI (the full conversational WebSocket product). Grounded in
 * https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json
 * (fetched 2026-07 while building this).
 */
const HUME_TTS_URL = 'https://api.hume.ai/v0/tts';

// Octave's `description` field is "acting directions" for delivery style -
// keeps the synthesized voice in AL-TRON's persona (sharp/direct/witty, per
// ALTRON_ENGINE's system prompt) rather than a neutral, sing-song TTS read.
const VOICE_DESCRIPTION =
  'A sharp, confident AI assistant voice - direct and efficient, with a calculated, ' +
  'dry wit. No sing-song delivery, no over-enunciation - reads like someone who ' +
  'already knows the answer.';

interface HumeTtsGeneration {
  audio: string;
  duration: number;
  encoding: { format: 'mp3' | 'pcm' | 'wav'; sample_rate: number };
}

interface HumeTtsResponse {
  generations: HumeTtsGeneration[];
  request_id: string | null;
}

export interface SynthesizeSpeechResult {
  uri: string;
  durationSeconds: number;
}

let synthesisCounter = 0;
let previousFileUri: string | null = null;

/**
 * Synthesizes `text` via Hume's Octave TTS and writes the resulting MP3 to a
 * temp file, returning its URI for playback. Deletes the previous call's
 * temp file first so these don't accumulate unbounded in cache across a
 * long session (bounded to ~1 file at a time, not precise per-chunk cleanup).
 */
export async function synthesizeSpeech(apiKey: string, text: string, speed = 1.05): Promise<SynthesizeSpeechResult> {
  const { data } = await axios.post<HumeTtsResponse>(
    HUME_TTS_URL,
    {
      utterances: [{ text, description: VOICE_DESCRIPTION, speed }],
      format: { type: 'mp3' },
      num_generations: 1,
    },
    {
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );

  const generation = data.generations[0];
  if (!generation) {
    throw new Error('Hume TTS returned no audio generations');
  }

  const bytes = base64ToUint8Array(generation.audio);
  synthesisCounter += 1;
  const file = new File(Paths.cache, `hume-tts-${Date.now()}-${synthesisCounter}.mp3`);
  file.write(bytes);

  if (previousFileUri) {
    try {
      new File(previousFileUri).delete();
    } catch {
      // Best-effort cleanup - cache dir is OS-evictable anyway.
    }
  }
  previousFileUri = file.uri;

  return { uri: file.uri, durationSeconds: generation.duration };
}
