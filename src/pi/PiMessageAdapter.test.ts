import { buildPiConversation } from "./PiMessageAdapter";
import type { PromptContextEnvelope, PromptContextLayer } from "@/context/PromptContextTypes";
import type { ChatMessage } from "@/types/message";

/**
 * Create a minimal prompt envelope for pi transcript conversion tests.
 */
function createEnvelope(layers: PromptContextLayer[]): PromptContextEnvelope {
  const layerHashes = {
    L1_SYSTEM: "",
    L2_PREVIOUS: "",
    L3_TURN: "",
    L4_STRIP: "",
    L5_USER: "",
  };

  layers.forEach((layer) => {
    layerHashes[layer.id] = layer.hash;
  });

  return {
    version: 1,
    conversationId: "test-conversation",
    messageId: "test-message",
    layers,
    serializedText: layers.map((layer) => layer.text).join("\n\n"),
    layerHashes,
    combinedHash: "combined-hash",
  };
}

/**
 * Build a user chat message with just the fields needed by the adapter.
 */
function createUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    message: "Fallback user message",
    originalMessage: "Fallback user message",
    sender: "user",
    timestamp: null,
    isVisible: true,
    ...overrides,
  };
}

const testModel = {
  api: "openai",
  provider: "openai",
  id: "gpt-4.1-mini",
} as any;

describe("buildPiConversation", () => {
  it("converts envelope layers and memory history into a pi conversation", () => {
    const conversation = buildPiConversation({
      userMessage: createUserMessage({
        contextEnvelope: createEnvelope([
          {
            id: "L1_SYSTEM",
            label: "System Instructions",
            text: "You are a focused note assistant.",
            stable: true,
            segments: [],
            hash: "l1",
          },
          {
            id: "L3_TURN",
            label: "Current Turn Context",
            text: "Context attached for Projects/Alpha.md",
            stable: false,
            segments: [],
            hash: "l3",
          },
          {
            id: "L5_USER",
            label: "User Message",
            text: "Summarize the current project.",
            stable: false,
            segments: [],
            hash: "l5",
          },
        ]),
      }),
      rawHistory: [
        {
          _getType: () => "human",
          content: "Earlier user turn",
        },
        {
          _getType: () => "ai",
          content: "Earlier assistant turn",
        },
      ],
      model: testModel,
      injectedContextBlocks: ["## Vault Search Results\n\nRelevant note excerpt"],
    });

    expect(conversation.systemPrompt).toBe("You are a focused note assistant.");
    expect(conversation.history).toHaveLength(2);
    expect(conversation.history[0]).toMatchObject({
      role: "user",
      content: "Earlier user turn",
    });
    expect(conversation.history[1]).toMatchObject({
      role: "assistant",
      provider: "openai",
      model: "gpt-4.1-mini",
      stopReason: "stop",
    });
    expect((conversation.history[1] as any).usage.totalTokens).toBe(0);
    expect(conversation.currentUser.role).toBe("user");
    expect(conversation.currentUser.content).toContain("## Vault Search Results");
    expect(conversation.currentUser.content).toContain("Context attached for Projects/Alpha.md");
    expect(conversation.currentUser.content).toContain("Summarize the current project.");
  });

  it("converts inline image attachments into pi image content blocks", () => {
    const conversation = buildPiConversation({
      userMessage: createUserMessage({
        contextEnvelope: createEnvelope([
          {
            id: "L5_USER",
            label: "User Message",
            text: "What is shown here?",
            stable: false,
            segments: [],
            hash: "l5",
          },
        ]),
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==",
            },
          },
          {
            type: "image_url",
            image_url: {
              url: "https://example.com/not-a-data-url.png",
            },
          },
        ],
      }),
      rawHistory: [],
      model: testModel,
    });

    expect(Array.isArray(conversation.currentUser.content)).toBe(true);
    expect(conversation.currentUser.content).toEqual([
      {
        type: "text",
        text: "What is shown here?",
      },
      {
        type: "image",
        mimeType: "image/png",
        data: "ZmFrZS1pbWFnZS1ieXRlcw==",
      },
    ]);
  });

  it("throws when the current user message has no context envelope", () => {
    expect(() =>
      buildPiConversation({
        userMessage: createUserMessage(),
        rawHistory: [],
        model: testModel,
      })
    ).toThrow("Pi backend requires a context envelope");
  });
});
