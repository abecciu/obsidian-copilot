import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { processRawChatHistory } from "@/LLMProviders/chainRunner/utils/chatHistoryUtils";
import type { ChatMessage } from "@/types/message";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  UserMessage,
} from "@mariozechner/pi-ai";

/**
 * Prepared pi conversation payload for a single run.
 */
export interface PiPreparedConversation {
  systemPrompt: string;
  history: Message[];
  currentUser: UserMessage;
}

/**
 * Build the pi runtime conversation from current envelope state and prior memory history.
 */
export function buildPiConversation(params: {
  userMessage: ChatMessage;
  rawHistory: any[];
  model: Model<Api>;
  injectedContextBlocks?: string[];
  overrideUserText?: string;
}): PiPreparedConversation {
  const { userMessage, rawHistory, model, injectedContextBlocks = [], overrideUserText } = params;

  const envelope = userMessage.contextEnvelope;
  if (!envelope) {
    throw new Error("Pi backend requires a context envelope for the current user message.");
  }

  const providerMessages = LayerToMessagesConverter.convert(envelope);
  const systemPrompt = providerMessages.find((message) => message.role === "system")?.content || "";
  const currentUserText =
    overrideUserText ||
    providerMessages.find((message) => message.role === "user")?.content ||
    userMessage.originalMessage ||
    userMessage.message;

  const injectedContext = injectedContextBlocks
    .filter((block) => block.trim().length > 0)
    .join("\n\n");
  const mergedUserText = injectedContext
    ? `${injectedContext}\n\n---\n\n${currentUserText}`.trim()
    : currentUserText;

  return {
    systemPrompt,
    history: convertHistoryToPiMessages(rawHistory, model),
    currentUser: createCurrentUserMessage(mergedUserText, userMessage),
  };
}

/**
 * Convert LangChain memory history into pi-compatible messages.
 */
function convertHistoryToPiMessages(rawHistory: any[], model: Model<Api>): Message[] {
  const processedHistory = processRawChatHistory(rawHistory);
  const history: Message[] = [];

  for (const message of processedHistory) {
    const textContent = normalizeHistoryContent(message.content);
    if (!textContent) {
      continue;
    }

    if (message.role === "user") {
      history.push({
        role: "user",
        content: textContent,
        timestamp: Date.now(),
      });
      continue;
    }

    history.push(createAssistantHistoryMessage(textContent, model));
  }

  return history;
}

/**
 * Normalize mixed content history into a simple text string.
 */
function normalizeHistoryContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content || "");
  }

  return content
    .map((item: any) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      if (item.type === "text") {
        return item.text || "";
      }
      if (item.type === "image_url") {
        return "[Image]";
      }
      return "";
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

/**
 * Create the current user message, including any inline image attachments.
 */
function createCurrentUserMessage(text: string, userMessage: ChatMessage): UserMessage {
  const imageBlocks = extractImageContent(userMessage);

  if (imageBlocks.length === 0) {
    return {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
  }

  const blocks: Array<{ type: "text"; text: string } | ImageContent> = [];
  if (text.trim().length > 0) {
    blocks.push({
      type: "text",
      text,
    });
  }
  blocks.push(...imageBlocks);

  return {
    role: "user",
    content: blocks,
    timestamp: Date.now(),
  };
}

/**
 * Convert a stored assistant history message into a pi assistant message.
 */
function createAssistantHistoryMessage(text: string, model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text,
      },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/**
 * Extract inline image attachments from the Copilot chat message structure.
 */
function extractImageContent(userMessage: ChatMessage): ImageContent[] {
  if (!Array.isArray(userMessage.content)) {
    return [];
  }

  return userMessage.content
    .map((item: any): ImageContent | null => {
      const dataUrl = item?.image_url?.url;
      if (item?.type !== "image_url" || typeof dataUrl !== "string") {
        return null;
      }
      return parseDataUrlImage(dataUrl);
    })
    .filter((item): item is ImageContent => item !== null);
}

/**
 * Convert a `data:` URL into pi image content.
 */
function parseDataUrlImage(dataUrl: string): ImageContent | null {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    type: "image",
    mimeType: match[1],
    data: match[2],
  };
}
