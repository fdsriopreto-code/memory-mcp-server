#!/bin/bash
set -e

mkdir -p /data/logs

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

# ── 2. Gera ou carrega segredos automáticos ───────────────────────────────────
SECRETS_FILE="/data/.secrets"

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
  chmod 600 "$SECRETS_FILE"

  # Salva a MCP_API_KEY num arquivo visível
  echo "MCP_API_KEY=${MCP_API_KEY}" > /data/mcp-api-key.txt
  echo "✅ Segredos gerados e salvos em /data/.secrets"
else
  echo "🔑 Carregando segredos existentes..."
fi

source "$SECRETS_FILE"

export DATABASE_URL="postgresql://mcp_user:${DB_PASSWORD}@localhost:5432/mcp_db"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET
export MCP_API_KEY
export ENCRYPTION_KEY

# Salva script de start do node com todas as variáveis já exportadas
cat > /data/start-node.sh << NODEEOF
#!/bin/bash
export DATABASE_URL="${DATABASE_URL}"
export REDIS_URL="${REDIS_URL}"
export OPENAI_API_KEY="${OPENAI_API_KEY}"
export JWT_SECRET="${JWT_SECRET}"
export MCP_API_KEY="${MCP_API_KEY}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY}"
export ADMIN_EMAIL="${ADMIN_EMAIL}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD}"
export ADMIN_NAME="${ADMIN_NAME:-Administrador}"
export PORT="${PORT:-3100}"
export NODE_ENV="production"
export SERVE_FRONTEND="true"
export FRONTEND_DIST="/app/frontend/dist"
cd /app
node dist/index.js
NODEEOF
chmod +x /data/start-node.sh

# ── 3. Inicializa PostgreSQL ──────────────────────────────────────────────────
if [ ! -f "/var/lib/postgresql/data/PG_VERSION" ]; then
  echo "📦 Inicializando PostgreSQL pela primeira vez..."
  chown -R postgres:postgres /var/lib/postgresql/data
  su -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/data --auth-local=trust --auth-host=md5" postgres
fi

# Inicia Postgres e Redis via supervisord em background
supervisorctl -c /dev/null > /dev/null 2>&1 || true
echo "▶ Iniciando PostgreSQL e Redis..."
/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/data -l /data/logs/postgres.log start -w -t 30 2>/dev/null \
  || su -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/data -l /data/logs/postgres.log start -w -t 30" postgres

# Aguarda Postgres aceitar conexões
echo "⏳ Aguardando PostgreSQL..."
for i in $(seq 1 20); do
  if su -c "psql -U postgres -c '\q'" postgres 2>/dev/null; then
    break
  fi
  sleep 2
done

# Cria usuário e banco se não existir
su -c "psql -U postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='mcp_user'\" | grep -q 1 || \
       psql -U postgres -c \"CREATE USER mcp_user WITH PASSWORD '${DB_PASSWORD}'\"" postgres 2>/dev/null || true
su -c "psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='mcp_db'\" | grep -q 1 || \
       psql -U postgres -c \"CREATE DATABASE mcp_db OWNER mcp_user\"" postgres 2>/dev/null || true
su -c "psql -U postgres -d mcp_db -c \"CREATE EXTENSION IF NOT EXISTS vector\"" postgres 2>/dev/null || true

echo "✅ PostgreSQL pronto"

# ── 4. Inicia Redis ───────────────────────────────────────────────────────────
redis-server /etc/redis/redis-standalone.conf --daemonize yes --logfile /data/logs/redis.log
echo "✅ Redis pronto"

# ── 5. Roda migrations ───────────────────────────────────────────────────────
echo "📦 Aplicando migrations..."
cd /app
DATABASE_URL="$DATABASE_URL" npx prisma db push --accept-data-loss 2>&1 | tail -5
echo "✅ Migrations aplicadas"

# ── 6. Inicia Node.js ────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Memory MCP iniciado!"
echo "   Porta: ${PORT:-3100}"
echo "   Admin: ${ADMIN_EMAIL}"
echo "   MCP API Key: ${MCP_API_KEY}"
echo "   (chave salva em /data/mcp-api-key.txt)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exec /data/start-node.sh
