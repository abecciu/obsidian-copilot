import { ChainType } from "@/chainFactory";
import { deduplicateSources } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { getSettings } from "@/settings/model";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import { BaseChainRunner } from "@/LLMProviders/chainRunner/BaseChainRunner";
import { buildPiConversation } from "./PiMessageAdapter";
import { resolvePiApiKey, resolvePiModel } from "./PiModelResolver";
import { getPiTools, type PiToolDetails, type PiToolSource } from "./PiToolRegistry";
import { ToolManager } from "@/tools/toolManager";
import { localSearchTool } from "@/tools/SearchTools";
import { selfHostWebSearch } from "@/LLMProviders/selfHostServices";

/**
 * Pi-backed chain runner that reuses Copilot's existing chat shell.
 */
export class PiAgentChainRunner extends BaseChainRunner {
  constructor(
    chainManager: any,
    private readonly chainType: ChainType
  ) {
    super(chainManager);
  }

  /**
   * Execute the configured pi backend and stream the response into the current chat UI.
   */
  async run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
      updateLoadingMessage?: (message: string) => void;
    }
  ): Promise<string> {
    try {
      const model = resolvePiModel();
      const apiKey = await resolvePiApiKey();
      const memoryVariables = await this.chainManager.memoryManager
        .getMemory()
        .loadMemoryVariables({});
      const rawHistory = memoryVariables.history || [];
      const injectedContext = await this.buildInjectedContext(
        userMessage,
        options.updateLoadingMessage
      );
      const conversation = buildPiConversation({
        userMessage,
        rawHistory,
        model,
        injectedContextBlocks: injectedContext.blocks,
      });

      let streamingText = "";
      let latestResponseMetadata: ResponseMetadata | undefined;
      const collectedSources = [...injectedContext.sources];
      const agent = new Agent({
        initialState: {
          model,
          systemPrompt: conversation.systemPrompt,
          thinkingLevel: getSettings().piAgent.thinkingLevel,
          tools: this.getActivePiTools(),
          messages: conversation.history,
        },
        getApiKey: async () => apiKey,
      });

      const unsubscribe = agent.subscribe(async (event) => {
        this.handleAgentEvent(event, updateCurrentAiMessage, {
          onSources: (sources) => {
            collectedSources.push(...sources);
          },
          onText: (text) => {
            streamingText = text;
          },
          onMetadata: (metadata) => {
            latestResponseMetadata = metadata;
          },
        });
      });
      const abortHandler = () => agent.abort();
      abortController.signal.addEventListener("abort", abortHandler);

      try {
        await agent.prompt(conversation.currentUser);
      } finally {
        unsubscribe();
        abortController.signal.removeEventListener("abort", abortHandler);
      }

      const finalResponse = streamingText || this.getFinalAssistantText(agent.state.messages);
      return await this.handleResponse(
        finalResponse,
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage,
        deduplicateSources(collectedSources),
        finalResponse,
        latestResponseMetadata
      );
    } catch (error) {
      let formattedError = "";
      await this.handleError(error, (message) => {
        formattedError = message;
        updateCurrentAiMessage(message);
      });

      return await this.handleResponse(
        formattedError || "Pi agent request failed.",
        userMessage,
        abortController,
        addMessage,
        updateCurrentAiMessage
      );
    }
  }

  /**
   * Choose which pi tools are active for the current chain.
   */
  private getActivePiTools() {
    if (
      this.chainType === ChainType.COPILOT_PLUS_CHAIN ||
      this.chainType === ChainType.PROJECT_CHAIN
    ) {
      return getPiTools();
    }
    return [];
  }

  /**
   * Handle streamed pi agent events and update the Copilot UI state.
   */
  private handleAgentEvent(
    event: AgentEvent,
    updateCurrentAiMessage: (message: string) => void,
    callbacks: {
      onSources: (sources: PiToolSource[]) => void;
      onText: (text: string) => void;
      onMetadata: (metadata: ResponseMetadata) => void;
    }
  ): void {
    if (event.type === "message_update" && event.message.role === "assistant") {
      const text = this.extractAssistantText(event.message);
      callbacks.onText(text);
      updateCurrentAiMessage(text);
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const text = this.extractAssistantText(event.message);
      callbacks.onText(text);
      callbacks.onMetadata(
        this.buildResponseMetadata(event.message.stopReason, event.message.usage)
      );
      updateCurrentAiMessage(text);
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolSources = (event.result as { details?: PiToolDetails })?.details?.sources || [];
      callbacks.onSources(toolSources);
      const toolStatus = `_Running ${event.toolName}..._`;
      updateCurrentAiMessage(toolStatus);
    }
  }

  /**
   * Build any forced context blocks for Vault QA and explicit `@` tool markers.
   */
  private async buildInjectedContext(
    userMessage: ChatMessage,
    updateLoadingMessage?: (message: string) => void
  ): Promise<{ blocks: string[]; sources: PiToolSource[] }> {
    const originalText = userMessage.originalMessage || userMessage.message;
    const blocks: string[] = [];
    const sources: PiToolSource[] = [];
    const shouldSearchVault =
      this.chainType === ChainType.VAULT_QA_CHAIN || /(^|\s)@vault\b/i.test(originalText);
    const shouldSearchWeb = /(^|\s)@web(search)?\b/i.test(originalText);

    if (shouldSearchVault) {
      updateLoadingMessage?.("Searching the vault...");
      const localSearchResult = await ToolManager.callTool(localSearchTool, {
        query: this.stripToolMarkers(originalText),
        salientTerms: this.extractSalientTerms(originalText),
      });
      blocks.push(`## Vault Search Results\n\n${this.stringifyToolResult(localSearchResult)}`);
      sources.push(...this.collectSourcesFromLocalSearch(localSearchResult));
    }

    if (shouldSearchWeb) {
      updateLoadingMessage?.("Searching the web...");
      const webSearchResult = await selfHostWebSearch(this.stripToolMarkers(originalText));
      blocks.push(
        `## Web Search Results\n\n${webSearchResult.content}\n\n${
          webSearchResult.citations.length > 0
            ? `Sources:\n${webSearchResult.citations.map((citation) => `- ${citation}`).join("\n")}`
            : ""
        }`.trim()
      );
      sources.push(
        ...webSearchResult.citations.map((citation) => ({
          title: citation,
          path: citation,
          score: 1,
        }))
      );
    }

    return { blocks, sources };
  }

  /**
   * Remove Copilot command markers before handing the prompt to the pi agent.
   */
  private stripToolMarkers(text: string): string {
    return text
      .replace(/(^|\s)@(vault|websearch|web|composer)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Extract simple salient terms for vault search.
   */
  private extractSalientTerms(text: string): string[] {
    return this.stripToolMarkers(text)
      .split(/[\s\p{P}]+/u)
      .filter((term) => term.length >= 3)
      .slice(0, 8);
  }

  /**
   * Extract a plain-text assistant response from pi message content.
   */
  private extractAssistantText(message: { content: any[]; errorMessage?: string }): string {
    const text = message.content
      .filter((item) => item?.type === "text")
      .map((item) => item.text || "")
      .join("");

    return text || message.errorMessage || "";
  }

  /**
   * Read the final assistant message from the completed pi transcript.
   */
  private getFinalAssistantText(messages: any[]): string {
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((message) => message?.role === "assistant");
    if (!lastAssistantMessage) {
      return "";
    }
    return this.extractAssistantText(lastAssistantMessage);
  }

  /**
   * Convert pi usage/stop information into Copilot response metadata.
   */
  private buildResponseMetadata(
    stopReason: string,
    usage?: { input?: number; output?: number; totalTokens?: number }
  ): ResponseMetadata {
    return {
      wasTruncated: stopReason === "length",
      tokenUsage: usage
        ? {
            inputTokens: usage.input,
            outputTokens: usage.output,
            totalTokens: usage.totalTokens,
          }
        : undefined,
    };
  }

  /**
   * Convert local search payloads into source metadata.
   */
  private collectSourcesFromLocalSearch(result: unknown): PiToolSource[] {
    const parsedResult = this.parseToolResult(result);
    const payload = Array.isArray(parsedResult) ? parsedResult[0] : parsedResult;
    const documents = Array.isArray((payload as any)?.documents) ? (payload as any).documents : [];

    return documents
      .filter((document: any) => typeof document?.path === "string")
      .map((document: any) => ({
        title: document.title || document.path,
        path: document.path,
        score: Number(document.score || document.rerank_score || 0),
        explanation: document.explanation,
      }));
  }

  /**
   * Parse JSON-like tool results when they are returned as strings.
   */
  private parseToolResult(result: unknown): unknown {
    if (typeof result !== "string") {
      return result;
    }

    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  /**
   * Convert a tool result into a readable string.
   */
  private stringifyToolResult(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }
    return JSON.stringify(result, null, 2);
  }
}
