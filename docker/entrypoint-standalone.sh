#!/bin/bash
set -e

echo "🚀 Memory MCP — iniciando container all-in-one (PID $$)"

# Evita múltiplas instâncias inicializando ao mesmo tempo
LOCK_FILE="/tmp/mcp-init.lock"
if [ -f "$LOCK_FILE" ] && kill -0 "$(cat $LOCK_FILE)" 2>/dev/null; then
  echo "⚠ Outra instância já está inicializando (PID $(cat $LOCK_FILE)). Configure Replicas=1 no EasyPanel."
  sleep 30
  exit 1
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

# ── 1. Valida variáveis obrigatórias ─────────────────────────────────────────
MISSING=""
[ -z "$ADMIN_EMAIL" ]    && MISSING="$MISSING ADMIN_EMAIL"
[ -z "$ADMIN_PASSWORD" ] && MISSING="$MISSING ADMIN_PASSWORD"
[ -z "$OPENAI_API_KEY" ] && MISSING="$MISSING OPENAI_API_KEY"

if [ -n "$MISSING" ]; then
  echo ""
  echo "❌ ERRO: Variáveis obrigatórias não definidas:$MISSING"
  echo ""
  echo "   No EasyPanel, vá em: Serviço → Environment → adicione:"
  echo "     ADMIN_EMAIL     = seu-email@exemplo.com"
  echo "     ADMIN_PASSWORD  = sua-senha-segura"
  echo "     OPENAI_API_KEY  = sk-..."
  echo ""
  echo "   Opcional — para usar banco/redis externos já existentes:"
  echo "     DATABASE_URL    = postgresql://user:pass@host:5432/db"
  echo "     REDIS_URL       = redis://host:6379"
  echo ""
  exit 1
fi

# ── 2. Detecta modo: externo ou interno ───────────────────────────────────────
# Se DATABASE_URL já veio do ambiente externo, usa ele direto (pula Postgres interno)
EXTERNAL_DB=false
if [ -n "$DATABASE_URL" ]; then
  echo "🔗 DATABASE_URL externo detectado — usando banco externo, pulando Postgres interno"
  EXTERNAL_DB=true
fi

# Se REDIS_URL já veio do ambiente externo, usa ele direto (pula Redis interno)
EXTERNAL_REDIS=false
if [ -n "$REDIS_URL" ]; then
  echo "🔗 REDIS_URL externo detectado — usando Redis externo, pulando Redis interno"
  EXTERNAL_REDIS=true
fi

# ── 3. Garante /data com permissões corretas ──────────────────────────────────
mkdir -p /data 2>/dev/null || true
chmod 777 /data 2>/dev/null || true

# ── 4. Gera ou carrega segredos automáticos ───────────────────────────────────
if touch /data/.test 2>/dev/null; then
  rm -f /data/.test
  SECRETS_FILE="/data/.secrets"
  KEY_FILE="/data/mcp-api-key.txt"
else
  echo "⚠ Volume /data sem permissão de escrita, usando /tmp (segredos não persistem entre restarts)"
  SECRETS_FILE="/tmp/.secrets"
  KEY_FILE="/tmp/mcp-api-key.txt"
fi

if [ ! -f "$SECRETS_FILE" ]; then
  echo "🔑 Gerando segredos pela primeira vez..."
  DB_PASSWORD=$(openssl rand -hex 20)
  JWT_SECRET=$(openssl rand -hex 32)
  MCP_API_KEY=$(openssl rand -hex 24)
  ENCRYPTION_KEY=$(openssl rand -hex 32)

  cat > "$SECRETS_FILE" << EOF
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
MCP_API_KEY=${MCP_API_KEY}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF
  chmod 600 "$SECRETS_FILE" 2>/dev/null || true
  echo "MCP_API_KEY=${MCP_API_KEY}" > "$KEY_FILE"
  echo "✅ Segredos gerados"
else
  echo "🔑 Carregando segredos existentes..."
fi

. "$SECRETS_FILE"   # source compatível com /bin/sh

# Só gera DATABASE_URL interno se não veio do ambiente externo
if [ "$EXTERNAL_DB" = "false" ]; then
  export DATABASE_URL="postgresql://mcp_user:${DB_PASSWORD}@127.0.0.1:5432/mcp_db"
fi

# Só gera REDIS_URL interno se não veio do ambiente externo
if [ "$EXTERNAL_REDIS" = "false" ]; then
  export REDIS_URL="redis://127.0.0.1:6379"
fi

export JWT_SECRET MCP_API_KEY ENCRYPTION_KEY

# ── 5. Inicializa PostgreSQL interno (só se não usar externo) ─────────────────
if [ "$EXTERNAL_DB" = "false" ]; then
  PG_DATA="/var/lib/postgresql/data"
  PG_BIN="/usr/lib/postgresql/16/bin"

  chown -R postgres:postgres "$PG_DATA" 2>/dev/null || true

  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "📦 Inicializando PostgreSQL pela primeira vez..."
    su -s /bin/bash postgres -c "$PG_BIN/initdb -D $PG_DATA --auth-local=trust --auth-host=trust -E UTF8 --no-locale"
    echo "logging_collector = off" >> "$PG_DATA/postgresql.conf"
    echo "log_destination = 'stderr'"  >> "$PG_DATA/postgresql.conf"
  fi

  echo "▶ Iniciando PostgreSQL interno..."
  su -s /bin/bash postgres -c "$PG_BIN/pg_ctl -D $PG_DATA start -w -t 60"
  echo "✅ PostgreSQL pronto"

  su -s /bin/bash postgres -c "psql -U postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='mcp_user'\" | grep -q 1 \
    || psql -U postgres -c \"CREATE USER mcp_user WITH PASSWORD '${DB_PASSWORD}'\"" 2>/dev/null || true

  su -s /bin/bash postgres -c "psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='mcp_db'\" | grep -q 1 \
    || psql -U postgres -c \"CREATE DATABASE mcp_db OWNER mcp_user\"" 2>/dev/null || true

  su -s /bin/bash postgres -c "psql -U postgres -d mcp_db -c \"CREATE EXTENSION IF NOT EXISTS vector\"" 2>/dev/null || true
else
  echo "⏭ PostgreSQL interno pulado (usando externo)"
fi

# ── 6. Inicia Redis interno (só se não usar externo) ──────────────────────────
if [ "$EXTERNAL_REDIS" = "false" ]; then
  echo "▶ Iniciando Redis interno..."
  redis-server /etc/redis/redis-standalone.conf \
    --daemonize yes \
    --logfile "" \
    --pidfile /tmp/redis.pid
  echo "✅ Redis pronto"
else
  echo "⏭ Redis interno pulado (usando externo)"
fi

# ── 7. Roda migrations ────────────────────────────────────────────────────────
echo "📦 Aplicando migrations..."
cd /app
npx prisma db push --accept-data-loss 2>&1 | grep -v "^$" | tail -10
echo "✅ Migrations aplicadas"

# ── 8. Inicia Node.js ─────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Memory MCP iniciado com sucesso!"
echo "   Porta:       ${PORT:-3100}"
echo "   Admin:       ${ADMIN_EMAIL}"
echo "   MCP API Key: ${MCP_API_KEY}"
echo "   Banco:       $([ "$EXTERNAL_DB" = "true" ] && echo "EXTERNO" || echo "interno")"
echo "   Redis:       $([ "$EXTERNAL_REDIS" = "true" ] && echo "EXTERNO" || echo "interno")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec node /app/dist/index.js
