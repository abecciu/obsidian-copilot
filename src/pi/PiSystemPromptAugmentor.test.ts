import type { MessageContext } from "@/types/message";
import { logInfo } from "@/logger";
import { augmentPiSystemPromptForTurn } from "@/pi/PiSystemPromptAugmentor";
import { appendVaultAgentInstructionsToSystemPrompt } from "@/pi/VaultAgentSystemPrompt";
import { TFile } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("@/pi/VaultAgentSystemPrompt", () => ({
  appendVaultAgentInstructionsToSystemPrompt: jest.fn(),
}));

/**
 * Create a minimal file-like object for Pi prompt augmentation tests.
 *
 * @param path - Vault-relative note path.
 * @returns File-like `TFile` test double.
 */
function createNote(path: string): TFile {
  const name = path.split("/").pop() || path;
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    extension: name.split(".").pop() || "",
  } as TFile;
}

describe("augmentPiSystemPromptForTurn", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (appendVaultAgentInstructionsToSystemPrompt as jest.Mock).mockImplementation(
      async ({ basePrompt }: { basePrompt: string }) => ({
        systemPrompt: `${basePrompt}\n\n<vault_agent_instructions />`,
        resolution: {
          anchorPath: "Work/ClientA",
          anchorSource: "explicit-folder",
          explicitAnchorPath: "Work/ClientA",
          appliedPaths: ["AGENTS.md", "Work/ClientA/AGENTS.md"],
          promptBlock: "<vault_agent_instructions />",
        },
      })
    );
  });

  it("passes explicit anchor metadata to the vault instruction helper for Pi turns", async () => {
    const activeFile = createNote("Personal/today.md");
    const mockVault = {} as any;
    const context: MessageContext = {
      notes: [createNote("Work/ClientA/brief.md")],
      urls: [],
      agentInstructionAnchor: "Work/ClientA",
    };

    const result = await augmentPiSystemPromptForTurn({
      agentBackend: "pi",
      enableVaultAgentInstructions: true,
      basePrompt: "Base system prompt",
      vault: mockVault,
      activeFile,
      context,
    });

    expect(result).toBe("Base system prompt\n\n<vault_agent_instructions />");
    expect(appendVaultAgentInstructionsToSystemPrompt).toHaveBeenCalledWith({
      basePrompt: "Base system prompt",
      vault: mockVault,
      enabled: true,
      explicitAnchorPath: "Work/ClientA",
      activeFile,
      attachedNotes: context.notes,
    });
    expect(logInfo).toHaveBeenCalledWith("[PiSystemPromptAugmentor] Vault instruction resolution", {
      anchorPath: "Work/ClientA",
      anchorSource: "explicit-folder",
      explicitAnchorPath: "Work/ClientA",
      appliedPaths: ["AGENTS.md", "Work/ClientA/AGENTS.md"],
      appliedCount: 2,
      fellBackToVaultRoot: false,
      appliedInstructions: true,
    });
  });

  it("returns the original prompt unchanged when Pi mode is inactive", async () => {
    const mockVault = {} as any;
    const result = await augmentPiSystemPromptForTurn({
      agentBackend: "upstream",
      enableVaultAgentInstructions: true,
      basePrompt: "Base system prompt",
      vault: mockVault,
      activeFile: createNote("Work/ClientA/brief.md"),
      context: {
        notes: [],
        urls: [],
        agentInstructionAnchor: "Work/ClientA",
      },
    });

    expect(result).toBe("Base system prompt");
    expect(appendVaultAgentInstructionsToSystemPrompt).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("returns the original prompt unchanged when vault instructions are disabled", async () => {
    const mockVault = {} as any;
    const result = await augmentPiSystemPromptForTurn({
      agentBackend: "pi",
      enableVaultAgentInstructions: false,
      basePrompt: "Base system prompt",
      vault: mockVault,
      activeFile: createNote("Work/ClientA/brief.md"),
      context: {
        notes: [],
        urls: [],
      },
    });

    expect(result).toBe("Base system prompt");
    expect(appendVaultAgentInstructionsToSystemPrompt).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      "[PiSystemPromptAugmentor] Vault agent instructions disabled."
    );
  });

  it("falls back to active-note heuristics when no explicit anchor is provided", async () => {
    const activeFile = createNote("Work/ClientA/brief.md");
    const mockVault = {} as any;

    await augmentPiSystemPromptForTurn({
      agentBackend: "pi",
      enableVaultAgentInstructions: true,
      basePrompt: "Base system prompt",
      vault: mockVault,
      activeFile,
      context: {
        notes: [],
        urls: [],
      },
    });

    expect(appendVaultAgentInstructionsToSystemPrompt).toHaveBeenCalledWith({
      basePrompt: "Base system prompt",
      vault: mockVault,
      enabled: true,
      explicitAnchorPath: undefined,
      activeFile,
      attachedNotes: [],
    });
  });

  it("logs when Pi vault instruction resolution cannot run because no vault is available", async () => {
    const result = await augmentPiSystemPromptForTurn({
      agentBackend: "pi",
      enableVaultAgentInstructions: true,
      basePrompt: "Base system prompt",
      vault: null,
      activeFile: createNote("Work/ClientA/brief.md"),
      context: {
        notes: [],
        urls: [],
      },
    });

    expect(result).toBe("Base system prompt");
    expect(appendVaultAgentInstructionsToSystemPrompt).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      "[PiSystemPromptAugmentor] Vault agent instructions skipped: no vault available."
    );
  });
});
