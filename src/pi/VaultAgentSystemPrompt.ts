import { Vault } from "obsidian";
import { VaultAgentInstructionResolver } from "@/pi/VaultAgentInstructionResolver";
import type {
  ResolveVaultAgentInstructionsParams,
  ResolvedVaultAgentInstructions,
} from "@/pi/VaultAgentInstructionResolver";

/**
 * Inputs for augmenting a system prompt with vault-scoped `AGENTS.md` instructions.
 */
export interface AppendVaultAgentInstructionsToSystemPromptParams
  extends ResolveVaultAgentInstructionsParams {
  /** Existing system prompt content. */
  basePrompt: string;
  /** Vault used to resolve `AGENTS.md` files. */
  vault?: Vault | null;
  /** Whether vault instruction application is enabled. */
  enabled?: boolean;
}

/**
 * Output from system-prompt augmentation.
 */
export interface AppendVaultAgentInstructionsToSystemPromptResult {
  /** Final system prompt after optional vault-instruction augmentation. */
  systemPrompt: string;
  /** Resolution metadata for the current turn, if resolution ran. */
  resolution: ResolvedVaultAgentInstructions | null;
}

/**
 * Append resolved vault-scoped `AGENTS.md` instructions to a base system prompt.
 *
 * This is the shared integration seam used by both main chat and lightweight
 * Pi streaming surfaces such as Quick Ask and custom commands.
 *
 * @param params - Base prompt plus vault-instruction resolution inputs.
 * @returns Final system prompt and resolution metadata.
 */
export async function appendVaultAgentInstructionsToSystemPrompt(
  params: AppendVaultAgentInstructionsToSystemPromptParams
): Promise<AppendVaultAgentInstructionsToSystemPromptResult> {
  const { basePrompt, vault, enabled = true, ...resolverParams } = params;

  if (!enabled || !vault) {
    return {
      systemPrompt: basePrompt,
      resolution: null,
    };
  }

  const resolver = new VaultAgentInstructionResolver(vault);
  const resolution = await resolver.resolve(resolverParams);

  if (!resolution.promptBlock) {
    return {
      systemPrompt: basePrompt,
      resolution,
    };
  }

  const trimmedBasePrompt = basePrompt.trimEnd();
  const systemPrompt = trimmedBasePrompt
    ? `${trimmedBasePrompt}\n\n${resolution.promptBlock}`
    : resolution.promptBlock;

  return {
    systemPrompt,
    resolution,
  };
}
