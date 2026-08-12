# Build context: repository root (monorepo)
#   docker build -f apps/web/Dockerfile .
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# Install workspace deps (web + shared only)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @cashu-auction/web...

# Build shared types + web (NEXT_PUBLIC_API_URL is inlined at build time)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @cashu-auction/shared build && pnpm --filter @cashu-auction/web build

ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@cashu-auction/web", "start"]
