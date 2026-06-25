#!/bin/sh
set -e

# Valida variáveis obrigatórias e mostra erro claro
check_var() {
  val=$(eval echo "\$$1")
  if [ -z "$val" ]; then
    echo "❌ ERRO: variável de ambiente obrigatória não definida: $1"
    echo "   Configure essa variável no painel do EasyPanel/Docker e reinicie."
    exit 1
  fi
}

echo "🔍 Verificando variáveis de ambiente..."
check_var DATABASE_URL
check_var OPENAI_API_KEY
check_var MCP_API_KEY
check_var JWT_SECRET
check_var ENCRYPTION_KEY
check_var ADMIN_EMAIL
check_var ADMIN_PASSWORD
echo "✅ Variáveis OK"

# Aguarda o PostgreSQL aceitar conexões (até 60s)
echo "⏳ Aguardando PostgreSQL..."
RETRIES=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { console.log('ok'); c.end(); process.exit(0); })
   .catch(() => process.exit(1));
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo "❌ PostgreSQL não respondeu em 60s. Verifique DATABASE_URL e se o banco está rodando."
    echo "   DATABASE_URL atual: ${DATABASE_URL}"
    exit 1
  fi
  echo "   Tentando novamente... (${RETRIES} tentativas restantes)"
  sleep 2
done
echo "✅ PostgreSQL pronto"

# Roda migrations
echo "📦 Aplicando migrations..."
npx prisma db push --accept-data-loss 2>&1
echo "✅ Migrations aplicadas"

# Inicia o servidor
echo "🚀 Iniciando servidor na porta ${PORT:-3100}..."
exec node dist/index.js
