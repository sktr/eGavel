# Build context: repository root (monorepo)
#   docker build -f apps/server/Dockerfile .
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
# better-sqlite3 is a native module; ensure node-gyp toolchain is present
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install workspace deps (server + shared only)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
RUN pnpm install --frozen-lockfile --filter @egavel/server...

# Build shared types + server
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN pnpm --filter @egavel/shared build && pnpm --filter @egavel/server build

ENV PORT=3001 NODE_ENV=production
RUN mkdir -p /app/data
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
