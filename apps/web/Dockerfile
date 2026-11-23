# The web image (§14, #81): Next.js's standalone server, built from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_DEPLOYMENT_ID=<commit> \
#     --secret id=next_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY .
# No secret stays in the image: the action key is a build secret (it only has to match the one the container is
# started with), and every other setting (config/env.ts's `web` process) arrives when the container starts.
# node:26-slim (Debian: the worker image takes Chromium on the same base in #383)
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @lzp/web...
ARG NEXT_DEPLOYMENT_ID
RUN --mount=type=secret,id=next_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  NEXT_DEPLOYMENT_ID="$NEXT_DEPLOYMENT_ID" pnpm --filter @lzp/web build

# node:26-slim
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 MALLOC_ARENA_MAX=2
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
