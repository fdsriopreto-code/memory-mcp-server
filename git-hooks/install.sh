#!/bin/sh
# Instala o git hook post-commit no repositório atual.
# Uso: sh memory-mcp-server/git-hooks/install.sh
#
# Variáveis de ambiente necessárias:
#   MCP_KEY     — chave da API do memory-mcp-server
#   MCP_PROJECT — slug do projeto (ex: ilemanager, front-tarot)
#   MCP_URL     — URL do servidor (opcional, usa o padrão se omitido)

set -e

HOOK_DIR="$(git rev-parse --git-dir 2>/dev/null)/hooks"
if [ -z "$HOOK_DIR" ] || [ ! -d "$HOOK_DIR" ]; then
  echo "❌ Não estamos dentro de um repositório git."
  exit 1
fi

# Descobre onde este script está
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/post-commit"

if [ ! -f "$SRC" ]; then
  echo "❌ Template $SRC não encontrado."
  exit 1
fi

DEST="$HOOK_DIR/post-commit"

# Verifica se já existe um hook diferente
if [ -f "$DEST" ]; then
  if grep -q "memory-mcp-server" "$DEST" 2>/dev/null; then
    echo "⚠️  Hook já instalado. Sobrescrevendo..."
  else
    echo "⚠️  Já existe um post-commit hook diferente em $DEST"
    echo "    Faça backup manual e rode novamente se quiser substituir."
    exit 1
  fi
fi

cp "$SRC" "$DEST"
chmod +x "$DEST"

echo "✅ Hook instalado em: $DEST"
echo ""
echo "Configure as variáveis de ambiente (adicione ao .env.local ou ao shell):"
echo "  export MCP_KEY=\"sua-chave-aqui\""
echo "  export MCP_PROJECT=\"${MCP_PROJECT:-slug-do-projeto}\""
echo "  export MCP_URL=\"${MCP_URL:-https://ferramentas-memory-mcp-server.m5mfeg.easypanel.host}\""
