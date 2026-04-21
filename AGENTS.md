# AGENTS.md

This file provides guidance to any coding agent when working with code in this repository.

## Overview

Copilot for Obsidian is an AI-powered assistant plugin that integrates various LLM providers (OpenAI, Anthropic, Google, etc.) with Obsidian. It provides chat interfaces, autocomplete, semantic search, and various AI-powered commands for note-taking and knowledge management.

## Development Commands

### Build & Development

- **NEVER RUN `npm run dev`** - The user will handle all builds manually
- `npm run build` - Production build (TypeScript check + minified output)

### Code Quality

- `npm run lint` - Run ESLint checks
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check formatting without changing files
- **Before PR:** Always run `npm run format && npm run lint`

### Testing

- `npm run test` - Run unit tests (excludes integration tests)
- `npm run test:integration` - Run integration tests (requires API keys)
- Run single test: `npm test -- -t "test name"`

## High-Level Architecture

### Core Systems

1. **LLM Provider System** (`src/LLMProviders/`)

   - Provider implementations for OpenAI, Anthropic, Google, Azure, local models
   - `LLMProviderManager` handles provider lifecycle and switching
   - Stream-based responses with error handling and rate limiting
   - Custom model configuration support

2. **Chain Factory Pattern** (`src/chainFactory.ts`)

   - Different chain types for various AI operations (chat, copilot, adhoc prompts)
   - LangChain integration for complex workflows
   - Memory management for conversation context
   - Tool integration (search, file operations, time queries)

3. **Vector Store & Search** (`src/search/`)

   - `VectorStoreManager` manages embeddings and semantic search
   - `ChunkedStorage` for efficient large document handling
   - Event-driven index updates via `IndexManager`
   - Multiple embedding providers support

4. **UI Component System** (`src/components/`)

   - React functional components with Radix UI primitives
   - Tailwind CSS with class variance authority (CVA)
   - Modal system for user interactions
   - Chat interface with streaming support
   - Settings UI with versioned components

5. **Message Management Architecture** (`src/core/`, `src/state/`)

   - **MessageRepository** (`src/core/MessageRepository.ts`): Single source of truth for all messages
     - Stores each message once with both `displayText` and `processedText`
     - Provides computed views for UI display and LLM processing
     - No complex dual-array synchronization
   - **ChatManager** (`src/core/ChatManager.ts`): Central business logic coordinator
     - Orchestrates MessageRepository, ContextManager, and LLM operations
     - Handles message sending, editing, regeneration, and deletion
     - Manages context processing and chain memory synchronization
     - **Project Chat Isolation**: Maintains separate MessageRepository per project
       - Automatically detects project switches via `getCurrentMessageRepo()`
       - Each project has its own isolated message history
       - Non-project chats use `defaultProjectKey` repository
   - **ChatUIState** (`src/state/ChatUIState.ts`): Clean UI-only state manager
     - Delegates all business logic to ChatManager
     - Provides React integration with subscription mechanism
     - Replaces legacy SharedState with minimal, focused approach
   - **ContextManager** (`src/core/ContextManager.ts`): Handles context processing
     - Processes message context (notes, URLs, selected text)
     - Reprocesses context when messages are edited

6. **Settings Management**

   - Jotai for atomic settings state management
   - React contexts for feature-specific state

7. **Plugin Integration**
   - Main entry: `src/main.ts` extends Obsidian Plugin
   - Command registration system
   - Event handling for Obsidian lifecycle
   - Settings persistence and migration
   - Chat history loading via pending message mechanism

### Key Patterns

- **Single Source of Truth**: MessageRepository stores each message once with computed views
- **Clean Architecture**: Repository → Manager → UIState → React Components
- **Context Reprocessing**: Automatic context updates when messages are edited
- **Computed Views**: Display messages for UI, LLM messages for AI processing
- **Project Isolation**: Each project maintains its own MessageRepository instance
- **Error Handling**: Custom error types with detailed interfaces
- **Async Operations**: Consistent async/await pattern with proper error boundaries
- **Caching**: Multi-layer caching for files, PDFs, and API responses
- **Streaming**: Real-time streaming for LLM responses
- **Testing**: Unit tests adjacent to implementation, integration tests for API calls

## Message Management Architecture

For detailed architecture diagrams and documentation, see [`MESSAGE_ARCHITECTURE.md`](./designdocs/MESSAGE_ARCHITECTURE.md).

### Core Classes and Flow

1. **MessageRepository** (`src/core/MessageRepository.ts`)

   - Single source of truth for all messages
   - Stores `StoredMessage` objects with both `displayText` and `processedText`
   - Provides computed views via `getDisplayMessages()` and `getLLMMessages()`
   - No complex dual-array synchronization or ID matching

2. **ChatManager** (`src/core/ChatManager.ts`)

   - Central business logic coordinator
   - Orchestrates MessageRepository, ContextManager, and LLM operations
   - Handles all message CRUD operations with proper error handling
   - Synchronizes with chain memory for conversation history
   - **Project Chat Isolation Implementation**:
     - Maintains `projectMessageRepos: Map<string, MessageRepository>` for project-specific storage
     - `getCurrentMessageRepo()` automatically detects current project and returns correct repository
     - Seamlessly switches between project repositories when project changes
     - Creates new empty repository for each project (no message caching)

3. **ChatUIState** (`src/state/ChatUIState.ts`)

   - Clean UI-only state manager
   - Delegates all business logic to ChatManager
   - Provides React integration with subscription mechanism
   - Replaces legacy SharedState with minimal, focused approach

4. **ContextManager** (`src/core/ContextManager.ts`)

   - Handles context processing (notes, URLs, selected text)
   - Reprocesses context when messages are edited
   - Ensures fresh context for LLM processing

5. **ChatPersistenceManager** (`src/core/ChatPersistenceManager.ts`)
   - Handles saving and loading chat history to/from markdown files
   - Project-aware file naming (prefixes with project ID)
   - Parses and formats chat content for storage
   - Integrated with ChatManager for seamless persistence

## Code Style Guidelines

### MAJOR PRINCIPLES

- **ALWAYS WRITE GENERALIZABLE SOLUTIONS**: Never add edge-case handling or hardcoded logic for specific scenarios (like "piano notes" or "daily notes"). Solutions must work for all cases.
- **NEVER MODIFY AI PROMPT CONTENT**: Do not update, edit, or change any AI prompts, system prompts, or model adapter prompts unless explicitly asked to do so by the user
- **Avoid hardcoding**: No hardcoded folder names, file patterns, or special-case logic
- **Configuration over convention**: If behavior needs to vary, make it configurable, not hardcoded
- **Universal patterns**: Solutions should work equally well for any folder structure, naming convention, or content type

### TypeScript

- Strict mode enabled (no implicit any, strict null checks)
- Use absolute imports with `@/` prefix: `import { ChainType } from "@/chainFactory"`
- Prefer const assertions and type inference where appropriate
- Use interface for object shapes, type for unions/aliases

### React

- Functional components only (no class components)
- Custom hooks for reusable logic
- Props interfaces defined above components
- Avoid inline styles, use Tailwind classes

### General

- File naming: PascalCase for components, camelCase for utilities
- Async/await over promises
- Early returns for error conditions
- **Always add JSDoc comments** for all functions and methods
- Organize imports: React → external → internal
- **Avoid language-specific lists** (like stopwords or action verbs) - use language-agnostic approaches instead

### Logging

- **NEVER use console.log** - Use the logging utilities instead:
  - `logInfo()` for informational messages
  - `logWarn()` for warnings
  - `logError()` for errors
- Import from logger: `import { logInfo, logWarn, logError } from "@/logger"`
- These utilities already respect the debug flag internally — never wrap them in `if (getSettings().debug)`

## Testing Guidelines

- Unit tests use Jest with TypeScript support
- Mock Obsidian API for plugin testing
- Integration tests require API keys in `.env.test`
- Test files adjacent to implementation (`.test.ts`)
- Use `@testing-library/react` for component testing

## Development Session Planning

### Using TODO.md for Session Management

**IMPORTANT**: When working on a development session, maintain a comprehensive `TODO.md` file that serves as the central plan and tracker:

1. **Session Goal**: Define the high-level objective at the start
2. **Task Tracking**:
   - List all completed tasks with [x] checkboxes
   - Track pending tasks with [ ] checkboxes
   - Group related tasks into logical sections
3. **Architecture Decisions**: Document key design choices and rationale
4. **Progress Updates**: Keep the TODO.md updated as tasks complete
5. **Testing Checklist**: Include verification steps for the session

The TODO.md should be:

- The single source of truth for session progress
- Updated frequently as work progresses
- Clear enough that another developer can understand what was done
- Comprehensive enough to serve as a migration guide

### Structure Example:

```markdown
# Development Session TODO

## Session Goal

[Clear statement of what this session aims to achieve]

## Completed Tasks ✅

- [x] Task description with key details
- [x] Another completed task

## Pending Tasks 📋

- [ ] Next task to work on
- [ ] Future enhancement

## Architecture Summary

[Key design decisions and rationale]

## Testing Checklist

- [ ] Functionality verification
- [ ] Performance checks
```

## Important Notes

- The plugin supports multiple LLM providers with custom endpoints
- Vector store requires rebuilding when switching embedding providers
- Settings are versioned - migrations may be needed
- Local model support available via Ollama/LM Studio
- Rate limiting is implemented for all API calls
- For technical debt and known issues, see [`TECHDEBT.md`](./designdocs/todo/TECHDEBT.md)
- For current development session planning, see [`TODO.md`](./TODO.md)

### Obsidian Plugin Environment

- **Global `app` variable**: In Obsidian plugins, `app` is a globally available variable that provides access to the Obsidian API. It's automatically available in all files without needing to import or declare it.

### Architecture Migration Notes

- **SharedState Removed**: The legacy `src/sharedState.ts` has been completely removed
- **Clean Architecture**: New architecture follows Repository → Manager → UIState → UI pattern
- **Single Source of Truth**: All messages stored once in MessageRepository with computed views
- **Context Always Fresh**: Context is reprocessed when messages are edited to ensure accuracy
- **Chat History Loading**: Uses pending message mechanism through CopilotView → Chat component props
- **Project Chat Isolation**: Each project now has completely isolated chat history
  - Automatic detection of project switches via `ProjectManager.getCurrentProjectId()`
  - Separate MessageRepository instances per project ID
  - Non-project chats stored in default repository
  - Backwards compatible - loads existing messages from ProjectManager cache
  - Zero configuration required - works automatically

## Fork Maintenance Notes

This fork adds a **pi-agent backend** while intentionally keeping as much of the upstream Copilot UI and Obsidian integration intact as possible.

### Fork Design Goal

- Treat upstream Copilot as the **shell**
- Keep fork-owned runtime code in `src/pi/`
- Keep upstream files as **thin integration seams**
- Prefer backend dispatch, adapters, and small conditional branches over broad rewrites
- Avoid changing upstream prompt content unless the user explicitly asks

### Current Pi Integration Seams

- `src/pi/`
  - Fork-owned Pi runtime code should live here whenever possible
  - This includes model resolution, transcript rendering, tool adaptation, and backend-specific helpers
- `src/LLMProviders/chainManager.ts`
  - Backend dispatch seam
  - Should stay thin: choose upstream runner vs Pi runner, not implement Pi logic inline
- `src/pi/PiAgentChainRunner.ts`
  - Main chat Pi runtime path
  - Reuses existing Copilot chat shell and message handling
- `src/hooks/use-streaming-chat-session.ts`
  - Shared Quick Ask / custom command streaming seam
  - Pi support here should remain generic and reusable across these lightweight chat surfaces
- `src/settings/model.ts` and `src/settings/v2/`
  - Settings seam for backend selection and Pi-specific configuration
  - Keep Pi settings grouped and clearly separated from upstream provider settings where possible
- UI files such as chat panels, Quick Ask, and command modals
  - Prefer rendering adapters and backend-aware selectors over duplicating UI components

### License and Entitlement Rules

- When `agentBackend === "pi"`, Copilot Plus license checks must be bypassed
- Do not let Pi mode depend on upstream Copilot Plus entitlement state
- New Plus-gated UI/features must be reviewed to ensure Pi mode does not accidentally inherit those restrictions
- If upstream adds new license or entitlement checks, patch them at the entitlement/helper seam rather than scattering Pi exceptions throughout the UI

### Rules For Adding New Pi Functionality

- **Default rule**: add new Pi code under `src/pi/` first
- Only touch upstream-owned areas when you need an integration seam:
  - backend selection
  - settings exposure
  - model selectors
  - chat/command streaming hooks
  - entitlement bypass helpers
- Prefer **adapter functions** over inlining Pi-specific behavior into large upstream files
- Prefer adding a new Pi helper and calling it from an upstream seam instead of rewriting upstream logic
- Keep backend-specific conditionals shallow and obvious
- If the same behavior is needed in multiple Pi surfaces, put it in a shared helper instead of re-implementing it in each UI path

### Rules For Preserving Upstream Mergeability

- Do not rename or broadly restructure upstream files unless absolutely necessary
- Do not move large upstream components just to fit fork logic
- Keep diffs in upstream files small, localized, and easy to reapply
- Prefer:
  - adding a new helper import
  - adding a small backend branch
  - adding a thin selector/dispatcher
- Avoid:
  - embedding Pi logic deep across many unrelated files
  - mixing Pi-specific state into generic upstream types when a wrapper or optional field would work
  - replacing upstream abstractions when extension is sufficient

### Preferred Extension Pattern

When adding new features, use this order of preference:

1. Add fork-owned implementation under `src/pi/`
2. Expose it through an existing seam
3. Add the minimum backend-aware UI/settings glue required
4. Add targeted tests around the seam and the Pi helper

Good examples:

- Add a Pi model catalog helper in `src/pi/`, then wire the settings UI to it
- Add Pi transcript rendering helpers in `src/pi/`, then reuse them from chat and Quick Ask
- Add Pi tool registry/helpers in `src/pi/`, then let chain runners consume that registry

Bad examples:

- Copy/pasting upstream chat logic into a parallel Pi-only UI tree
- Putting large Pi implementations directly into `chainManager.ts`, settings components, or generic chat components
- Solving Pi entitlement issues by sprinkling `agentBackend === "pi"` checks everywhere instead of centralizing them

### Feature-Specific Guidance

- **New tools / skills / projects support**
  - Implement the Pi-side runtime and adapters in `src/pi/`
  - Reuse existing Copilot UI affordances where possible
  - If upstream already has a UX for the concept, prefer adapting data into that UX rather than building a new UI first
- **New model/provider behavior**
  - Keep Pi provider/model discovery independent from upstream model tabs where possible
  - Make selectors backend-aware instead of overloading upstream provider state
- **Thinking / reasoning / tool-call display**
  - Reuse existing Copilot rendering patterns where possible
  - Preserve raw Pi thinking separately from synthesized tool-call summaries
  - Be careful not to lose intermediate assistant messages when finalizing multi-step Pi turns
- **Quick Ask / custom commands**
  - Changes should generally go through `use-streaming-chat-session.ts` before touching multiple UI call sites

### Testing Expectations For Fork Work

- Add focused unit tests for every new Pi helper or adapter
- When changing a seam file, add at least one regression test that locks down the backend-specific behavior
- For bugs involving streaming/finalization, test both:
  - streaming-time behavior
  - finalized persisted behavior

### If Upstream Changes Conflict

- Prefer re-applying the fork at the seam instead of carrying forward a large divergent patch
- Re-check these areas first after pulling upstream:
  - backend dispatch in `chainManager.ts`
  - settings sanitization and settings UI
  - entitlement/license helpers
  - shared streaming hooks
  - message rendering paths
- If upstream introduces a new abstraction that can absorb the Pi fork cleanly, prefer migrating to that abstraction rather than preserving an older custom patch shape
