interface PiAssistantTextBlock {
  type: "text";
  text?: string;
}

interface PiAssistantThinkingBlock {
  type: "thinking";
  thinking?: string;
}

interface PiAssistantToolCallBlock {
  type: "toolCall";
}

type PiAssistantContentBlock =
  | PiAssistantTextBlock
  | PiAssistantThinkingBlock
  | PiAssistantToolCallBlock
  | { type?: string; [key: string]: unknown };

interface PiAssistantMessageLike {
  content?: PiAssistantContentBlock[];
  errorMessage?: string;
}

interface RenderPiAssistantMessageOptions {
  keepTrailingThinkingOpen?: boolean;
  includeText?: boolean;
  includeThinking?: boolean;
}

/**
 * Render a pi assistant message into Copilot's chat markup.
 * Thinking blocks are converted into `<think>` sections that the existing UI
 * already knows how to render as collapsibles.
 */
export function renderPiAssistantMessage(
  message: PiAssistantMessageLike,
  options: RenderPiAssistantMessageOptions = {}
): string {
  const content = Array.isArray(message.content) ? message.content : [];
  const includeText = options.includeText ?? true;
  const includeThinking = options.includeThinking ?? true;
  const trailingThinkingIndex =
    includeThinking &&
    options.keepTrailingThinkingOpen &&
    content[content.length - 1]?.type === "thinking"
      ? content.length - 1
      : -1;

  let renderedContent = "";

  for (let index = 0; index < content.length; index += 1) {
    const item = content[index];

    if (item?.type === "text") {
      if (!includeText) {
        continue;
      }
      renderedContent += item.text || "";
      continue;
    }

    if (item?.type !== "thinking" || !includeThinking) {
      continue;
    }

    const thinkingText = item.thinking || "";
    const prefix = renderedContent.length > 0 ? "\n" : "";

    if (index === trailingThinkingIndex) {
      renderedContent += `${prefix}<think>${thinkingText}`;
      continue;
    }

    renderedContent += `${prefix}<think>${thinkingText}</think>`;
  }

  return renderedContent || message.errorMessage || "";
}

/**
 * Render the finalized display transcript for all assistant messages produced in a
 * single pi turn. Earlier assistant messages contribute only their thinking blocks,
 * while the final assistant message contributes its full rendered content.
 */
export function renderPiAssistantTranscript(
  messages: PiAssistantMessageLike[],
  options: Pick<RenderPiAssistantMessageOptions, "keepTrailingThinkingOpen"> = {}
): string {
  if (messages.length === 0) {
    return "";
  }

  const lastIndex = messages.length - 1;
  const transcriptParts = messages
    .map((message, index) => {
      if (index === lastIndex) {
        return renderPiAssistantMessage(message, {
          keepTrailingThinkingOpen: options.keepTrailingThinkingOpen,
        });
      }

      return renderPiAssistantMessage(message, {
        includeText: false,
      });
    })
    .filter((part) => part.trim().length > 0);

  return transcriptParts.join("\n\n");
}
