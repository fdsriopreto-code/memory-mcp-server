# Container all-in-one: PostgreSQL (pgvector) + Redis + Node.js
# Deploy como UM serviço só. Usuário precisa definir apenas:
#   ADMIN_EMAIL, ADMIN_PASSWORD, OPENAI_API_KEY
# Tudo mais (banco, redis, senhas, JWT) é automático.

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

# ── Stage 3: Runtime all-in-one ───────────────────────────────────────────────
FROM pgvector/pgvector:pg16

RUN apt-get update -qq && apt-get install -y -qq \
    curl redis-server openssl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-builder /app/dist         ./dist
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/prisma       ./prisma
COPY server/package.json ./
COPY --from=frontend-builder /frontend/dist  ./frontend/dist

COPY docker/redis.conf          /etc/redis/redis-standalone.conf
COPY docker/entrypoint-standalone.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/var/lib/postgresql/data", "/data"]

ENV SERVE_FRONTEND=true
ENV FRONTEND_DIST=/app/frontend/dist
ENV NODE_ENV=production
ENV PORT=3100

EXPOSE 3100

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=10 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["/entrypoint.sh"]
