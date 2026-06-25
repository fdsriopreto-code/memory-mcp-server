# 🧠 Memory MCP — Guia Completo

> Seu segundo cérebro persistente para o Claude. Uma vez que você aprende algo, nunca mais esquece.

## O que é isso?

O Memory MCP é um servidor que dá ao Claude uma memória permanente entre conversas. Você também pode:
- Controlar seu computador pelo celular
- Rodar agentes autônomos que executam tarefas sozinhos
- Pesquisar na web
- Visualizar todo o conhecimento em grafos

---

## 🚀 Instalação Rápida

### Opção 1: Docker (recomendado)
```bash
git clone https://github.com/seu-usuario/memory-mcp-server
cd memory-mcp-server
cp .env.example .env   # edite com suas chaves
docker-compose up -d
```

### Opção 2: Desktop App
Baixe o instalador na página de Releases e siga o wizard de configuração.

---

## ⚙️ Configuração no Claude Code

Adicione no seu `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory": {
      "type": "http",
      "url": "https://seu-servidor.com/mcp",
      "headers": {
        "Authorization": "Bearer SUA_API_KEY"
      }
    }
  }
}
```

Ou para uso local (Desktop App):
```json
{
  "mcpServers": {
    "memory": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer SUA_MCP_API_KEY"
      }
    }
  }
}
```

---

## 📖 Guia das Funcionalidades

### 🧠 Memórias (`/memories`)

**O que é:** O coração do sistema. São pedaços de conhecimento que o Claude guarda para sempre.

**Tipos de memória:**
| Tipo | Quando usar |
|---|---|
| `FACT` | Fatos objetivos: "A API usa porta 3100" |
| `DECISION` | Decisões tomadas: "Escolhemos usar Tailwind" |
| `BUG_FIX` | Bugs resolvidos: "PIX expirava por causa de X" |
| `PATTERN` | Padrões de código: "Sempre usar asyncHandler" |
| `PREFERENCE` | Preferências: "Não usar comentários no código" |
| `WARNING` | Alertas: "Nunca alterar X sem fazer Y" |
| `NOTE` | Notas gerais |

**Importância (1-5):**
- 5 = Crítico, sempre relevante (ex: regras de segurança)
- 3 = Normal
- 1 = Baixa prioridade, pode ser esquecida

**Como usar no Claude:**
```
claude: lembra que a gente usa Tailwind aqui?
claude code: /memory memory_search "tailwind configuração"
```

---

### 🌳 Brain (`/brain`)

**O que é:** Visualização em árvore de todas as memórias organizadas por tipo e importância.

**Como usar:** Navegue pela árvore para ver o que o Claude já sabe sobre o projeto. Clique em uma memória para ver detalhes e editá-la.

---

### 🕸️ Grafo do Brain (`/brain-graph`)

**O que é:** Mapa visual de como as memórias se conectam umas às outras.

**Como funciona:** O Claude cria links entre memórias relacionadas automaticamente. Por exemplo: uma memória sobre "autenticação JWT" pode estar ligada a "segurança" e "rotas protegidas".

**Dica:** Use o grafo para descobrir conhecimento que você tinha esquecido. Clique em um nó para ver a memória.

---

### 🔍 Busca (`/search`)

**O que é:** Busca semântica — não precisa digitar a palavra exata. Funciona por significado.

**Exemplo:** Buscar "como fazer login" vai encontrar memórias sobre "autenticação", "JWT", "token", etc.

**Como usar:** Digite o que quer saber na caixa de busca. O sistema encontra as memórias mais relevantes usando IA.

---

### ✅ Tarefas (`/tasks`)

**O que é:** Sistema de TODO integrado com a memória.

**Diferença de um TO-DO comum:** As tarefas são associadas ao projeto e o Claude pode ver, criar e atualizar tarefas durante uma conversa.

**Exemplo de uso:**
```
"Crie uma tarefa: implementar autenticação por telefone, prioridade alta"
```

---

### 💬 Chat (`/chat`)

**O que é:** Interface de chat otimizada para mobile.

**Dica:** Adicione o site na tela inicial do celular (Safari/Chrome → "Adicionar à tela inicial") para ter um app de verdade. Daí você manda comandos pro Claude de qualquer lugar.

---

### 🤖 Agent Run (`/agent-run`)

**O que é:** Loop autônomo onde você diz o OBJETIVO e o Claude planeja e executa sozinho.

**Como funciona:**
1. Você digita o objetivo (ex: "Faça git commit e push de tudo")
2. GPT-4o cria um plano de steps
3. Cada step é executado automaticamente
4. Você vê o progresso em tempo real
5. O resultado é salvo na memória

**Exemplos de objetivos:**
- "Analise os arquivos em src/ e documente os problemas de segurança"
- "Pesquise as melhores práticas de React 19 e salve o que for relevante"
- "Faça git add -A, crie um commit descritivo e faça push"

**Dica importante:** Para usar `computer_exec`, o Computer Agent precisa estar rodando no seu PC (veja abaixo).

---

### 💻 Terminal Remoto (`/computer`)

**O que é:** Terminal que roda comandos no seu computador de qualquer lugar — pelo celular, pelo Claude, de onde for.

**Pré-requisito:** O **Computer Agent** precisa estar rodando no seu PC:
```bash
cd computer-agent
npm install
npx tsx src/index.ts
```

**Como usar:**
1. Inicie o Computer Agent no seu PC
2. Abra `/computer` no browser ou celular
3. Digite comandos normalmente (git, npm, node, etc.)
4. O output aparece em tempo real

**Dica:** Use ↑ e ↓ para navegar no histórico de comandos, igual a um terminal de verdade.

**Exemplos de comandos:**
```
git status
git add -A && git commit -m "feat: nova feature"
git push
npm run build
npm test
code .
```

---

### ⚓ Anchors (`/anchors`)

**O que é:** Gatilhos automáticos de memória. Quando o Claude detecta uma palavra-chave, as memórias vinculadas são injetadas automaticamente no contexto.

**Tipos:**
- `KEYWORD` — quando contém a palavra (ex: "pagamento" → injeta memórias de MercadoPago)
- `REGEX` — expressão regular (ex: `/webhook/i`)
- `SEMANTIC` — por significado (ex: "processamento de cartão" também ativa "pagamento")

**Como criar:**
1. Clique em "Novo Anchor"
2. Dê um nome (ex: "Regras de Pagamento")
3. Escolha o tipo e o padrão
4. Selecione as memórias a injetar

**Quando usar:** Para conhecimento crítico que não pode ser esquecido. Ex: regras de segurança, padrões de código obrigatórios.

---

### 👁️ Session Monitor (`/session-monitor`)

**O que é:** Monitor em tempo real de tudo que está acontecendo no sistema.

**O que mostra:**
- Buscas de memória sendo feitas pelo Claude
- Memórias sendo criadas/atualizadas
- Anchors sendo disparados
- Comandos sendo executados no computador
- Output do agent run em tempo real

**Quando usar:** Para depurar, entender como o Claude está usando a memória, ou só para ver tudo acontecendo ao vivo.

---

### 📅 Timeline (`/timeline`)

**O que é:** Histórico de como a memória cresceu ao longo do tempo.

**O que mostra:**
- Gráfico de memórias criadas por dia/semana
- Linha cumulativa de crescimento
- KPIs: total de memórias, média por dia, memórias importantes

---

### 🗺️ Atlas (`/atlas`)

**O que é:** Mapa 2D de TODAS as memórias, posicionadas por similaridade semântica.

**Como funciona:** Usa PCA para projetar os embeddings (vetores de 1536 dimensões) em 2D. Memórias sobre assuntos similares aparecem próximas.

**Como usar:**
- Clique e arraste para navegar
- Scroll para zoom
- Clique em um ponto para ver a memória
- Use a busca para filtrar por tipo

**Dica:** Clusters de pontos = assuntos relacionados. Se você ver um cluster isolado, pode ser um assunto que precisa de mais conexões.

---

### 📊 Brain Health (`/brain-health`)

**O que é:** Saúde geral da sua memória — heatmap de atividade, conflitos e duplicatas.

**O que mostra:**
- **Heatmap:** calendário de 52 semanas mostrando atividade (igual ao GitHub contributions)
- **Conflitos:** memórias que se contradizem
- **Duplicatas:** memórias muito similares (>92% similaridade)

**Quando usar:** Periodicamente para limpar memórias conflitantes e duplicadas.

---

### 📁 Knowledge Debt (`/knowledge-debt`)

**O que é:** Mostra quais arquivos do seu projeto NÃO têm cobertura na memória.

**Como usar:**
1. Digite o caminho do repositório (ex: `C:\Users\user\meu-projeto`)
2. Clique em "Analisar"
3. Veja a % de cobertura e quais arquivos não têm memórias

**Por que usar:** Para identificar partes do código que o Claude "não conhece" ainda.

---

### ⏮️ Time Travel (`brain_time_travel`)

**O que é:** Tool MCP que mostra como era o brain em uma data específica.

**Como usar no Claude:**
```
"Como era o brain do projeto X em 01/06/2026?"
```

---

### 📋 Audit Log (`/audit`)

**O que é:** Log de todas as operações que foram feitas — quem criou, modificou ou deletou o quê.

---

### 📝 Projetos (`/projects`)

**O que é:** O sistema suporta múltiplos projetos. Cada projeto tem seu próprio conjunto de memórias, tarefas e configurações.

**Exemplo:** Um projeto para "meu-saas", outro para "projeto-pessoal", outro para "estudos".

---

## 🔧 Ferramentas MCP Disponíveis

Quando você adiciona o Memory MCP no Claude Code, estas ferramentas ficam disponíveis:

| Tool | O que faz |
|---|---|
| `memory_add` | Salva uma nova memória |
| `memory_search` | Busca memórias por significado |
| `memory_update` | Atualiza uma memória existente |
| `memory_delete` | Remove uma memória |
| `brain_learn` | Analisa um texto e extrai memórias automaticamente |
| `brain_status` | Resumo do estado atual do brain |
| `brain_review` | Revisa código e sugere problemas baseado em memórias de bugs |
| `brain_interview` | Gera perguntas para preencher lacunas de conhecimento |
| `brain_vaccinate` | Converte bugs conhecidos em anchors preventivos |
| `brain_export` | Exporta todas as memórias em JSON/Markdown |
| `brain_prewarm` | Carrega contexto para arquivos específicos |
| `computer_list` | Lista computadores conectados |
| `computer_exec` | Executa comando no seu PC |
| `computer_git` | Executa git no seu PC |
| `computer_read_file` | Lê um arquivo do seu PC |
| `computer_write_file` | Escreve um arquivo no seu PC |
| `computer_vscode` | Abre arquivo no VS Code |
| `web_search` | Pesquisa na internet |
| `web_fetch` | Acessa uma URL e extrai conteúdo |
| `agent_run` | Loop autônomo: planeja e executa steps |
| `task_create` | Cria uma tarefa |
| `task_list` | Lista tarefas |
| `git_extract` | Extrai memórias do histórico git |
| `anchor_create` | Cria um gatilho de memória |
| `anchor_list` | Lista gatilhos ativos |

---

## 🎯 Fluxo de Uso Recomendado

### 1. Primeiro dia num projeto novo

```
1. Crie um projeto no /projects
2. Use brain_learn para aprender o README e arquivos principais
3. Use git_extract para aprender o histórico de commits
4. Use brain_review nos arquivos principais
```

### 2. No dia a dia

```
- Quando resolver um bug: "Salva uma memória sobre isso"
- Quando tomar uma decisão: "Registra que decidimos usar X por causa de Y"
- Quando iniciar uma sessão: "Qual é o estado atual do projeto X?"
```

### 3. Controle remoto pelo celular

```
1. Abra o Computer Agent no PC: cd computer-agent && npx tsx src/index.ts
2. Acesse memory-mcp pelo celular (ou adicione à tela inicial)
3. Vá em /computer ou /agent-run
4. Mande comandos como: "git add -A && git commit -m 'fix: ...' && git push"
```

---

## ❓ Perguntas Frequentes

**P: O Claude vai usar as memórias automaticamente?**
R: Sim! Quando você faz uma pergunta, o sistema busca automaticamente memórias relevantes e as injeta no contexto.

**P: Minha API key da OpenAI vai ser gasta muito?**
R: O sistema usa `text-embedding-3-small` (muito barato, ~$0.02/1M tokens) para criar embeddings. Uma sessão normal gasta menos de $0.01.

**P: Posso usar sem PostgreSQL?**
R: Por enquanto não — o pgvector (extensão do PostgreSQL) é necessário para a busca semântica. Mas você pode usar o Neon.tech (grátis, sem cartão).

**P: Como conecto o Computer Agent?**
R: Entre na pasta `computer-agent/`, rode `npm install` e depois `npx tsx src/index.ts`. O agente conecta automaticamente e fica em background.

**P: Quanto custa rodar na VPS?**
R: O EasyPanel com o servidor que descrevemos custa cerca de $5-10/mês no DigitalOcean ou similar.
