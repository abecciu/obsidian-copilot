import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const DEFAULT_EXA_RESULT_COUNT = 5;
const DEFAULT_FIRECRAWL_TIMEOUT_MS = 60000;

/**
 * Source information returned by Pi web tools.
 */
export interface PiWebToolSource {
  title: string;
  path: string;
  score: number;
  explanation?: unknown;
}

/**
 * Normalized payload returned by Pi web provider helpers.
 */
export interface PiWebToolExecutionResult {
  text: string;
  rawResult: unknown;
  sources: PiWebToolSource[];
}

interface ExaSearchResponse {
  requestId?: string;
  results?: ExaSearchResult[];
}

interface ExaSearchResult {
  id?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  highlightScores?: number[];
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  error?: string;
  data?: FirecrawlScrapeData;
}

interface FirecrawlScrapeData {
  markdown?: string;
  metadata?: FirecrawlScrapeMetadata;
}

interface FirecrawlScrapeMetadata {
  title?: string;
  description?: string;
  sourceURL?: string;
}

/**
 * Execute the Pi-mode web search flow with Exa.
 *
 * @param query - Natural-language web search query.
 * @returns Normalized text, raw payload, and source metadata for Pi chat.
 */
export async function executePiExaWebSearch(query: string): Promise<PiWebToolExecutionResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("Exa web search requires a non-empty query.");
  }

  const proxyUrl = getPiToolProxyEndpoint("exa/search");
  if (proxyUrl) {
    return executePiProxyExaWebSearch(proxyUrl, trimmedQuery);
  }

  const apiKey = await getConfiguredApiKey("exaApiKey", "Exa");
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: trimmedQuery,
      type: "auto",
      numResults: DEFAULT_EXA_RESULT_COUNT,
      contents: {
        highlights: {
          maxCharacters: 4000,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Exa web search failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as ExaSearchResponse;
  const results = Array.isArray(payload.results) ? payload.results : [];
  logInfo(`[PiWebTools] Exa search returned ${results.length} results for "${trimmedQuery}"`);

  if (results.length === 0) {
    return {
      text: "No web search results found. Try a more specific query.",
      rawResult: payload,
      sources: [],
    };
  }

  return {
    text: results.map(formatExaSearchResult).join("\n\n---\n\n"),
    rawResult: payload,
    sources: results
      .filter((result): result is ExaSearchResult & { url: string } => typeof result.url === "string")
      .map((result, index) => ({
        title: result.title || result.url,
        path: result.url,
        score: resolveExaResultScore(result, index),
        explanation: result.summary || result.highlights?.[0],
      })),
  };
}

/**
 * Execute Pi web search against a configured tool proxy.
 *
 * @param proxyUrl - Fully resolved proxy endpoint URL.
 * @param query - Natural-language web search query.
 * @returns Normalized text, raw payload, and source metadata for Pi chat.
 */
async function executePiProxyExaWebSearch(
  proxyUrl: string,
  query: string
): Promise<PiWebToolExecutionResult> {
  const proxyToken = await getConfiguredApiKey("toolProxyApiKey", "Tool proxy");
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${proxyToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: DEFAULT_EXA_RESULT_COUNT,
      contents: {
        highlights: {
          maxCharacters: 4000,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tool proxy Exa search failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as ExaSearchResponse;
  const results = Array.isArray(payload.results) ? payload.results : [];
  logInfo(`[PiWebTools] Tool proxy Exa search returned ${results.length} results for "${query}"`);

  if (results.length === 0) {
    return {
      text: "No web search results found. Try a more specific query.",
      rawResult: payload,
      sources: [],
    };
  }

  return {
    text: results.map(formatExaSearchResult).join("\n\n---\n\n"),
    rawResult: payload,
    sources: results
      .filter((result): result is ExaSearchResult & { url: string } => typeof result.url === "string")
      .map((result, index) => ({
        title: result.title || result.url,
        path: result.url,
        score: resolveExaResultScore(result, index),
        explanation: result.summary || result.highlights?.[0],
      })),
  };
}

/**
 * Execute the Pi-mode page fetch flow with Firecrawl scrape.
 *
 * @param url - Exact URL to fetch and scrape.
 * @returns Normalized text, raw payload, and source metadata for Pi chat.
 */
export async function executePiFirecrawlWebFetch(
  url: string
): Promise<PiWebToolExecutionResult> {
  const normalizedUrl = normalizeUrl(url);
  const apiKey = await getConfiguredApiKey("firecrawlApiKey", "Firecrawl");
  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: normalizedUrl,
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      proxy: "auto",
      storeInCache: true,
      timeout: DEFAULT_FIRECRAWL_TIMEOUT_MS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl scrape failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as FirecrawlScrapeResponse;
  if (payload.success === false) {
    throw new Error(payload.error || "Firecrawl scrape returned an unsuccessful response.");
  }

  const data = payload.data || {};
  const markdown = typeof data.markdown === "string" ? data.markdown.trim() : "";
  if (!markdown) {
    throw new Error("Firecrawl scrape returned no markdown content.");
  }

  const sourceUrl =
    typeof data.metadata?.sourceURL === "string" && data.metadata.sourceURL.trim().length > 0
      ? data.metadata.sourceURL.trim()
      : normalizedUrl;

  logInfo(`[PiWebTools] Firecrawl fetched ${sourceUrl}`);

  return {
    text: formatFirecrawlScrapeResult(data, sourceUrl),
    rawResult: payload,
    sources: [
      {
        title:
          typeof data.metadata?.title === "string" && data.metadata.title.trim().length > 0
            ? data.metadata.title.trim()
            : sourceUrl,
        path: sourceUrl,
        score: 1,
      },
    ],
  };
}

/**
 * Retrieve and decrypt a configured API key from settings.
 *
 * @param keyName - Settings key containing the encrypted secret.
 * @param providerName - Human-readable provider name for error messages.
 * @returns Decrypted API key.
 */
async function getConfiguredApiKey(
  keyName: "exaApiKey" | "firecrawlApiKey" | "toolProxyApiKey",
  providerName: string
): Promise<string> {
  const settings = getSettings();
  const rawValue = settings[keyName];
  const apiKey = (await getDecryptedKey(rawValue)).trim();
  if (!apiKey) {
    throw new Error(
      `${providerName} API key is not configured. Add it in Settings > Basic while Pi Agent is enabled.`
    );
  }
  return apiKey;
}

/**
 * Resolve the optional Pi tool proxy endpoint for a provider path.
 *
 * @param providerPath - Provider-specific relative path, e.g. "exa/search".
 * @returns Full proxy endpoint URL when configured, otherwise null.
 */
function getPiToolProxyEndpoint(providerPath: string): string | null {
  const baseUrl = getSettings().toolProxyBaseUrl?.trim();
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${providerPath.replace(/^\/+/, "")}`;
}

/**
 * Normalize a URL string and fail clearly when it is invalid.
 *
 * @param url - User-provided URL string.
 * @returns Canonical URL string.
 */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`webFetch requires a valid URL. Received: "${url}"`);
  }
}

/**
 * Convert an Exa result into model-readable text.
 *
 * @param result - Single Exa search result.
 * @returns Formatted multi-line text block.
 */
function formatExaSearchResult(result: ExaSearchResult): string {
  const lines = [`Title: ${result.title || "Untitled"}`, `URL: ${result.url || "N/A"}`];

  if (result.publishedDate) {
    lines.push(`Published: ${result.publishedDate}`);
  }

  if (result.author) {
    lines.push(`Author: ${result.author}`);
  }

  const highlights = Array.isArray(result.highlights)
    ? result.highlights.filter(
        (highlight): highlight is string =>
          typeof highlight === "string" && highlight.trim().length > 0
      )
    : [];

  if (highlights.length > 0) {
    lines.push("Highlights:");
    lines.push(...highlights.map((highlight) => `- ${highlight}`));
  } else if (typeof result.summary === "string" && result.summary.trim().length > 0) {
    lines.push(`Summary: ${result.summary.trim()}`);
  } else if (typeof result.text === "string" && result.text.trim().length > 0) {
    lines.push(`Text: ${createSnippet(result.text)}`);
  }

  return lines.join("\n");
}

/**
 * Determine a stable score for an Exa result.
 *
 * @param result - Single Exa search result.
 * @param index - Result index in the returned list.
 * @returns Numeric score for UI/source metadata.
 */
function resolveExaResultScore(result: ExaSearchResult, index: number): number {
  const firstHighlightScore = Array.isArray(result.highlightScores) ? result.highlightScores[0] : 0;
  if (typeof firstHighlightScore === "number" && Number.isFinite(firstHighlightScore)) {
    return firstHighlightScore;
  }
  return Math.max(0, 1 - index * 0.01);
}

/**
 * Format Firecrawl scrape output into a compact text payload for the model.
 *
 * @param data - Scrape result payload.
 * @param sourceUrl - Final source URL to display.
 * @returns Formatted text block.
 */
function formatFirecrawlScrapeResult(
  data: FirecrawlScrapeData,
  sourceUrl: string
): string {
  const sections = [];

  if (typeof data.metadata?.title === "string" && data.metadata.title.trim().length > 0) {
    sections.push(`# ${data.metadata.title.trim()}`);
  }

  sections.push(`URL: ${sourceUrl}`);

  if (
    typeof data.metadata?.description === "string" &&
    data.metadata.description.trim().length > 0
  ) {
    sections.push(`Description: ${data.metadata.description.trim()}`);
  }

  sections.push(data.markdown!.trim());
  return sections.join("\n\n");
}

/**
 * Create a short snippet from a larger text body.
 *
 * @param text - Raw text body.
 * @returns Single-line shortened snippet.
 */
function createSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}
