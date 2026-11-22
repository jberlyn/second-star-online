# syntax=docker/dockerfile:1

FROM oven/bun:1.4.0@sha256:18639686662e5cd8a963ffb967dd130034a2a2d076a52e65dfd4fe18f75cc038 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/data/package.json ./packages/data/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/perf/package.json ./packages/perf/package.json
RUN bun install --frozen-lockfile --production && \
    mkdir -p packages/data/node_modules packages/shared/node_modules packages/server/node_modules

FROM oven/bun:1.4.0@sha256:18639686662e5cd8a963ffb967dd130034a2a2d076a52e65dfd4fe18f75cc038 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/data/package.json ./packages/data/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/perf/package.json ./packages/perf/package.json
RUN bun install --frozen-lockfile
COPY packages/data ./packages/data
COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
COPY assets/original ./assets/original
COPY assets/added ./assets/added
COPY assets/original-sidecars.json ./assets/original-sidecars.json
RUN bun run data:build && bun run build

FROM oven/bun:1.4.0@sha256:18639686662e5cd8a963ffb967dd130034a2a2d076a52e65dfd4fe18f75cc038 AS runtime
WORKDIR /app
RUN mkdir -p /data && chown bun:bun /data

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /app/packages/data/node_modules ./packages/data/node_modules
COPY --from=deps --chown=bun:bun /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps --chown=bun:bun /app/packages/server/node_modules ./packages/server/node_modules

COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun packages/server/package.json ./packages/server/package.json
COPY --chown=bun:bun packages/server/src ./packages/server/src
COPY --chown=bun:bun packages/server/migrations ./packages/server/migrations
COPY --chown=bun:bun packages/shared/package.json ./packages/shared/package.json
COPY --chown=bun:bun packages/shared/src ./packages/shared/src
COPY --chown=bun:bun packages/data/package.json ./packages/data/package.json
COPY --chown=bun:bun packages/data/content ./packages/data/content
COPY --chown=bun:bun packages/data/schema ./packages/data/schema

COPY --from=builder --chown=bun:bun /app/packages/data/src ./packages/data/src
# The Classic pack, read from the image at every start (never copied into the database).
COPY --from=builder --chown=bun:bun /app/packages/data/packs ./packages/data/packs
COPY --from=builder --chown=bun:bun /app/packages/data/assets ./packages/data/assets
COPY --from=builder --chown=bun:bun /app/dist/client ./dist/client

USER bun
ENV NODE_ENV=production \
    SSO_DB=/data/sso.sqlite \
    PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "packages/server/src/cli/healthcheck.ts"]

CMD ["bun", "packages/server/src/main.ts"]
