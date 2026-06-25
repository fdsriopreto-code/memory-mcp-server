# Memory MCP — Desktop App

## Desenvolvimento

```bash
cd electron
npm install
npm run dev
```

## Build

```bash
# Build o servidor primeiro
cd server && npm run build

# Build o frontend
cd frontend && npm run build

# Build o Electron
cd electron
npm install
npm run dist:win   # Windows .exe
npm run dist:mac   # macOS .dmg
npm run dist:linux # Linux .AppImage
```

## Configuração

Na primeira execução, o app cria um arquivo de configuração em:
- Windows: `%APPDATA%\memory-mcp-desktop\config.json`
- macOS: `~/Library/Application Support/memory-mcp-desktop/config.json`
- Linux: `~/.config/memory-mcp-desktop/config.json`

Preencha:
- `DATABASE_URL` — PostgreSQL (Neon/Supabase grátis)
- `OPENAI_API_KEY` — API key da OpenAI
