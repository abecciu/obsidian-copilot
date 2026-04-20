import { ChainType } from "@/chainFactory";
import { getSettings, type CopilotSettings } from "@/settings/model";

/**
 * Returns true when the fork-owned pi backend is active.
 */
export function isPiBackendActive(
  settings: Pick<CopilotSettings, "agentBackend"> = getSettings()
): boolean {
  return settings.agentBackend === "pi";
}

/**
 * Returns true when the upstream Copilot runtime is active.
 */
export function isUpstreamBackendActive(
  settings: Pick<CopilotSettings, "agentBackend"> = getSettings()
): boolean {
  return settings.agentBackend === "upstream";
}

/**
 * Determines whether license checks should be bypassed.
 */
export function shouldBypassLicenseChecks(
  settings: Pick<CopilotSettings, "agentBackend"> = getSettings()
): boolean {
  return isPiBackendActive(settings);
}

/**
 * Chain types that historically exposed premium chat surfaces.
 */
export function isPremiumChainType(chainType: ChainType): boolean {
  return chainType === ChainType.COPILOT_PLUS_CHAIN || chainType === ChainType.PROJECT_CHAIN;
}

/**
 * Whether a chain should have premium-local context features, such as URL and PDF handling.
 */
export function hasPremiumContextAccess(
  chainType: ChainType,
  settings: Pick<CopilotSettings, "agentBackend"> = getSettings()
): boolean {
  return shouldBypassLicenseChecks(settings) || isPremiumChainType(chainType);
}
