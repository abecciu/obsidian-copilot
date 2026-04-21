import { getPiModelId, getCurrentProject, type ProjectConfig } from "@/aiParams";
import { getDecryptedKey } from "@/encryptionService";
import { getSettings, type CopilotSettings, type PiModelCatalogEntry } from "@/settings/model";
import { requestUrl } from "obsidian";

interface OpenAIModelListResponse {
  data?: Array<{
    id?: string;
  }>;
}

/**
 * Return the pi model catalog, always including the configured default model.
 */
export function getPiModelCatalog(
  settings: Readonly<CopilotSettings> = getSettings()
): PiModelCatalogEntry[] {
  const configuredModelId = settings.piAgent.modelId.trim();
  const seen = new Set<string>();
  const entries: PiModelCatalogEntry[] = [];

  for (const entry of settings.piAgent.models) {
    const normalizedEntry = normalizePiModelEntry(entry);
    if (!normalizedEntry || seen.has(normalizedEntry.id)) {
      continue;
    }
    seen.add(normalizedEntry.id);
    entries.push(normalizedEntry);
  }

  if (configuredModelId && !seen.has(configuredModelId)) {
    entries.unshift({
      id: configuredModelId,
      displayName: configuredModelId,
      enabled: true,
      source: "manual",
    });
  }

  return entries;
}

/**
 * Return only enabled pi models from the local catalog.
 */
export function getEnabledPiModels(
  settings: Readonly<CopilotSettings> = getSettings()
): PiModelCatalogEntry[] {
  return getPiModelCatalog(settings).filter((entry) => entry.enabled);
}

/**
 * Find a pi model entry by ID.
 */
export function findPiModelEntry(
  modelId: string | null | undefined,
  settings: Readonly<CopilotSettings> = getSettings()
): PiModelCatalogEntry | null {
  if (!modelId?.trim()) {
    return null;
  }

  return getPiModelCatalog(settings).find((entry) => entry.id === modelId.trim()) ?? null;
}

/**
 * Resolve a display label for a pi model ID.
 */
export function getPiModelLabel(
  modelId: string | null | undefined,
  settings: Readonly<CopilotSettings> = getSettings()
): string {
  const modelEntry = findPiModelEntry(modelId, settings);
  if (modelEntry) {
    return modelEntry.displayName || modelEntry.id;
  }

  return modelId?.trim() || "Select Model";
}

/**
 * Resolve the default pi model ID for chat-like UI surfaces.
 */
export function resolvePiChatModelId(
  settings: Readonly<CopilotSettings> = getSettings(),
  project: ProjectConfig | null = getCurrentProject()
): string {
  if (project?.projectPiModelId?.trim()) {
    return project.projectPiModelId.trim();
  }

  const sessionModelId = getPiModelId().trim();
  if (sessionModelId) {
    return sessionModelId;
  }

  const configuredModelId = settings.piAgent.modelId.trim();
  if (configuredModelId) {
    return configuredModelId;
  }

  return getEnabledPiModels(settings)[0]?.id || "";
}

/**
 * Fetch an OpenAI-compatible `/models` response from the configured pi provider.
 */
export async function fetchPiProviderModels(
  settings: Readonly<CopilotSettings> = getSettings()
): Promise<PiModelCatalogEntry[]> {
  const baseUrl = settings.piAgent.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = (await getDecryptedKey(settings.piAgent.apiKey)).trim();

  if (!baseUrl) {
    throw new Error("Set a Pi Base URL before refreshing the pi model catalog.");
  }

  const response = await requestUrl({
    url: `${baseUrl}/models`,
    method: "GET",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
  });

  const body = (response.json || {}) as OpenAIModelListResponse;
  const modelIds = Array.isArray(body.data)
    ? body.data
        .map((entry) => entry?.id?.trim() || "")
        .filter((id, index, values) => Boolean(id) && values.indexOf(id) === index)
    : [];

  return modelIds.map((id) => ({
    id,
    displayName: id,
    enabled: true,
    source: "fetched" as const,
  }));
}

/**
 * Merge freshly fetched models into the locally curated catalog without losing edits.
 */
export function mergeFetchedPiModels(
  existingEntries: PiModelCatalogEntry[],
  fetchedEntries: PiModelCatalogEntry[]
): PiModelCatalogEntry[] {
  const fetchedById = new Map(
    fetchedEntries.map((entry) => [entry.id, normalizePiModelEntry(entry)])
  );
  const mergedEntries: PiModelCatalogEntry[] = [];

  for (const entry of existingEntries) {
    const normalizedEntry = normalizePiModelEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const fetchedEntry = fetchedById.get(normalizedEntry.id);
    if (fetchedEntry) {
      mergedEntries.push({
        ...normalizedEntry,
        source: fetchedEntry.source,
      });
      fetchedById.delete(normalizedEntry.id);
      continue;
    }

    mergedEntries.push(normalizedEntry);
  }

  for (const fetchedEntry of fetchedById.values()) {
    if (fetchedEntry) {
      mergedEntries.push(fetchedEntry);
    }
  }

  return mergedEntries;
}

/**
 * Normalize a pi model entry and reject malformed values.
 */
export function normalizePiModelEntry(entry: Partial<PiModelCatalogEntry> | null | undefined) {
  const id = typeof entry?.id === "string" ? entry.id.trim() : "";
  if (!id) {
    return null;
  }

  return {
    id,
    displayName:
      typeof entry?.displayName === "string" && entry.displayName.trim().length > 0
        ? entry.displayName.trim()
        : id,
    enabled: typeof entry?.enabled === "boolean" ? entry.enabled : true,
    source: entry?.source === "manual" ? "manual" : "fetched",
  } satisfies PiModelCatalogEntry;
}
