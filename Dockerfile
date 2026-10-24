# syntax=docker/dockerfile:1
FROM node:24.15.0-bookworm-slim AS dependencies
WORKDIR /workspace
RUN npm install --global pnpm@10.30.3
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=hehuoda-pnpm,target=/root/.local/share/pnpm/store,sharing=locked pnpm fetch --frozen-lockfile
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/uni/package.json ./apps/uni/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/api-types/package.json ./packages/api-types/package.json
COPY packages/client-domain/package.json ./packages/client-domain/package.json
COPY packages/sicau-connectors/package.json ./packages/sicau-connectors/package.json
RUN --mount=type=cache,id=hehuoda-pnpm,target=/root/.local/share/pnpm/store,sharing=locked pnpm install --offline --frozen-lockfile

FROM dependencies AS api-build
COPY apps/api ./apps/api
COPY packages/sicau-connectors ./packages/sicau-connectors
# pnpm 10 needs this command-local setting to derive a portable dedicated lockfile.
# API scripts build the connectors before compiling; deploy includes their ESM and declarations.
RUN --mount=type=cache,id=hehuoda-pnpm,target=/root/.local/share/pnpm/store,sharing=locked pnpm --filter @hehuoda/api build \
    && pnpm --filter @hehuoda/api exec tsc -p tsconfig.openapi.json \
    && pnpm --config.inject-workspace-packages=true --filter @hehuoda/api deploy --prod --offline --frozen-lockfile /runtime

FROM node:24.15.0-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SWAGGER_ENABLED=false
WORKDIR /app
COPY --from=api-build --chown=node:node /runtime/node_modules ./node_modules
COPY --from=api-build --chown=node:node /workspace/apps/api/package.json ./package.json
COPY --from=api-build --chown=node:node /workspace/apps/api/dist ./dist
COPY --from=api-build --chown=node:node /workspace/apps/api/dist-openapi ./dist-openapi
COPY --from=api-build --chown=node:node /workspace/apps/api/migrations ./migrations
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM dependencies AS h5-build
COPY apps/uni ./apps/uni
COPY packages ./packages
ENV VITE_API_BASE_URL=/api/v1 UNI_RELEASE=false
RUN pnpm --filter @hehuoda/uni check:toolchain && pnpm --filter @hehuoda/uni build:h5

FROM nginx:1.30.0-alpine AS web
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/app-locations.inc /etc/nginx/app-locations.inc
COPY --from=h5-build /workspace/apps/uni/dist/build/h5 /usr/share/nginx/html
EXPOSE 80
