import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGINS: Joi.string().default(''),

  DATABASE_URL: Joi.string().uri().required(),

  AUTH_PRO_BASE_URL: Joi.string().uri().required(),
  AUTH_PRO_TIMEOUT_MS: Joi.number().default(5000),

  GITHUB_PAT: Joi.string().required(),
  GITHUB_MODELS_BASE_URL: Joi.string().uri().default('https://models.github.ai/inference'),
  GITHUB_MODELS_DEFAULT_MODEL: Joi.string().default('openai/gpt-4o-mini'),
  GITHUB_MODELS_TIMEOUT_MS: Joi.number().default(30000),

  THROTTLE_DEFAULT_TTL_MS: Joi.number().default(60000),
  THROTTLE_DEFAULT_LIMIT: Joi.number().default(100),
  THROTTLE_AI_TTL_MS: Joi.number().default(60000),
  THROTTLE_AI_LIMIT: Joi.number().default(10),
});
