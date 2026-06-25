# ── Stage 1: Build Frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build Server ─────────────────────────────────────────────────────
FROM node:22-alpine AS server-builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server/ .
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache openssl curl
WORKDIR /app

COPY --from=server-builder /app/dist         ./dist
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/prisma       ./prisma
COPY server/package.json ./

# Frontend build — acessível em /app/frontend/dist
COPY --from=frontend-builder /frontend/dist  ./frontend/dist

# Backend serve o frontend na mesma URL
ENV SERVE_FRONTEND=true
ENV FRONTEND_DIST=/app/frontend/dist

# Script de startup com retry no banco
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD curl -f http://localhost:${PORT:-3100}/health || exit 1

CMD ["/docker-entrypoint.sh"]
