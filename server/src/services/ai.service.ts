import OpenAI from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export type ExtractedMemory = {
  type: "DECISION" | "CONTEXT" | "PATTERN" | "NOTE" | "BUG_FIX" | "ARCHITECTURE" | "BRAIN";
  title: string;
  content: string;
  tags: string[];
  importance: number;
};

const VALID_TYPES = ["DECISION", "CONTEXT", "PATTERN", "NOTE", "BUG_FIX", "ARCHITECTURE", "BRAIN"];

export async function extractMemoriesFromText(text: string, projectName: string): Promise<ExtractedMemory[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a knowledge extraction expert for a software project called "${projectName}".
Extract structured memories from the provided session text.

MEMORY TYPES (pick the most accurate):
- DECISION: Architectural/design decisions made and why
- CONTEXT: Background context, setup, configuration, environment
- PATTERN: Recurring code patterns, conventions, best practices discovered
- NOTE: Important warnings, gotchas, reminders
- BUG_FIX: Bugs found/fixed — what was the bug, root cause, and the fix
- ARCHITECTURE: System modules, flows, components, integrations
- BRAIN: Meta-knowledge about how to work effectively with this project

RULES:
- Extract 3 to 8 memories maximum
- Only extract knowledge that will still be valuable in future sessions
- Do NOT extract temporary/in-progress state or trivial observations
- Focus on: bugs fixed, architectural decisions, patterns discovered, system insights
- Importance scale: 1=trivial, 2=minor, 3=normal, 4=important, 5=critical
- tags: lowercase, specific, relevant for future search
- content: write in Portuguese (pt-BR), be thorough and specific

Output ONLY a JSON object: { "memories": [ { "type", "title", "content", "tags": string[], "importance": number } ] }`,
      },
      {
        role: "user",
        content: text.slice(0, 12000),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    const memories: unknown[] = Array.isArray(parsed.memories) ? parsed.memories : [];
    return memories
      .filter((m): m is ExtractedMemory =>
        typeof m === "object" && m !== null &&
        "type" in m && VALID_TYPES.includes((m as any).type) &&
        "title" in m && typeof (m as any).title === "string" &&
        "content" in m && typeof (m as any).content === "string"
      )
      .map(m => ({
        ...m,
        tags: Array.isArray(m.tags) ? m.tags : [],
        importance: Math.min(5, Math.max(1, typeof m.importance === "number" ? m.importance : 3)),
      }));
  } catch {
    return [];
  }
}

export async function consolidateMemoriesWithAI(
  memories: { title: string; content: string; type: string }[]
): Promise<{ title: string; content: string; type: string }> {
  const source = memories
    .map((m, i) => `### ${i + 1}. [${m.type}] ${m.title}\n${m.content}`)
    .join("\n\n---\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a knowledge consolidation expert. Merge the provided memories into one comprehensive, well-structured memory.
Remove duplication but preserve ALL unique insights. The result must be richer than any individual source.
Output JSON: { "title": string, "type": string, "content": string }
Types: DECISION, CONTEXT, PATTERN, NOTE, BUG_FIX, ARCHITECTURE, BRAIN. Pick the most appropriate.
Write content in Portuguese (pt-BR).`,
      },
      {
        role: "user",
        content: source.slice(0, 10000),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      title:   typeof parsed.title   === "string" ? parsed.title   : memories[0].title,
      content: typeof parsed.content === "string" ? parsed.content : memories.map(m => m.content).join("\n\n"),
      type:    VALID_TYPES.includes(parsed.type)  ? parsed.type    : memories[0].type,
    };
  } catch {
    return {
      title:   memories[0].title,
      content: memories.map(m => m.content).join("\n\n"),
      type:    memories[0].type,
    };
  }
}
