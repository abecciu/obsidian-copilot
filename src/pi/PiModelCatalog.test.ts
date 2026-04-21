import { DEFAULT_SETTINGS } from "@/constants";
import {
  getPiModelCatalog,
  mergeFetchedPiModels,
  normalizePiModelEntry,
  resolvePiChatModelId,
} from "@/pi/PiModelCatalog";

describe("PiModelCatalog", () => {
  it("preserves local curation when merging fetched models", () => {
    const mergedModels = mergeFetchedPiModels(
      [
        {
          id: "model-a",
          displayName: "Model A",
          enabled: false,
          source: "manual",
        },
      ],
      [
        {
          id: "model-a",
          displayName: "Provider Model A",
          enabled: true,
          source: "fetched",
        },
        {
          id: "model-b",
          displayName: "Provider Model B",
          enabled: true,
          source: "fetched",
        },
      ]
    );

    expect(mergedModels).toEqual([
      {
        id: "model-a",
        displayName: "Model A",
        enabled: false,
        source: "fetched",
      },
      {
        id: "model-b",
        displayName: "Provider Model B",
        enabled: true,
        source: "fetched",
      },
    ]);
  });

  it("always includes the configured default model in the catalog", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      piAgent: {
        ...DEFAULT_SETTINGS.piAgent,
        modelId: "custom-default",
        models: [],
      },
    };

    expect(getPiModelCatalog(settings)).toEqual([
      {
        id: "custom-default",
        displayName: "custom-default",
        enabled: true,
        source: "manual",
      },
    ]);
  });

  it("prefers the project pi model over the session default", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      piAgent: {
        ...DEFAULT_SETTINGS.piAgent,
        modelId: "global-default",
      },
    };

    expect(
      resolvePiChatModelId(settings, {
        id: "project-1",
        name: "Project 1",
        projectModelKey: "",
        projectPiModelId: "project-model",
        systemPrompt: "",
        modelConfigs: {},
        contextSource: {},
        created: Date.now(),
        UsageTimestamps: Date.now(),
      })
    ).toBe("project-model");
  });

  it("normalizes malformed pi catalog entries", () => {
    expect(
      normalizePiModelEntry({
        id: " model-a ",
        displayName: "",
        enabled: undefined,
        source: "manual",
      })
    ).toEqual({
      id: "model-a",
      displayName: "model-a",
      enabled: true,
      source: "manual",
    });
  });
});
