# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/patch-mastra-studio-serve-handler.mjs ./scripts/
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts/prepare-production-dist.mjs scripts/verify-production-dist.mjs ./scripts/
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="Governed Investment Assistant" \
      org.opencontainers.image.description="Tool-grounded bilingual AI investment-assistant reference implementation" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/mammadovziya/governed-investment-assistant" \
      org.opencontainers.image.documentation="https://github.com/mammadovziya/governed-investment-assistant#readme"

ENV NODE_ENV=production \
    PORT=3000 \
    ASSISTANT_RELEASE_TARGET=customer-production \
    MASTRA_STORAGE_URL=file:/data/mastra.db \
    MASTRA_OBSERVABILITY_PATH=/data/observability-app.duckdb \
    KNOWLEDGE_VECTOR_URL=file:/data/knowledge-vector.db \
    ASSISTANT_AUDIT_OUTBOX_PATH=/data/assistant-audit.jsonl

RUN mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/server.js"]
