# Node 24 rather than 22, because the lockfile is written by npm 11 and the
# npm 10 that ships with Node 22 cannot read it — it reports chokidar and
# readdirp as missing and stops. Keep this in step with the npm that generates
# the lockfile; package.json records the floor.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/bin
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
# --no-audit and --no-fund keep the build log about the build. The retries are
# for the registry, which is not always reachable first time from a builder.
RUN npm ci --no-audit --no-fund --fetch-retries 5

FROM deps AS build
COPY tsconfig*.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY package.json ./
COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
