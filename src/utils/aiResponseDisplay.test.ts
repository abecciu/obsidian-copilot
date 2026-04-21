import {
  formatAIResponseForPlainText,
  formatAIResponseForPreview,
} from "@/utils/aiResponseDisplay";

describe("aiResponseDisplay", () => {
  it("formats think sections for preview rendering", () => {
    expect(
      formatAIResponseForPreview("<think>Check assumptions\nCompare options</think>\nFinal answer.")
    ).toContain("> [!abstract]- Thought for a while");
    expect(
      formatAIResponseForPreview("<think>Check assumptions\nCompare options</think>\nFinal answer.")
    ).toContain("Final answer.");
  });

  it("formats reasoning markers for preview rendering", () => {
    const formatted = formatAIResponseForPreview(
      '<!--AGENT_REASONING:complete:3:["Searching notes","Found relevant context"]-->\nAnswer.'
    );

    expect(formatted).toContain("> [!info]- Agent reasoning (3s)");
    expect(formatted).toContain("> - Searching notes");
    expect(formatted).toContain("Answer.");
  });

  it("formats think sections for plain-text streaming views", () => {
    expect(formatAIResponseForPlainText("<think>Working...</think>Answer.")).toBe(
      "Thought for a while:\nWorking...\n\nAnswer."
    );
  });

  it("formats reasoning markers for plain-text streaming views", () => {
    expect(
      formatAIResponseForPlainText(
        '<!--AGENT_REASONING:complete:2:["Searching notes"]-->\n<think>Working...</think>Answer.'
      )
    ).toBe(
      "Agent reasoning (2s):\n\n- Searching notes\n\nThought for a while:\nWorking...\n\nAnswer."
    );
  });
});
