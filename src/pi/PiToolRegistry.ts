import { getSettings } from "@/settings/model";
import { selfHostWebSearch } from "@/LLMProviders/selfHostServices";
import { logInfo } from "@/logger";
import { readNoteTool } from "@/tools/NoteTools";
import { ToolManager } from "@/tools/toolManager";
import {
  convertTimeBetweenTimezonesTool,
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
} from "@/tools/TimeTools";
import { localSearchTool } from "@/tools/SearchTools";
import { writeFileTool, editFileTool } from "@/tools/ComposerTools";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@sinclair/typebox";

/**
 * Source metadata collected from pi tool execution.
 */
export interface PiToolSource {
  title: string;
  path: string;
  score: number;
  explanation?: unknown;
}

/**
 * Structured details returned by pi tool wrappers.
 */
export interface PiToolDetails {
  rawResult: unknown;
  sources: PiToolSource[];
}

interface PiToolDefinition {
  id: string;
  tool: AgentTool<any, PiToolDetails>;
}

const timeRangeSchema = Type.Object({
  startTime: Type.Number(),
  endTime: Type.Number(),
});

const localSearchParameters = Type.Object({
  query: Type.String(),
  salientTerms: Type.Array(Type.String()),
  timeRange: Type.Optional(timeRangeSchema),
  _preExpandedQuery: Type.Optional(Type.String()),
});

const readNoteParameters = Type.Object({
  notePath: Type.String(),
  chunkIndex: Type.Optional(Type.Integer()),
});

const writeFileParameters = Type.Object({
  path: Type.String(),
  content: Type.String(),
  confirmation: Type.Optional(Type.Boolean()),
});

const editFileParameters = Type.Object({
  path: Type.String(),
  oldText: Type.String(),
  newText: Type.String(),
});

const getCurrentTimeParameters = Type.Object({
  timezoneOffset: Type.Optional(Type.String()),
});

const getTimeRangeParameters = Type.Object({
  timeExpression: Type.String(),
});

const getTimeInfoParameters = Type.Object({
  epoch: Type.Number(),
});

const convertTimeParameters = Type.Object({
  time: Type.String(),
  fromOffset: Type.String(),
  toOffset: Type.String(),
});

const webSearchParameters = Type.Object({
  query: Type.String(),
});

const localSearchPiTool: AgentTool<typeof localSearchParameters, PiToolDetails> = {
  name: "localSearch",
  label: "Vault Search",
  description: "Search the vault for notes related to a query.",
  parameters: localSearchParameters,
  execute: async (_toolCallId, params) =>
    executeStructuredTool(localSearchTool, params, collectSourcesFromLocalSearch),
};

const readNotePiTool: AgentTool<typeof readNoteParameters, PiToolDetails> = {
  name: "readNote",
  label: "Read Note",
  description: "Read a note by its exact vault-relative path.",
  parameters: readNoteParameters,
  execute: async (_toolCallId, params) => executeStructuredTool(readNoteTool, params),
};

const writeFilePiTool: AgentTool<typeof writeFileParameters, PiToolDetails> = {
  name: "writeFile",
  label: "Write File",
  description: "Create or replace a file with new content.",
  parameters: writeFileParameters,
  executionMode: "sequential",
  execute: async (_toolCallId, params) => executeStructuredTool(writeFileTool, params),
};

const editFilePiTool: AgentTool<typeof editFileParameters, PiToolDetails> = {
  name: "editFile",
  label: "Edit File",
  description: "Replace a targeted text span in an existing file.",
  parameters: editFileParameters,
  executionMode: "sequential",
  execute: async (_toolCallId, params) => executeStructuredTool(editFileTool, params),
};

const getCurrentTimePiTool: AgentTool<typeof getCurrentTimeParameters, PiToolDetails> = {
  name: "getCurrentTime",
  label: "Get Current Time",
  description: "Get the current time in local time or a specified UTC offset.",
  parameters: getCurrentTimeParameters,
  execute: async (_toolCallId, params) => executeStructuredTool(getCurrentTimeTool, params),
};

const getTimeRangeMsPiTool: AgentTool<typeof getTimeRangeParameters, PiToolDetails> = {
  name: "getTimeRangeMs",
  label: "Get Time Range",
  description: "Convert natural language time expressions into a date range.",
  parameters: getTimeRangeParameters,
  execute: async (_toolCallId, params) => executeStructuredTool(getTimeRangeMsTool, params),
};

const getTimeInfoByEpochPiTool: AgentTool<typeof getTimeInfoParameters, PiToolDetails> = {
  name: "getTimeInfoByEpoch",
  label: "Get Time Info",
  description: "Convert an epoch timestamp into formatted time information.",
  parameters: getTimeInfoParameters,
  execute: async (_toolCallId, params) => executeStructuredTool(getTimeInfoByEpochTool, params),
};

const convertTimeBetweenTimezonesPiTool: AgentTool<typeof convertTimeParameters, PiToolDetails> = {
  name: "convertTimeBetweenTimezones",
  label: "Convert Timezones",
  description: "Convert a time between UTC offsets.",
  parameters: convertTimeParameters,
  execute: async (_toolCallId, params) =>
    executeStructuredTool(convertTimeBetweenTimezonesTool, params),
};

const webSearchPiTool: AgentTool<typeof webSearchParameters, PiToolDetails> = {
  name: "webSearch",
  label: "Web Search",
  description: "Search the web using the user's own Firecrawl or Perplexity credentials.",
  parameters: webSearchParameters,
  execute: async (_toolCallId, params) => executePiWebSearch(params),
};

const PI_TOOL_DEFINITIONS: PiToolDefinition[] = [
  { id: "localSearch", tool: localSearchPiTool },
  { id: "readNote", tool: readNotePiTool },
  { id: "webSearch", tool: webSearchPiTool },
  { id: "writeFile", tool: writeFilePiTool },
  { id: "editFile", tool: editFilePiTool },
  { id: "getCurrentTime", tool: getCurrentTimePiTool },
  { id: "getTimeRangeMs", tool: getTimeRangeMsPiTool },
  { id: "getTimeInfoByEpoch", tool: getTimeInfoByEpochPiTool },
  { id: "convertTimeBetweenTimezones", tool: convertTimeBetweenTimezonesPiTool },
];

/**
 * Return the enabled pi tools from settings.
 */
export function getPiTools(): AgentTool<any, PiToolDetails>[] {
  const enabledToolIds = new Set(getSettings().piAgent.enabledToolIds);
  return PI_TOOL_DEFINITIONS.filter((definition) => enabledToolIds.has(definition.id)).map(
    (definition) => definition.tool
  );
}

/**
 * Execute an existing StructuredTool and adapt the result to pi-agent-core.
 */
async function executeStructuredTool<TParameters>(
  tool: any,
  params: TParameters,
  sourceCollector?: (result: unknown) => PiToolSource[]
): Promise<AgentToolResult<PiToolDetails>> {
  const rawResult = await ToolManager.callTool(tool, params);
  const parsedResult = parseToolResult(rawResult);
  const text = stringifyToolResult(rawResult);
  const sources = sourceCollector ? sourceCollector(parsedResult) : [];

  return {
    content: [{ type: "text", text }],
    details: {
      rawResult: parsedResult,
      sources,
    },
  };
}

/**
 * Execute a backend-local web search without invoking Copilot-hosted services.
 */
async function executePiWebSearch(
  params: Static<typeof webSearchParameters>
): Promise<AgentToolResult<PiToolDetails>> {
  const result = await selfHostWebSearch(params.query);
  const citations = result.citations || [];
  const text = [
    result.content.trim(),
    citations.length > 0
      ? `Sources:\n${citations.map((citation) => `- ${citation}`).join("\n")}`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

  return {
    content: [{ type: "text", text }],
    details: {
      rawResult: result,
      sources: citations.map((citation) => ({
        title: citation,
        path: citation,
        score: 1,
      })),
    },
  };
}

/**
 * Parse JSON-like tool results when possible.
 */
function parseToolResult(result: unknown): unknown {
  if (typeof result !== "string") {
    return result;
  }

  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * Convert a tool result into text for the model.
 */
function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Extract local-search sources from the structured local search payload.
 */
function collectSourcesFromLocalSearch(result: unknown): PiToolSource[] {
  const payload = Array.isArray(result) ? result[0] : result;
  const documents = Array.isArray((payload as any)?.documents) ? (payload as any).documents : [];

  const sources = documents
    .filter((document: any) => typeof document?.path === "string")
    .map((document: any) => ({
      title: document.title || document.path,
      path: document.path,
      score: Number(document.score || document.rerank_score || 0),
      explanation: document.explanation,
    }));

  logInfo(`[PiToolRegistry] Collected ${sources.length} local search sources`);
  return sources;
}
