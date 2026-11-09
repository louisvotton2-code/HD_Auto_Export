ARG NODE_IMAGE=node:24.19.0-bookworm-slim
ARG NGINX_IMAGE=nginx:1.28.0-alpine
FROM postgres:18.6 AS postgres
COPY deploy/runtime/db-entrypoint.sh /db-entrypoint.sh
COPY deploy/runtime/init-db.sql /docker-entrypoint-initdb.d/10-app.sql
ENTRYPOINT ["bash", "/db-entrypoint.sh"]
CMD ["postgres"]
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/calculator-core/package.json packages/calculator-core/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm --filter @hd/contracts build
FROM build AS api-build
RUN pnpm --filter @hd/api build
FROM ${NODE_IMAGE} AS api
WORKDIR /app/apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3320
COPY --from=api-build /app/node_modules /app/node_modules
COPY --from=api-build /app/apps/api/node_modules ./node_modules
COPY --from=api-build /app/apps/api/package.json ./package.json
COPY --from=api-build /app/apps/api/dist ./dist
COPY --from=api-build /app/apps/api/migrations ./migrations
COPY --from=api-build /app/packages/contracts /app/packages/contracts
COPY deploy/runtime/api-entrypoint.mjs /app/api-entrypoint.mjs
ENTRYPOINT ["node", "/app/api-entrypoint.mjs"]
CMD ["dist/main.js"]
FROM build AS web-build
ARG SITE_ORIGIN=https://localhost:3410
ARG SITE_INDEXABLE=false
ENV NEXT_PUBLIC_SITE_URL=$SITE_ORIGIN SITE_INDEXABLE=$SITE_INDEXABLE NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @hd/web build
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=web-build /app/apps/web/.next/standalone ./
USER 1000:1000
CMD ["node", "apps/web/server.js"]
FROM build AS admin-build
RUN pnpm --filter @hd/admin build
FROM ${NGINX_IMAGE} AS proxy
COPY deploy/runtime/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/runtime/nginx-edge.conf /etc/nginx/conf.d/00-edge.conf
COPY deploy/runtime/nginx-domains /etc/nginx/hd-domains
COPY deploy/runtime/nginx-media-main.conf /etc/nginx/nginx-media-main.conf
COPY deploy/runtime/nginx-media-entrypoint.sh /etc/nginx/nginx-media-entrypoint.sh
COPY --from=admin-build /app/apps/admin/dist /srv/admin
# Two-host production topology; the original proxy target remains available for local development.
FROM proxy AS proxy-domains
COPY deploy/runtime/nginx-domains.conf /etc/nginx/conf.d/default.conf
