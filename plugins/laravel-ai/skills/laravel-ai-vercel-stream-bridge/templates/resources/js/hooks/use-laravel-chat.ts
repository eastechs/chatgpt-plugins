import { useChat } from '@ai-sdk/react';
import type { Message } from 'ai';

interface UseLaravelChatOptions {
    projectId: string;
    conversationId: string;
    modelId: string;
    /** Optional UI side ("left" / "right") for split-panel chats. */
    side?: 'left' | 'right';
    /** Document ids attached to the next message. */
    documentIds?: string[];
    /** Initial history loaded from `GET /projects/:id/chat/messages`. */
    initialMessages?: Message[];
}

/**
 * `useChat` configured to talk to a Laravel AI streaming endpoint that uses
 * `->usingVercelDataProtocol()`. The wire format is the same one the AI
 * SDK's TypeScript adapters produce, so all `useChat` features work
 * unchanged: streaming text, tool calls, reasoning, finish events.
 *
 * `body` is sent as the JSON body of every `POST` to the chat endpoint.
 * Updating any of these between renders takes effect on the next message.
 */
export function useLaravelChat({
    projectId,
    conversationId,
    modelId,
    side,
    documentIds,
    initialMessages,
}: UseLaravelChatOptions) {
    return useChat({
        api: `/projects/${projectId}/chat`,
        id: conversationId,
        initialMessages,
        body: {
            conversation_id: conversationId,
            model_id: modelId,
            side,
            document_ids: documentIds ?? [],
        },
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            // Inertia / Laravel CSRF token. Read from the meta tag the
            // Blade template renders. Drop if your app uses a different
            // auth scheme.
            'X-CSRF-TOKEN':
                document
                    .querySelector('meta[name="csrf-token"]')
                    ?.getAttribute('content') ?? '',
        },
    });
}
