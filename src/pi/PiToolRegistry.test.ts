const mockGetSettings = jest.fn();
const mockCallTool = jest.fn();
const mockSelfHostWebSearch = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
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
}));

import { getPiTools } from "./PiToolRegistry";

describe("getPiTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
