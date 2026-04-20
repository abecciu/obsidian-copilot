const mockGetSettings = jest.fn();
const mockUpdateSetting = jest.fn();
const mockValidateLicenseKey = jest.fn();
const mockOpenExpiredModal = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: jest.fn(),
  updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
  useSettingsValue: jest.fn(),
}));

jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "LLM_CHAIN",
    VAULT_QA_CHAIN: "VAULT_QA_CHAIN",
    COPILOT_PLUS_CHAIN: "COPILOT_PLUS_CHAIN",
    PROJECT_CHAIN: "PROJECT_CHAIN",
  },
}));

jest.mock("@/aiParams", () => ({
  setChainType: jest.fn(),
  setModelKey: jest.fn(),
}));

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      validateLicenseKey: (...args: unknown[]) => mockValidateLicenseKey(...args),
    }),
  },
}));

jest.mock("@/components/modals/CopilotPlusExpiredModal", () => ({
  CopilotPlusExpiredModal: jest.fn().mockImplementation(() => ({
    open: mockOpenExpiredModal,
  })),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
}));

import {
  checkIsPlusUser,
  isPlusEnabled,
  isSelfHostEligiblePlan,
  turnOffPlus,
  turnOnPlus,
  validateSelfHostMode,
} from "./plusUtils";

describe("plusUtils in pi backend mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      agentBackend: "pi",
      isPlusUser: false,
      enableSelfHostMode: false,
      plusLicenseKey: "",
      selfHostModeValidatedAt: null,
      selfHostValidationCount: 0,
    });
  });

  it("treats pi mode as locally entitled for synchronous Plus checks", () => {
    expect(isPlusEnabled()).toBe(true);
  });

  it("bypasses license validation when checking Plus status", async () => {
    await expect(checkIsPlusUser()).resolves.toBe(true);
    expect(mockValidateLicenseKey).not.toHaveBeenCalled();
  });

  it("bypasses license validation for self-host eligibility and toggle validation", async () => {
    await expect(isSelfHostEligiblePlan()).resolves.toBe(true);
    await expect(validateSelfHostMode()).resolves.toBe(true);
    expect(mockValidateLicenseKey).not.toHaveBeenCalled();
    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });

  it("does not mutate Plus state when pi mode disables license enforcement", () => {
    turnOnPlus();
    turnOffPlus();

    expect(mockUpdateSetting).not.toHaveBeenCalled();
    expect(mockOpenExpiredModal).not.toHaveBeenCalled();
  });
});
