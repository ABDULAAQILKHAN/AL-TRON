export default () => ({
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT as string, 10),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  database: {
    url: process.env.DATABASE_URL,
  },

  mongo: {
    url: process.env.MONGO_DB_URL,
  },

  authPro: {
    baseUrl: (process.env.AUTH_PRO_BASE_URL ?? '').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.AUTH_PRO_TIMEOUT_MS as string, 10),
  },

  githubModels: {
    token: process.env.GITHUB_PAT,
    baseUrl: (process.env.GITHUB_MODELS_BASE_URL ?? 'https://models.github.ai/inference').replace(
      /\/+$/,
      '',
    ),
    defaultModel: process.env.GITHUB_MODELS_DEFAULT_MODEL ?? 'openai/gpt-4o-mini',
    embeddingModel: process.env.GITHUB_MODELS_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
    routerModel: process.env.GITHUB_MODELS_ROUTER_MODEL ?? 'openai/gpt-4o-mini',
    specialistModel: process.env.GITHUB_MODELS_SPECIALIST_MODEL ?? 'openai/gpt-4o',
    timeoutMs: parseInt((process.env.GITHUB_MODELS_TIMEOUT_MS as string) ?? '30000', 10),
  },

  memory: {
    vectorSearchIndex: process.env.MEMORY_VECTOR_SEARCH_INDEX ?? 'memory_vector_index',
  },

  redis: {
    url: process.env.REDIS_URL,
    // "Short-term" persona/history state expires instead of accumulating forever.
    personaSessionTtlSeconds: parseInt(
      (process.env.PERSONA_SESSION_TTL_SECONDS as string) ?? '21600',
      10,
    ),
  },

  hume: {
    apiKey: process.env.HUME_API_KEY,
  },

  throttle: {
    default: {
      ttl: parseInt(process.env.THROTTLE_DEFAULT_TTL_MS as string, 10),
      limit: parseInt(process.env.THROTTLE_DEFAULT_LIMIT as string, 10),
    },
    ai: {
      ttl: parseInt(process.env.THROTTLE_AI_TTL_MS as string, 10),
      limit: parseInt(process.env.THROTTLE_AI_LIMIT as string, 10),
    },
  },
});
