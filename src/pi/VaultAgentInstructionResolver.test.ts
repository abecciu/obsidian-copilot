import { logWarn } from "@/logger";
import {
  VaultAgentInstructionResolver,
  type ResolvedVaultAgentInstructions,
} from "@/pi/VaultAgentInstructionResolver";
import { TFile, Vault } from "obsidian";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

type MockVaultEntry = string | Error;

/**
 * Create a minimal file-like object for resolver tests.
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

describe("VaultAgentInstructionResolver", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Resolve instructions against a mock vault in a single step.
   *
   * @param entries - Instruction files keyed by path.
   * @param params - Resolver parameters for the turn.
   * @returns Resolved instruction payload.
   */
  async function resolveWithEntries(
    entries: Record<string, MockVaultEntry>,
    params: Parameters<VaultAgentInstructionResolver["resolve"]>[0]
  ): Promise<ResolvedVaultAgentInstructions> {
    const resolver = new VaultAgentInstructionResolver(createMockVault(entries));
    return resolver.resolve(params);
  }

  it("resolves vault-root instructions for a root note and escapes prompt content", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": 'Use <xml> & stay "safe"',
      },
      {
        activeFile: createNote("Daily.md"),
      }
    );

    expect(result.anchorPath).toBeNull();
    expect(result.anchorSource).toBe("active-note");
    expect(result.explicitAnchorPath).toBeNull();
    expect(result.appliedPaths).toEqual(["AGENTS.md"]);
    expect(result.promptBlock).toContain('<anchor path="/" source="active-note" />');
    expect(result.promptBlock).toContain("&lt;xml&gt; &amp; stay &quot;safe&quot;");
  });

  it("discovers inherited instructions in root-to-leaf order for a file target path", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Work/AGENTS.md": "Work guidance",
        "Work/ClientA/AGENTS.md": "Client guidance",
        "Work/ClientA/specs/AGENTS.md": "Specs guidance",
      },
      {
        targetPath: "Work/ClientA/specs/roadmap.md",
      }
    );

    expect(result.anchorPath).toBe("Work/ClientA/specs");
    expect(result.anchorSource).toBe("target-note");
    expect(result.appliedPaths).toEqual([
      "AGENTS.md",
      "Work/AGENTS.md",
      "Work/ClientA/AGENTS.md",
      "Work/ClientA/specs/AGENTS.md",
    ]);
    expect(result.promptBlock.indexOf("Global guidance")).toBeLessThan(
      result.promptBlock.indexOf("Work guidance")
    );
    expect(result.promptBlock.indexOf("Work guidance")).toBeLessThan(
      result.promptBlock.indexOf("Client guidance")
    );
    expect(result.promptBlock.indexOf("Client guidance")).toBeLessThan(
      result.promptBlock.indexOf("Specs guidance")
    );
  });

  it("prefers a valid explicit folder anchor over active-note heuristics", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Work/AGENTS.md": "Work guidance",
        "Personal/Journal/AGENTS.md": "Journal guidance",
      },
      {
        explicitAnchorPath: "Personal/Journal",
        activeFile: createNote("Work/ClientA/meeting.md"),
      }
    );

    expect(result.anchorPath).toBe("Personal/Journal");
    expect(result.anchorSource).toBe("explicit-folder");
    expect(result.explicitAnchorPath).toBe("Personal/Journal");
    expect(result.appliedPaths).toEqual(["AGENTS.md", "Personal/Journal/AGENTS.md"]);
    expect(result.promptBlock).not.toContain("Work/AGENTS.md");
  });

  it("falls back to active-note inference when the explicit anchor is invalid", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Personal/Journal/AGENTS.md": "Journal guidance",
      },
      {
        explicitAnchorPath: "Missing/Folder",
        activeFile: createNote("Personal/Journal/entry.md"),
      }
    );

    expect(result.anchorPath).toBe("Personal/Journal");
    expect(result.anchorSource).toBe("active-note");
    expect(result.explicitAnchorPath).toBeNull();
    expect(result.appliedPaths).toEqual(["AGENTS.md", "Personal/Journal/AGENTS.md"]);
  });

  it("uses the single attached note when no higher-precedence anchor exists", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Work/ClientA/AGENTS.md": "Client guidance",
      },
      {
        attachedNotes: [createNote("Work/ClientA/brief.md")],
      }
    );

    expect(result.anchorPath).toBe("Work/ClientA");
    expect(result.anchorSource).toBe("single-attached-note");
    expect(result.appliedPaths).toEqual(["AGENTS.md", "Work/ClientA/AGENTS.md"]);
  });

  it("uses a non-root common ancestor for multiple attached notes", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Work/AGENTS.md": "Work guidance",
        "Work/ClientA/AGENTS.md": "Client guidance",
      },
      {
        attachedNotes: [createNote("Work/ClientA/one.md"), createNote("Work/ClientA/two.md")],
      }
    );

    expect(result.anchorPath).toBe("Work/ClientA");
    expect(result.anchorSource).toBe("common-ancestor");
    expect(result.appliedPaths).toEqual(["AGENTS.md", "Work/AGENTS.md", "Work/ClientA/AGENTS.md"]);
  });

  it("falls back to vault root when the only shared ancestor is the vault root", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
      },
      {
        attachedNotes: [createNote("Work/one.md"), createNote("Personal/two.md")],
      }
    );

    expect(result.anchorPath).toBeNull();
    expect(result.anchorSource).toBe("vault-root");
    expect(result.appliedPaths).toEqual(["AGENTS.md"]);
  });

  it("returns an empty prompt block when no instruction files are found", async () => {
    const result = await resolveWithEntries(
      {},
      {
        targetPath: "Work/ClientA/roadmap.md",
      }
    );

    expect(result.anchorPath).toBe("Work/ClientA");
    expect(result.anchorSource).toBe("target-note");
    expect(result.appliedPaths).toEqual([]);
    expect(result.promptBlock).toBe("");
  });

  it("skips unreadable instruction files without failing the resolution", async () => {
    const result = await resolveWithEntries(
      {
        "AGENTS.md": "Global guidance",
        "Work/AGENTS.md": new Error("boom"),
      },
      {
        activeFile: createNote("Work/task.md"),
      }
    );

    expect(result.appliedPaths).toEqual(["AGENTS.md"]);
    expect(result.promptBlock).toContain("Global guidance");
    expect(logWarn).toHaveBeenCalledWith(
      "[VaultAgentInstructionResolver] Failed to read Work/AGENTS.md",
      expect.any(Error)
    );
  });
});
