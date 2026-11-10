FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dev
# npm 10 sometimes fails a fresh install with EEXIST/ENOENT in its cache; retry once with a clean cache.
RUN npm ci || (npm cache clean --force && npm ci)
COPY . .
CMD ["npm", "run", "dev"]

FROM base AS build
# npm 10 sometimes fails a fresh install with EEXIST/ENOENT in its cache; retry once with a clean cache.
RUN npm ci || (npm cache clean --force && npm ci)
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS prod
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json .
# Backup volume mount point: pre-created so the named volume is writable by `app`.
RUN mkdir /backups && chown app:app /backups && chmod 700 /backups
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
