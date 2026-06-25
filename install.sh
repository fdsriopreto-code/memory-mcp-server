#!/bin/bash
set -e

# ── Cores ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

clear
echo -e "${BOLD}${CYAN}"
echo "  ███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗ ██╗   ██╗    ███╗   ███╗ ██████╗██████╗ "
echo "  ████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗╚██╗ ██╔╝    ████╗ ████║██╔════╝██╔══██╗"
echo "  ██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝ ╚████╔╝     ██╔████╔██║██║     ██████╔╝"
echo "  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗  ╚██╔╝      ██║╚██╔╝██║██║     ██╔═══╝ "
echo "  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║   ██║       ██║ ╚═╝ ██║╚██████╗██║     "
echo "  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝       ╚═╝     ╚═╝ ╚═════╝╚═╝     "
echo -e "${RESET}"
echo -e "${BOLD}  Instalador automático — v1.0${RESET}"
echo -e "  Postgres + Redis + Backend + Frontend em um só comando"
echo ""
echo -e "${YELLOW}  Você só precisa responder 3 perguntas. O resto é automático.${RESET}"
echo ""

# ── Verifica Docker ───────────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker não encontrado. Instalando...${RESET}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker --now
  echo -e "${GREEN}Docker instalado!${RESET}"
fi

if ! docker compose version &> /dev/null 2>&1; then
  echo -e "${YELLOW}Docker Compose plugin não encontrado. Instalando...${RESET}"
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

echo -e "${GREEN}✓ Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) detectado${RESET}"
echo ""

# ── Coleta só o que é necessário ──────────────────────────────────────────────
echo -e "${BOLD}━━━ Configuração do painel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

read -p "$(echo -e "${CYAN}  Email do administrador:${RESET} ")" ADMIN_EMAIL
if [[ -z "$ADMIN_EMAIL" ]]; then
  echo -e "${RED}Email é obrigatório.${RESET}"; exit 1
fi

while true; do
  read -s -p "$(echo -e "${CYAN}  Senha do painel (min 8 chars):${RESET} ")" ADMIN_PASSWORD
  echo ""
  if [[ ${#ADMIN_PASSWORD} -ge 8 ]]; then break; fi
  echo -e "${RED}  Senha deve ter pelo menos 8 caracteres.${RESET}"
done

echo ""
echo -e "${BOLD}━━━ OpenAI (embeddings de memória) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "  ${YELLOW}Obtenha sua chave em: https://platform.openai.com/api-keys${RESET}"
echo ""
read -p "$(echo -e "${CYAN}  OpenAI API Key (sk-...):${RESET} ")" OPENAI_API_KEY
if [[ -z "$OPENAI_API_KEY" ]]; then
  echo -e "${YELLOW}  Aviso: sem OpenAI key, busca semântica de memórias ficará desabilitada.${RESET}"
  OPENAI_API_KEY="CONFIGURE_DEPOIS"
fi

echo ""
echo -e "${BOLD}━━━ Gerando segredos automaticamente ━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Gera todos os segredos aleatoriamente
DB_PASSWORD=$(openssl rand -hex 20)
JWT_SECRET=$(openssl rand -hex 32)
MCP_API_KEY=$(openssl rand -hex 24)
ENCRYPTION_KEY=$(openssl rand -hex 32)

echo -e "  ${GREEN}✓ Senha do PostgreSQL gerada${RESET}"
echo -e "  ${GREEN}✓ JWT Secret gerado${RESET}"
echo -e "  ${GREEN}✓ MCP API Key gerada${RESET}"
echo -e "  ${GREEN}✓ Chave de criptografia gerada${RESET}"
echo ""

# ── Cria o .env ───────────────────────────────────────────────────────────────
cat > .env << EOF
# ── Gerado automaticamente pelo install.sh em $(date '+%Y-%m-%d %H:%M') ──
DATABASE_URL=postgresql://mcp_user:${DB_PASSWORD}@mcp-postgres:5432/mcp_db
REDIS_URL=redis://mcp-redis:6379
OPENAI_API_KEY=${OPENAI_API_KEY}
MCP_API_KEY=${MCP_API_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_NAME=Administrador
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
DB_PASSWORD=${DB_PASSWORD}
PORT=3100
NODE_ENV=production
SERVE_FRONTEND=true
FRONTEND_DIST=/app/frontend/dist
EOF

echo -e "${GREEN}✓ Arquivo .env criado${RESET}"

# Salva a MCP_API_KEY num arquivo fácil de achar
cat > mcp-api-key.txt << EOF
Memory MCP — sua chave de API
==============================
MCP_API_KEY=${MCP_API_KEY}

Use essa chave para conectar o Claude ao seu servidor MCP.
Guarde em lugar seguro!
EOF

echo ""
echo -e "${BOLD}━━━ Iniciando containers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# Sobe tudo
docker compose up -d --build

echo ""
echo -e "${BOLD}━━━ Aguardando servidor iniciar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost:3100/health > /dev/null 2>&1; then
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  echo -ne "\r  Aguardando... ${ELAPSED}s"
done
echo ""

if curl -sf http://localhost:3100/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Servidor rodando!${RESET}"
else
  echo -e "${YELLOW}⚠ Servidor pode estar ainda iniciando. Verifique com: docker compose logs mcp-server${RESET}"
fi

# ── Resumo ────────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -sf https://api.ipify.org 2>/dev/null || echo "SEU_IP")

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${GREEN}  ✅ Memory MCP instalado com sucesso!${RESET}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${BOLD}Painel:${RESET}       http://${SERVER_IP}:3100"
echo -e "  ${BOLD}Login:${RESET}        ${ADMIN_EMAIL}"
echo -e "  ${BOLD}MCP API Key:${RESET}  ${MCP_API_KEY}"
echo ""
echo -e "  ${YELLOW}A chave MCP API também foi salva em: mcp-api-key.txt${RESET}"
echo ""
echo -e "  ${BOLD}Próximo passo — conectar o Claude Code:${RESET}"
echo -e "  Adicione em ~/.claude.json (ou settings do Claude):"
echo ""
echo -e '  {
    "mcpServers": {
      "memory": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "http://'"${SERVER_IP}"':3100/mcp"],
        "env": { "MCP_API_KEY": "'"${MCP_API_KEY}"'" }
      }
    }
  }'
echo ""
echo -e "${BOLD}  Comandos úteis:${RESET}"
echo -e "  docker compose logs -f mcp-server   # ver logs"
echo -e "  docker compose restart mcp-server   # reiniciar"
echo -e "  docker compose down                 # parar tudo"
echo -e "  docker compose pull && docker compose up -d  # atualizar"
echo ""
