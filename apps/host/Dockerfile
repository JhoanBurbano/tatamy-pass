# Tatami Pass · host (Fastify + SQLite). Imagen sin root.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY apps/host/package.json apps/host/
COPY apps/print/package.json apps/print/
COPY apps/host-admin/package.json apps/host-admin/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
  && npm ci --workspace=packages/core --workspace=apps/host --workspace=apps/print --workspace=apps/host-admin --ignore-scripts
COPY packages/core packages/core
COPY apps/print apps/print
COPY apps/host-admin apps/host-admin
COPY apps/host apps/host
RUN npm rebuild better-sqlite3 && npm run build -w packages/core && npm run build -w apps/print && npm run build -w apps/host && npm run build -w apps/host-admin

FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=8787 TP_DB_PATH=/data/tatami.db TP_BACKUPS_DIR=/backups TP_KEYS_DIR=/keys TP_ROLE=primary
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/host/package.json apps/host/package.json
COPY --from=build /app/apps/host/dist apps/host/dist
COPY --from=build /app/apps/host/public apps/host/public
COPY --from=build /app/apps/print/package.json apps/print/package.json
COPY --from=build /app/apps/print/dist apps/print/dist
COPY --from=build /app/apps/host/migrations apps/host/migrations
COPY --from=build /app/apps/host/event.config.json apps/host/event.config.json
RUN mkdir -p /data /backups /keys && chown -R node:node /data /backups /keys /app
USER node
EXPOSE 8787
WORKDIR /app/apps/host
CMD ["node", "dist/main.js"]
