@echo off
echo Memory MCP Computer Agent
echo.
echo Configure as variaveis de ambiente antes de rodar:
echo   MCP_SERVER_URL = URL do seu servidor (wss://...)
echo   MCP_API_KEY    = Chave do painel (Settings > API)
echo.

if "%MCP_SERVER_URL%"=="" (
  echo ERRO: MCP_SERVER_URL nao definida.
  echo Exemplo: set MCP_SERVER_URL=wss://meu-servidor.easypanel.host
  pause
  exit /b 1
)
if "%MCP_API_KEY%"=="" (
  echo ERRO: MCP_API_KEY nao definida.
  echo Exemplo: set MCP_API_KEY=sua-chave-do-painel
  pause
  exit /b 1
)

set AGENT_ID=%COMPUTERNAME%
node dist/index.js
pause
