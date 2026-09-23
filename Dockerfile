# syntax=docker/dockerfile:1

# Render deploys this service from source via this Dockerfile (not the native Node
# buildpack) specifically so Puppeteer's headless Chrome has the system libraries it
# needs — Render's native runtime doesn't give a build step apt access to install them.

FROM node:22-slim AS build
WORKDIR /app
# Pin the exact pnpm version instead of trusting corepack's own default — the lockfile is
# format 9.0 (pnpm 9/10), and without this an older default pnpm can't read it under
# --frozen-lockfile and fails the build. Keep this in sync with package.json's
# "packageManager" field.
RUN corepack enable && corepack prepare pnpm@10.9.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# Skip Puppeteer's own Chromium download here — the runtime stage below installs
# Google Chrome via apt instead, so this would just be discarded, unused, bandwidth.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Google Chrome (for Puppeteer's PDF rendering) — installed via apt rather than
# Puppeteer's bundled-Chromium download, so its shared-library dependencies (libnss3,
# libgbm1, etc.) come from apt too instead of needing to be hand-assembled, and the
# browser version is pinned by the distro repo.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates fonts-liberation \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 4000
# Migrations run separately (Render's own "Pre-Deploy Command", e.g. `pnpm prisma:deploy`)
# rather than in this CMD, so a multi-instance deploy doesn't race multiple containers
# running `migrate deploy` against the same database at once.
CMD ["node", "dist/src/server.js"]
