FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:activity

FROM base AS runtime
ENV NODE_ENV=production \
    CLIENT_AUTH_MODE=discord \
    DEV_AUTH=false \
    ACTIVITY_HOST=0.0.0.0 \
    ACTIVITY_PORT=5180
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 5180
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.ACTIVITY_PORT + '/api/health', { signal: AbortSignal.timeout(4000) }).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
CMD ["node", "dist/server/server/client/activity.js"]
