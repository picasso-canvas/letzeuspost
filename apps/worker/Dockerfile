# The worker image (§14, #81), built from the repo root:
#   docker build -f apps/worker/Dockerfile .
# It also carries the migration and seed commands (packages/db), which run from it as one-off containers with the
# owner role's URL; the worker itself never holds that. No secret is in the image: settings arrive at start.
# node:26-slim (Debian: Chromium joins this image in #383)
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @lzp/worker... --filter @lzp/db... \
  && pnpm --filter @lzp/email build

# The same install again without the dev tools, so the image holds what the worker runs and nothing else.
FROM build AS prod
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod --filter @lzp/worker... --filter @lzp/db...

# node:26-slim
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod --chown=node:node /repo /repo
COPY --from=build --chown=node:node /repo/packages/email/dist /repo/packages/email/dist
USER node
CMD ["node", "apps/worker/src/index.ts"]
