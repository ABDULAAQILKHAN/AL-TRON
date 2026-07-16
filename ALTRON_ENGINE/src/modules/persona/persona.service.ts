import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

export type PersonaChatRole = 'user' | 'assistant';

export interface PersonaChatMessage {
  role: PersonaChatRole;
  content: string;
}

/** Short-term behavior, distinct from the long-term identity in altron_profile.json. */
export interface AltronPersonaState {
  directives: string[];
  mood: string;
  updatedAt: string;
}

export interface PersonaContext {
  /** Extra system-message content to layer on top of the core persona prompt; null if nothing applies this turn. */
  systemPromptFragment: string | null;
  /** Prior turns for this session, oldest first, ready to splice into a chat completion's messages array. */
  history: PersonaChatMessage[];
}

/** `session:${userId}:history` is capped to the last N messages (user+assistant combined). */
const HISTORY_LIMIT = 15;

const DEFAULT_DIRECTIVES = ['Keep the opening line short - one beat, then get to the point.'];

function personaKey(userId: string): string {
  return `session:${userId}:altron_persona`;
}

function historyKey(userId: string): string {
  return `session:${userId}:history`;
}

@Injectable()
export class PersonaService {
  private readonly logger = new Logger(PersonaService.name);
  private readonly sessionTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.sessionTtlSeconds = this.configService.get<number>(
      'redis.personaSessionTtlSeconds',
    ) as number;
  }

  /**
   * Loads (or seeds) this user's short-term persona state and recent history.
   *
   * Note: the wake-word greeting ("hey bro", "yes boss", ...) is spoken locally by the SENSE
   * app the instant it hears the wake word - it is NOT injected here. Doing it client-side
   * means it's instant (no round trip) and it never ends up concatenated onto the model's
   * actual answer, which is what happened when this used to be a system-prompt directive.
   */
  async buildContext(userId: string): Promise<PersonaContext> {
    const [persona, history] = await Promise.all([
      this.getOrCreatePersona(userId),
      this.getHistory(userId),
    ]);

    const systemPromptFragment =
      persona.directives.length > 0 ? this.buildDirectivesPrompt(persona) : null;

    return { systemPromptFragment, history };
  }

  /** Appends both sides of a completed turn to the rolling history, capped at the last 15 messages. */
  async recordTurn(userId: string, userPrompt: string, assistantReply: string): Promise<void> {
    const key = historyKey(userId);
    const entries: string[] = [
      JSON.stringify({ role: 'user', content: userPrompt } satisfies PersonaChatMessage),
      JSON.stringify({ role: 'assistant', content: assistantReply } satisfies PersonaChatMessage),
    ];

    const results = await this.redis
      .pipeline()
      .rpush(key, ...entries)
      .ltrim(key, -HISTORY_LIMIT, -1)
      .expire(key, this.sessionTtlSeconds)
      .exec();

    const failed = results?.find(([error]) => error);
    if (failed?.[0]) {
      this.logger.warn(
        `[PERSONA] Failed to record turn for userId=${userId}: ${failed[0].message}`,
      );
    }
  }

  private async getHistory(userId: string): Promise<PersonaChatMessage[]> {
    const raw = await this.redis.lrange(historyKey(userId), 0, -1);
    return raw
      .map((entry) => this.parseHistoryEntry(entry))
      .filter((entry): entry is PersonaChatMessage => entry !== null);
  }

  private parseHistoryEntry(raw: string): PersonaChatMessage | null {
    try {
      const parsed = JSON.parse(raw) as Partial<PersonaChatMessage>;
      if (
        (parsed.role !== 'user' && parsed.role !== 'assistant') ||
        typeof parsed.content !== 'string'
      ) {
        return null;
      }
      return { role: parsed.role, content: parsed.content };
    } catch {
      return null;
    }
  }

  private async getOrCreatePersona(userId: string): Promise<AltronPersonaState> {
    const key = personaKey(userId);
    const raw = await this.redis.get(key);
    if (raw) {
      try {
        return JSON.parse(raw) as AltronPersonaState;
      } catch (error) {
        this.logger.warn(
          `[PERSONA] Corrupt persona state for userId=${userId} (${(error as Error).message}) - reseeding`,
        );
      }
    }

    const seeded: AltronPersonaState = {
      directives: DEFAULT_DIRECTIVES,
      mood: 'neutral',
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(seeded), 'EX', this.sessionTtlSeconds);
    return seeded;
  }

  private buildDirectivesPrompt(persona: AltronPersonaState): string {
    return (
      `Current session mood: ${persona.mood}.\n` +
      `Behavioral directives for this session:\n- ${persona.directives.join('\n- ')}`
    );
  }
}
