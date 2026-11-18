FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
# Narrowly ship the governed, idempotent commercial plan publisher; no secrets or dev scripts.
COPY --chown=node:node scripts/stage-ai-monthly-plan-versions.mjs ./scripts/stage-ai-monthly-plan-versions.mjs
# Read-only Exercise Video inventory audit; data includes candidates, never approved content.
COPY --chown=node:node scripts/audit-exercise-video-inventory.mjs ./scripts/audit-exercise-video-inventory.mjs
COPY --chown=node:node data/exercises/exercise-catalog.pt-BR.v1.json ./data/exercises/exercise-catalog.pt-BR.v1.json
COPY --chown=node:node data/exercises/youtube-curation-queue.pt-BR.v1.json ./data/exercises/youtube-curation-queue.pt-BR.v1.json
COPY --chown=node:node config/commercial/iron-four-tiers-2026.candidate.json ./config/commercial/iron-four-tiers-2026.candidate.json
USER node
EXPOSE 3333
CMD ["node", "dist/src/main.js"]
