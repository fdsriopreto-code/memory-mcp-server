@echo off
setlocal enabledelayedexpansion
title Memory MCP — Instalador

echo.
echo  ==========================================
echo   Memory MCP — Instalador Windows
echo  ==========================================
echo.
echo  Voce so precisa responder 3 perguntas.
echo  Postgres + Redis + servidor: tudo automatico.
echo.

:: Verifica Docker
docker --version >nul 2>&1
if errorlevel 1 (
  echo  ERRO: Docker nao encontrado.
  echo  Instale o Docker Desktop em: https://docs.docker.com/desktop/install/windows/
  echo  Depois execute este instalador novamente.
  pause
  exit /b 1
)
echo  [OK] Docker detectado
echo.

:: Coleta dados do usuario
echo  ==========================================
echo   Configuracao do painel
echo  ==========================================
echo.
set /p ADMIN_EMAIL="  Email do administrador: "
set /p ADMIN_PASSWORD="  Senha do painel (min 8 chars): "
echo.
echo  ==========================================
echo   OpenAI API Key (para busca de memorias)
echo   Obtenha em: https://platform.openai.com/api-keys
echo  ==========================================
echo.
set /p OPENAI_API_KEY="  OpenAI API Key (sk-...): "

:: Gera segredos usando PowerShell
echo.
echo  Gerando segredos automaticamente...

for /f "delims=" %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(20))"') do set DB_PASSWORD=%%i
for /f "delims=" %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"') do set JWT_SECRET=%%i
for /f "delims=" %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))"') do set MCP_API_KEY=%%i
for /f "delims=" %%i in ('powershell -Command "[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"') do set ENCRYPTION_KEY=%%i

echo  [OK] Segredos gerados

:: Cria .env
(
echo # Gerado pelo install.bat
echo DATABASE_URL=postgresql://mcp_user:!DB_PASSWORD!@mcp-postgres:5432/mcp_db
echo REDIS_URL=redis://mcp-redis:6379
echo OPENAI_API_KEY=!OPENAI_API_KEY!
echo MCP_API_KEY=!MCP_API_KEY!
echo ADMIN_EMAIL=!ADMIN_EMAIL!
echo ADMIN_PASSWORD=!ADMIN_PASSWORD!
echo ADMIN_NAME=Administrador
echo JWT_SECRET=!JWT_SECRET!
echo ENCRYPTION_KEY=!ENCRYPTION_KEY!
echo DB_PASSWORD=!DB_PASSWORD!
echo PORT=3100
echo NODE_ENV=production
echo SERVE_FRONTEND=true
echo FRONTEND_DIST=/app/frontend/dist
) > .env

echo  [OK] Arquivo .env criado

:: Salva a API key
(
echo Memory MCP — sua chave de API
echo ==============================
echo MCP_API_KEY=!MCP_API_KEY!
echo.
echo Use essa chave para conectar o Claude ao seu servidor MCP.
echo Guarde em lugar seguro!
) > mcp-api-key.txt

echo.
echo  ==========================================
echo   Iniciando containers (pode demorar na 1a vez)...
echo  ==========================================
echo.

docker compose up -d --build

echo.
echo  ==========================================
echo   Instalacao concluida!
echo  ==========================================
echo.
echo  Painel:      http://localhost:3100
echo  Login:       !ADMIN_EMAIL!
echo  MCP API Key: !MCP_API_KEY!
echo.
echo  A chave tambem foi salva em: mcp-api-key.txt
echo.
echo  Comandos uteis:
echo    docker compose logs -f mcp-server
echo    docker compose restart mcp-server
echo    docker compose down
echo.
pause
