# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile .
# Node runs the TypeScript sources directly (type stripping), so there is no compile step.

ARG NODE_VERSION=22.23.2

# --- deps: production dependencies for the API and the data scripts --------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@ipx/api..." --filter "@ipx/scripts..."

# --- runtime ---------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY scripts scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/api/src/server.ts"]
