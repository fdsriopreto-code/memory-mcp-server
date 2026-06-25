import { useState } from "react";

type Section = {
  id:       string;
  icon:     string;
  title:    string;
  subtitle: string;
  content:  React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "intro",
    icon: "🧠",
    title: "O que é o Memory MCP?",
    subtitle: "Segundo cérebro persistente para o Claude",
    content: (
      <div className="space-y-4">
        <p className="text-white/70 leading-relaxed">
          O Memory MCP dá ao Claude uma <strong className="text-white">memória permanente</strong> entre conversas.
          Tudo que você aprende junto — bugs resolvidos, decisões tomadas, padrões de código —
          fica salvo para sempre e é injetado automaticamente quando relevante.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {[
            { icon: "💾", title: "Memória Persistente", desc: "O Claude lembra de tudo entre sessões" },
            { icon: "💻", title: "Controle Remoto", desc: "Execute comandos no PC pelo celular" },
            { icon: "🤖", title: "Agente Autônomo", desc: "Diga o objetivo, ele executa sozinho" },
          ].map(f => (
            <div key={f.title} className="rounded-xl p-4 border border-white/10" style={{ background: "rgba(99,102,241,0.08)" }}>
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="text-sm font-semibold text-white">{f.title}</div>
              <div className="text-xs text-white/50 mt-1">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "memories",
    icon: "💾",
    title: "Memórias",
    subtitle: "O coração do sistema — /memories e /brain",
    content: (
      <div className="space-y-4">
        <p className="text-white/70 leading-relaxed">
          Memórias são pedaços de conhecimento que o Claude guarda permanentemente sobre o seu projeto.
        </p>
        <div className="space-y-2">
          {[
            { type: "FACT",       color: "#60a5fa", desc: "Fatos objetivos — 'A API usa porta 3100'" },
            { type: "DECISION",   color: "#a78bfa", desc: "Decisões — 'Escolhemos usar Tailwind por causa de X'" },
            { type: "BUG_FIX",    color: "#f87171", desc: "Bugs resolvidos — 'PIX expirava porque...'" },
            { type: "PATTERN",    color: "#34d399", desc: "Padrões — 'Sempre usar asyncHandler nas rotas'" },
            { type: "PREFERENCE", color: "#fbbf24", desc: "Preferências — 'Não usar comentários no código'" },
            { type: "WARNING",    color: "#fb923c", desc: "Alertas críticos — 'Nunca alterar X sem Y'" },
          ].map(m => (
            <div key={m.type} className="flex items-start gap-3 p-3 rounded-xl border border-white/5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded shrink-0" style={{ background: `${m.color}20`, color: m.color }}>
                {m.type}
              </span>
              <span className="text-sm text-white/60">{m.desc}</span>
            </div>
          ))}
        </div>
        <div className="p-4 rounded-xl border border-indigo-500/20" style={{ background: "rgba(99,102,241,0.06)" }}>
          <div className="text-xs font-semibold text-indigo-400 mb-1">💡 Dica</div>
          <div className="text-sm text-white/60">Memórias com importância 5 são sempre injetadas. Importância 1-2 só aparecem quando muito relevantes.</div>
        </div>
      </div>
    ),
  },
  {
    id: "computer",
    icon: "💻",
    title: "Terminal Remoto",
    subtitle: "Controle seu PC de qualquer lugar — /computer",
    content: (
      <div className="space-y-4">
        <p className="text-white/70 leading-relaxed">
          Execute comandos no seu computador em casa estando com o celular. Git, npm, VS Code — qualquer coisa.
        </p>
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="px-4 py-2 border-b border-white/5 text-xs text-white/40 font-mono">Passo 1 — Inicie o Computer Agent no seu PC</div>
          <pre className="p-4 text-sm font-mono text-green-400 overflow-x-auto" style={{ background: "#0d0d14" }}>
{`cd computer-agent
npm install
npx tsx src/index.ts
# ✅ Conectado como "SEU-PC"`}
          </pre>
        </div>
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="px-4 py-2 border-b border-white/5 text-xs text-white/40 font-mono">Passo 2 — Use pelo celular ou browser</div>
          <div className="p-4 space-y-2">
            {["git status", "git add -A && git commit -m 'feat: nova feature'", "git push", "npm run build"].map(cmd => (
              <div key={cmd} className="flex items-center gap-2 font-mono text-xs text-green-400">
                <span className="text-white/30">$</span> {cmd}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "agent",
    icon: "🤖",
    title: "Agent Run",
    subtitle: "Agente autônomo — /agent-run",
    content: (
      <div className="space-y-4">
        <p className="text-white/70 leading-relaxed">
          Você diz o <strong className="text-white">objetivo</strong> em linguagem natural.
          O GPT-4o cria um plano, executa cada passo automaticamente e você vê tudo em tempo real.
        </p>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-wider">Exemplos de objetivos</div>
          {[
            "Faça git add -A, crie um commit com mensagem descritiva e faça push",
            "Pesquise as melhores práticas de segurança em APIs Node.js e salve na memória",
            "Analise os arquivos em src/ e liste possíveis bugs",
            "npm run build — se der erro, mostre o que está errado",
          ].map(goal => (
            <div key={goal} className="flex items-start gap-2 p-3 rounded-xl border border-white/5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <span className="text-indigo-400 text-sm shrink-0">→</span>
              <span className="text-sm text-white/70 italic">"{goal}"</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "anchors",
    icon: "⚓",
    title: "Memory Anchors",
    subtitle: "Gatilhos automáticos de contexto — /anchors",
    content: (
      <div className="space-y-4">
        <p className="text-white/70 leading-relaxed">
          Anchors são gatilhos: quando o Claude detecta uma palavra-chave na conversa,
          as memórias vinculadas são injetadas automaticamente — mesmo sem você pedir.
        </p>
        <div className="space-y-3">
          {[
            { type: "KEYWORD",  example: "pagamento",     desc: "Toda vez que falar em pagamento → injeta as regras de MercadoPago" },
            { type: "REGEX",    example: "/webhook/i",    desc: "Regex — detecta webhook, Webhook, WEBHOOK..." },
            { type: "SEMANTIC", example: "processar cartão", desc: "Por significado — 'cobrar cliente' também ativa" },
          ].map(a => (
            <div key={a.type} className="p-4 rounded-xl border border-white/10 space-y-1" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-indigo-400">{a.type}</span>
                <code className="text-xs text-white/60 bg-white/5 px-2 py-0.5 rounded">{a.example}</code>
              </div>
              <div className="text-xs text-white/50">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "mcp-tools",
    icon: "🔧",
    title: "Ferramentas no Claude Code",
    subtitle: "Comandos disponíveis quando o MCP está conectado",
    content: (
      <div className="space-y-3">
        <p className="text-white/70 text-sm">Adicione no seu <code className="text-indigo-400 bg-indigo-500/10 px-1 rounded">~/.claude/settings.json</code>:</p>
        <pre className="p-4 rounded-xl text-xs font-mono text-green-400 overflow-x-auto" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
{`{
  "mcpServers": {
    "memory": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer SUA_MCP_API_KEY"
      }
    }
  }
}`}
        </pre>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          {[
            ["memory_search",   "Busca memórias por significado"],
            ["memory_add",      "Salva nova memória"],
            ["brain_learn",     "Aprende de um texto automaticamente"],
            ["brain_status",    "Resumo do estado do brain"],
            ["brain_review",    "Revisa código vs memórias de bugs"],
            ["brain_interview", "Gera perguntas para preencher lacunas"],
            ["computer_exec",   "Executa comando no PC"],
            ["computer_git",    "Executa git no PC"],
            ["web_search",      "Pesquisa na internet"],
            ["web_fetch",       "Acessa uma URL"],
            ["agent_run",       "Loop autônomo multi-step"],
            ["task_create",     "Cria tarefa no projeto"],
          ].map(([tool, desc]) => (
            <div key={tool} className="flex items-start gap-2 p-2 rounded-lg border border-white/5">
              <code className="text-[10px] font-mono text-indigo-400 shrink-0 mt-0.5">{tool}</code>
              <span className="text-[10px] text-white/40">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "pages",
    icon: "📄",
    title: "Guia das Páginas",
    subtitle: "O que cada aba do sistema faz",
    content: (
      <div className="space-y-2">
        {[
          { path: "/",               icon: "🏠", title: "Dashboard",       desc: "KPIs e resumo geral do projeto" },
          { path: "/memories",       icon: "💾", title: "Memórias",        desc: "Lista e gerencia todas as memórias" },
          { path: "/brain",          icon: "🌳", title: "Brain",           desc: "Árvore visual das memórias por tipo" },
          { path: "/brain-graph",    icon: "🕸️", title: "Brain Graph",     desc: "Grafo de conexões entre memórias" },
          { path: "/atlas",          icon: "🗺️", title: "Atlas",           desc: "Mapa 2D de memórias por similaridade semântica" },
          { path: "/search",         icon: "🔍", title: "Busca",           desc: "Busca semântica por significado (não palavra exata)" },
          { path: "/tasks",          icon: "✅", title: "Tarefas",         desc: "TODOs integrados ao projeto" },
          { path: "/chat",           icon: "💬", title: "Chat",            desc: "Interface mobile-friendly" },
          { path: "/agent-run",      icon: "🤖", title: "Agent Run",       desc: "Agente autônomo — diga o objetivo" },
          { path: "/computer",       icon: "💻", title: "Terminal",        desc: "Terminal remoto no seu PC" },
          { path: "/anchors",        icon: "⚓", title: "Anchors",         desc: "Gatilhos automáticos de memória" },
          { path: "/session-monitor",icon: "👁️", title: "Session Monitor", desc: "Monitor em tempo real de tudo" },
          { path: "/timeline",       icon: "📅", title: "Timeline",        desc: "Histórico de crescimento da memória" },
          { path: "/brain-health",   icon: "📊", title: "Brain Health",    desc: "Heatmap de atividade + conflitos e duplicatas" },
          { path: "/knowledge-debt", icon: "📁", title: "Knowledge Debt",  desc: "Arquivos do projeto sem cobertura na memória" },
        ].map(p => (
          <div key={p.path} className="flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-colors" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="text-lg w-8 text-center shrink-0">{p.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{p.title}</span>
                <code className="text-[10px] text-white/30 font-mono">{p.path}</code>
              </div>
              <div className="text-xs text-white/50 mt-0.5">{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export default function HelpPage() {
  const [active, setActive] = useState("intro");
  const section = SECTIONS.find(s => s.id === active) ?? SECTIONS[0];

  return (
    <div className="flex gap-5 h-[calc(100vh-80px)]">
      {/* Sidebar */}
      <div className="w-56 shrink-0 flex flex-col gap-1 overflow-y-auto">
        <div className="text-xs font-semibold text-white/30 uppercase tracking-wider px-3 py-2">Ajuda</div>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all w-full"
            style={{
              background: active === s.id ? "rgba(99,102,241,0.15)" : "transparent",
              border: active === s.id ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
              color: active === s.id ? "#fff" : "rgba(255,255,255,0.45)",
            }}>
            <span className="text-base">{s.icon}</span>
            <span className="text-sm font-medium truncate">{s.title}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-white/10 p-6" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-3xl">{section.icon}</span>
            <h1 className="text-xl font-bold text-white">{section.title}</h1>
          </div>
          <p className="text-sm text-white/40 ml-12">{section.subtitle}</p>
        </div>
        <div className="text-sm">
          {section.content}
        </div>
      </div>
    </div>
  );
}
