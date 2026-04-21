import { CustomModel } from "@/aiParams";
import { BUILTIN_CHAT_MODELS } from "@/constants";
import ProjectManager from "@/LLMProviders/projectManager";
import { logError } from "@/logger";
import { CopilotSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { ModelAddDialog } from "@/settings/v2/components/ModelAddDialog";
import { ModelEditModal } from "@/settings/v2/components/ModelEditDialog";
import { ModelTable } from "@/settings/v2/components/ModelTable";
import { omit } from "@/utils";
import { Notice } from "obsidian";
import React, { useState } from "react";

export const ModelSettings: React.FC = () => {
  const settings = useSettingsValue();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const onCopyModel = (model: CustomModel, isEmbeddingModel: boolean = false) => {
    const newModel: CustomModel = {
      ...omit(model, [
        "isBuiltIn",
        "core",
        "projectEnabled",
        "plusExclusive",
        "believerExclusive",
        "capabilities",
        "displayName",
        "dimensions",
      ]),
      name: `${model.name} (copy)`,
    };

    const settingField: keyof CopilotSettings = isEmbeddingModel
      ? "activeEmbeddingModels"
      : "activeModels";

    updateSetting(settingField, [...settings[settingField], newModel]);
  };

  const handleModelReorder = (newModels: CustomModel[], isEmbeddingModel: boolean = false) => {
    const settingField: keyof CopilotSettings = isEmbeddingModel
      ? "activeEmbeddingModels"
      : "activeModels";
    updateSetting(settingField, newModels);
  };

  const onDeleteModel = (modelKey: string) => {
    const [modelName, provider] = modelKey.split("|");
    const updatedActiveModels = settings.activeModels.filter(
      (model) => !(model.name === modelName && model.provider === provider)
    );

    let newDefaultModelKey = settings.defaultModelKey;
    if (modelKey === settings.defaultModelKey) {
      const newDefaultModel = updatedActiveModels.find((model) => model.enabled);
      newDefaultModelKey = newDefaultModel
        ? `${newDefaultModel.name}|${newDefaultModel.provider}`
        : "";
    }

    setSettings({
      activeModels: updatedActiveModels,
      defaultModelKey: newDefaultModelKey,
    });
  };

  const handleModelUpdate = (
    isEmbeddingModel: boolean,
    originalModel: CustomModel,
    updatedModel: CustomModel
  ) => {
    const settingField: keyof CopilotSettings = isEmbeddingModel
      ? "activeEmbeddingModels"
      : "activeModels";

    const modelIndex = settings[settingField].findIndex(
      (m) => m.name === originalModel.name && m.provider === originalModel.provider
    );
    if (modelIndex !== -1) {
      const updatedModels = [...settings[settingField]];
      updatedModels[modelIndex] = updatedModel;
      updateSetting(settingField, updatedModels);
    } else {
      new Notice("Could not find model to update");
      logError("Could not find model to update:", originalModel);
    }
  };

  // Handler for updates originating from the ModelTable itself (e.g., checkbox toggles)
  const handleTableUpdate = (updatedModel: CustomModel) => {
    const updatedModels = settings.activeModels.map((m) =>
      m.name === updatedModel.name && m.provider === updatedModel.provider ? updatedModel : m
    );
    updateSetting("activeModels", updatedModels);
  };
  const handleRefreshChatModels = () => {
    // Get all custom models (non-built-in models)
    const customModels = settings.activeModels.filter((model) => !model.isBuiltIn);

    // Create a new array with built-in models and custom models
    const updatedModels = [...BUILTIN_CHAT_MODELS, ...customModels];

    // Update the settings
    updateSetting("activeModels", updatedModels);
    new Notice("Chat models refreshed successfully");
  };

  const handleEditModel = (model: CustomModel, isEmbeddingModel: boolean = false) => {
    const modal = new ModelEditModal(app, model, isEmbeddingModel, handleModelUpdate);
    modal.open();
  };

  return (
    <div className="tw-space-y-4">
      <section>
        <ModelTable
          models={settings.activeModels}
          onEdit={(model) => handleEditModel(model)}
          onCopy={(model) => onCopyModel(model)}
          onDelete={onDeleteModel}
          onAdd={() => setShowAddDialog(true)}
          onUpdateModel={handleTableUpdate}
          onReorderModels={(newModels) => handleModelReorder(newModels)}
          onRefresh={handleRefreshChatModels}
          title="Chat Models"
        />

        {/* model add dialog */}
        <ModelAddDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onAdd={(model) => {
            const updatedModels = [...settings.activeModels, model];
            updateSetting("activeModels", updatedModels);
          }}
          ping={(model) =>
            ProjectManager.instance.getCurrentChainManager().chatModelManager.ping(model)
          }
        />
      </section>
    </div>
  );
};
