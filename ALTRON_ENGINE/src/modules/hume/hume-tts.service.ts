import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom, of } from 'rxjs';

/**
 * Hume Octave TTS - server-side now, so the Hume API key never ships inside
 * the SENSE mobile bundle (it used to, as EXPO_PUBLIC_HUME_API_KEY, which is
 * extractable from the APK). Grounded in
 * https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json
 */
const HUME_TTS_URL = 'https://api.hume.ai/v0/tts';

// Octave's `description` field is "acting directions" for delivery style -
// keeps the synthesized voice in AL-TRON's persona (sharp/direct/witty, per
// AiService's system prompt) rather than a neutral, sing-song TTS read.
const VOICE_DESCRIPTION =
  'A sharp, confident AI assistant voice - direct and efficient, with a calculated, ' +
  'dry wit. No sing-song delivery, no over-enunciation - reads like someone who ' +
  'already knows the answer.';

// Fixed preset voice. Without an explicit `voice`, Octave does "dynamic
// generation" - a brand new, randomly gendered voice on every single call,
// which is exactly the bug this fixes.
const FIXED_VOICE = { name: 'Fastidious Robo-Butler', provider: 'HUME_AI' as const };

interface HumeTtsGeneration {
  audio: string;
  duration: number;
  encoding: { format: 'mp3' | 'pcm' | 'wav'; sample_rate: number };
}

interface HumeTtsResponse {
  generations: HumeTtsGeneration[];
  request_id: string | null;
}

@Injectable()
export class HumeTtsService {
  private readonly logger = new Logger(HumeTtsService.name);
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('hume.apiKey') as string;
  }

  /**
   * Synthesizes `text` via Hume's Octave TTS. Returns base64-encoded MP3, or
   * `null` if the call fails - a Hume outage should degrade the response to
   * text-only, not break the whole /ai/prompt request.
   */
  async synthesizeSpeech(text: string): Promise<string | null> {
    const response = await firstValueFrom(
      this.httpService
        .post<HumeTtsResponse>(
          HUME_TTS_URL,
          {
            utterances: [{ text, voice: FIXED_VOICE, description: VOICE_DESCRIPTION, speed: 1.05 }],
            format: { type: 'mp3' },
            num_generations: 1,
          },
          {
            headers: {
              'X-Hume-Api-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        )
        .pipe(
          catchError((error) => {
            this.logger.warn(
              `Hume TTS request failed, degrading to text-only: ${(error as Error).message}`,
            );
            return of(null);
          }),
        ),
    );

    const generation = response?.data.generations[0];
    if (!generation) {
      if (response) {
        this.logger.warn('Hume TTS returned no audio generations');
      }
      return null;
    }

    return generation.audio;
  }
}
