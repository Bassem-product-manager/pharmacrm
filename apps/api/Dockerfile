# PharmaCRM API — build context is the REPO ROOT (turborepo workspace).
# Render: dockerfilePath=apps/api/Dockerfile, dockerContext=. (repo root).
# node:20-slim (Debian) so Prisma uses its default debian-openssl-3.0.x engine
# with no binaryTargets tweak. Migrations run on boot (idempotent).
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# ---- deps: install the whole workspace from the lockfile ----
FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN npm ci

# ---- build: generate Prisma client, build @pharmacrm/shared + api via turbo ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npx turbo run build --filter=@pharmacrm/api

# ---- runner: only what the API needs at runtime ----
FROM base AS runner
ENV NODE_ENV=production
# node_modules carries the generated Prisma client (.prisma) + the symlinked
# @pharmacrm/shared workspace package; packages/ carries shared's built dist.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api
EXPOSE 3001
# migrate deploy is idempotent; applies pending migrations (incl. RLS) on boot
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
