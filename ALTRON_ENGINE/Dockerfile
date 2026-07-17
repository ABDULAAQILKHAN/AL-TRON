# syntax=docker/dockerfile:1

# ---- Builder ---------------------------------------------------------------
# Compiles TypeScript and generates BOTH Prisma clients (Postgres, from
# prisma/schema.prisma -> node_modules/.prisma/client, and Mongo, from
# prisma/mongo/schema.prisma -> generated/mongo-client per its own `output`).
# Needs devDependencies (prisma CLI, @nestjs/cli, typescript), so this stage
# is discarded after `npm prune` - only its pruned node_modules + build
# output get copied into the runtime image.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Prisma's query engine binary needs OpenSSL at generate-time too, not just runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate --schema=prisma/schema.prisma \
 && npx prisma generate --schema=prisma/mongo/schema.prisma

RUN npm run build

# Drop devDependencies now that dist/ and both Prisma clients already exist -
# npm prune only touches npm-managed packages, so the generated Prisma
# clients (plain files under node_modules/.prisma and generated/) survive.
RUN npm prune --omit=dev

# ---- Runtime -----------------------------------------------------------------
# Deliberately minimal: no prisma CLI, no source, no devDependencies. Postgres
# (Neon) and MongoDB (Atlas) are cloud-hosted for this project, not containers
# this image manages - run `npm run prisma:deploy` / `prisma:push:mongo` from
# a dev machine (or CI) against DATABASE_URL/MONGO_DB_URL, not from here.
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/generated ./generated
COPY --from=builder --chown=node:node /app/dist ./dist
# nest-cli.json has "assets": [] (nothing gets copied into dist/ on build), and
# AiService reads this file straight off disk at runtime via `process.cwd()`
# rather than importing it - see src/modules/ai/ai.service.ts.
COPY --from=builder --chown=node:node /app/src/information ./src/information

USER node
EXPOSE 3000

# /health is @Public() + @SkipThrottle() - no auth or rate-limit interference here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
