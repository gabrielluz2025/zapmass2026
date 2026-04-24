# syntax=docker/dockerfile:1
# ZapMass: uma imagem com UI (Vite build) + API Express + Socket.IO + Chromium (WhatsApp Web).
#
# Build: docker build -t zapmass .
# Run:  veja docker-compose.yml (volume em /app/data, porta 3001, variáveis em .env)

FROM node:22-bookworm AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Variaveis VITE_* precisam existir na hora do build (Vite as "cozinha" no bundle).
# Recebidas via build args no docker-compose.yml a partir do .env da VPS.
ARG VITE_ADMIN_EMAILS=""
ARG VITE_MARKETING_PRICE_MONTHLY=""
ARG VITE_MARKETING_PRICE_ANNUAL=""
ARG VITE_ENFORCE_SUBSCRIPTION=""
ARG VITE_CREATOR_STUDIO=""
# Commit enxertado no bundle (Vite) — passar a partir de `git rev-parse` na pasta do repo na VPS, ver docker-compose.
ARG VITE_GIT_REF=unknown
ENV VITE_ADMIN_EMAILS=$VITE_ADMIN_EMAILS \
    VITE_MARKETING_PRICE_MONTHLY=$VITE_MARKETING_PRICE_MONTHLY \
    VITE_MARKETING_PRICE_ANNUAL=$VITE_MARKETING_PRICE_ANNUAL \
    VITE_ENFORCE_SUBSCRIPTION=$VITE_ENFORCE_SUBSCRIPTION \
    VITE_CREATOR_STUDIO=$VITE_CREATOR_STUDIO \
    VITE_GIT_REF=$VITE_GIT_REF

COPY . .
RUN npm run build

# Runtime: mesmo base Debian que o build (menos surpresas com libs)
FROM node:22-bookworm AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/utils ./src/utils
COPY --from=builder /app/VERSION ./VERSION

RUN npm ci --omit=dev \
  && npm cache clean --force

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=15s --start-period=180s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

CMD ["./node_modules/.bin/tsx", "server/server.ts"]
