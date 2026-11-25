# The worker image (§14, #81), built from the repo root:
#   docker build -f apps/worker/Dockerfile .
# It also carries the migration and seed commands (packages/db), which run from it as one-off containers with the
# owner role's URL; the worker itself never holds that. No secret is in the image: settings arrive at start.
#
# Chromium (#383, §08 Security): the render browser lives in this image, pinned by playwright-core's version, and runs as
# the non-root `node` user with its own OS sandbox on (flags.ts `chromiumSandbox: true`). The sandbox needs unprivileged
# user namespaces, which Docker's default seccomp profile refuses, so the container starts under
# docker/seccomp/worker-chromium.json (see the notes there) with every capability dropped (docker/compose.picasso.yml).
# `packages/render/src/browser/check-sandbox.ts` proves it from inside the image; `picasso.ts deploy` runs it before swapping containers.
# node:26-slim (Debian)
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
RUN npm install --global pnpm@12.18.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @lzp/worker... --filter @lzp/db... --filter @lzp/render... \
  && pnpm --filter @lzp/email build

# The same install again without the dev tools, so the image holds what the worker runs and nothing else.
FROM build AS prod
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod --filter @lzp/worker... --filter @lzp/db... --filter @lzp/render...

# node:26-slim
FROM node@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /repo
COPY --from=prod --chown=node:node /repo /repo
COPY --from=build --chown=node:node /repo/packages/email/dist /repo/packages/email/dist
# As root, once: the system libraries Chromium needs, and the Chromium that playwright-core 1.65.0 pins, in a folder
# only root can write to. Nothing here runs as root afterwards.
RUN node packages/render/node_modules/playwright-core/cli.js install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "apps/worker/src/index.ts"]
