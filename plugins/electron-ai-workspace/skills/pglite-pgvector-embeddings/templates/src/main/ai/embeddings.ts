import { eq, and, sql, cosineDistance } from "drizzle-orm";
import { embed, embedMany } from "ai";
import { getDb } from "../database.js";
// REPLACE: import paths to your tables. The `documents`, `documentChunks`,
// and `projects` table objects must come from your schema.
import { documents, documentChunks, projects } from "../db/schema.js";
import { getApiKey } from "../settings.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const TOKEN_CAP = 512;
const SNIPPET_CHARS = 300;
const RETRY_DELAYS_MS = [250, 500, 1000];

// Minimum cosine similarity (1 - distance) required to surface a chunk.
// text-embedding-3-small produces ~0.6+ for related content, ~0.3-0.5 for
// loosely related, and below ~0.3 for unrelated. Without this floor a small
// project would always return every doc since topK > doc count, and even
// completely unrelated ones get a non-zero score.
const MIN_SIMILARITY = 0.3;

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;

export class NoOpenAIKeyError extends Error {
  constructor() {
    super("no-openai-key");
    this.name = "NoOpenAIKeyError";
  }
}

export interface Chunk {
  headingPath: string[];
  text: string;
  tokenCount: number;
}

export interface SearchResult {
  id: string;
  name: string;
  directory: string;
  snippet: string;
  score: number;
}

// Cheap whitespace-based token estimate. Real tokenization via tiktoken would
// be heavier; chars/4 is a well-known approximation for English markdown that
// keeps us safely under the 8192-token model limit even at the high end.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Walks markdown line-by-line, splitting at H1/H2/H3 boundaries. Each emitted
// chunk carries its heading ancestry. Sections that exceed TOKEN_CAP are
// further split on blank-line paragraph boundaries; a single oversized
// paragraph is emitted as-is and accepts the overflow.
export function chunkMarkdown(content: string): Chunk[] {
  const lines = content.split("\n");
  type Section = { headingPath: string[]; lines: string[] };
  const sections: Section[] = [];

  let pathStack: string[] = [];
  let currentLines: string[] = [];
  let currentPath: string[] = [];

  const flushSection = () => {
    if (currentLines.length > 0) {
      sections.push({ headingPath: [...currentPath], lines: currentLines });
      currentLines = [];
    }
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flushSection();
      const depth = m[1].length;
      const title = m[2];
      if (pathStack.length >= depth - 1) {
        pathStack = pathStack.slice(0, depth - 1);
        pathStack.push(title);
        currentPath = pathStack.slice();
      } else {
        currentPath = [...pathStack, title];
      }
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flushSection();

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (!text) continue;

    const tokens = estimateTokens(text);
    if (tokens <= TOKEN_CAP) {
      chunks.push({
        headingPath: section.headingPath,
        text,
        tokenCount: tokens,
      });
      continue;
    }

    const paragraphs = text.split(/\n\n+/);
    let buffer: string[] = [];
    let bufferTokens = 0;
    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const t = buffer.join("\n\n");
      chunks.push({
        headingPath: section.headingPath,
        text: t,
        tokenCount: estimateTokens(t),
      });
      buffer = [];
      bufferTokens = 0;
    };
    for (const p of paragraphs) {
      const pTokens = estimateTokens(p);
      if (bufferTokens + pTokens > TOKEN_CAP && buffer.length > 0)
        flushBuffer();
      buffer.push(p);
      bufferTokens += pTokens;
      if (bufferTokens > TOKEN_CAP) flushBuffer();
    }
    flushBuffer();
  }

  return chunks;
}

async function getOpenAIClient() {
  const apiKey = getApiKey("openai");
  if (!apiKey) throw new NoOpenAIKeyError();
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey });
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (e instanceof NoOpenAIKeyError) throw e;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Per-document serialization. Concurrent edits to the same doc would otherwise
// race: delete-then-insert with stale content can land after a newer call's
// transaction, leaving older content in the chunks table. Queue work per
// documentId so each call sees the latest content when it runs.
const embedQueue = new Map<string, Promise<void>>();

// Embeds a document's content as heading-aware chunks. Delete-then-insert in
// a single transaction so a doc never has a half-rebuilt embedding set
// visible to the search query. Silently skips when the project has the
// per-project toggle off or no OpenAI key is configured.
export async function embedDocument(documentId: string): Promise<void> {
  const previous = embedQueue.get(documentId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => embedDocumentInner(documentId));
  embedQueue.set(documentId, next);
  try {
    await next;
  } finally {
    if (embedQueue.get(documentId) === next) {
      embedQueue.delete(documentId);
    }
  }
}

async function embedDocumentInner(documentId: string): Promise<void> {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!doc) return;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, doc.projectId));
  if (!project || !project.embeddingsEnabled) return;

  if (!getApiKey("openai")) return;

  const chunks = chunkMarkdown(doc.content ?? "");

  if (chunks.length === 0) {
    await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    return;
  }

  const embeddings = await withRetry(async () => {
    const openai = await getOpenAIClient();
    const result = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: chunks.map((c) => c.text),
    });
    return result.embeddings;
  });

  if (embeddings.length !== chunks.length) {
    throw new Error(
      "malformed embedding response from provider; document chunks not updated",
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    await tx.insert(documentChunks).values(
      chunks.map((chunk, i) => ({
        documentId,
        chunkIndex: i,
        headingPath: chunk.headingPath,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        embedding: embeddings[i],
      })),
    );
  });
}

// Semantic search across a project's document chunks. Embeds the query once,
// fetches topK*5 chunks ranked by cosine distance, then dedupes by document so
// each doc appears at most once with its highest-scoring chunk's text as the
// snippet. Throws NoOpenAIKeyError when no key is configured (callers translate
// to a 409 for the UI / silent fallback for the agent).
export async function searchProject(
  projectId: string,
  query: string,
  opts: { topK?: number; directory?: string } = {},
): Promise<SearchResult[]> {
  const topK = opts.topK ?? 10;
  if (topK <= 0) return [];

  if (query.trim().length === 0) return [];

  const db = getDb();
  const openai = await getOpenAIClient();
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: query,
  });

  const distance = cosineDistance(documentChunks.embedding, embedding);
  const similarity = sql<number>`1 - (${distance})`;
  const limit = topK * 5;

  // Optional directory filter so an agent can scope to its own bucket while
  // the project-wide UI search omits it and sees every document. The
  // similarity floor is applied at the database level so noise never makes
  // it into the topK window.
  const filters = [
    eq(documents.projectId, projectId),
    sql`${distance} < ${1 - MIN_SIMILARITY}`,
  ];
  if (opts.directory) {
    filters.push(eq(documents.directory, opts.directory));
  }

  const rows = await db
    .select({
      documentId: documentChunks.documentId,
      text: documentChunks.text,
      name: documents.name,
      directory: documents.directory,
      score: similarity,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(...filters))
    .orderBy(distance)
    .limit(limit);

  const byDoc = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byDoc.has(row.documentId)) byDoc.set(row.documentId, row);
  }

  return Array.from(byDoc.values())
    .slice(0, topK)
    .map((r) => ({
      id: r.documentId,
      name: r.name,
      directory: r.directory,
      snippet:
        r.text.length > SNIPPET_CHARS
          ? `${r.text.slice(0, SNIPPET_CHARS)}…`
          : r.text,
      score: typeof r.score === "string" ? parseFloat(r.score) : r.score,
    }));
}
