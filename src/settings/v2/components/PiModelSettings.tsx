import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";

import {
  getPiModelCatalog,
  fetchPiProviderModels,
  mergeFetchedPiModels,
} from "@/pi/PiModelCatalog";
import { updateSetting, useSettingsValue } from "@/settings/model";

/**
 * Pi-specific model catalog settings. Models come from the provider `/models`
 * endpoint, but remain locally editable after refresh.
 */
export const PiModelSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualModelId, setManualModelId] = useState("");
  const [manualDisplayName, setManualDisplayName] = useState("");

  const modelCatalog = useMemo(() => getPiModelCatalog(settings), [settings]);

  /**
   * Persist a modified pi model catalog.
   */
  const updatePiModels = (
    nextModels: typeof settings.piAgent.models,
    nextDefaultModelId: string = settings.piAgent.modelId
  ) => {
    updateSetting("piAgent", {
      ...settings.piAgent,
      modelId: nextDefaultModelId,
      models: nextModels,
    });
  };

  /**
   * Refresh the catalog from the configured provider.
   */
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const fetchedModels = await fetchPiProviderModels(settings);
      const mergedModels = mergeFetchedPiModels(settings.piAgent.models, fetchedModels);
      updatePiModels(mergedModels);
      new Notice(`Refreshed ${fetchedModels.length} pi models from the configured provider.`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to refresh pi models.");
    } finally {
      setIsRefreshing(false);
    }
  };

  /**
   * Add a manual pi model entry.
   */
  const handleAddManualModel = () => {
    const id = manualModelId.trim();
    if (!id) {
      new Notice("Enter a model ID before adding a manual pi model.");
      return;
    }

    if (modelCatalog.some((entry) => entry.id === id)) {
      new Notice("That pi model already exists in the local catalog.");
      return;
    }

    updatePiModels([
      ...settings.piAgent.models,
      {
        id,
        displayName: manualDisplayName.trim() || id,
        enabled: true,
        source: "manual",
      },
    ]);
    setManualModelId("");
    setManualDisplayName("");
  };

  return (
    <div className="tw-space-y-4">
      <section className="tw-space-y-4">
        <SettingItem
          type="custom"
          title="Provider Model Catalog"
          description="Refresh `/models` from your configured pi provider, then locally hide, rename, reorder, or add extra model IDs for this fork."
        >
          <Button variant="secondary" onClick={handleRefresh} disabled={isRefreshing}>
            {isRefreshing ? (
              <>
                <Loader2 className="tw-size-4 tw-animate-spin" />
                Refreshing
              </>
            ) : (
              <>
                <RefreshCcw className="tw-size-4" />
                Refresh from Provider
              </>
            )}
          </Button>
        </SettingItem>

        <SettingItem
          type="custom"
          title="Add Manual Model"
          description="Use this when your gateway exposes a model ID you want to keep locally even if `/models` does not return it."
        >
          <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row">
            <Input
              value={manualModelId}
              onChange={(event) => setManualModelId(event.target.value)}
              placeholder="Model ID"
              className="sm:tw-max-w-xs"
            />
            <Input
              value={manualDisplayName}
              onChange={(event) => setManualDisplayName(event.target.value)}
              placeholder="Display name (optional)"
              className="sm:tw-max-w-xs"
            />
            <Button onClick={handleAddManualModel}>
              <Plus className="tw-size-4" />
              Add
            </Button>
          </div>
        </SettingItem>

        <div className="tw-space-y-2">
          {modelCatalog.map((entry, index) => (
            <div
              key={entry.id}
              className="tw-flex tw-flex-col tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3 tw-bg-muted/20"
            >
              <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
                <div className="tw-min-w-0">
                  <div className="tw-truncate tw-font-medium">{entry.id}</div>
                  <div className="tw-text-sm tw-text-muted">
                    {entry.source === "manual" ? "Manual" : "Fetched from provider"}
                    {settings.piAgent.modelId === entry.id ? " • Default chat model" : ""}
                  </div>
                </div>
                <div className="tw-flex tw-items-center tw-gap-2">
                  <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-muted">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(event) => {
                        const nextModels = modelCatalog.map((model) =>
                          model.id === entry.id
                            ? { ...model, enabled: event.target.checked }
                            : model
                        );
                        updatePiModels(nextModels);
                      }}
                    />
                    Enabled
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => updatePiModels(modelCatalog, entry.id)}
                    disabled={settings.piAgent.modelId === entry.id}
                  >
                    Use Default
                  </Button>
                  <Button
                    variant="ghost2"
                    size="icon"
                    onClick={() => {
                      const remainingModels = modelCatalog.filter((model) => model.id !== entry.id);
                      const nextDefaultModelId =
                        settings.piAgent.modelId === entry.id
                          ? remainingModels.find((model) => model.enabled)?.id ||
                            remainingModels[0]?.id ||
                            ""
                          : settings.piAgent.modelId;
                      updatePiModels(remainingModels, nextDefaultModelId);
                    }}
                    disabled={modelCatalog.length === 1}
                    title="Remove model"
                  >
                    <Trash2 className="tw-size-4" />
                  </Button>
                </div>
              </div>

              <div className="tw-flex tw-flex-col tw-gap-2 sm:tw-flex-row">
                <Input
                  value={entry.displayName}
                  onChange={(event) => {
                    const nextModels = modelCatalog.map((model) =>
                      model.id === entry.id
                        ? { ...model, displayName: event.target.value || model.id }
                        : model
                    );
                    updatePiModels(nextModels);
                  }}
                  placeholder="Display name"
                  className="sm:tw-max-w-sm"
                />
                <div className="tw-flex tw-items-center tw-gap-2">
                  <Button
                    variant="ghost2"
                    size="sm"
                    onClick={() => {
                      if (index === 0) {
                        return;
                      }
                      const nextModels = [...modelCatalog];
                      const [movedModel] = nextModels.splice(index, 1);
                      nextModels.splice(index - 1, 0, movedModel);
                      updatePiModels(nextModels);
                    }}
                    disabled={index === 0}
                  >
                    Move Up
                  </Button>
                  <Button
                    variant="ghost2"
                    size="sm"
                    onClick={() => {
                      if (index === modelCatalog.length - 1) {
                        return;
                      }
                      const nextModels = [...modelCatalog];
                      const [movedModel] = nextModels.splice(index, 1);
                      nextModels.splice(index + 1, 0, movedModel);
                      updatePiModels(nextModels);
                    }}
                    disabled={index === modelCatalog.length - 1}
                  >
                    Move Down
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
