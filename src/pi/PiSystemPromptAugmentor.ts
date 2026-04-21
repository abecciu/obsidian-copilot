import type { AgentBackend } from "@/settings/model";
import type { MessageContext } from "@/types/message";
import { logInfo } from "@/logger";
import { appendVaultAgentInstructionsToSystemPrompt } from "@/pi/VaultAgentSystemPrompt";
import type { TFile, Vault } from "obsidian";

/**
 * Inputs for Pi-specific system prompt augmentation.
 */
export interface AugmentPiSystemPromptForTurnParams {
  /** Current backend selection. */
  agentBackend?: AgentBackend | null;
  /** Feature flag controlling vault-scoped `AGENTS.md` application. */
  enableVaultAgentInstructions?: boolean;
  /** Base system prompt prior to Pi-specific augmentation. */
  basePrompt: string;
  /** Vault used to resolve `AGENTS.md` files. */
  vault?: Vault | null;
  /** Active note for heuristic anchor inference. */
  activeFile?: TFile | null;
  /** Optional message context carrying explicit anchor metadata and attached notes. */
  context?: MessageContext;
}

/**
 * Apply vault-scoped `AGENTS.md` instructions for Pi turns when the backend and
 * feature flag are both active. Non-Pi callers receive the original prompt unchanged.
 *
 * @param params - Pi prompt augmentation inputs for the current turn.
 * @returns Final system prompt for the turn.
 */
export async function augmentPiSystemPromptForTurn(
  params: AugmentPiSystemPromptForTurnParams
): Promise<string> {
  const {
    agentBackend,
    enableVaultAgentInstructions = true,
    basePrompt,
    vault,
    activeFile,
    context,
  } = params;

  if (agentBackend !== "pi" || !enableVaultAgentInstructions) {
    if (agentBackend === "pi" && !enableVaultAgentInstructions) {
      logInfo("[PiSystemPromptAugmentor] Vault agent instructions disabled.");
    }
    return basePrompt;
  }

  if (!vault) {
    logInfo("[PiSystemPromptAugmentor] Vault agent instructions skipped: no vault available.");
    return basePrompt;
  }

  const result = await appendVaultAgentInstructionsToSystemPrompt({
    basePrompt,
    vault,
    enabled: true,
    explicitAnchorPath: context?.agentInstructionAnchor,
    activeFile,
    attachedNotes: context?.notes || [],
  });

  if (result.resolution) {
    logInfo("[PiSystemPromptAugmentor] Vault instruction resolution", {
      anchorPath: result.resolution.anchorPath ?? "/",
      anchorSource: result.resolution.anchorSource,
      explicitAnchorPath: result.resolution.explicitAnchorPath,
      appliedPaths: result.resolution.appliedPaths,
      appliedCount: result.resolution.appliedPaths.length,
      fellBackToVaultRoot: result.resolution.anchorPath === null,
      appliedInstructions: result.resolution.promptBlock.length > 0,
    });
  }

  return result.systemPrompt;
}
