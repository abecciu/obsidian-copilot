const mockGetSettings = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: (key: string) => Promise.resolve(key),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { executePiExaWebSearch, executePiFirecrawlWebFetch } from "./PiWebTools";

describe("PiWebTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      exaApiKey: "exa-test-key",
      firecrawlApiKey: "fc-test-key",
      toolProxyBaseUrl: "",
      toolProxyApiKey: "",
    });
  });

  it("formats Exa search results with sources", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Result Title",
            url: "https://example.com/result",
            publishedDate: "2025-01-01T00:00:00.000Z",
            author: "Example Author",
            highlights: ["First highlight", "Second highlight"],
            highlightScores: [0.87],
          },
        ],
      }),
    });

    const result = await executePiExaWebSearch("test query");

    expect(mockFetch).toHaveBeenCalledWith("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": "exa-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "test query",
        type: "auto",
        numResults: 5,
        contents: {
          highlights: {
            maxCharacters: 4000,
          },
        },
      }),
    });
    expect(result.text).toContain("Title: Result Title");
    expect(result.text).toContain("URL: https://example.com/result");
    expect(result.text).toContain("- First highlight");
    expect(result.sources).toEqual([
      {
        title: "Result Title",
        path: "https://example.com/result",
        score: 0.87,
        explanation: "First highlight",
      },
    ]);
  });

  it("uses the configured tool proxy for Exa web search", async () => {
    mockGetSettings.mockReturnValue({
      exaApiKey: "",
      firecrawlApiKey: "fc-test-key",
      toolProxyBaseUrl: "https://toolproxy.zup.sh",
      toolProxyApiKey: "toolproxy-token",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Proxy Result",
            url: "https://example.com/proxy",
            highlights: ["Proxy highlight"],
          },
        ],
      }),
    });

    const result = await executePiExaWebSearch("proxied query");

    expect(mockFetch).toHaveBeenCalledWith("https://toolproxy.zup.sh/exa/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer toolproxy-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "proxied query",
        type: "auto",
        numResults: 5,
        contents: {
          highlights: {
            maxCharacters: 4000,
          },
        },
      }),
    });
    expect(result.text).toContain("Proxy Result");
  });

  it("fails clearly when Exa API key is missing", async () => {
    mockGetSettings.mockReturnValue({
      exaApiKey: "",
      firecrawlApiKey: "fc-test-key",
      toolProxyBaseUrl: "",
      toolProxyApiKey: "",
    });

    await expect(executePiExaWebSearch("test query")).rejects.toThrow(
      "Exa API key is not configured."
    );
  });

  it("fails clearly when tool proxy is configured without a bearer token", async () => {
    mockGetSettings.mockReturnValue({
      exaApiKey: "",
      firecrawlApiKey: "fc-test-key",
      toolProxyBaseUrl: "https://toolproxy.zup.sh",
      toolProxyApiKey: "",
    });

    await expect(executePiExaWebSearch("test query")).rejects.toThrow(
      "Tool proxy API key is not configured."
    );
  });

  it("formats Firecrawl scrape markdown with metadata", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "# Article body\n\nSome text here.",
          metadata: {
            title: "Example Page",
            description: "Useful description",
            sourceURL: "https://example.com/page",
          },
        },
      }),
    });

    const result = await executePiFirecrawlWebFetch("https://example.com/page");

    expect(mockFetch).toHaveBeenCalledWith("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: "Bearer fc-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/page",
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true,
        proxy: "auto",
        storeInCache: true,
        timeout: 60000,
      }),
    });
    expect(result.text).toContain("# Example Page");
    expect(result.text).toContain("URL: https://example.com/page");
    expect(result.text).toContain("Description: Useful description");
    expect(result.text).toContain("# Article body");
    expect(result.sources).toEqual([
      {
        title: "Example Page",
        path: "https://example.com/page",
        score: 1,
      },
    ]);
  });

  it("fails clearly when Firecrawl scrape returns no markdown", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          metadata: {
            title: "Example Page",
          },
        },
      }),
    });

    await expect(executePiFirecrawlWebFetch("https://example.com/page")).rejects.toThrow(
      "Firecrawl scrape returned no markdown content."
    );
  });

  it("fails clearly when webFetch receives an invalid URL", async () => {
    await expect(executePiFirecrawlWebFetch("not-a-url")).rejects.toThrow(
      'webFetch requires a valid URL. Received: "not-a-url"'
    );
  });
});
