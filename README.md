<div align="center">

<img src="docs/banner.svg" alt="Memory MCP" width="100%"/>

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-a855f7?style=flat-square)](https://modelcontextprotocol.io)
[![Claude](https://img.shields.io/badge/Claude-Code-d97706?style=flat-square)](https://claude.ai/code)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)

**The AI memory system that makes Claude remember everything — forever.**

[Features](#-features) · [Quick Start](#-quick-start) · [Screenshots](#-screenshots) · [MCP Tools](#-mcp-tools) · [Desktop App](#-desktop-app) · [Self-Host](#-self-hosting)

</div>

---

## What is Memory MCP?

Memory MCP gives Claude a **persistent second brain** that survives across every conversation. Once you learn something together, it's never forgotten.

```
You: "Remember that we use Tailwind and never add comments to code"
Claude: ✅ Saved. I'll remember this in every future session.

--- next week, new conversation ---

You: "Add a button to this component"
Claude: I'll use Tailwind classes as usual, without comments...
```

But it goes way beyond memory. You can **control your computer from your phone**, run **autonomous agents** that execute tasks on their own, and browse the web — all from a single MCP server.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🧠 Persistent Memory
- Memories survive across **all** Claude sessions
- **Semantic search** — finds by meaning, not exact words
- 7 memory types: `FACT` `DECISION` `BUG_FIX` `PATTERN` `WARNING` `PREFERENCE` `NOTE`
- Importance levels (1-5), auto-decay for old memories
- Visual graph of memory connections

</td>
<td width="50%">

### 💻 Remote Computer Control
- Execute **any terminal command** from Claude or your phone
- Full git workflow: status, commit, push, pull
- Open files in VS Code remotely
- Real-time output streaming
- Works over the internet, not just local network

</td>
</tr>
<tr>
<td width="50%">

### 🤖 Autonomous Agent
- Tell Claude your **goal** in plain language
- GPT-4o creates an execution plan
- Runs each step automatically
- Learns from every run (results saved to memory)
- Real-time progress via WebSocket

</td>
<td width="50%">

### 🔍 Web Intelligence
- `web_search` — Tavily AI search (free 1000/mo) or DuckDuckGo fallback (no key needed)
- `web_fetch` — Extract readable content from any URL
- Results automatically saved to memory when relevant

</td>
</tr>
<tr>
<td width="50%">

### ⚓ Smart Triggers (Anchors)
- Auto-inject memories when keywords are detected
- `KEYWORD`, `REGEX`, or `SEMANTIC` pattern matching
- Example: mention "payment" → payment rules auto-loaded

</td>
<td width="50%">

### 📊 Brain Analytics
- 2D memory atlas (semantic similarity map)
- GitHub-style activity heatmap
- Knowledge debt — find code files with no memory coverage
- Conflict & duplicate detection

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Option 1 — Docker (recommended, 2 minutes)

```bash
git clone https://github.com/fdsriopreto-code/memory-mcp-server
cd memory-mcp-server
cp .env.example .env
# Edit .env with your keys (see below)
docker-compose up -d
```

That's it. Open `http://localhost:3101` for the dashboard.

### Option 2 — Desktop App

Download the installer for your OS from [Releases](https://github.com/fdsriopreto-code/memory-mcp-server/releases) and run it. The app connects to your server automatically.

### Configure Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

### Required Environment Variables

| Variable | Description | Where to get |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | [Neon](https://neon.tech) (free) or [Supabase](https://supabase.com) (free) |
| `OPENAI_API_KEY` | For embeddings & AI features | [platform.openai.com](https://platform.openai.com) |
| `JWT_SECRET` | Random 32+ char string | `openssl rand -hex 32` |
| `MCP_API_KEY` | Your API key for Claude | Any random string |
| `TAVILY_API_KEY` | Web search (optional) | [tavily.com](https://tavily.com) — free 1000/mo |

---

## 📸 Screenshots

> **Want to add screenshots?**  
> Record with [ScreenToGif](https://www.screentogif.com/) (Windows, free) and save to `docs/screenshots/`.

### Dashboard & Brain Graph

<!-- Replace with actual screenshot -->
<!-- ![Dashboard](docs/screenshots/dashboard.png) -->

```
📊 Dashboard shows:  KPIs · recent memories · activity chart
🕸️ Brain Graph:      visual network of all memory connections
🗺️ Atlas:            2D semantic map (memories clustered by topic)
```

### Remote Terminal — Control your PC from anywhere

<!-- Replace with actual GIF -->
<!-- ![Terminal](docs/screenshots/terminal.gif) -->

```
1. Start the computer agent on your PC:
   cd computer-agent && npx tsx src/index.ts

2. Open /computer on your phone browser
3. Type any command → runs on your PC in real-time
```

### Autonomous Agent in Action

<!-- Replace with actual GIF -->
<!-- ![Agent Run](docs/screenshots/agent-run.gif) -->

```
Goal: "git add -A, write a good commit message and push"

Step 1 [computer_exec] git status ............... ✅
Step 2 [computer_exec] git diff --stat .......... ✅
Step 3 [computer_exec] git add -A ............... ✅
Step 4 [computer_exec] git commit -m "..." ...... ✅
Step 5 [computer_exec] git push ................. ✅

Done in 12 seconds.
```

### Memory Types & Search

<!-- Replace with actual screenshot -->
<!-- ![Memories](docs/screenshots/memories.png) -->

---

## 🔧 MCP Tools

All tools are available in Claude Code once the MCP server is connected.

### Memory
| Tool | Description |
|---|---|
| `memory_search` | Semantic search — finds by meaning, not exact words |
| `memory_add` | Save a new memory with type and importance |
| `memory_update` | Update existing memory content or importance |
| `memory_delete` | Remove a memory |

### Brain Intelligence
| Tool | Description |
|---|---|
| `brain_learn` | Auto-extract memories from any text/documentation |
| `brain_status` | Summary of current brain state and recent activity |
| `brain_review` | Review code against known bugs — prevent regressions |
| `brain_interview` | Generate questions to fill knowledge gaps |
| `brain_vaccinate` | Convert known bugs → auto-injection anchors |
| `brain_prewarm` | Pre-load context for specific files before editing |
| `brain_export` | Export all memories as JSON or Markdown |
| `brain_time_travel` | See what the brain looked like at a past date |

### Computer Control
| Tool | Description |
|---|---|
| `computer_list` | List connected computers |
| `computer_exec` | Run any shell command on your PC |
| `computer_git` | Git operations (status, commit, push, pull...) |
| `computer_read_file` | Read a file from your PC |
| `computer_write_file` | Write/create a file on your PC |
| `computer_vscode` | Open file or folder in VS Code |

### Web & Agents
| Tool | Description |
|---|---|
| `web_search` | Search the web (Tavily or DuckDuckGo fallback) |
| `web_fetch` | Fetch and extract readable content from any URL |
| `agent_run` | Autonomous multi-step agent — give a goal, it executes |

### Tasks & Anchors
| Tool | Description |
|---|---|
| `task_create` | Create a project task |
| `task_list` | List tasks with status |
| `task_update` | Update task status |
| `anchor_create` | Create auto-injection memory trigger |
| `anchor_list` | List active triggers |
| `anchor_trigger` | Test which anchors would fire for a query |
| `git_extract` | Extract memories from git commit history |

---

## 🖥️ Desktop App

The desktop app is a lightweight wrapper (~120MB) that opens your server in a native window with system tray support.

### Download

Get the latest build from [Releases](https://github.com/fdsriopreto-code/memory-mcp-server/releases):
- **Windows**: `Memory-MCP-Setup-x.x.x.exe`
- **macOS**: `Memory-MCP-x.x.x.dmg`
- **Linux**: `Memory-MCP-x.x.x.AppImage`

### Features
- Stays in system tray — always one click away
- Auto-connects to your VPS server
- Works offline (shows error screen if server is down)
- Configurable server URL via `config.json`

### Config file location
- Windows: `%APPDATA%\memory-mcp-desktop\config.json`
- macOS: `~/Library/Application Support/memory-mcp-desktop/config.json`
- Linux: `~/.config/memory-mcp-desktop/config.json`

```json
{
  "serverUrl": "https://your-server.easypanel.host"
}
```

---

## 📱 Mobile PWA

The frontend is a Progressive Web App — add it to your home screen for a native-like experience.

**iOS**: Safari → Share → Add to Home Screen  
**Android**: Chrome → Menu → Install App (or Add to Home Screen)

Once installed, you get:
- Full-screen app experience
- Remote terminal from your phone
- Agent run — send goals on the go
- Real-time notifications via WebSocket

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Memory MCP Server                        │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌────────────────────────┐   │
│  │ MCP/HTTP │  │  REST API  │  │    WebSocket /ws        │   │
│  │  /mcp    │  │  /api/*    │  │  frontend (JWT)         │   │
│  └────┬─────┘  └─────┬──────┘  │  computer agent (key)  │   │
│       │               │         └────────────┬───────────┘   │
│  ┌────▼───────────────▼──────────────────────▼───────────┐   │
│  │              Express + Prisma + PostgreSQL              │   │
│  │         pgvector · BullMQ · OpenAI embeddings          │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
    Claude Code          Browser/PWA          Computer Agent
    (MCP client)         (dashboard)          (local daemon)
```

### Computer Agent
The computer agent is a tiny Node.js daemon that runs on your local machine and connects to the MCP server via WebSocket. This enables Claude to execute commands, run git, open files, and more — all on your actual computer.

```
Cloud (MCP Server) ──── WebSocket ────► Local Computer
                                            ↓ executes
                                      terminal, git, vscode, files
```

---

## 🐳 Self-Hosting

### Requirements
- PostgreSQL 15+ with pgvector extension
- Node.js 20+ (or Docker)
- OpenAI API key (for embeddings)

### Docker Compose

```yaml
# docker-compose.yml is included in the repo
docker-compose up -d
```

Services started:
- `db` — PostgreSQL 16 with pgvector
- `server` — MCP server on port 3100
- `frontend` — React dashboard on port 3101

### EasyPanel / Railway / Render

The project includes ready-to-use Dockerfiles:
- `Dockerfile.server` — MCP backend
- `Dockerfile` (frontend) — React dashboard

Set environment variables in your hosting panel and deploy.

---

## 🔌 Computer Agent Setup

```bash
# In the repo root
cd computer-agent
npm install

# Start the agent (connects to your MCP server automatically)
npx tsx src/index.ts

# Or use the Windows launcher
start-dev.bat
```

The agent auto-reconnects if the connection drops. Keep it running in a terminal or set it up as a startup service.

### Windows — Run on startup (optional)

1. Press `Win + R` → `shell:startup`
2. Create a shortcut to `start-dev.bat` there
3. The agent will start with Windows

---

## 🗂️ Project Structure

```
memory-mcp-server/
├── server/              # MCP server (Node.js + Express + Prisma)
│   ├── src/
│   │   ├── tools/       # MCP tools (memory, brain, computer, agent...)
│   │   ├── services/    # AI, embeddings, agent runner
│   │   ├── routes/      # REST API endpoints
│   │   └── ws.ts        # WebSocket (frontend + computer agent)
│   └── prisma/          # Database schema + migrations
├── frontend/            # React dashboard (Vite + Tailwind + shadcn)
│   └── src/pages/       # 20+ pages (brain, terminal, atlas, help...)
├── computer-agent/      # Local daemon for computer control
│   └── src/index.ts
├── electron/            # Desktop app wrapper
│   └── src/main.ts
└── .github/workflows/   # Auto-build .exe/.dmg/.AppImage on release
```

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Open a Pull Request

All issues and PRs are welcome!

---

## 📄 License

MIT © Memory MCP Contributors

---

<div align="center">

**If this project helped you, consider giving it a ⭐**

Built with Claude Code · Powered by MCP · Open Source

</div>
