# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Cache build metadata for --cache-from support
ARG BUILDKIT_INLINE_CACHE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Install production-only deps (native modules compile here with build tools)
RUN rm -rf node_modules && \
    npm ci --omit=dev && \
    rm -rf /root/.npm /tmp/*

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-slim

ARG BUILDKIT_INLINE_CACHE=1

# Only runtime deps — no build tools, no purge needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip sqlite3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build ./build

# Only copy the OpenAPI spec — avoid copying large planning .md files
COPY --from=builder /app/docs/openapi.yaml ./docs/openapi.yaml

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p /app/data /app/cache

ENV PORT=7331
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/mediajam.sqlite
ENV BODY_SIZE_LIMIT=Infinity

EXPOSE 7331

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:7331').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "build/index.js"]
