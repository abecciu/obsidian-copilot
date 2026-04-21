import React, { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App, TFile } from "obsidian";
import {
  getPiAgentInstructionAnchorFolderPath,
  hasPiMessageContextBadges,
  renderPiMessageContextBadges,
  usePiAgentInstructionComposerExtension,
} from "@/pi/PiChatContextExtensions";
import { ChatMessage } from "@/types/message";

jest.mock("@/components/modals/FolderSearchModal", () => ({
  FolderSearchModal: jest.fn().mockImplementation((_app, onSelect) => ({
    open: () => onSelect("Work/ClientA"),
  })),
}));

jest.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * Create a minimal Obsidian file object for Pi context extension tests.
 *
 * @param path - Vault-relative file path.
 * @returns Mocked file object.
 */
function createMockFile(path: string): TFile {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  const extension = path.split(".").pop() ?? "md";

  return {
    path,
    basename,
    extension,
  } as TFile;
}

interface ExtensionHarnessProps {
  enabled?: boolean;
  initialAnchor?: string;
  activeFilePath?: string;
}

/**
 * Minimal harness for exercising the Pi composer extension hook through DOM actions.
 *
 * @param props - Harness configuration.
 * @returns Rendered test harness.
 */
function ExtensionHarness({
  enabled = true,
  initialAnchor,
  activeFilePath,
}: ExtensionHarnessProps) {
  const lexicalEditorRef = useRef<any>({ focus: jest.fn() });
  const extension = usePiAgentInstructionComposerExtension({
    app: {} as App,
    currentActiveFile: activeFilePath ? createMockFile(activeFilePath) : null,
    lexicalEditorRef,
    initialAnchor,
    enabled,
  });

  return (
    <div>
      <div data-testid="anchor-value">{extension.agentInstructionAnchor ?? ""}</div>
      <div data-testid="has-context">{String(extension.hasContext)}</div>
      {extension.contextMenuControls}
      {extension.contextBadges}
      <button
        onClick={() => extension.handleAddToContext("agentInstructionAnchor", "Projects/Alpha")}
      >
        set-anchor
      </button>
      <button
        onClick={() => extension.handleRemoveFromContext("agentInstructionAnchor", undefined)}
      >
        clear-anchor
      </button>
    </div>
  );
}

describe("PiChatContextExtensions", () => {
  describe("getPiAgentInstructionAnchorFolderPath", () => {
    it("returns the parent folder for nested notes", () => {
      expect(getPiAgentInstructionAnchorFolderPath(createMockFile("Projects/Alpha/Plan.md"))).toBe(
        "Projects/Alpha"
      );
    });

    it("maps root-level notes to the vault root anchor", () => {
      expect(getPiAgentInstructionAnchorFolderPath(createMockFile("Inbox.md"))).toBe("/");
    });
  });

  describe("usePiAgentInstructionComposerExtension", () => {
    it("hides Pi-specific controls and effective context when disabled", () => {
      render(<ExtensionHarness enabled={false} initialAnchor="Work/ClientA" />);

      expect(screen.getByTestId("anchor-value").textContent).toBe("");
      expect(screen.getByTestId("has-context").textContent).toBe("false");
      expect(screen.queryByText("Anchor...")).toBeNull();
      expect(screen.queryByText("Work/ClientA")).toBeNull();
    });

    it("handles Pi-specific context add/remove actions through the shared seam", () => {
      render(<ExtensionHarness enabled={true} />);

      fireEvent.click(screen.getByText("set-anchor"));
      expect(screen.getByTestId("anchor-value").textContent).toBe("Projects/Alpha");
      expect(screen.getByTestId("has-context").textContent).toBe("true");

      fireEvent.click(screen.getByText("clear-anchor"));
      expect(screen.getByTestId("anchor-value").textContent).toBe("");
      expect(screen.getByTestId("has-context").textContent).toBe("false");
    });

    it("wires the folder picker and active note shortcut into Pi-owned controls", async () => {
      render(<ExtensionHarness enabled={true} activeFilePath="Projects/Today.md" />);

      fireEvent.click(screen.getByText("Anchor..."));
      await waitFor(() => {
        expect(screen.getByTestId("anchor-value").textContent).toBe("Work/ClientA");
      });

      fireEvent.click(screen.getByText("Use note folder"));
      expect(screen.getByTestId("anchor-value").textContent).toBe("Projects");
    });
  });

  describe("Pi message context rendering", () => {
    it("renders the persisted anchor badge through the Pi-owned message seam", () => {
      const context = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
        agentInstructionAnchor: "/",
      } as ChatMessage["context"];

      expect(hasPiMessageContextBadges(context)).toBe(true);
      render(<>{renderPiMessageContextBadges(context)}</>);

      expect(screen.getAllByText("Vault root").length).toBeGreaterThan(0);
      expect(screen.getByText("Anchor")).not.toBeNull();
    });

    it("reports no Pi message badges when no anchor is stored", () => {
      const context = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      } as ChatMessage["context"];

      expect(hasPiMessageContextBadges(context)).toBe(false);
      expect(renderPiMessageContextBadges(context)).toBeNull();
    });
  });
});
