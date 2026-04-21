import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PiToolDefinition, PiToolDetails } from "./PiToolRegistry";
import { executePiExaWebSearch, executePiFirecrawlWebFetch } from "./PiWebTools";

const webSearchParameters = Type.Object({
  query: Type.String(),
});

const webFetchParameters = Type.Object({
  url: Type.String(),
});

const exaWebSearchPiTool: AgentTool<typeof webSearchParameters, PiToolDetails> = {
  name: "webSearch",
  label: "Web Search",
  description: "Search the web with Exa and return the best matching pages with highlights.",
  parameters: webSearchParameters,
  execute: async (_toolCallId, params) => {
    const result = await executePiExaWebSearch(params.query);
    return toPiToolResult(result.text, result.rawResult, result.sources);
  },
};

const webFetchPiTool: AgentTool<typeof webFetchParameters, PiToolDetails> = {
  name: "webFetch",
  label: "Web Fetch",
  description: "Fetch and scrape a single exact URL using Firecrawl markdown extraction.",
  parameters: webFetchParameters,
  execute: async (_toolCallId, params) => {
    const result = await executePiFirecrawlWebFetch(params.url);
    return toPiToolResult(result.text, result.rawResult, result.sources);
  },
};

/**
 * Return fork-owned Pi tool definitions.
 *
 * Keep fork-only tools here so upstream merges stay localized.
 */
export function getCustomPiToolDefinitions(): PiToolDefinition[] {
  return [
    {
      id: "webSearch",
      tool: exaWebSearchPiTool,
      enabledByDefault: true,
    },
    {
      id: "webFetch",
      tool: webFetchPiTool,
      enabledByDefault: true,
    },
  ];
}

/**
 * Adapt a normalized Pi web tool result into the pi-agent-core tool shape.
 *
 * @param text - Human-readable content for the model.
 * @param rawResult - Parsed provider payload.
 * @param sources - Source metadata to attach to the result.
 * @returns Pi-compatible tool result.
 */
function toPiToolResult(
  text: string,
  rawResult: unknown,
  sources: PiToolDetails["sources"]
): AgentToolResult<PiToolDetails> {
  return {
    content: [{ type: "text", text }],
    details: {
      rawResult,
      sources,
    },
  };
}
