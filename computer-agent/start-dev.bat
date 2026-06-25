@echo off
echo Memory MCP Computer Agent [DEV]
echo.
echo Configure as variaveis de ambiente antes de rodar:
echo   MCP_SERVER_URL = URL do seu servidor (wss://...)
echo   MCP_API_KEY    = Chave do painel (Settings > API)
echo.

if "%MCP_SERVER_URL%"=="" (
  echo ERRO: MCP_SERVER_URL nao definida.
  echo Edite este arquivo ou defina a variavel antes de rodar.
  pause
  exit /b 1
)
if "%MCP_API_KEY%"=="" (
  echo ERRO: MCP_API_KEY nao definida.
  pause
  exit /b 1
)

set AGENT_ID=%COMPUTERNAME%
npx tsx src/index.ts
pause
