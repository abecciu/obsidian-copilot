const mockGetSettings = jest.fn();
const mockCallTool = jest.fn();
const mockSelfHostWebSearch = jest.fn();
const mockGetCustomPiToolDefinitions = jest.fn(() => []);
const mockIsDesktopRuntime = jest.fn(() => true);

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/chainFactory", () => ({
  ChainType: {
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project",
  },
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: (...args: unknown[]) => mockCallTool(...args),
  },
}));

jest.mock("@/tools/SearchTools", () => ({
  localSearchTool: { name: "localSearch" },
}));

jest.mock("@/tools/NoteTools", () => ({
  readNoteTool: { name: "readNote" },
}));

jest.mock("@/tools/ComposerTools", () => ({
  writeFileTool: { name: "writeFile" },
  editFileTool: { name: "editFile" },
}));

jest.mock("@/tools/TimeTools", () => ({
  convertTimeBetweenTimezonesTool: { name: "convertTimeBetweenTimezones" },
  getCurrentTimeTool: { name: "getCurrentTime" },
  getTimeInfoByEpochTool: { name: "getTimeInfoByEpoch" },
  getTimeRangeMsTool: { name: "getTimeRangeMs" },
}));

jest.mock("@/LLMProviders/selfHostServices", () => ({
  selfHostWebSearch: (...args: unknown[]) => mockSelfHostWebSearch(...args),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isDesktopRuntime: () => mockIsDesktopRuntime(),
}));

jest.mock("./PiCustomTools", () => ({
  getCustomPiToolDefinitions: () => mockGetCustomPiToolDefinitions(),
}));

import { ChainType } from "@/chainFactory";
import { Type } from "@sinclair/typebox";
import { getPiTools, registerPiToolProvider, resetPiToolProvidersForTests } from "./PiToolRegistry";

describe("getPiTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPiToolProvidersForTests();
    mockGetCustomPiToolDefinitions.mockReturnValue([]);
    mockIsDesktopRuntime.mockReturnValue(true);
  });

  it("returns only the tools enabled in pi settings", () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch", "webSearch", "getCurrentTime"],
      },
    });

    const tools = getPiTools();

    expect(tools.map((tool) => tool.name)).toEqual(["localSearch", "webSearch", "getCurrentTime"]);
  });

  it("adapts structured local-search results into pi tool output with sources", async () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch"],
      },
    });
    mockCallTool.mockResolvedValue(
      JSON.stringify({
        documents: [
          {
            title: "Project Alpha",
            path: "Projects/Alpha.md",
            score: 0.91,
            explanation: "Top lexical match",
          },
        ],
      })
    );

    const localSearchTool = getPiTools().find((tool) => tool.name === "localSearch");
    const result = await localSearchTool!.execute("tool-call-1", {
      query: "alpha",
      salientTerms: ["alpha"],
    });

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining('"documents"'),
        },
      ],
      details: {
        rawResult: {
          documents: [
            expect.objectContaining({
              path: "Projects/Alpha.md",
            }),
          ],
        },
        sources: [
          {
            title: "Project Alpha",
            path: "Projects/Alpha.md",
            score: 0.91,
            explanation: "Top lexical match",
          },
        ],
      },
    });
  });

  it("uses self-hosted search for the pi webSearch tool", async () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["webSearch"],
      },
    });
    mockSelfHostWebSearch.mockResolvedValue({
      content: "Search summary",
      citations: ["https://example.com/a", "https://example.com/b"],
    });

    const webSearchTool = getPiTools().find((tool) => tool.name === "webSearch");
    const result = await webSearchTool!.execute("tool-call-2", {
      query: "custom backend",
    });

    expect(mockSelfHostWebSearch).toHaveBeenCalledWith("custom backend");
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Search summary"),
      },
    ]);
    expect((result.content[0] as { text: string }).text).toContain("https://example.com/a");
    expect(result.details.sources).toEqual([
      {
        title: "https://example.com/a",
        path: "https://example.com/a",
        score: 1,
      },
      {
        title: "https://example.com/b",
        path: "https://example.com/b",
        score: 1,
      },
    ]);
  });

  it("includes custom tools enabled by default from registered providers", () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch"],
      },
    });

    registerPiToolProvider("test-custom", () => [
      {
        id: "customEcho",
        enabledByDefault: true,
        tool: {
          name: "customEcho",
          label: "Custom Echo",
          description: "Echoes text",
          parameters: Type.Object({
            text: Type.String(),
          }),
          execute: async (_toolCallId, params) => ({
            content: [{ type: "text", text: String(params.text) }],
            details: {
              rawResult: params,
              sources: [],
            },
          }),
        },
      },
    ]);

    const tools = getPiTools();

    expect(tools.map((tool) => tool.name)).toEqual(["localSearch", "customEcho"]);
  });

  it("lets a custom provider override the builtin Pi webSearch tool", async () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["webSearch"],
      },
    });

    registerPiToolProvider("test-custom-override", () => [
      {
        id: "webSearch",
        enabledByDefault: true,
        tool: {
          name: "webSearch",
          label: "Custom Web Search",
          description: "Override",
          parameters: Type.Object({
            query: Type.String(),
          }),
          execute: async (_toolCallId, params) => ({
            content: [{ type: "text", text: `override:${String(params.query)}` }],
            details: {
              rawResult: params,
              sources: [],
            },
          }),
        },
      },
    ]);

    const webSearchTool = getPiTools().find((tool) => tool.name === "webSearch");
    const result = await webSearchTool!.execute("tool-call-override", {
      query: "override me",
    });

    expect(webSearchTool?.label).toBe("Custom Web Search");
    expect(result.content).toEqual([{ type: "text", text: "override:override me" }]);
    expect(mockSelfHostWebSearch).not.toHaveBeenCalled();
  });

  it("ignores duplicate custom tool ids and keeps the first definition", () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch"],
      },
    });

    registerPiToolProvider("test-custom-a", () => [
      {
        id: "duplicateTool",
        enabledByDefault: true,
        tool: {
          name: "duplicateTool",
          label: "Duplicate Tool A",
          description: "First duplicate",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: "text", text: "a" }],
            details: { rawResult: "a", sources: [] },
          }),
        },
      },
    ]);
    registerPiToolProvider("test-custom-b", () => [
      {
        id: "duplicateTool",
        enabledByDefault: true,
        tool: {
          name: "duplicateTool",
          label: "Duplicate Tool B",
          description: "Second duplicate",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: "text", text: "b" }],
            details: { rawResult: "b", sources: [] },
          }),
        },
      },
    ]);

    const tools = getPiTools();

    expect(tools.map((tool) => tool.name)).toEqual(["localSearch", "duplicateTool"]);
    expect(tools.find((tool) => tool.name === "duplicateTool")?.label).toBe("Duplicate Tool A");
  });

  it("filters out desktop-only tools on mobile runtimes", () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch"],
      },
    });
    mockIsDesktopRuntime.mockReturnValue(false);

    registerPiToolProvider("desktop-only-provider", () => [
      {
        id: "desktopOnlyTool",
        enabledByDefault: true,
        availability: {
          platforms: ["desktop"],
        },
        tool: {
          name: "desktopOnlyTool",
          label: "Desktop Only Tool",
          description: "Only available on desktop.",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: "text", text: "desktop" }],
            details: { rawResult: "desktop", sources: [] },
          }),
        },
      },
    ]);

    const tools = getPiTools();

    expect(tools.map((tool) => tool.name)).toEqual(["localSearch"]);
  });

  it("falls back to the builtin tool when a desktop-only override is unavailable", async () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["webSearch"],
      },
    });
    mockIsDesktopRuntime.mockReturnValue(false);
    mockSelfHostWebSearch.mockResolvedValue({
      content: "Builtin mobile search",
      citations: ["https://example.com/mobile"],
    });

    registerPiToolProvider("desktop-websearch-override", () => [
      {
        id: "webSearch",
        enabledByDefault: true,
        availability: {
          platforms: ["desktop"],
        },
        tool: {
          name: "webSearch",
          label: "Desktop Web Search",
          description: "Desktop-only override",
          parameters: Type.Object({
            query: Type.String(),
          }),
          execute: async (_toolCallId, params) => ({
            content: [{ type: "text", text: `desktop:${String(params.query)}` }],
            details: {
              rawResult: params,
              sources: [],
            },
          }),
        },
      },
    ]);

    const webSearchTool = getPiTools().find((tool) => tool.name === "webSearch");
    const result = await webSearchTool!.execute("tool-call-mobile", {
      query: "mobile fallback",
    });

    expect(webSearchTool?.label).toBe("Web Search");
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Builtin mobile search"),
      },
    ]);
    expect(mockSelfHostWebSearch).toHaveBeenCalledWith("mobile fallback");
  });

  it("filters tools by chain type when runtime context is provided", () => {
    mockGetSettings.mockReturnValue({
      piAgent: {
        enabledToolIds: ["localSearch"],
      },
    });

    registerPiToolProvider("project-only-provider", () => [
      {
        id: "projectOnlyTool",
        enabledByDefault: true,
        availability: {
          chainTypes: [ChainType.PROJECT_CHAIN],
        },
        tool: {
          name: "projectOnlyTool",
          label: "Project Only Tool",
          description: "Only available in project chat.",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: "text", text: "project" }],
            details: { rawResult: "project", sources: [] },
          }),
        },
      },
    ]);

    const projectTools = getPiTools({ chainType: ChainType.PROJECT_CHAIN });
    const copilotTools = getPiTools({ chainType: ChainType.COPILOT_PLUS_CHAIN });

    expect(projectTools.map((tool) => tool.name)).toEqual(["localSearch", "projectOnlyTool"]);
    expect(copilotTools.map((tool) => tool.name)).toEqual(["localSearch"]);
  });
});
