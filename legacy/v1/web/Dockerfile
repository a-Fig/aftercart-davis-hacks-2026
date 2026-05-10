# syntax=docker/dockerfile:1.7
#
# Three-stage build for the AfterCart / ReceiptCheck web app.
#
# Build context is the repo root (not web/). The OFF SQLite (~2 GB) is NOT
# baked in — it's downloaded from GCS to /tmp at container startup by
# scripts/download-off-startup.mjs. This keeps the image slim (~200 MB)
# and decouples OFF data updates from code deploys.
#
#   docker build -f web/Dockerfile -t aftercart:local .
#
# The repo-root .dockerignore is inclusion-style (everything denied, then
# `web/` re-allowed) so the build context stays slim.

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps: install npm packages + native-compile better-sqlite3
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

# Toolchain required to build better-sqlite3 against the Linux Node 20 ABI.
# Without this the install pulls a prebuilt binary keyed to the host's ABI,
# which won't match the runner stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder: next build + pre-warm the transformers model cache
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Pre-warm @xenova/transformers — first request after cold start otherwise
# downloads ~25 MB from HuggingFace before it can match anything. Cache lands
# in ./.transformers-cache and is copied into the runner stage below.
RUN node -e "import('@xenova/transformers').then(async ({pipeline,env})=>{env.cacheDir='./.transformers-cache'; await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2')})"

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner: slim final image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    OFF_SQLITE_PATH=/tmp/us-products.sqlite \
    OFF_GCS_PATH=gs://aftercart-off-data/us-products.sqlite \
    TRANSFORMERS_CACHE=/app/.transformers-cache \
    NEXT_TELEMETRY_DISABLED=1

# Non-root runtime user
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Next standalone output (server.js + minimal node_modules trace)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Native modules: Next's standalone trace can miss sidecar binaries these
# packages dlopen at runtime. Copy them explicitly for OFF + matcher queries.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/onnxruntime-node ./node_modules/onnxruntime-node
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/onnxruntime-common ./node_modules/onnxruntime-common

# Pre-warmed transformers model cache (~25 MB)
COPY --from=builder --chown=nextjs:nodejs /app/.transformers-cache ./.transformers-cache

# Startup script: downloads OFF SQLite from GCS to /tmp before server start
COPY --chown=nextjs:nodejs web/scripts/download-off-startup.mjs ./scripts/download-off-startup.mjs

USER nextjs

EXPOSE 8080

CMD ["sh", "-c", "node scripts/download-off-startup.mjs && node server.js"]
