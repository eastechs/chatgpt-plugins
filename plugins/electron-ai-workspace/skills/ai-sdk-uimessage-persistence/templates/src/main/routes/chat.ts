import { Router, type Request } from "express";
import {
  streamText,
  generateText,
  convertToModelMessages,
  stepCountIs,
  generateId,
  type UIMessage,
  type ToolSet,
} from "ai";
import { eq, asc, sql, and } from "drizzle-orm";
import { getDb } from "../database.js";
import { conversations, messages } from "../db/schema.js";
// REPLACE: from vercel-ai-multi-provider.
import {
  resolveModel,
  getProviderOptions,
  modelLabel,
  isEffortLevel,
  DEFAULT_EFFORT,
} from "../ai/providers.js";
// REPLACE: from electron-encrypted-settings.
import { getApiKey } from "../settings.js";

const router = Router({ mergeParams: true });

type ProjectRequest = Request<{ projectId: string }>;

// ─── Send message (streaming) ──────────────────────────────

router.post("/", async (req: ProjectRequest, res) => {
  const db = getDb();
  const { projectId } = req.params;
  const {
    messages: requestMessages,
    model_id,
    conversation_id,
    side,
  } = req.body;

  if (!model_id || !conversation_id) {
    res.status(422).json({ error: "model_id and conversation_id are required" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversation_id),
        eq(conversations.projectId, projectId),
      ),
    );
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  // Validate at read time — column is plain text with no DB-level CHECK,
  // and downstream provider mappers rely on the value being a known level.
  const effort = isEffortLevel(conversation.effort)
    ? conversation.effort
    : DEFAULT_EFFORT;

  // Honor the conversation's saved model when it's been pinned. First message
  // in a new conversation has model=null, so we trust the request id then.
  const effectiveModelId: string = conversation.model || model_id;

  // The client (useChat) sends the full UIMessage[] including the new user message.
  // Use that directly; the DB history would miss the new message.
  const history: UIMessage[] = Array.isArray(requestMessages)
    ? requestMessages
    : [];

  if (history.length === 0) {
    res.status(422).json({ error: "messages must not be empty" });
    return;
  }

  const model = resolveModel(effectiveModelId);
  const provider = effectiveModelId.startsWith("claude-")
    ? "anthropic"
    : effectiveModelId.startsWith("gemini-")
      ? "gemini"
      : "openai";

  // REPLACE: load your system prompt and tools.
  const systemPrompt = "You are a helpful assistant.";
  const tools: ToolSet = {};

  // Anthropic caches up to four breakpoints; mark the system prompt and the
  // last tool definition so the entire stable prefix becomes a cache hit on
  // every subsequent turn within the 1h TTL window. Cache markers on
  // non-Anthropic providers are silently ignored.
  const cacheMarkedTools: ToolSet = (() => {
    if (provider !== "anthropic") return tools;
    const entries = Object.entries(tools);
    if (entries.length === 0) return tools;
    const [lastKey, lastTool] = entries[entries.length - 1];
    const existingAnthropic =
      (lastTool.providerOptions?.anthropic as
        | Record<string, unknown>
        | undefined) ?? {};
    return {
      ...tools,
      [lastKey]: {
        ...lastTool,
        providerOptions: {
          ...lastTool.providerOptions,
          anthropic: {
            ...existingAnthropic,
            cacheControl: { type: "ephemeral", ttl: "1h" },
          },
        },
      },
    };
  })();

  // Tie the LLM call's lifetime to the HTTP connection: when the client
  // aborts the fetch (e.g. user clicks the stop button, which calls
  // useChat's stop()), the socket closes and we abort streamText. Without
  // this the provider keeps generating tokens we'd just discard.
  const abortController = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const convertedMessages = await convertToModelMessages(history, {
      tools: cacheMarkedTools,
    });

    // Pass the system prompt as a message rather than the top-level `system`
    // string so we can attach providerOptions to it. For Anthropic this marks
    // the first cache breakpoint (the second is on the last tool above).
    const modelMessages = [
      {
        role: "system" as const,
        content: systemPrompt,
        ...(provider === "anthropic" && {
          providerOptions: {
            anthropic: {
              cacheControl: { type: "ephemeral" as const, ttl: "1h" as const },
            },
          },
        }),
      },
      ...convertedMessages,
    ];

    const result = streamText({
      model,
      messages: modelMessages,
      tools: cacheMarkedTools,
      stopWhen: stepCountIs(25),
      providerOptions: getProviderOptions(effectiveModelId, {
        projectId,
        effort,
      }),
      abortSignal: abortController.signal,
    });

    // Per-request accumulator for Anthropic's per-step cache_creation count.
    let anthropicCacheWrites = 0;

    // Pipe the UI message stream directly to the Express response. This hands
    // lifecycle to the AI SDK so onFinish reliably runs before the response
    // closes, avoiding a race where the last assistant message wouldn't get
    // persisted.
    result.pipeUIMessageStreamToResponse(res, {
      sendReasoning: true,
      originalMessages: history,
      generateMessageId: generateId,
      // Attach token usage to assistant messages on finish so the client can
      // render the usage widget. Anthropic doesn't populate the standard
      // inputTokenDetails.cacheWriteTokens; they expose
      // cacheCreationInputTokens via providerMetadata on each finish-step.
      messageMetadata: ({ part }) => {
        if (part.type === "finish-step") {
          const anthropicMeta = part.providerMetadata?.anthropic as
            | { cacheCreationInputTokens?: number }
            | undefined;
          const writes = anthropicMeta?.cacheCreationInputTokens;
          if (typeof writes === "number") anthropicCacheWrites += writes;
          return undefined;
        }
        if (part.type === "finish") {
          const u = part.totalUsage;
          return {
            model: effectiveModelId,
            usage: {
              prompt_tokens: u.inputTokens,
              completion_tokens: u.outputTokens,
              cache_read_input_tokens: u.inputTokenDetails?.cacheReadTokens,
              cache_write_input_tokens:
                u.inputTokenDetails?.cacheWriteTokens ??
                (anthropicCacheWrites > 0 ? anthropicCacheWrites : undefined),
              reasoning_tokens: u.outputTokenDetails?.reasoningTokens,
            },
          };
        }
        return undefined;
      },
      onFinish: async ({ messages: allMessages, responseMessage }) => {
        try {
          const [maxOrder] = await db
            .select({ max: sql<number>`COALESCE(MAX(order_index), -1)` })
            .from(messages)
            .where(eq(messages.conversationId, conversation_id));

          let nextIndex = (maxOrder?.max ?? -1) + 1;

          for (const msg of allMessages) {
            const existing = await db
              .select({ id: messages.id })
              .from(messages)
              .where(eq(messages.id, msg.id));

            if (existing.length === 0) {
              await db.insert(messages).values({
                id: msg.id,
                conversationId: conversation_id,
                role: msg.role,
                parts: msg.parts as unknown as Record<string, unknown>,
                metadata: (msg.metadata as
                  | Record<string, unknown>
                  | undefined) ?? { model: effectiveModelId },
                orderIndex: nextIndex++,
              });
            } else if (msg.id === responseMessage.id) {
              // The response message may extend an existing assistant message
              // (isContinuation). Update parts + metadata to the latest state.
              await db
                .update(messages)
                .set({
                  parts: msg.parts as unknown as Record<string, unknown>,
                  metadata: (msg.metadata as
                    | Record<string, unknown>
                    | undefined) ?? { model: effectiveModelId },
                })
                .where(eq(messages.id, msg.id));
            } else if (msg.role === "assistant") {
              // Existing prior assistant message — its parts may have changed
              // client-side since we last saved (e.g. a client-side tool call
              // got fulfilled via addToolOutput between turns).
              //
              // User messages are intentionally NOT updated here: server-side
              // attachments would otherwise get stripped on a re-save.
              await db
                .update(messages)
                .set({ parts: msg.parts as unknown as Record<string, unknown> })
                .where(eq(messages.id, msg.id));
            }
          }

          // Update conversation title on first message.
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversation_id));
          if (conv?.title === "New Chat") {
            const firstUserMsg = allMessages.find((m) => m.role === "user");
            const title = await generateConversationTitle(firstUserMsg);
            await db
              .update(conversations)
              .set({
                title,
                model: effectiveModelId,
                side: side ?? conv.side,
                updatedAt: new Date(),
              })
              .where(eq(conversations.id, conversation_id));
          } else {
            await db
              .update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, conversation_id));
          }
        } catch (err) {
          console.error("Error persisting messages:", err);
        }
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Get messages for a conversation ───────────────────────

router.get("/messages", async (req: ProjectRequest, res) => {
  const db = getDb();
  const conversationId = req.query.conversation_id as string;
  if (!conversationId) {
    res.json([]);
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.orderIndex));

  // Return as UIMessage[] — no transformation needed.
  res.json(
    msgs.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      ...(m.metadata ? { metadata: m.metadata } : {}),
    })),
  );
});

// ─── Title generation helper ───────────────────────────────

async function generateConversationTitle(
  firstUserMessage?: UIMessage,
): Promise<string> {
  if (!firstUserMessage) return "New Chat";

  const textPart = firstUserMessage.parts?.find(
    (p): p is { type: "text"; text: string } => p.type === "text",
  );
  const userText = textPart?.text ?? "";
  if (!userText) return "New Chat";

  try {
    const openaiKey = getApiKey("openai");
    if (openaiKey) {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey: openaiKey });
      const { text } = await generateText({
        model: openai("gpt-5-nano"),
        system:
          "Generate a short, descriptive title for a conversation based on the user's first message. Max 50 characters. No quotes. Just the title.",
        prompt: userText,
      });
      const title = text.trim();
      if (title) return title;
    }
  } catch {
    // Fall back to truncation.
  }

  return userText.length > 50 ? userText.substring(0, 47) + "..." : userText;
}

export default router;

// modelLabel is imported just to make sure the providers import isn't shaken
// out by the tree-shaker; remove if unused in your route file.
void modelLabel;
