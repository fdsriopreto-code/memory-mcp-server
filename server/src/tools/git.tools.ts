import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSync } from "child_process";
import { prisma } from "../config/database.js";
import { extractMemoriesFromText } from "../services/ai.service.js";
import { getEmbedding } from "../services/embedding.service.js";
import { logAudit } from "./audit.js";

export function registerGitTools(server: McpServer) {

  server.tool(
    "git_extract",
    "Lê o histórico de commits de um repositório git local e extrai automaticamente memórias estruturadas — decisões arquiteturais, bugs corrigidos, padrões descobertos. O cérebro aprende direto do código.",
    {
      project:  z.string().describe("Slug do projeto"),
      repoPath: z.string().describe("Caminho absoluto para o repositório git local (ex: /home/user/meu-projeto)"),
      since:    z.string().default("30 days ago").describe("Período a analisar (ex: '30 days ago', '2026-01-01', '3 months ago')"),
      branch:   z.string().optional().describe("Branch específico (opcional, usa o atual se omitido)"),
      maxCommits: z.number().min(1).max(200).default(50).describe("Máximo de commits a processar"),
      dry_run:  z.boolean().default(true).describe("true = mostra o que seria criado sem salvar | false = salva as memórias"),
    },
    async ({ project, repoPath, since, branch, maxCommits, dry_run }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      // Verificar que é um repo git válido
      try {
        execSync(`git -C "${repoPath}" rev-parse --is-inside-work-tree`, { stdio: "pipe" });
      } catch {
        return { content: [{ type: "text" as const, text: `❌ Caminho inválido ou não é um repositório git: ${repoPath}` }] };
      }

      // Obter commits
      const branchArg = branch ? `"${branch}"` : "";
      let gitLog = "";
      try {
        const cmd = `git -C "${repoPath}" log ${branchArg} --since="${since}" --format="COMMIT_START%nHash: %H%nDate: %ad%nAuthor: %ae%nSubject: %s%nBody: %b%nCOMMIT_END" --date=short -${maxCommits}`;
        gitLog = execSync(cmd, { stdio: "pipe", encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      } catch (e) {
        return { content: [{ type: "text" as const, text: `❌ Erro ao ler git log: ${e instanceof Error ? e.message : String(e)}` }] };
      }

      if (!gitLog.trim()) {
        return { content: [{ type: "text" as const, text: `Nenhum commit encontrado desde "${since}" no repositório ${repoPath}.` }] };
      }

      // Obter estatísticas de arquivos alterados
      let diffStat = "";
      try {
        diffStat = execSync(
          `git -C "${repoPath}" diff --stat HEAD~${Math.min(maxCommits, 30)} HEAD 2>/dev/null || echo "diff não disponível"`,
          { stdio: "pipe", encoding: "utf8", maxBuffer: 1024 * 1024 }
        );
      } catch { diffStat = ""; }

      // Construir texto para extração
      const extractText = `
# Histórico de commits — ${repoPath}
Período: desde ${since}
Branch: ${branch ?? "atual"}

## Commits
${gitLog.slice(0, 12000)}

## Arquivos alterados (diff stat)
${diffStat.slice(0, 2000)}
      `.trim();

      // Extrair memórias via IA
      let extracted: { type: string; title: string; content: string; tags: string[]; importance: number }[] = [];
      try {
        extracted = await extractMemoriesFromText(extractText, proj.name);
      } catch (e) {
        return { content: [{ type: "text" as const, text: `❌ Erro na extração de memórias: ${e instanceof Error ? e.message : String(e)}` }] };
      }

      if (extracted.length === 0) {
        return { content: [{ type: "text" as const, text: "A IA não encontrou memórias relevantes nestes commits. Tente um período maior ou com mais commits." }] };
      }

      if (dry_run) {
        const preview = extracted.map((m, i) =>
          `**${i + 1}. [${m.type}]** ${m.title} (imp:${m.importance})\n   Tags: ${m.tags.join(", ") || "—"}\n   ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`
        ).join("\n\n");
        return { content: [{ type: "text" as const, text: `# 👁️ Git Extract Dry Run\n\nAnalisados: commits desde "${since}"\n**${extracted.length} memórias seriam criadas:**\n\n${preview}\n\n---\n_Use dry_run: false para salvar no projeto "${project}"._` }] };
      }

      // Salvar memórias
      const created = await Promise.all(
        extracted.map(m =>
          prisma.memory.create({
            data: {
              projectId: proj.id,
              type: m.type as any,
              title: m.title,
              content: m.content,
              tags: [...m.tags, "git-extracted"],
              importance: m.importance,
            },
          })
        )
      );

      // Embeddings async
      setImmediate(async () => {
        for (let i = 0; i < created.length; i++) {
          try {
            const emb = await getEmbedding(`${extracted[i].title}\n\n${extracted[i].content}`);
            await prisma.$executeRaw`UPDATE memories SET embedding = ${`[${emb.join(",")}]`}::vector WHERE id = ${created[i].id}`;
          } catch {}
        }
      });

      await logAudit(proj.id, "git_extract", { project, repoPath, since, maxCommits }, `${created.length} memórias extraídas do git`);

      const summary = created.map((m, i) =>
        `- **[${extracted[i].type}]** ${extracted[i].title} (imp:${extracted[i].importance}/5) — \`${m.id}\``
      ).join("\n");

      return { content: [{ type: "text" as const, text: `# ✅ Git Extract — ${created.length} memórias absorvidas\n\nRepositório: \`${repoPath}\`\nPeríodo: ${since}\n\n${summary}\n\n🧠 O cérebro aprendeu direto do histórico do código.` }] };
    }
  );
}
