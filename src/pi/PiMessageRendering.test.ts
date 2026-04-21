import { renderPiAssistantMessage, renderPiAssistantTranscript } from "@/pi/PiMessageRendering";

describe("renderPiAssistantMessage", () => {
  it("renders completed thinking blocks as closed think sections", () => {
    expect(
      renderPiAssistantMessage({
        content: [
          { type: "thinking", thinking: "Working through the request." },
          { type: "text", text: "Here is the answer." },
        ],
      })
    ).toBe("<think>Working through the request.</think>Here is the answer.");
  });

  it("keeps trailing thinking blocks open during streaming", () => {
    expect(
      renderPiAssistantMessage(
        {
          content: [{ type: "thinking", thinking: "Still thinking..." }],
        },
        { keepTrailingThinkingOpen: true }
      )
    ).toBe("<think>Still thinking...");
  });

  it("ignores tool call blocks in the rendered transcript", () => {
    expect(
      renderPiAssistantMessage({
        content: [
          { type: "text", text: "Before" },
          { type: "toolCall" },
          { type: "text", text: "After" },
        ],
      })
    ).toBe("BeforeAfter");
  });

  it("preserves earlier thinking blocks when rendering a turn transcript", () => {
    expect(
      renderPiAssistantTranscript([
        {
          content: [
            { type: "thinking", thinking: "First pass reasoning." },
            { type: "toolCall" },
          ],
        },
        {
          content: [{ type: "text", text: "Final answer." }],
        },
      ])
    ).toBe("<think>First pass reasoning.</think>\n\nFinal answer.");
  });
});
