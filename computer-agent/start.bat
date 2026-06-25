@echo off
echo Memory MCP Computer Agent
echo Conectando ao servidor MCP...
set MCP_SERVER_URL=wss://ferramentas-memory-mcp-server.m5mfeg.easypanel.host
set MCP_API_KEY=
set AGENT_ID=%COMPUTERNAME%
node dist/index.js
pause
