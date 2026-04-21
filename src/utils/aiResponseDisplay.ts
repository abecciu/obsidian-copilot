import { parseReasoningBlock } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";

/**
 * Convert multiline content into markdown blockquote lines.
 */
function toBlockquote(content: string): string {
  return content
    .trim()
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * Build an Obsidian callout block.
 */
function buildCallout(type: string, title: string, content: string): string {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return `> [!${type}]- ${title}`;
  }

  return `> [!${type}]- ${title}\n${toBlockquote(trimmedContent)}`;
}

/**
 * Convert `<think>` sections into preview-friendly callouts.
 */
function transformThinkSectionsToPreview(content: string): string {
  let transformed = content.replace(/<think>([\s\S]*?)<\/think>/g, (_match, sectionContent) => {
    return `\n\n${buildCallout("abstract", "Thought for a while", sectionContent)}\n\n`;
  });

  transformed = transformed.replace(/<think>([\s\S]*)$/g, (_match, sectionContent) => {
    return `\n\n${buildCallout("abstract", "Thinking...", sectionContent)}\n`;
  });

  return transformed.trim();
}

/**
 * Convert `<think>` sections into readable plain text for streaming surfaces.
 */
function transformThinkSectionsToPlainText(content: string): string {
  let transformed = content.replace(/<think>([\s\S]*?)<\/think>/g, (_match, sectionContent) => {
    const trimmed = sectionContent.trim();
    return trimmed ? `Thought for a while:\n${trimmed}\n\n` : "";
  });

  transformed = transformed.replace(/<think>([\s\S]*)$/g, (_match, sectionContent) => {
    const trimmed = sectionContent.trim();
    return trimmed ? `Thinking...\n${trimmed}` : "Thinking...";
  });

  return transformed.trim();
}

/**
 * Convert a response with embedded reasoning markers and think tags into a
 * markdown preview representation suitable for Obsidian's MarkdownRenderer.
 */
export function formatAIResponseForPreview(content: string): string {
  const commonProcessed = preprocessAIResponse(content);
  const reasoningBlock = parseReasoningBlock(commonProcessed);
  const contentWithoutReasoning = reasoningBlock?.contentAfter ?? commonProcessed;
  const previewBody = transformThinkSectionsToPreview(contentWithoutReasoning);

  if (!reasoningBlock?.hasReasoning || reasoningBlock.status === "idle") {
    return previewBody;
  }

  const title =
    reasoningBlock.elapsedSeconds > 0
      ? `Agent reasoning (${reasoningBlock.elapsedSeconds}s)`
      : "Agent reasoning";
  const stepBody =
    reasoningBlock.steps.length > 0
      ? reasoningBlock.steps.map((step) => `- ${step}`).join("\n")
      : "Working through the request.";

  return [buildCallout("info", title, stepBody), previewBody].filter(Boolean).join("\n\n").trim();
}

/**
 * Convert a response with embedded reasoning markers and think tags into a
 * readable plain-text representation for lightweight streaming UIs.
 */
export function formatAIResponseForPlainText(content: string): string {
  const reasoningBlock = parseReasoningBlock(content);
  const contentWithoutReasoning = reasoningBlock?.contentAfter ?? content;
  const plainBody = transformThinkSectionsToPlainText(contentWithoutReasoning);

  if (!reasoningBlock?.hasReasoning || reasoningBlock.status === "idle") {
    return plainBody;
  }

  const header =
    reasoningBlock.elapsedSeconds > 0
      ? `Agent reasoning (${reasoningBlock.elapsedSeconds}s):`
      : "Agent reasoning:";
  const stepBody =
    reasoningBlock.steps.length > 0
      ? reasoningBlock.steps.map((step) => `- ${step}`).join("\n")
      : "Working through the request.";

  return [header, stepBody, plainBody].filter(Boolean).join("\n\n").trim();
}
