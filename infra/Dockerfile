# Builds a single workspace (@jsk/api or @jsk/worker) image from the monorepo root.
# Used by all app services in infra/docker-compose.yml via build arg APP.
# Spec Phase 19: api and worker are the same codebase, different entrypoint.
ARG APP=api
FROM node:18-alpine AS build
ARG APP
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/ apps/
COPY packages/ packages/
COPY tsconfig.base.json eslint.config.mjs .prettierrc.json .prettierignore ./
RUN npm ci
# Build shared + domain packages (api/worker import them from dist), then the app itself.
RUN npm run build --workspace @jsk/shared-kernel \
 && npm run build --workspace @jsk/shared-auth \
 && npm run build --workspace @jsk/domain-hr \
 && npm run build --workspace @jsk/domain-geofence \
 && npm run build --workspace @jsk/domain-attendance \
 && npm run build --workspace @jsk/domain-leave \
 && npm run build --workspace @jsk/domain-files \
 && npm run build --workspace @jsk/domain-projects \
 && npm run build --workspace @jsk/domain-audit \
 && npm run build --workspace @jsk/domain-training \
 && npm run build --workspace @jsk/domain-messages \
 && npm run build --workspace @jsk/domain-payroll \
 && npm run build --workspace @jsk/domain-todos \
 && npm run build --workspace @jsk/domain-notifications \
 && npm run build --workspace "@jsk/${APP}"

FROM node:18-alpine
ARG APP
ENV APP=${APP}
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps /app/apps
COPY --from=build /app/packages /app/packages
COPY --from=build /app/node_modules /app/node_modules
USER node
CMD ["sh", "-c", "node apps/${APP}/dist/main.js"]