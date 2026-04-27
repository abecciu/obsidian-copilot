import type { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { selfHostWebSearch } from "@/LLMProviders/selfHostServices";
import { logError, logInfo, logWarn } from "@/logger";
import { isDesktopRuntime } from "@/services/obsidianCli/ObsidianCliClient";
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
import { getCustomPiToolDefinitions } from "./PiCustomTools";

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

/**
 * Supported runtime platforms for metadata-driven Pi tool availability.
 */
export type PiToolPlatform = "desktop" | "mobile";

/**
 * Optional availability constraints applied before a Pi tool becomes visible
 * to the active runtime.
 */
export interface PiToolAvailability {
  platforms?: PiToolPlatform[];
  chainTypes?: ChainType[];
}

/**
 * Runtime context used to evaluate Pi tool availability metadata.
 */
export interface PiToolAvailabilityContext {
  platform: PiToolPlatform;
  chainType?: ChainType;
}

/**
 * A concrete Pi tool entry together with the settings id used to enable it.
 */
export interface PiToolDefinition {
  id: string;
  tool: AgentTool<any, PiToolDetails>;
  enabledByDefault?: boolean;
  availability?: PiToolAvailability;
}

/**
 * Provider function used to contribute Pi tools from fork-owned extension points.
 */
export type PiToolProvider = () => PiToolDefinition[];

/**
 * Internal options for collecting Pi tool definitions from providers.
 */
interface CollectPiToolDefinitionsOptions {
  context?: PiToolAvailabilityContext;
  includeUnavailable?: boolean;
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

const BUILTIN_PI_TOOL_DEFINITIONS: PiToolDefinition[] = [
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

const piToolProviders = new Map<string, PiToolProvider>([
  ["builtin", () => BUILTIN_PI_TOOL_DEFINITIONS],
  ["custom", getCustomPiToolDefinitions],
]);

/**
 * Register a fork-owned Pi tool provider.
 */
export function registerPiToolProvider(id: string, provider: PiToolProvider): void {
  piToolProviders.set(id, provider);
}

/**
 * Remove a previously registered Pi tool provider.
 */
export function unregisterPiToolProvider(id: string): void {
  piToolProviders.delete(id);
}

/**
 * Reset the dynamic provider registry to its built-in state.
 * Intended for tests.
 */
export function resetPiToolProvidersForTests(): void {
  piToolProviders.clear();
  piToolProviders.set("builtin", () => BUILTIN_PI_TOOL_DEFINITIONS);
  piToolProviders.set("custom", getCustomPiToolDefinitions);
}

/**
 * Return the enabled Pi tools from settings after applying availability rules.
 */
export function getPiTools(
  context?: Partial<PiToolAvailabilityContext>
): AgentTool<any, PiToolDetails>[] {
  const enabledToolIds = new Set(getSettings().piAgent.enabledToolIds);
  return getPiToolDefinitions(context)
    .filter((definition) => isPiToolEnabled(definition, enabledToolIds))
    .map((definition) => definition.tool);
}

/**
 * Return Pi tool definitions available for the current runtime context after
 * merging built-in and custom providers.
 */
export function getPiToolDefinitions(
  context?: Partial<PiToolAvailabilityContext>
): PiToolDefinition[] {
  return collectPiToolDefinitions({
    context: resolvePiToolAvailabilityContext(context),
  });
}

/**
 * Return all registered Pi tool definitions without applying availability
 * filtering.
 */
export function getAllPiToolDefinitions(): PiToolDefinition[] {
  return collectPiToolDefinitions({ includeUnavailable: true });
}

/**
 * Collect Pi tool definitions from all providers, optionally filtering by the
 * active runtime before duplicate resolution.
 *
 * Filtering before duplicate resolution lets a platform-specific override win
 * only where it is actually available.
 */
function collectPiToolDefinitions(
  options: CollectPiToolDefinitionsOptions = {}
): PiToolDefinition[] {
  const toolDefinitions: PiToolDefinition[] = [];
  const seenToolIds = new Set<string>();
  const toolIndexById = new Map<string, number>();
  const providerByToolId = new Map<string, string>();

  for (const [providerId, provider] of piToolProviders.entries()) {
    let providedDefinitions: PiToolDefinition[] = [];

    try {
      providedDefinitions = provider();
    } catch (error) {
      logError(`[PiToolRegistry] Failed to load Pi tool provider '${providerId}'`, error);
      continue;
    }

    for (const definition of providedDefinitions) {
      if (!definition?.id || !definition?.tool?.name) {
        logWarn(`[PiToolRegistry] Skipping invalid Pi tool definition from '${providerId}'`);
        continue;
      }

      if (
        !options.includeUnavailable &&
        options.context &&
        !matchesPiToolAvailability(definition, options.context)
      ) {
        continue;
      }

      if (seenToolIds.has(definition.id)) {
        const previousProviderId = providerByToolId.get(definition.id);
        if (previousProviderId === "builtin" && providerId !== "builtin") {
          const existingIndex = toolIndexById.get(definition.id);
          if (existingIndex !== undefined) {
            logInfo(
              `[PiToolRegistry] Overriding builtin Pi tool '${definition.id}' with '${providerId}'`
            );
            toolDefinitions[existingIndex] = definition;
            providerByToolId.set(definition.id, providerId);
          }
          continue;
        }

        logWarn(
          `[PiToolRegistry] Skipping duplicate Pi tool id '${definition.id}' from '${providerId}'`
        );
        continue;
      }

      if (definition.tool.name !== definition.id) {
        logWarn(
          `[PiToolRegistry] Pi tool id '${definition.id}' does not match tool name '${definition.tool.name}'`
        );
      }

      seenToolIds.add(definition.id);
      toolIndexById.set(definition.id, toolDefinitions.length);
      providerByToolId.set(definition.id, providerId);
      toolDefinitions.push(definition);
    }
  }

  return toolDefinitions;
}

/**
 * Resolve a full runtime context for Pi tool availability checks.
 *
 * @param context - Optional caller-provided availability overrides.
 * @returns A context with platform resolved from the active runtime.
 */
function resolvePiToolAvailabilityContext(
  context?: Partial<PiToolAvailabilityContext>
): PiToolAvailabilityContext {
  return {
    platform: context?.platform ?? (isDesktopRuntime() ? "desktop" : "mobile"),
    chainType: context?.chainType,
  };
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
 * Check whether a Pi tool matches the current runtime availability context.
 *
 * @param definition - Pi tool definition to evaluate.
 * @param context - Active runtime context.
 * @returns True when the tool is available in the current runtime.
 */
function matchesPiToolAvailability(
  definition: PiToolDefinition,
  context: PiToolAvailabilityContext
): boolean {
  const availability = definition.availability;

  if (!availability) {
    return true;
  }

  if (
    availability.platforms &&
    availability.platforms.length > 0 &&
    !availability.platforms.includes(context.platform)
  ) {
    return false;
  }

  if (
    availability.chainTypes &&
    availability.chainTypes.length > 0 &&
    (!context.chainType || !availability.chainTypes.includes(context.chainType))
  ) {
    return false;
  }

  return true;
}

/**
 * Determine whether a Pi tool should be enabled for the current settings.
 */
function isPiToolEnabled(definition: PiToolDefinition, enabledToolIds: Set<string>): boolean {
  if (enabledToolIds.has(definition.id)) {
    return true;
  }

  return definition.enabledByDefault === true;
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
