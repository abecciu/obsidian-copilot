/**
 * useStreamingChatSession - Shared streaming chat session hook.
 *
 * Responsibilities:
 * - AbortController lifecycle (stop/reset/unmount)
 * - Re-entrancy lock (isStreamingRef)
 * - RAF-throttled streaming text updates
 * - Lazy chain + memory creation and recreation (model/systemPrompt changes)
 * - First-turn tracking based on successful memory persistence
 * - ThinkBlockStreamer integration for provider-agnostic streaming chunks
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunnableSequence } from "@langchain/core/runnables";
import type { BaseChatMemory } from "@langchain/classic/memory";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

import type { CustomModel } from "@/aiParams";
import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";
import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import {
  createInitialReasoningState,
  serializeReasoningBlock,
  summarizeToolCall,
  summarizeToolResult,
} from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { ABORT_REASON } from "@/constants";
import { logError } from "@/logger";
import { renderPiAssistantMessage, renderPiAssistantTranscript } from "@/pi/PiMessageRendering";
import { resolvePiApiKey, resolvePiModel } from "@/pi/PiModelResolver";
import { useSettingsValue } from "@/settings/model";
import { useRafThrottledCallback } from "@/hooks/use-raf-throttled-callback";

export interface StreamingChatTurnContext {
  /** Abort signal for the current turn (covers prompt-building + streaming). */
  signal: AbortSignal;
  /** True if no previous successful turn has been saved into memory. */
  isFirstTurn: boolean;
}

export interface UseStreamingChatSessionParams {
  /** Resolved model to use (already validated/enabled). */
  model: CustomModel | null;
  /** Pi model ID to use when the pi backend is active. */
  piModelId?: string | null;
  /** System prompt for the chain (empty string allowed). */
  systemPrompt: string;
  /** Exclude thinking blocks from streamed output (default: true). */
  excludeThinking?: boolean;
  /** Called when a turn is requested but no model is available. */
  onNoModel?: () => void;
  /** Called when a non-abort error occurs during streaming. */
  onNonAbortError?: (error: unknown) => void;
}

export interface StreamingChatSessionApi {
  isStreaming: boolean;
  streamingText: string;

  /** Returns true if this is the first successful turn (based on memory persistence). */
  getIsFirstTurn: () => boolean;

  /**
   * Runs a streaming turn.
   * `getPrompt` is executed after the AbortController is created, so stop/reset can abort prompt-building too.
   *
   * Returns the committed (trimmed) output, or null if:
   * - aborted due to NEW_CHAT / UNMOUNT
   * - missing model
   * - non-abort error
   * - empty output
   */
  runTurn: (
    getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
  ) => Promise<string | null>;

  /** Aborts the current turn (default reason: USER_STOPPED). */
  stop: (reason?: ABORT_REASON) => void;

  /** Aborts with NEW_CHAT and resets chain/memory/first-turn + streaming state. */
  reset: () => void;

  /** Get the current memory instance (for saving partial context on stop). */
  getMemory: () => BaseChatMemory | null;

  /** Get the latest streaming text from ref (bypasses RAF throttle). */
  getLatestStreamingText: () => string;
}

interface ChainAndMemory {
  chain: RunnableSequence;
  memory: BaseChatMemory;
}

/** Returns a stable key for caching chain per model. */
function getModelKey(model: CustomModel): string {
  return `${model.name}|${model.provider}`;
}

/** Returns true if an aborted signal should skip persistence/commit. */
function shouldSkipPersistOnAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;

  const reason = signal.reason;
  // If abort() was called without a string reason, treat it as a "non-commit" cancel.
  if (typeof reason !== "string") return true;

  return reason === ABORT_REASON.NEW_CHAT || reason === ABORT_REASON.UNMOUNT;
}

/**
 * Extract plain text from a pi assistant message.
 */
function extractPiAssistantText(message: { content?: any[]; errorMessage?: string }): string {
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .filter((item) => item?.type === "text")
    .map((item) => item?.text || "")
    .join("");

  return text || message.errorMessage || "";
}

/**
 * Convert a pi tool result into a readable string.
 */
function stringifyPiToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Shared streaming chat session hook for Quick Ask + CustomCommandChatModal.
 */
export function useStreamingChatSession(
  params: UseStreamingChatSessionParams
): StreamingChatSessionApi {
  const {
    model,
    piModelId,
    systemPrompt,
    excludeThinking = true,
    onNoModel,
    onNonAbortError,
  } = params;
  const settings = useSettingsValue();
  const isPiMode = settings.agentBackend === "pi";

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const isMountedRef = useRef(true);
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamingTextRef = useRef("");
  const hasSavedContextOnceRef = useRef(false);
  // Reason: Monotonically increasing turn ID prevents stale finally blocks
  // from overwriting state after reset() starts a new generation.
  const turnIdRef = useRef(0);

  // Reason: Store callbacks in refs to avoid runTurn identity changing
  // when caller passes inline functions. This prevents autoExecute effects
  // from re-running due to runTurn dependency changes.
  const onNoModelRef = useRef(onNoModel);
  const onNonAbortErrorRef = useRef(onNonAbortError);
  useEffect(() => {
    onNoModelRef.current = onNoModel;
    onNonAbortErrorRef.current = onNonAbortError;
  }, [onNoModel, onNonAbortError]);

  const memoryRef = useRef<BaseChatMemory | null>(null);
  const chainRef = useRef<RunnableSequence | null>(null);
  const piMessagesRef = useRef<Message[]>([]);
  const currentModelKeyRef = useRef<string | null>(null);
  const currentSystemPromptRef = useRef<string | null>(null);

  const modelKey = useMemo(() => {
    if (!model) return null;
    return getModelKey(model);
  }, [model]);

  const setStreamingTextThrottled = useRafThrottledCallback((text: string) => {
    if (!isMountedRef.current) return;
    setStreamingText(text);
  });

  /** Updates streaming refs + schedules a throttled state update. */
  const handleDelta = useCallback(
    (text: string): void => {
      if (!isMountedRef.current) return;
      streamingTextRef.current = text;
      setStreamingTextThrottled(text);
    },
    [setStreamingTextThrottled]
  );

  /** Ensures chain/memory exist and are recreated when model/systemPrompt change. */
  const getOrCreateChain = useCallback(
    async (signal: AbortSignal): Promise<ChainAndMemory | null> => {
      if (!model || !modelKey) {
        onNoModelRef.current?.();
        return null;
      }

      const needsRecreate =
        !chainRef.current ||
        currentModelKeyRef.current !== modelKey ||
        currentSystemPromptRef.current !== systemPrompt;

      if (needsRecreate) {
        if (!memoryRef.current) {
          memoryRef.current = createChatMemory();
        }

        const nextChain = await createChatChain(model, systemPrompt, memoryRef.current);

        // Avoid stale write-back if the turn was cancelled while creating the chain.
        if (signal.aborted) return null;

        chainRef.current = nextChain;
        currentModelKeyRef.current = modelKey;
        currentSystemPromptRef.current = systemPrompt;
      }

      if (!chainRef.current || !memoryRef.current) return null;
      return { chain: chainRef.current, memory: memoryRef.current };
    },
    [model, modelKey, systemPrompt]
  );

  /** Cleanup on unmount: abort any active turn and prevent state updates. */
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort(ABORT_REASON.UNMOUNT);
      abortControllerRef.current = null;
    };
  }, []);

  /**
   * If model/systemPrompt changes while streaming, abort to avoid stale writes
   * and force chain recreation on next turn. Memory is preserved.
   */
  useEffect(() => {
    if (isStreamingRef.current) {
      abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    }
    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;
  }, [isPiMode, modelKey, piModelId, systemPrompt]);

  const getIsFirstTurn = useCallback((): boolean => {
    if (isPiMode) {
      return piMessagesRef.current.length === 0;
    }
    return !hasSavedContextOnceRef.current;
  }, [isPiMode]);

  const getMemory = useCallback((): BaseChatMemory | null => {
    if (isPiMode) {
      return null;
    }
    return memoryRef.current;
  }, [isPiMode]);

  /** Returns the latest streaming text directly from the ref, bypassing RAF throttle. */
  const getLatestStreamingText = useCallback((): string => {
    return streamingTextRef.current;
  }, []);

  const stop = useCallback((reason: ABORT_REASON = ABORT_REASON.USER_STOPPED): void => {
    abortControllerRef.current?.abort(reason);
  }, []);

  const reset = useCallback((): void => {
    abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    abortControllerRef.current = null;

    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;
    piMessagesRef.current = [];

    memoryRef.current = createChatMemory();
    hasSavedContextOnceRef.current = false;

    // Increment turn ID so any pending finally block from the old turn
    // will skip state updates.
    turnIdRef.current += 1;

    streamingTextRef.current = "";
    isStreamingRef.current = false;

    if (isMountedRef.current) {
      setStreamingText("");
      setStreamingTextThrottled("");
      setIsStreaming(false);
    }
  }, [setStreamingTextThrottled]);

  const runTurn = useCallback(
    async (
      getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
    ): Promise<string | null> => {
      if (isStreamingRef.current) return null;

      isStreamingRef.current = true;
      if (isMountedRef.current) setIsStreaming(true);

      const currentTurnId = ++turnIdRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Reset streaming buffers (also update throttler so pending RAF won't resurrect stale text).
      streamingTextRef.current = "";
      if (isMountedRef.current) {
        setStreamingText("");
        setStreamingTextThrottled("");
      }

      // Reason: Wrap handleDelta with a turnId guard so that after reset(),
      // any pending ThinkBlockStreamer callbacks from the old turn are no-ops.
      const turnScopedDelta = (text: string): void => {
        if (turnIdRef.current !== currentTurnId) return;
        handleDelta(text);
      };

      const thinkStreamer = new ThinkBlockStreamer(turnScopedDelta, excludeThinking);

      let didNonAbortError = false;
      let memory: BaseChatMemory | null = null;
      let prompt = "";
      let committed: string | null = null;
      let piCommitted: string | null = null;

      try {
        const isFirstTurn = !hasSavedContextOnceRef.current;
        const resolvedIsFirstTurn = isPiMode ? piMessagesRef.current.length === 0 : isFirstTurn;

        if (!isPiMode && !model) {
          onNoModelRef.current?.();
          return null;
        }

        if (isPiMode && !(piModelId || settings.piAgent.modelId || "").trim()) {
          onNoModelRef.current?.();
          return null;
        }

        prompt = await getPrompt({
          signal: abortController.signal,
          isFirstTurn: resolvedIsFirstTurn,
        });
        if (abortController.signal.aborted) return null;

        if (!prompt.trim()) return null;

        if (isPiMode) {
          const resolvedPiModelId = (piModelId || settings.piAgent.modelId || "").trim();
          const resolvedModel = resolvePiModel(resolvedPiModelId);
          const apiKey = await resolvePiApiKey();
          const initialPiMessageCount = piMessagesRef.current.length;
          let latestPiVisibleResponse = "";
          let latestPiAssistantResponse = "";
          const piToolArgsById = new Map<string, Record<string, unknown>>();
          const piReasoningState = createInitialReasoningState();
          let piReasoningTimerInterval: ReturnType<typeof setInterval> | null = null;
          const piReasoningHistory: Array<{ timestamp: number; summary: string; toolName?: string }> =
            [];

          /**
           * Render a pi assistant message into the current display format.
           */
          const renderAssistantResponse = (
            message: { content?: any[]; errorMessage?: string },
            keepTrailingThinkingOpen = false
          ): string => {
            if (excludeThinking) {
              return extractPiAssistantText(message);
            }

            return renderPiAssistantMessage(message, { keepTrailingThinkingOpen });
          };

          /**
           * Compose the visible response, including any reasoning marker block.
           */
          const composeVisibleResponse = (): string => {
            const reasoningMarkup =
              piReasoningState.status === "idle"
                ? ""
                : serializeReasoningBlock({
                    ...piReasoningState,
                    steps:
                      piReasoningState.status === "reasoning"
                        ? piReasoningState.steps
                        : piReasoningHistory,
                  });

            if (!reasoningMarkup) {
              return latestPiAssistantResponse;
            }

            return latestPiAssistantResponse
              ? `${reasoningMarkup}\n\n${latestPiAssistantResponse}`
              : reasoningMarkup;
          };

          /**
           * Push the latest visible pi response into the shared streaming callback.
           */
          const pushPiVisibleResponse = (): void => {
            latestPiVisibleResponse = composeVisibleResponse();
            turnScopedDelta(latestPiVisibleResponse);
          };

          /**
           * Add a summarized tool/reasoning step to the visible response.
           */
          const addReasoningStep = (summary: string, toolName?: string): void => {
            const step = {
              timestamp: Date.now(),
              summary,
              toolName,
            };

            piReasoningHistory.push(step);
            piReasoningState.steps.push(step);
            if (piReasoningState.steps.length > 4) {
              piReasoningState.steps.shift();
            }
            pushPiVisibleResponse();
          };

          /**
           * Start the transient reasoning/timer block when a tool call begins.
           */
          const startReasoning = (): void => {
            if (piReasoningState.status !== "idle") {
              return;
            }

            piReasoningState.status = "reasoning";
            piReasoningState.startTime = Date.now();
            piReasoningState.elapsedSeconds = 0;
            piReasoningState.steps = [];

            piReasoningTimerInterval = setInterval(() => {
              if (piReasoningState.status !== "reasoning" || !piReasoningState.startTime) {
                return;
              }

              piReasoningState.elapsedSeconds = Math.floor(
                (Date.now() - piReasoningState.startTime) / 1000
              );
              pushPiVisibleResponse();
            }, 100);
          };

          /**
           * Finalize the reasoning block once the pi turn finishes.
           */
          const finishReasoning = (): void => {
            if (piReasoningState.status === "idle") {
              return;
            }

            if (piReasoningTimerInterval) {
              clearInterval(piReasoningTimerInterval);
              piReasoningTimerInterval = null;
            }

            if (piReasoningState.startTime) {
              piReasoningState.elapsedSeconds = Math.floor(
                (Date.now() - piReasoningState.startTime) / 1000
              );
            }

            piReasoningState.status = "complete";
            pushPiVisibleResponse();
          };

          const agent = new Agent({
            initialState: {
              model: resolvedModel,
              systemPrompt,
              thinkingLevel: settings.piAgent.thinkingLevel,
              tools: [],
              messages: piMessagesRef.current.slice(),
            },
            getApiKey: async () => apiKey,
          });

          const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
            if (event.type === "message_update" && event.message.role === "assistant") {
              const shouldKeepTrailingThinkingOpen =
                event.assistantMessageEvent.type === "thinking_start" ||
                event.assistantMessageEvent.type === "thinking_delta";
              latestPiAssistantResponse = renderAssistantResponse(
                event.message,
                shouldKeepTrailingThinkingOpen
              );
              pushPiVisibleResponse();
              return;
            }

            if (event.type === "message_end" && event.message.role === "assistant") {
              latestPiAssistantResponse = renderAssistantResponse(event.message);
              pushPiVisibleResponse();
              return;
            }

            if (event.type === "tool_execution_start") {
              piToolArgsById.set(event.toolCallId, event.args);
              startReasoning();
              addReasoningStep(summarizeToolCall(event.toolName, event.args), event.toolName);
              return;
            }

            if (event.type === "tool_execution_end") {
              const toolArgs = piToolArgsById.get(event.toolCallId);
              const sourceTitles =
                (
                  event.result as {
                    details?: { sources?: Array<{ title?: string }> };
                  }
                )?.details?.sources
                  ?.map((source) => source.title)
                  .filter((title): title is string => typeof title === "string") || [];
              piToolArgsById.delete(event.toolCallId);

              addReasoningStep(
                summarizeToolResult(
                  event.toolName,
                  {
                    success: !event.isError,
                    result: stringifyPiToolResult(event.result),
                  },
                  sourceTitles.length > 0
                    ? { titles: sourceTitles, count: sourceTitles.length }
                    : undefined,
                  toolArgs
                ),
                event.toolName
              );
            }
          });
          const abortHandler = () => agent.abort();
          abortController.signal.addEventListener("abort", abortHandler);

          try {
            await agent.prompt(prompt);
          } finally {
            finishReasoning();
            unsubscribe();
            abortController.signal.removeEventListener("abort", abortHandler);
          }

          if (!shouldSkipPersistOnAbort(abortController.signal)) {
            piMessagesRef.current = agent.state.messages.slice() as Message[];
            const turnAssistantMessages = agent.state.messages
              .slice(initialPiMessageCount)
              .filter((message) => message?.role === "assistant");
            piCommitted = excludeThinking
              ? extractPiAssistantText(turnAssistantMessages[turnAssistantMessages.length - 1] || {})
              : renderPiAssistantTranscript(turnAssistantMessages).trim();

            if (!piCommitted) {
              const lastAssistantMessage = [...agent.state.messages]
                .reverse()
                .find((message) => message?.role === "assistant");
              if (lastAssistantMessage) {
                piCommitted = renderAssistantResponse(lastAssistantMessage).trim();
              }
            }
          }
        } else {
          const chainAndMemory = await getOrCreateChain(abortController.signal);
          if (!chainAndMemory) return null;

          memory = chainAndMemory.memory;

          const chainWithSignal = chainAndMemory.chain.withConfig({
            signal: abortController.signal,
          });
          const stream = await chainWithSignal.stream({ input: prompt });

          for await (const chunk of stream) {
            thinkStreamer.processChunk(chunk);
            if (abortController.signal.aborted) break;
          }
        }
      } catch (error) {
        const isAbort =
          (error instanceof Error && error.name === "AbortError") || abortController.signal.aborted;

        if (!isAbort) {
          didNonAbortError = true;
          onNonAbortErrorRef.current?.(error);
        }
      } finally {
        const result = isPiMode ? (piCommitted || "").trim() : thinkStreamer.close().content.trim();

        const shouldSkip = shouldSkipPersistOnAbort(abortController.signal);
        const isStale = turnIdRef.current !== currentTurnId;

        // Reason: Decouple result delivery from persistence success.
        // Even if saveContext fails, the user should still see the generated result.
        // But skip everything if the turn is stale (reset was called).
        if (!didNonAbortError && result && !shouldSkip && !isStale) {
          committed = result;

          // Best-effort persistence - failure doesn't affect UI
          // Compact the output to reduce memory bloat from tool results
          if (memory) {
            try {
              const compactedResult = compactAssistantOutput(result);
              await memory.saveContext(
                { input: prompt },
                { output: typeof compactedResult === "string" ? compactedResult : result }
              );
              hasSavedContextOnceRef.current = true;
            } catch (error) {
              logError("Error saving chat context:", error);
            }
          }
        }

        // Final cleanup - only if this turn is still the active one.
        // Reason: If reset() was called while this turn was in-flight,
        // turnIdRef will have been incremented, and we must not overwrite
        // the clean state that reset() established.
        if (!isStale) {
          streamingTextRef.current = "";
          isStreamingRef.current = false;
        }

        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }

        if (isMountedRef.current && !isStale) {
          setStreamingText("");
          setStreamingTextThrottled("");
          setIsStreaming(false);
        }
      }

      return committed;
    },
    [
      excludeThinking,
      getOrCreateChain,
      handleDelta,
      isPiMode,
      model,
      piModelId,
      setStreamingTextThrottled,
      settings.piAgent.modelId,
      settings.piAgent.thinkingLevel,
      systemPrompt,
    ]
  );

  return {
    isStreaming,
    streamingText,
    getIsFirstTurn,
    runTurn,
    stop,
    reset,
    getMemory,
    getLatestStreamingText,
  };
}
