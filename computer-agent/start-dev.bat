@echo off
echo Memory MCP Computer Agent [DEV]
set MCP_SERVER_URL=wss://ferramentas-memory-mcp-server.m5mfeg.easypanel.host
set MCP_API_KEY=
set AGENT_ID=%COMPUTERNAME%
npx tsx src/index.ts
pause
