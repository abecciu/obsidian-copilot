import { TFile, Vault } from "obsidian";
import { appendVaultAgentInstructionsToSystemPrompt } from "@/pi/VaultAgentSystemPrompt";

type MockVaultEntry = string | Error;

/**
 * Create a minimal file-like object for vault instruction prompt tests.
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

/**
 * Build a vault test double that supports folder existence, adapter reads, and file lookup.
 *
 * @param entries - Instruction file contents keyed by vault-relative path.
 * @returns Vault-like object with the APIs used by the resolver.
 */
function createMockVault(entries: Record<string, MockVaultEntry>): Vault {
  const folderPaths = new Set<string>();

  Object.keys(entries).forEach((path) => {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      folderPaths.add(segments.slice(0, index).join("/"));
    }
  });

  return {
    getAbstractFileByPath: jest.fn((path: string) => {
      if (Object.prototype.hasOwnProperty.call(entries, path)) {
        return createNote(path);
      }

      if (folderPaths.has(path)) {
        return { path, children: [] };
      }

      return null;
    }),
    adapter: {
      exists: jest.fn(async (path: string) => {
        return Object.prototype.hasOwnProperty.call(entries, path) || folderPaths.has(path);
      }),
      read: jest.fn(async (path: string) => {
        const entry = entries[path];
        if (entry instanceof Error) {
          throw entry;
        }
        return entry;
      }),
    },
  } as unknown as Vault;
}

describe("appendVaultAgentInstructionsToSystemPrompt", () => {
  it("appends resolved instructions after the base system prompt", async () => {
    const result = await appendVaultAgentInstructionsToSystemPrompt({
      basePrompt: "Base system prompt",
      vault: createMockVault({
        "AGENTS.md": "Global guidance",
        "Work/AGENTS.md": "Work guidance",
      }),
      explicitAnchorPath: "Work",
    });

    expect(result.systemPrompt).toContain("Base system prompt");
    expect(result.systemPrompt).toContain("<vault_agent_instructions>");
    expect(result.systemPrompt).toContain('<anchor path="Work" source="explicit-folder" />');
    expect(result.systemPrompt.indexOf("Base system prompt")).toBeLessThan(
      result.systemPrompt.indexOf("<vault_agent_instructions>")
    );
    expect(result.resolution?.appliedPaths).toEqual(["AGENTS.md", "Work/AGENTS.md"]);
  });

  it("returns the base prompt unchanged when vault instructions are disabled", async () => {
    const result = await appendVaultAgentInstructionsToSystemPrompt({
      basePrompt: "Base system prompt",
      vault: createMockVault({
        "AGENTS.md": "Global guidance",
      }),
      enabled: false,
      activeFile: createNote("Work/note.md"),
    });

    expect(result.systemPrompt).toBe("Base system prompt");
    expect(result.resolution).toBeNull();
  });

  it("returns the base prompt unchanged when no AGENTS files are found", async () => {
    const result = await appendVaultAgentInstructionsToSystemPrompt({
      basePrompt: "Base system prompt",
      vault: createMockVault({}),
      activeFile: createNote("Work/note.md"),
    });

    expect(result.systemPrompt).toBe("Base system prompt");
    expect(result.resolution?.promptBlock).toBe("");
    expect(result.resolution?.anchorPath).toBe("Work");
    expect(result.resolution?.anchorSource).toBe("active-note");
  });
});
