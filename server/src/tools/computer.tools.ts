import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { logAudit } from "./audit.js";
import { sendToComputer, getComputerAgents } from "../ws.js";
import { broadcast } from "../ws.js";

export function registerComputerTools(server: McpServer) {

  server.tool(
    "computer_list",
    "Lista os computadores conectados como agentes — mostra quais PCs estão disponíveis para receber comandos",
    {},
    async () => {
      const agents = getComputerAgents();
      if (!agents.length) {
        return { content: [{ type: "text" as const, text: `# 💻 Nenhum computador conectado\n\nPara conectar seu PC:\n1. Abra a pasta \`computer-agent/\` do repositório\n2. Execute \`start-dev.bat\` (Windows) ou \`npx tsx src/index.ts\`\n3. O agente vai conectar automaticamente\n\nO agente usa a mesma API key do MCP — sem configuração extra.` }] };
      }
      const list = agents.map(a => {
        const ago = Math.round((Date.now() - a.connectedAt.getTime()) / 60_000);
        return `- **${a.agentId}** — ${a.hostname} (${a.platform}) — conectado há ${ago < 1 ? "< 1" : ago} min`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: `# 💻 Computadores Conectados (${agents.length})\n\n${list}` }] };
    }
  );

  server.tool(
    "computer_exec",
    "Executa um comando de terminal no seu computador local — git, npm, node, tsc, qualquer CLI. O output é retornado em tempo real.",
    {
      command:  z.string().describe("Comando a executar (ex: 'git status', 'npm run build', 'ls -la')"),
      workdir:  z.string().optional().describe("Diretório de trabalho (ex: 'C:\\\\Users\\\\user\\\\projeto')"),
      agent_id: z.string().optional().describe("ID do agente (omitir usa o primeiro disponível)"),
    },
    async ({ command, workdir, agent_id }) => {
      const agents = getComputerAgents();
      if (!agents.length) return { content: [{ type: "text" as const, text: "❌ Nenhum computador conectado. Rode o computer-agent no seu PC." }] };

      const targetId = agent_id ?? agents[0].agentId;
      broadcast("computer_exec_start", { agentId: targetId, command, workdir });

      try {
        const result = await sendToComputer(targetId, command, workdir);
        await logAudit(null, "computer_exec", { agentId: targetId, command }, result.output.slice(0, 300));

        const status = result.exitCode === 0 ? "✅" : "❌";
        const output = result.output.slice(0, 8000) || "(sem output)";
        return { content: [{ type: "text" as const, text: `${status} **Exit code:** ${result.exitCode}\n\n\`\`\`\n${output}\n\`\`\`` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ Erro: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "computer_git",
    "Executa comandos git no seu computador — commit, push, pull, status, log, branch, etc.",
    {
      args:     z.array(z.string()).describe("Argumentos git (ex: ['status'], ['commit', '-m', 'feat: nova feature'], ['push'])"),
      workdir:  z.string().optional().describe("Diretório do repositório"),
      agent_id: z.string().optional().describe("ID do agente"),
    },
    async ({ args, workdir, agent_id }) => {
      const agents = getComputerAgents();
      if (!agents.length) return { content: [{ type: "text" as const, text: "❌ Nenhum computador conectado." }] };

      const targetId = agent_id ?? agents[0].agentId;
      const command  = `git ${args.join(" ")}`;

      try {
        const result = await sendToComputer(targetId, command, workdir);
        await logAudit(null, "computer_git", { agentId: targetId, args }, result.output.slice(0, 200));

        const status = result.exitCode === 0 ? "✅" : "❌";
        return { content: [{ type: "text" as const, text: `${status} \`${command}\`\n\n\`\`\`\n${result.output.slice(0, 6000) || "(sem output)"}\n\`\`\`` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "computer_read_file",
    "Lê o conteúdo de um arquivo no seu computador local",
    {
      path:     z.string().describe("Caminho absoluto do arquivo (ex: 'C:\\\\Users\\\\user\\\\projeto\\\\src\\\\index.ts')"),
      agent_id: z.string().optional().describe("ID do agente"),
    },
    async ({ path, agent_id }) => {
      const agents = getComputerAgents();
      if (!agents.length) return { content: [{ type: "text" as const, text: "❌ Nenhum computador conectado." }] };

      const targetId = agent_id ?? agents[0].agentId;

      try {
        // Usar cat/type para ler o arquivo
        const osCheck = await sendToComputer(targetId, "echo %OS%");
        const isWindows = osCheck.output.includes("Windows");
        const readCmd   = isWindows ? `type "${path}"` : `cat "${path}"`;
        const result    = await sendToComputer(targetId, readCmd);

        if (result.exitCode !== 0) {
          return { content: [{ type: "text" as const, text: `❌ Arquivo não encontrado ou sem permissão: ${path}` }] };
        }

        await logAudit(null, "computer_read_file", { agentId: targetId, path }, `${result.output.length} chars`);
        return { content: [{ type: "text" as const, text: `**📄 ${path}**\n\n\`\`\`\n${result.output.slice(0, 20000)}\n\`\`\`` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "computer_write_file",
    "Escreve conteúdo em um arquivo no seu computador local — cria ou sobrescreve",
    {
      path:     z.string().describe("Caminho absoluto do arquivo"),
      content:  z.string().describe("Conteúdo a escrever"),
      agent_id: z.string().optional().describe("ID do agente"),
    },
    async ({ path, content, agent_id }) => {
      const agents = getComputerAgents();
      if (!agents.length) return { content: [{ type: "text" as const, text: "❌ Nenhum computador conectado." }] };

      const targetId = agent_id ?? agents[0].agentId;

      // Usar PowerShell para escrever o arquivo (mais robusto no Windows)
      const escaped = content.replace(/'/g, "''");
      const psCmd   = `powershell -Command "$content = @'\n${escaped}\n'@; Set-Content -Path '${path.replace(/\\/g, "\\\\")}' -Value $content -Encoding UTF8"`;

      try {
        const result = await sendToComputer(targetId, psCmd);
        await logAudit(null, "computer_write_file", { agentId: targetId, path }, `${content.length} chars`);

        if (result.exitCode === 0) {
          return { content: [{ type: "text" as const, text: `✅ Arquivo salvo: ${path} (${content.length} chars)` }] };
        } else {
          return { content: [{ type: "text" as const, text: `❌ Erro ao salvar: ${result.output}` }] };
        }
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "computer_vscode",
    "Abre um arquivo ou pasta no VS Code no seu computador",
    {
      target:   z.string().describe("Caminho do arquivo ou pasta para abrir no VS Code"),
      agent_id: z.string().optional().describe("ID do agente"),
    },
    async ({ target, agent_id }) => {
      const agents = getComputerAgents();
      if (!agents.length) return { content: [{ type: "text" as const, text: "❌ Nenhum computador conectado." }] };

      const targetId = agent_id ?? agents[0].agentId;
      const command  = `code "${target}"`;

      try {
        await sendToComputer(targetId, command);
        await logAudit(null, "computer_vscode", { agentId: targetId, target }, "VS Code aberto");
        return { content: [{ type: "text" as const, text: `✅ VS Code abrindo: ${target}` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );
}
