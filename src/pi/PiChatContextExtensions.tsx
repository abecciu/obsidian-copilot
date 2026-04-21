import { ContextBadgeWrapper } from "@/components/chat-components/ContextBadgeWrapper";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatMessage } from "@/types/message";
import { isAllowedFileForNoteContext } from "@/utils";
import { Folder } from "lucide-react";
import { App, TFile } from "obsidian";
import React, { useCallback, useMemo, useState } from "react";

interface PiAgentInstructionAnchorBadgeProps {
  anchorPath: string;
  onRemove?: () => void;
}

interface UsePiAgentInstructionComposerExtensionParams {
  app: App;
  currentActiveFile: TFile | null;
  lexicalEditorRef: React.RefObject<any>;
  initialAnchor?: string;
  enabled: boolean;
}

interface PiAgentInstructionComposerExtension {
  agentInstructionAnchor?: string;
  hasContext: boolean;
  contextMenuControls: React.ReactNode;
  contextBadges: React.ReactNode;
  handleAddToContext: (category: string, data: unknown) => boolean;
  handleRemoveFromContext: (category: string, data: unknown) => boolean;
}

/**
 * Convert an anchor path into the user-facing label shown in Pi context badges.
 *
 * @param anchorPath - Explicit vault folder anchor.
 * @returns Human-readable anchor label.
 */
function getPiAgentInstructionAnchorLabel(anchorPath: string): string {
  return anchorPath === "/" ? "Vault root" : anchorPath;
}

/**
 * Restore focus to the Lexical editor after Pi-owned context UI actions complete.
 *
 * @param lexicalEditorRef - Shared Lexical editor ref.
 */
function restorePiContextEditorFocus(lexicalEditorRef: React.RefObject<any>): void {
  setTimeout(() => {
    lexicalEditorRef.current?.focus?.();
  }, 100);
}

/**
 * Load the shared folder picker lazily so non-composer test paths do not need the
 * full Obsidian modal inheritance chain at module evaluation time.
 *
 * @param app - Obsidian app instance.
 * @param onChooseFolder - Callback invoked with the selected folder path.
 */
async function openPiAgentInstructionFolderPicker(
  app: App,
  onChooseFolder: (folderPath: string) => void
): Promise<void> {
  const { FolderSearchModal } = await import("@/components/modals/FolderSearchModal");
  new FolderSearchModal(app, onChooseFolder).open();
}

/**
 * Resolve the folder path that should be used as the explicit Pi instruction anchor.
 *
 * Root-level notes map to `/` so the vault root remains representable as a persisted
 * anchor value.
 *
 * @param file - Active note candidate.
 * @returns Folder path for the note, or `null` when the note is not usable.
 */
export function getPiAgentInstructionAnchorFolderPath(file: TFile | null): string | null {
  if (!isAllowedFileForNoteContext(file) || !file?.path) {
    return null;
  }

  const lastSlashIndex = file.path.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return "/";
  }

  return file.path.slice(0, lastSlashIndex);
}

/**
 * Pi-owned badge that represents an explicit vault `AGENTS.md` anchor.
 *
 * @param props - Anchor badge props.
 * @returns Badge element.
 */
export function PiAgentInstructionAnchorBadge({
  anchorPath,
  onRemove,
}: PiAgentInstructionAnchorBadgeProps) {
  const displayText = getPiAgentInstructionAnchorLabel(anchorPath);

  return (
    <ContextBadgeWrapper icon={<Folder className="tw-size-3" />} onRemove={onRemove}>
      <span className="tw-text-xs tw-text-faint">Anchor</span>
      <TruncatedText className="tw-max-w-40" tooltipContent={displayText} alwaysShowTooltip>
        {displayText}
      </TruncatedText>
    </ContextBadgeWrapper>
  );
}

/**
 * Manage the Pi-only vault instruction anchor controls used by the shared composer UI.
 *
 * @param params - Shared composer dependencies and feature flags.
 * @returns Anchor state, category handlers, and React nodes for shared extension slots.
 */
export function usePiAgentInstructionComposerExtension({
  app,
  currentActiveFile,
  lexicalEditorRef,
  initialAnchor,
  enabled,
}: UsePiAgentInstructionComposerExtensionParams): PiAgentInstructionComposerExtension {
  const [anchorPath, setAnchorPath] = useState<string | undefined>(initialAnchor);
  const activeNoteFolderPath = useMemo(
    () => getPiAgentInstructionAnchorFolderPath(currentActiveFile),
    [currentActiveFile]
  );
  const effectiveAnchorPath = enabled ? anchorPath : undefined;

  /**
   * Open the shared folder picker and persist the selected Pi anchor.
   */
  const handleSelectAnchorFolder = useCallback(() => {
    if (!enabled) {
      return;
    }

    void openPiAgentInstructionFolderPicker(app, (folderPath) => {
      setAnchorPath(folderPath);
      restorePiContextEditorFocus(lexicalEditorRef);
    });
  }, [app, enabled, lexicalEditorRef]);

  /**
   * Reuse the active note's parent folder as the explicit Pi anchor.
   */
  const handleUseActiveNoteFolder = useCallback(() => {
    if (!enabled || !activeNoteFolderPath) {
      return;
    }

    setAnchorPath(activeNoteFolderPath);
    restorePiContextEditorFocus(lexicalEditorRef);
  }, [activeNoteFolderPath, enabled, lexicalEditorRef]);

  /**
   * Consume Pi-specific category additions from the shared context typeahead seam.
   *
   * @param category - Shared context category identifier.
   * @param data - Category payload from the shared context UI.
   * @returns `true` when the category belongs to the Pi extension.
   */
  const handleAddToContext = useCallback(
    (category: string, data: unknown): boolean => {
      if (category !== "agentInstructionAnchor") {
        return false;
      }

      if (enabled && typeof data === "string" && data.trim().length > 0) {
        setAnchorPath(data.trim());
      }

      return true;
    },
    [enabled]
  );

  /**
   * Consume Pi-specific context badge removals from the shared context seam.
   *
   * @param category - Shared context category identifier.
   * @returns `true` when the category belongs to the Pi extension.
   */
  const handleRemoveFromContext = useCallback((category: string): boolean => {
    if (category !== "agentInstructionAnchor") {
      return false;
    }

    setAnchorPath(undefined);
    return true;
  }, []);

  const contextMenuControls = useMemo(() => {
    if (!enabled) {
      return null;
    }

    return (
      <>
        <Button
          variant="ghost2"
          size="fit"
          className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted"
          onClick={handleSelectAnchorFolder}
        >
          <span className="tw-px-1 tw-text-sm tw-leading-4">Anchor...</span>
        </Button>
        {activeNoteFolderPath && activeNoteFolderPath !== anchorPath && (
          <Button
            variant="ghost2"
            size="fit"
            className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted"
            onClick={handleUseActiveNoteFolder}
          >
            <span className="tw-px-1 tw-text-sm tw-leading-4">Use note folder</span>
          </Button>
        )}
      </>
    );
  }, [
    activeNoteFolderPath,
    anchorPath,
    enabled,
    handleSelectAnchorFolder,
    handleUseActiveNoteFolder,
  ]);

  const contextBadges = useMemo(() => {
    if (!effectiveAnchorPath) {
      return null;
    }

    return (
      <PiAgentInstructionAnchorBadge
        anchorPath={effectiveAnchorPath}
        onRemove={() => handleRemoveFromContext("agentInstructionAnchor")}
      />
    );
  }, [effectiveAnchorPath, handleRemoveFromContext]);

  return {
    agentInstructionAnchor: effectiveAnchorPath,
    hasContext: Boolean(effectiveAnchorPath),
    contextMenuControls,
    contextBadges,
    handleAddToContext,
    handleRemoveFromContext,
  };
}

/**
 * Determine whether a stored message contains Pi-owned context badges.
 *
 * @param context - Stored message context.
 * @returns `true` when Pi-specific badges should be rendered.
 */
export function hasPiMessageContextBadges(context: ChatMessage["context"]): boolean {
  return Boolean(context?.agentInstructionAnchor);
}

/**
 * Render any Pi-specific message context badges stored on a persisted chat message.
 *
 * @param context - Stored message context.
 * @returns Pi-owned badges for the message context area.
 */
export function renderPiMessageContextBadges(context: ChatMessage["context"]): React.ReactNode {
  if (!context?.agentInstructionAnchor) {
    return null;
  }

  const displayText = getPiAgentInstructionAnchorLabel(context.agentInstructionAnchor);

  return (
    <Tooltip key={`anchor-${context.agentInstructionAnchor}`}>
      <TooltipTrigger asChild>
        <div>
          <PiAgentInstructionAnchorBadge anchorPath={context.agentInstructionAnchor} />
        </div>
      </TooltipTrigger>
      <TooltipContent className="tw-max-w-sm tw-break-words">{displayText}</TooltipContent>
    </Tooltip>
  );
}
