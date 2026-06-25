#!/bin/bash
set -e

echo "🚀 Memory MCP — iniciando container all-in-one"

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
  exit 1
fi

# ── 2. Garante diretórios com permissões corretas ─────────────────────────────
# /data pode ser volume montado como root — criamos subpastas com chmod
mkdir -p /tmp/pg-logs /tmp/redis-logs
mkdir -p /data 2>/dev/null || true
# Tenta criar /data com permissão permissiva (ignora erro se volume externo)
chmod 777 /data 2>/dev/null || true

# ── 3. Gera ou carrega segredos automáticos ───────────────────────────────────
# Tenta /data primeiro, cai para /tmp se não tiver permissão
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

export DATABASE_URL="postgresql://mcp_user:${DB_PASSWORD}@127.0.0.1:5432/mcp_db"
export REDIS_URL="redis://127.0.0.1:6379"
export JWT_SECRET MCP_API_KEY ENCRYPTION_KEY

# ── 4. Inicializa PostgreSQL ──────────────────────────────────────────────────
PG_DATA="/var/lib/postgresql/data"
PG_BIN="/usr/lib/postgresql/16/bin"

# Garante que postgres é dono do diretório de dados
chown -R postgres:postgres "$PG_DATA" 2>/dev/null || true

if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  echo "📦 Inicializando PostgreSQL pela primeira vez..."
  su -s /bin/bash postgres -c "$PG_BIN/initdb -D $PG_DATA --auth-local=trust --auth-host=trust -E UTF8 --no-locale"
fi

echo "▶ Iniciando PostgreSQL..."
# Usa /tmp para o log do postgres (sem problema de permissão)
su -s /bin/bash postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -l /tmp/pg-logs/postgres.log start -w -t 60"
echo "✅ PostgreSQL pronto"

# Cria usuário/banco/extensão na primeira vez
su -s /bin/bash postgres -c "psql -U postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='mcp_user'\" | grep -q 1 \
  || psql -U postgres -c \"CREATE USER mcp_user WITH PASSWORD '${DB_PASSWORD}'\"" 2>/dev/null || true

su -s /bin/bash postgres -c "psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='mcp_db'\" | grep -q 1 \
  || psql -U postgres -c \"CREATE DATABASE mcp_db OWNER mcp_user\"" 2>/dev/null || true

su -s /bin/bash postgres -c "psql -U postgres -d mcp_db -c \"CREATE EXTENSION IF NOT EXISTS vector\"" 2>/dev/null || true

# ── 5. Inicia Redis ───────────────────────────────────────────────────────────
echo "▶ Iniciando Redis..."
redis-server /etc/redis/redis-standalone.conf \
  --daemonize yes \
  --logfile /tmp/redis-logs/redis.log \
  --pidfile /tmp/redis.pid
echo "✅ Redis pronto"

# ── 6. Roda migrations ───────────────────────────────────────────────────────
echo "📦 Aplicando migrations..."
cd /app
npx prisma db push --accept-data-loss 2>&1 | grep -v "^$" | tail -10
echo "✅ Migrations aplicadas"

# ── 7. Inicia Node.js ────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Memory MCP iniciado com sucesso!"
echo "   Porta:       ${PORT:-3100}"
echo "   Admin:       ${ADMIN_EMAIL}"
echo "   MCP API Key: ${MCP_API_KEY}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec node /app/dist/index.js
