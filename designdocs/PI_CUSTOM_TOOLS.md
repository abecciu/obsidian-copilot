# Pi Custom Tools

This fork now has a dedicated extension seam for custom Pi tools in [`src/pi/PiCustomTools.ts`](../src/pi/PiCustomTools.ts).

## Goal

Keep fork-owned tool work isolated to `src/pi/` so upstream pulls stay easy:

- Built-in Pi tools still live in `src/pi/PiToolRegistry.ts`
- Fork-specific tools should live in `src/pi/PiCustomTools.ts`
- Future integration layers, such as an MCP adapter, should register through the same registry seam instead of modifying the chain runner directly

## Current Shape

`PiToolRegistry` now merges tool definitions from provider functions:

- `builtin`: the built-in Pi tools shipped by this fork
- `custom`: the fork-owned definitions returned by `getCustomPiToolDefinitions()`

Custom tools are described by `PiToolDefinition`:

```ts
interface PiToolAvailability {
  platforms?: Array<"desktop" | "mobile">;
  chainTypes?: ChainType[];
}

interface PiToolDefinition {
  id: string;
  tool: AgentTool<any, PiToolDetails>;
  enabledByDefault?: boolean;
  availability?: PiToolAvailability;
}
```

Notes:

- Keep `id` and `tool.name` the same. The registry warns if they diverge.
- `enabledByDefault: true` makes a custom tool available immediately without adding it to the current Pi settings allowlist.
- `availability.platforms` lets you hide tools on unsupported runtimes such as mobile.
- `availability.chainTypes` lets you scope tools to specific Pi chat surfaces such as project chat only.
- Built-in tools still respect `settings.piAgent.enabledToolIds`.
- If a fork-owned tool reuses a built-in id, the fork-owned definition overrides the built-in Pi tool only when it is available in the current runtime context.

## Adding a Custom Tool

1. Open [`src/pi/PiCustomTools.ts`](../src/pi/PiCustomTools.ts).
2. Define a TypeBox parameter schema.
3. Implement a Pi `AgentTool`.
4. Return it from `getCustomPiToolDefinitions()`.

Minimal example:

```ts
import { ChainType } from "@/chainFactory";

const echoParameters = Type.Object({
  text: Type.String(),
});

const echoTool = {
  name: "echoText",
  label: "Echo Text",
  description: "Return the provided text unchanged.",
  parameters: echoParameters,
  execute: async (_toolCallId: string, params: { text: string }) => ({
    content: [{ type: "text", text: params.text }],
    details: {
      rawResult: params,
      sources: [],
    },
  }),
};

export function getCustomPiToolDefinitions(): PiToolDefinition[] {
  return [
    {
      id: "echoText",
      tool: echoTool,
      enabledByDefault: true,
      availability: {
        platforms: ["desktop"],
        chainTypes: [ChainType.PROJECT_CHAIN],
      },
    },
  ];
}
```

## Design Guidance

- Prefer adding new behavior in `src/pi/PiCustomTools.ts` or a new fork-owned helper under `src/pi/`.
- Avoid editing `PiAgentChainRunner` unless the runtime contract itself changes.
- If a tool wraps existing Copilot functionality, adapt it in the tool layer rather than changing core managers.
- Prefer metadata-driven filtering over provider-side `if (isDesktopRuntime())` branches when the distinction belongs to the tool definition itself.
- Keep tool result `details.sources` populated when you want the chat UI to surface sources cleanly.
- The current fork-owned Pi web tools are `webSearch` via Exa and `webFetch` via Firecrawl scrape.
- `toolProxyBaseUrl` + `toolProxyApiKey` allow Pi `webSearch` to route through a generic proxy endpoint such as `/exa/search`.
- `exaApiKey` and `firecrawlApiKey` remain top-level settings fields so they reuse the existing encryption flow.

## MCP Direction

`pi-agent-core` does not currently expose first-class MCP integration in the local source tree we inspected. The clean approach for this fork is:

1. Add an MCP client/adapter under `src/pi/`
2. Discover MCP tools from configured servers
3. Convert them into `AgentTool` objects
4. Register them through the same Pi tool registry seam

That keeps MCP support as a fork-owned layer without coupling it to the upstream Copilot runtime.
