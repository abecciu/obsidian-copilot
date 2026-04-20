const mockGetChainType = jest.fn();
const mockGetCurrentProject = jest.fn();
const mockGetSettings = jest.fn();
const mockSubscribeToSettingsChange: jest.Mock = jest.fn().mockImplementation(() => jest.fn());
const mockCreateChainWithNewModel = jest.fn().mockResolvedValue(undefined);
const mockLlmRunnerRun = jest.fn().mockResolvedValue("llm response");
const mockVaultRunnerRun = jest.fn().mockResolvedValue("vault response");
const mockCopilotPlusRunnerRun = jest.fn().mockResolvedValue("copilot plus response");
const mockAutonomousRunnerRun = jest.fn().mockResolvedValue("autonomous response");
const mockProjectRunnerRun = jest.fn().mockResolvedValue("project response");
const mockPiRunnerRun = jest.fn().mockResolvedValue("pi response");

jest.mock("@/aiParams", () => ({
  getChainType: () => mockGetChainType(),
  getCurrentProject: () => mockGetCurrentProject(),
  getModelKey: jest.fn(),
  setChainType: jest.fn(),
}));

jest.mock("@/chainFactory", () => ({
  __esModule: true,
  default: {
    createNewLLMChain: jest.fn(),
    createConversationalRetrievalChain: jest.fn(),
  },
  ChainType: {
    LLM_CHAIN: "LLM_CHAIN",
    VAULT_QA_CHAIN: "VAULT_QA_CHAIN",
    COPILOT_PLUS_CHAIN: "COPILOT_PLUS_CHAIN",
    PROJECT_CHAIN: "PROJECT_CHAIN",
  },
}));

jest.mock("@/LLMProviders/chainRunner/index", () => ({
  AutonomousAgentChainRunner: jest.fn().mockImplementation(() => ({
    run: mockAutonomousRunnerRun,
  })),
  CopilotPlusChainRunner: jest.fn().mockImplementation(() => ({
    run: mockCopilotPlusRunnerRun,
  })),
  LLMChainRunner: jest.fn().mockImplementation(() => ({
    run: mockLlmRunnerRun,
  })),
  ProjectChainRunner: jest.fn().mockImplementation(() => ({
    run: mockProjectRunnerRun,
  })),
  VaultQAChainRunner: jest.fn().mockImplementation(() => ({
    run: mockVaultRunnerRun,
  })),
}));

jest.mock("@/pi/PiAgentChainRunner", () => ({
  PiAgentChainRunner: jest.fn().mockImplementation(() => ({
    run: mockPiRunnerRun,
  })),
}));

jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      validateChatModel: jest.fn().mockReturnValue(true),
      getChatModel: jest.fn().mockReturnValue({ id: "test-model" }),
      setChatModel: jest.fn(),
    }),
  },
}));

jest.mock("@/LLMProviders/memoryManager", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      getMemory: jest.fn(),
    }),
  },
}));

jest.mock("@/LLMProviders/promptManager", () => ({
  __esModule: true,
  default: {
    getInstance: () => ({
      getChatPrompt: jest.fn(),
    }),
  },
}));

jest.mock("@/memory/UserMemoryManager", () => ({
  UserMemoryManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  subscribeToSettingsChange: (callback: () => void) => mockSubscribeToSettingsChange(callback),
}));

jest.mock("@/system-prompts/systemPromptBuilder", () => ({
  getSystemPrompt: jest.fn().mockReturnValue("Test system prompt"),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/utils", () => ({
  findCustomModel: jest.fn(),
  isOSeriesModel: jest.fn().mockReturnValue(false),
  isSupportedChain: jest.fn().mockReturnValue(true),
}));

import ChainManager from "./chainManager";
import { ChainType } from "@/chainFactory";
import {
  AutonomousAgentChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  ProjectChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner/index";
import { PiAgentChainRunner } from "@/pi/PiAgentChainRunner";
import type { ChatMessage } from "@/types/message";

describe("ChainManager backend dispatch", () => {
  const createMessage = (): ChatMessage => ({
    message: "Test message",
    originalMessage: "Test message",
    sender: "user",
    timestamp: null,
    isVisible: true,
  });

  const createManager = (): ChainManager => {
    const createChainSpy = jest
      .spyOn(ChainManager.prototype, "createChainWithNewModel")
      .mockImplementation(mockCreateChainWithNewModel);
    const manager = new ChainManager({} as any);
    createChainSpy.mockRestore();
    jest.spyOn(manager as any, "validateChatModel").mockImplementation(() => {});
    jest.spyOn(manager as any, "validateChainInitialization").mockImplementation(() => {});
    return manager;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentProject.mockReturnValue(null);
    mockGetSettings.mockReturnValue({
      agentBackend: "upstream",
      enableAutonomousAgent: false,
    });
  });

  it("uses the pi runner when the fork backend is active", async () => {
    mockGetChainType.mockReturnValue(ChainType.COPILOT_PLUS_CHAIN);
    mockGetSettings.mockReturnValue({
      agentBackend: "pi",
      enableAutonomousAgent: true,
    });
    const manager = createManager();

    const result = await manager.runChain(
      createMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn()
    );

    expect(result).toBe("pi response");
    expect(PiAgentChainRunner).toHaveBeenCalledWith(manager, ChainType.COPILOT_PLUS_CHAIN);
    expect(mockPiRunnerRun).toHaveBeenCalledTimes(1);
    expect(LLMChainRunner).not.toHaveBeenCalled();
    expect(CopilotPlusChainRunner).not.toHaveBeenCalled();
    expect(AutonomousAgentChainRunner).not.toHaveBeenCalled();
    expect(ProjectChainRunner).not.toHaveBeenCalled();
    expect(VaultQAChainRunner).not.toHaveBeenCalled();
  });

  it("uses the standard LLM runner for upstream basic chat", async () => {
    mockGetChainType.mockReturnValue(ChainType.LLM_CHAIN);
    const manager = createManager();

    const result = await manager.runChain(
      createMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn()
    );

    expect(result).toBe("llm response");
    expect(LLMChainRunner).toHaveBeenCalledWith(manager);
    expect(mockLlmRunnerRun).toHaveBeenCalledTimes(1);
    expect(PiAgentChainRunner).not.toHaveBeenCalled();
  });

  it("uses the upstream Copilot Plus runner when autonomous mode is disabled", async () => {
    mockGetChainType.mockReturnValue(ChainType.COPILOT_PLUS_CHAIN);
    mockGetSettings.mockReturnValue({
      agentBackend: "upstream",
      enableAutonomousAgent: false,
    });
    const manager = createManager();

    const result = await manager.runChain(
      createMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn()
    );

    expect(result).toBe("copilot plus response");
    expect(CopilotPlusChainRunner).toHaveBeenCalledWith(manager);
    expect(mockCopilotPlusRunnerRun).toHaveBeenCalledTimes(1);
    expect(AutonomousAgentChainRunner).not.toHaveBeenCalled();
    expect(PiAgentChainRunner).not.toHaveBeenCalled();
  });

  it("uses the upstream autonomous runner when that mode is enabled", async () => {
    mockGetChainType.mockReturnValue(ChainType.COPILOT_PLUS_CHAIN);
    mockGetSettings.mockReturnValue({
      agentBackend: "upstream",
      enableAutonomousAgent: true,
    });
    const manager = createManager();

    const result = await manager.runChain(
      createMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn()
    );

    expect(result).toBe("autonomous response");
    expect(AutonomousAgentChainRunner).toHaveBeenCalledWith(manager);
    expect(mockAutonomousRunnerRun).toHaveBeenCalledTimes(1);
    expect(CopilotPlusChainRunner).not.toHaveBeenCalled();
    expect(PiAgentChainRunner).not.toHaveBeenCalled();
  });

  it("uses the project runner for upstream project chat", async () => {
    mockGetChainType.mockReturnValue(ChainType.PROJECT_CHAIN);
    const manager = createManager();

    const result = await manager.runChain(
      createMessage(),
      new AbortController(),
      jest.fn(),
      jest.fn()
    );

    expect(result).toBe("project response");
    expect(ProjectChainRunner).toHaveBeenCalledWith(manager);
    expect(mockProjectRunnerRun).toHaveBeenCalledTimes(1);
    expect(PiAgentChainRunner).not.toHaveBeenCalled();
  });
});
