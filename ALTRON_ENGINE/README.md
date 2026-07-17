# AL-TRON Engine

The API gateway and "brain" of the AL-TRON personal AI assistant. A NestJS
service that fronts a two-step **router + specialist** LLM pipeline, retrieves
and writes long-term memory via vector search, keeps short-term
session/persona state in Redis, and synthesizes spoken responses server-side
so the [SENSE](../SENSE) mobile app never has to talk to third-party AI APIs
directly.

## How it works

1. A request hits `POST /ai/prompt` (or its streaming sibling, see below)
   with a plain `{ "prompt": "..." }` body.
2. A lightweight **router** model (`gpt-4o-mini` by default) sees the prompt
   plus AL-TRON's persona and two tools:
   - `query_historical_memory` — searches past logged context via MongoDB
     Atlas Vector Search.
   - `save_memory` — writes a new fact/event to that same memory log.
3. If the router calls `query_historical_memory`, the retrieved context is
   handed to a heavier **specialist** model (`gpt-4o` by default) for the
   real answer. If it calls `save_memory`, the write happens and a short
   confirmation is returned directly. Otherwise the router's own reply is
   returned as-is (cheaper and faster for anything that doesn't need
   personal history).
4. The final text is synthesized to speech server-side via **Hume Octave
   TTS** (a fixed preset voice) and returned as base64 MP3 alongside the
   text, so the app never needs its own TTS API key.
5. Short-term session history and mood/directives live in **Redis**, layered
   on top of the long-term persona defined in
   [`src/information/altron_profile.json`](src/information/altron_profile.json).

### `/ai/prompt` vs `/ai/prompt/stream`

- `POST /ai/prompt` — single JSON response once the whole pipeline finishes.
- `POST /ai/prompt/stream` — same pipeline, but streamed as Server-Sent
  Events so a client can narrate progress ("thinking" / "remembering" /
  "saving") before the final `result` event arrives. See
  [`ai.controller.ts`](src/modules/ai/ai.controller.ts) for the exact event
  shapes. This is what SENSE uses.

## Requirements

- **Node.js 20+** and npm (the Docker image is built on `node:20-bookworm-slim`)
- A **PostgreSQL** database (this project uses [Neon](https://neon.tech))
- A **MongoDB Atlas** cluster with a Vector Search index configured on the
  `memories` collection (plain self-hosted MongoDB won't support the
  `$vectorSearch` aggregation this project relies on)
- A **Redis** instance (a container is provided via `docker-compose.yml`, or
  run one locally)
- Access to the following external services:
  - **AUTH-PRO** — the auth microservice this gateway delegates all session
    verification to (no local user/password storage here)
  - **GitHub Models** — a GitHub Personal Access Token with the `models: read`
    permission, used for both chat completions and embeddings
  - **Hume AI** — an API key for Octave TTS (server-side only)

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no (default `development`) | `development` \| `production` \| `test` |
| `PORT` | no (default `3000`) | HTTP port |
| `CORS_ORIGINS` | no | Comma-separated allowed origins |
| `DATABASE_URL` | **yes** | Postgres connection string (Prisma) |
| `MONGO_DB_URL` | **yes** | MongoDB Atlas connection string (memory layer) |
| `MEMORY_VECTOR_SEARCH_INDEX` | no (default `memory_vector_index`) | Atlas Vector Search index name |
| `AUTH_PRO_BASE_URL` | **yes** | Base URL of the AUTH-PRO service |
| `AUTH_PRO_TIMEOUT_MS` | no (default `5000`) | |
| `GITHUB_PAT` | **yes** | GitHub PAT used against GitHub Models |
| `GITHUB_MODELS_BASE_URL` | no | Default: `https://models.github.ai/inference` |
| `GITHUB_MODELS_DEFAULT_MODEL` | no | Default: `openai/gpt-4o-mini` |
| `GITHUB_MODELS_EMBEDDING_MODEL` | no | Default: `openai/text-embedding-3-small` |
| `GITHUB_MODELS_ROUTER_MODEL` | no | Default: `openai/gpt-4o-mini` |
| `GITHUB_MODELS_SPECIALIST_MODEL` | no | Default: `openai/gpt-4o` |
| `GITHUB_MODELS_TIMEOUT_MS` | no (default `30000`) | |
| `REDIS_URL` | **yes** | e.g. `redis://localhost:6379` |
| `PERSONA_SESSION_TTL_SECONDS` | no (default `21600`, 6h) | Session idle expiry |
| `HUME_API_KEY` | **yes** | Octave TTS API key ([platform.hume.ai](https://platform.hume.ai/)) |
| `THROTTLE_DEFAULT_TTL_MS` / `THROTTLE_DEFAULT_LIMIT` | no | Global rate limit window/count |
| `THROTTLE_AI_TTL_MS` / `THROTTLE_AI_LIMIT` | no | Stricter rate limit for `/ai/*` |

All of these are enforced at boot by [`validation.schema.ts`](src/config/validation.schema.ts) —
the app refuses to start if a required one is missing.

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env with real values

# 3. Generate BOTH Prisma clients (Postgres + Mongo are separate schemas)
npm run prisma:generate
npm run prisma:generate:mongo

# 4. Apply the Postgres schema
npm run prisma:migrate        # first time / new migrations, dev DB
# or
npm run prisma:deploy         # apply existing migrations, no new ones generated (prod-safe)

# 5. Push the Mongo schema (Mongo has no migration history, just a live schema push)
npm run prisma:push:mongo

# 6. Run it
npm run start:dev
```

The app boots at `http://localhost:3000`. Swagger API docs are available at
`http://localhost:3000/docs` (auto-disabled when `NODE_ENV=production`).
A liveness probe lives at `GET /health` (no auth, no rate limit).

## npm scripts

| Script | Purpose |
|---|---|
| `npm run start` | Start once, no watch |
| `npm run start:dev` | Start with hot reload (normal dev loop) |
| `npm run start:debug` | Start with `--inspect` + hot reload |
| `npm run start:prod` | Run the compiled `dist/main.js` (what the Docker image runs) |
| `npm run build` | Compile TypeScript via `nest build` |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier over `src/**/*.ts` |
| `npm run test` / `test:watch` / `test:e2e` | Jest |
| `npm run prisma:generate` | Generate the Postgres Prisma client |
| `npm run prisma:generate:mongo` | Generate the Mongo Prisma client (into `generated/mongo-client`) |
| `npm run prisma:migrate` | Create + apply a Postgres migration (dev) |
| `npm run prisma:deploy` | Apply existing Postgres migrations (prod-safe, no prompts) |
| `npm run prisma:studio` / `prisma:studio:mongo` | Prisma Studio for each datasource |
| `npm run prisma:push:mongo` | Push the Mongo schema without a migration history |

## API overview

All routes except `/auth/*`, `/admin/*`, and `/health` require
`Authorization: Bearer <AUTH-PRO token>` — this gateway never issues or
verifies tokens itself, it delegates to AUTH-PRO's `GET /users/me` on every
request (see [`auth-pro.guard.ts`](src/common/guards/auth-pro.guard.ts)).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/ai/prompt` | Bearer | Router + specialist pipeline, single JSON response |
| POST | `/ai/prompt/stream` | Bearer | Same pipeline, SSE progress events + final result |
| POST | `/memory/log` | Bearer | Manually log a memory entry |
| POST | `/memory/search` | Bearer | Vector-search the memory log |
| GET | `/users/me` | Bearer | Current user profile |
| PATCH | `/users/me` | Bearer | Update current user profile |
| POST | `/users/avatar` | Bearer | Upload avatar |
| POST | `/auth/signup` | Public | Proxied to AUTH-PRO |
| POST | `/auth/login` | Public | Proxied to AUTH-PRO |
| POST | `/auth/forgot-password` | Public | Proxied to AUTH-PRO |
| POST | `/auth/update-password` | Public | Proxied to AUTH-PRO |
| POST | `/admin/users/ban` | Public + `adminPass` in body | Ban a user |
| POST | `/admin/mail/send-custom` | Public + `adminPass` in body | Send a custom email |
| GET | `/health` | Public | Liveness probe, `{ status, uptime }` |

Full request/response schemas are in Swagger at `/docs`.

## Docker

Postgres (Neon) and MongoDB (Atlas) are cloud-hosted for this project, so
Docker only needs to run the app itself plus Redis (the one dependency that
isn't already a managed cloud service).

**Requirements:** Docker Engine with Compose v2 (`docker compose`, not the
old standalone `docker-compose`).

```bash
# Build the image and start app + redis
docker compose up -d --build

# Tail logs
docker compose logs -f app

# Check it's alive
curl http://localhost:3000/health

# Stop (add -v to also drop the redis-data volume)
docker compose down
```

`docker-compose.yml` loads the rest of your `.env` as-is (Neon/Atlas/AUTH-PRO/
GitHub PAT/Hume key all pass through unchanged) and only overrides
`REDIS_URL` to point at the `redis` service name instead of `localhost`,
since `localhost` inside the app container would mean the container itself.

### Plain `docker build` / `docker run` (no Compose)

```bash
docker build -t altron-engine .

docker run -d --name altron-engine \
  --env-file .env \
  -e REDIS_URL=redis://<your-redis-host>:6379 \
  -p 3000:3000 \
  altron-engine
```

### Notes

- The image is a 2-stage build ([`Dockerfile`](Dockerfile)): the builder
  stage installs devDependencies, generates both Prisma clients, compiles
  TypeScript, then prunes devDependencies; the runtime stage copies over
  only the pruned `node_modules`, `dist`, the generated Prisma clients, and
  `src/information/altron_profile.json` (read off disk at runtime), and
  runs as the non-root `node` user.
- The runtime image deliberately does **not** include the `prisma` CLI —
  run migrations from a dev machine or CI against `DATABASE_URL`/
  `MONGO_DB_URL` directly (`npm run prisma:deploy`, `npm run
  prisma:push:mongo`), not from inside the container.
- The image has a built-in `HEALTHCHECK` against `GET /health`.

## Dev-only scripts

[`scripts/generate-filler-audio.js`](scripts/generate-filler-audio.js) —
one-off script that pre-synthesizes AL-TRON's spoken filler phrases
("thinking" / "remembering" / "saving") and wake-word greeting
acknowledgments through Hume Octave TTS (same fixed voice as real
responses), writing the MP3s straight into `../SENSE/assets/audio/`. These
are bundled as static assets in the app, not synthesized per-request. Run it
again whenever the wording changes:

```bash
node scripts/generate-filler-audio.js
```

Requires `HUME_API_KEY` in `.env`.

## Project structure

```
src/
  common/          Guards, interceptors, filters, decorators shared app-wide
  config/          Env var loading (configuration.ts) + Joi validation schema
  information/     altron_profile.json - AL-TRON's persona/user profile data
  modules/
    admin/         User ban / custom email, proxied to AUTH-PRO
    ai/            Router + specialist pipeline, /ai/prompt(/stream)
    auth/          Signup/login/password, proxied to AUTH-PRO
    health/        Liveness probe
    hume/          Server-side Hume Octave TTS client
    memory/        Vector-search memory log (MongoDB Atlas)
    persona/       Redis-backed short-term session/history state
    users/         Current-user profile + avatar
  prisma/          Postgres PrismaService (users, ai_request_logs)
  redis/           ioredis wrapper (RedisService)
  utils/           Shared helpers (error normalization, response envelope)
prisma/
  schema.prisma        Postgres schema
  mongo/schema.prisma  MongoDB schema (separate datasource, own generated client)
scripts/
  generate-filler-audio.js   One-off Hume TTS pre-generation (see above)
```
