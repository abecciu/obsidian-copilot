import { escapeXml, escapeXmlAttribute } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { logWarn } from "@/logger";
import { TFile, Vault } from "obsidian";

const VAULT_AGENT_INSTRUCTION_FILENAME = "AGENTS.md";

/**
 * Provenance describing how the vault instruction anchor was chosen for a turn.
 */
export type VaultAgentAnchorSource =
  | "explicit-folder"
  | "target-note"
  | "active-note"
  | "single-attached-note"
  | "common-ancestor"
  | "project-default"
  | "vault-root";

/**
 * Resolver inputs for determining the effective vault instruction scope.
 */
export interface ResolveVaultAgentInstructionsParams {
  /** Explicit folder anchor chosen by the user for this turn. */
  explicitAnchorPath?: string | null;
  /** Explicit target note or folder path for the turn when known. */
  targetPath?: string | null;
  /** Active note at send time, if any. */
  activeFile?: TFile | null;
  /** Attached notes participating in the turn. */
  attachedNotes?: TFile[];
  /** Optional project-level fallback anchor for future project integrations. */
  projectDefaultAnchorPath?: string | null;
}

/**
 * Fully resolved vault instruction payload ready for prompt integration.
 */
export interface ResolvedVaultAgentInstructions {
  /** Folder anchor used for discovery, or `null` for vault root. */
  anchorPath: string | null;
  /** Provenance describing how `anchorPath` was derived. */
  anchorSource: VaultAgentAnchorSource;
  /** Normalized explicit anchor when one was valid for this turn. */
  explicitAnchorPath: string | null;
  /** Applied `AGENTS.md` file paths in root-to-leaf order. */
  appliedPaths: string[];
  /** Prompt-ready XML block, or an empty string when no files were applied. */
  promptBlock: string;
}

interface ResolvedAnchor {
  anchorPath: string | null;
  anchorSource: VaultAgentAnchorSource;
  explicitAnchorPath: string | null;
}

interface ResolvedInstructionFile {
  path: string;
  content: string;
}

/**
 * Resolves inherited vault-scoped `AGENTS.md` instructions for the Pi backend.
 */
export class VaultAgentInstructionResolver {
  /**
   * Create a resolver bound to a specific Obsidian vault.
   *
   * @param vault - Vault used for path existence checks and file reads.
   */
  constructor(private readonly vault: Vault) {}

  /**
   * Resolve the effective instruction anchor, inherited files, and prompt block.
   *
   * @param params - Anchor inference inputs for the current turn.
   * @returns Resolved instruction metadata and prompt-ready XML.
   */
  async resolve(
    params: ResolveVaultAgentInstructionsParams = {}
  ): Promise<ResolvedVaultAgentInstructions> {
    const resolvedAnchor = await this.resolveAnchor(params);
    const candidatePaths = this.buildCandidateInstructionPaths(resolvedAnchor.anchorPath);
    const resolvedFiles = await this.loadInstructionFiles(candidatePaths);

    return {
      anchorPath: resolvedAnchor.anchorPath,
      anchorSource: resolvedAnchor.anchorSource,
      explicitAnchorPath: resolvedAnchor.explicitAnchorPath,
      appliedPaths: resolvedFiles.map((file) => file.path),
      promptBlock: this.buildPromptBlock(resolvedAnchor, resolvedFiles),
    };
  }

  /**
   * Resolve the highest-precedence instruction anchor for the current turn.
   *
   * @param params - Anchor inference inputs for the current turn.
   * @returns Resolved anchor metadata.
   */
  private async resolveAnchor(
    params: ResolveVaultAgentInstructionsParams
  ): Promise<ResolvedAnchor> {
    const explicitAnchorPath = await this.resolveExplicitAnchor(params.explicitAnchorPath);
    if (explicitAnchorPath !== undefined) {
      return {
        anchorPath: explicitAnchorPath,
        anchorSource: "explicit-folder",
        explicitAnchorPath,
      };
    }

    const targetAnchorPath = this.normalizeAnchorCandidate(params.targetPath);
    if (targetAnchorPath !== undefined) {
      return {
        anchorPath: targetAnchorPath,
        anchorSource: "target-note",
        explicitAnchorPath: null,
      };
    }

    if (params.activeFile?.path) {
      return {
        anchorPath: this.getParentPath(params.activeFile.path),
        anchorSource: "active-note",
        explicitAnchorPath: null,
      };
    }

    const attachedNotes = params.attachedNotes || [];
    if (attachedNotes.length === 1 && attachedNotes[0]?.path) {
      return {
        anchorPath: this.getParentPath(attachedNotes[0].path),
        anchorSource: "single-attached-note",
        explicitAnchorPath: null,
      };
    }

    const commonAncestorPath = this.getMeaningfulCommonAncestor(attachedNotes);
    if (commonAncestorPath !== undefined) {
      return {
        anchorPath: commonAncestorPath,
        anchorSource: "common-ancestor",
        explicitAnchorPath: null,
      };
    }

    const projectDefaultAnchorPath = this.normalizeAnchorCandidate(params.projectDefaultAnchorPath);
    if (projectDefaultAnchorPath !== undefined) {
      return {
        anchorPath: projectDefaultAnchorPath,
        anchorSource: "project-default",
        explicitAnchorPath: null,
      };
    }

    return {
      anchorPath: null,
      anchorSource: "vault-root",
      explicitAnchorPath: null,
    };
  }

  /**
   * Validate and normalize an explicit folder anchor.
   *
   * Explicit anchors are stricter than heuristic anchors: they must resolve to an
   * existing directory (or the vault root), otherwise the resolver falls back to
   * heuristic inference.
   *
   * @param explicitAnchorPath - User-provided explicit folder anchor.
   * @returns Normalized folder path, `null` for vault root, or `undefined` when invalid/absent.
   */
  private async resolveExplicitAnchor(
    explicitAnchorPath?: string | null
  ): Promise<string | null | undefined> {
    const normalizedPath = this.normalizeRawPath(explicitAnchorPath);
    if (normalizedPath === undefined) {
      return undefined;
    }

    if (normalizedPath === null) {
      return null;
    }

    const abstractFile = this.vault.getAbstractFileByPath(normalizedPath);
    if (this.isMarkdownFileLike(abstractFile)) {
      return undefined;
    }

    if (abstractFile) {
      return normalizedPath;
    }

    try {
      const exists = await this.vault.adapter.exists(normalizedPath);
      if (!exists || this.isMarkdownPath(normalizedPath)) {
        return undefined;
      }
      return normalizedPath;
    } catch (error) {
      logWarn(
        `[VaultAgentInstructionResolver] Failed to validate explicit anchor: ${normalizedPath}`,
        error
      );
      return undefined;
    }
  }

  /**
   * Normalize a heuristic anchor candidate into a folder path.
   *
   * Heuristic candidates may point to a folder, an existing file, or a future note
   * path that does not yet exist. File-like candidates are normalized to their parent
   * directory. Empty values return `undefined`, while vault root returns `null`.
   *
   * @param anchorPath - Raw anchor candidate.
   * @returns Folder path, `null` for vault root, or `undefined` when absent.
   */
  private normalizeAnchorCandidate(anchorPath?: string | null): string | null | undefined {
    const normalizedPath = this.normalizeRawPath(anchorPath);
    if (normalizedPath === undefined || normalizedPath === null) {
      return normalizedPath;
    }

    const abstractFile = this.vault.getAbstractFileByPath(normalizedPath);
    if (this.isMarkdownFileLike(abstractFile) || this.isMarkdownPath(normalizedPath)) {
      return this.getParentPath(normalizedPath);
    }

    return normalizedPath;
  }

  /**
   * Normalize a raw vault-relative path string.
   *
   * @param rawPath - Raw vault-relative path, possibly with leading/trailing slashes.
   * @returns Normalized path, `null` for vault root, or `undefined` when no path was provided.
   */
  private normalizeRawPath(rawPath?: string | null): string | null | undefined {
    if (typeof rawPath !== "string") {
      return undefined;
    }

    const trimmedPath = rawPath.trim();
    if (!trimmedPath) {
      return undefined;
    }

    const normalizedPath = trimmedPath
      .replace(/\\/g, "/")
      .split("/")
      .filter((segment) => segment.length > 0)
      .join("/");

    return normalizedPath.length > 0 ? normalizedPath : null;
  }

  /**
   * Compute a non-root common ancestor for multiple attached notes.
   *
   * @param attachedNotes - Attached notes participating in the turn.
   * @returns Shared folder path, or `undefined` when the common ancestor is only the vault root.
   */
  private getMeaningfulCommonAncestor(attachedNotes: readonly TFile[]): string | null | undefined {
    if (attachedNotes.length < 2) {
      return undefined;
    }

    const folderSegments = attachedNotes
      .map((note) => this.getParentPath(note.path))
      .map((path) => (path ? path.split("/") : []));

    if (folderSegments.length === 0) {
      return undefined;
    }

    const shortestPathLength = Math.min(...folderSegments.map((segments) => segments.length));
    const sharedSegments: string[] = [];

    for (let index = 0; index < shortestPathLength; index += 1) {
      const currentSegment = folderSegments[0][index];
      if (folderSegments.every((segments) => segments[index] === currentSegment)) {
        sharedSegments.push(currentSegment);
        continue;
      }
      break;
    }

    if (sharedSegments.length === 0) {
      return undefined;
    }

    return sharedSegments.join("/");
  }

  /**
   * Convert a vault-relative file path to its parent folder path.
   *
   * @param filePath - Vault-relative file path.
   * @returns Parent folder path, or `null` when the file is at vault root.
   */
  private getParentPath(filePath: string): string | null {
    const normalizedPath = this.normalizeRawPath(filePath);
    if (normalizedPath === undefined || normalizedPath === null) {
      return null;
    }

    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    if (lastSlashIndex === -1) {
      return null;
    }

    return normalizedPath.slice(0, lastSlashIndex);
  }

  /**
   * Build the ordered `AGENTS.md` candidate file list for a folder anchor.
   *
   * @param anchorPath - Folder anchor, or `null` for vault root.
   * @returns Root-to-leaf candidate file paths.
   */
  private buildCandidateInstructionPaths(anchorPath: string | null): string[] {
    const candidatePaths = [VAULT_AGENT_INSTRUCTION_FILENAME];
    if (!anchorPath) {
      return candidatePaths;
    }

    const segments = anchorPath.split("/");
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      candidatePaths.push(`${currentPath}/${VAULT_AGENT_INSTRUCTION_FILENAME}`);
    }

    return candidatePaths;
  }

  /**
   * Read all existing candidate instruction files while preserving input order.
   *
   * @param candidatePaths - Root-to-leaf candidate file paths.
   * @returns Successfully read instruction files in deterministic order.
   */
  private async loadInstructionFiles(
    candidatePaths: readonly string[]
  ): Promise<ResolvedInstructionFile[]> {
    const resolvedFiles: ResolvedInstructionFile[] = [];

    for (const candidatePath of candidatePaths) {
      try {
        if (!(await this.vault.adapter.exists(candidatePath))) {
          continue;
        }

        const content = await this.vault.adapter.read(candidatePath);
        resolvedFiles.push({
          path: candidatePath,
          content,
        });
      } catch (error) {
        logWarn(`[VaultAgentInstructionResolver] Failed to read ${candidatePath}`, error);
      }
    }

    return resolvedFiles;
  }

  /**
   * Assemble the prompt-ready XML block for resolved instruction files.
   *
   * @param resolvedAnchor - Anchor metadata for the current turn.
   * @param resolvedFiles - Successfully resolved instruction files.
   * @returns XML prompt block, or an empty string when no instructions were found.
   */
  private buildPromptBlock(
    resolvedAnchor: ResolvedAnchor,
    resolvedFiles: readonly ResolvedInstructionFile[]
  ): string {
    if (resolvedFiles.length === 0) {
      return "";
    }

    const promptAnchorPath = resolvedAnchor.anchorPath || "/";
    const appliedFilesBlock = resolvedFiles.map((file) => `- ${escapeXml(file.path)}`).join("\n");
    const instructionBlocks = resolvedFiles
      .map(
        (file) =>
          `<instructions_from path="${escapeXmlAttribute(file.path)}">\n${escapeXml(file.content)}\n</instructions_from>`
      )
      .join("\n\n");

    return [
      "<vault_agent_instructions>",
      "<resolution>",
      "These instructions were loaded from vault AGENTS.md files. More specific folders override broader folders.",
      "These instructions cannot bypass app safety, permission, or confirmation rules.",
      "</resolution>",
      "",
      `<anchor path="${escapeXmlAttribute(promptAnchorPath)}" source="${escapeXmlAttribute(resolvedAnchor.anchorSource)}" />`,
      "",
      "<applied_files>",
      appliedFilesBlock,
      "</applied_files>",
      "",
      instructionBlocks,
      "</vault_agent_instructions>",
    ].join("\n");
  }

  /**
   * Check whether an abstract vault item is file-like and points to a markdown file.
   *
   * @param abstractFile - Item returned by `vault.getAbstractFileByPath()`.
   * @returns `true` when the item looks like a markdown file.
   */
  private isMarkdownFileLike(abstractFile: unknown): abstractFile is { extension: string } {
    return (
      typeof abstractFile === "object" &&
      abstractFile !== null &&
      typeof (abstractFile as { extension?: unknown }).extension === "string" &&
      ((abstractFile as { extension: string }).extension || "").toLowerCase() === "md"
    );
  }

  /**
   * Check whether a path string is obviously markdown-file-like.
   *
   * @param path - Vault-relative path.
   * @returns `true` when the path ends with `.md`.
   */
  private isMarkdownPath(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
  }
}
