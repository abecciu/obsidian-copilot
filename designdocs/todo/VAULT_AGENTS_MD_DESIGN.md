# Vault `AGENTS.md` Design for the Pi Agent

Status: Draft for implementation
Date: 2026-04-21

## 1. Goal

Add support for user-authored vault `AGENTS.md` files so the Pi backend can follow folder-scoped instructions while helping users think, write, organize notes, and do research inside an Obsidian vault.

Core direction:

- `AGENTS.md` files live inside the user's vault, not inside the plugin repository.
- They act as scoped instruction files, resolved from vault root down to the current task location.
- The Pi agent consumes them as stable system-level context, not as ad hoc user-message attachments.
- The feature is designed for Obsidian workflows, not coding-agent workflows.

## 2. Product Intent

The intended agent is a vault-native assistant. Its main jobs are:

- helping users think through ideas
- drafting and editing notes
- organizing note structure
- summarizing and synthesizing vault context
- doing web or vault research in support of note work

This feature is not primarily about:

- running shell commands
- editing codebases
- reproducing Codex/Claude Code behavior end to end
- turning Pi into a full local development agent

The analogy to coding-agent `AGENTS.md` is useful for the inheritance model, but the actual use case here is note work inside a vault.

## 3. Why `AGENTS.md` Belongs in the Vault

Users want instruction files to be:

- local to the vault
- syncable with the rest of their notes
- editable in plain Markdown
- scoped to specific folders or projects
- portable across machines and plugin reinstalls

Storing this data in plugin settings would be worse because:

- it breaks vault portability
- it makes folder-scoped conventions harder to manage
- it hides instructions from normal vault search/editing workflows

## 4. Final Decisions

1. Support exact filename `AGENTS.md` in V1.
2. Support an explicit user-selected instruction anchor folder anywhere in the vault.
3. Resolve `AGENTS.md` files by walking from the chosen anchor folder up to vault root.
4. When an explicit anchor is set, it overrides heuristic anchor inference for `AGENTS.md` resolution.
5. Keep the instruction anchor separate from normal folder context, search scope, or note attachment scope.
6. Apply instruction files from root to leaf, so deeper folders are more specific.
7. Inject resolved instructions into `L1_SYSTEM`.
8. Use the same resolution logic for main chat and Pi Quick Ask/custom command flows.
9. Make the anchor selectable and clearable from the composer UI, and snapshot it with the sent message.
10. Do not require frontmatter or a custom schema in V1.
11. Do not rely on the model to discover `AGENTS.md` on its own.
12. Do not treat `AGENTS.md` as tool output or turn-scoped user context.

## 5. Non-Goals for V1

- Supporting arbitrary instruction filenames
- Adding a dedicated browser UI for all discovered `AGENTS.md` files
- Parsing structured frontmatter like `always_apply: true`
- Requiring `AGENTS.md` to contain machine-readable sections
- Adding shell/CLI tools just because an instruction file references commands
- Applying every `AGENTS.md` in the vault on every turn

## 6. User Experience Model

Users can create files like:

```text
/AGENTS.md
/Work/AGENTS.md
/Work/ClientA/AGENTS.md
/Personal/Journal/AGENTS.md
```

Example behavior:

- A chat about `Work/ClientA/meeting-notes.md` should inherit:
  - `/AGENTS.md`
  - `/Work/AGENTS.md`
  - `/Work/ClientA/AGENTS.md`
- A chat about `Personal/Journal/2026-04-21.md` should inherit:
  - `/AGENTS.md`
  - `/Personal/Journal/AGENTS.md`

This gives users a simple mental model:

- vault root file = global behavior
- deeper folder file = more specific behavior

### 6.1 Explicit Instruction Anchor

In addition to inferred note-based anchors, the user should be able to choose any folder in the vault as an explicit instruction anchor.

Recommended V1 UX:

- add an `Anchor folder...` action in the composer context UI
- add a shortcut such as `Use active note folder as anchor` when an active note exists
- show the current anchor as a dedicated badge such as `Anchor: Work/ClientA`
- make the anchor clearable without affecting other attached context
- keep it sticky for the current composer session until changed or cleared
- persist the chosen anchor with the message so regenerate/history can reuse the same instruction scope

Important distinction:

- `folders` context means "search or include content from these folders"
- `instruction anchor` means "resolve inherited `AGENTS.md` from this folder"

Those concepts should not share the same field or badge type, because they drive different behavior.

## 7. Resolution Model

### 7.1 Anchor Path

The resolver should not apply instructions based on "current vault" alone. It needs an anchor path for the current task.

Recommended anchor selection order:

1. Explicit instruction anchor selected in the composer UI
2. Explicit target note/file path when the turn is clearly about a specific note
3. Active note path
4. Single attached note path, if exactly one note is attached
5. Common ancestor folder for multiple attached notes, if one exists and is meaningfully specific
6. Project default anchor path, if project mode later gains an explicit folder anchor
7. Vault root fallback

Important rule:

- explicit anchor affects only `AGENTS.md` resolution
- it does not automatically change folder search, note creation targets, or retrieval scope

Examples:

- "Rewrite the active note" -> anchor = active note path
- "Create a note in `Work/ClientA`" -> anchor = `Work/ClientA/`
- "Compare these two notes from `Work/ClientA`" -> anchor = nearest common ancestor
- "Summarize this web page" with no note context -> anchor = active note if present, otherwise vault root

### 7.2 Discovery

Given an anchor path:

1. Normalize to a folder path.
2. Walk upward toward vault root.
3. At each folder level, look for `AGENTS.md`.
4. Collect matches in root-to-leaf order.

Example:

```text
Anchor: Work/ClientA/specs/roadmap.md

Resolved files:
- AGENTS.md
- Work/AGENTS.md
- Work/ClientA/AGENTS.md
- Work/ClientA/specs/AGENTS.md
```

### 7.3 Precedence

Precedence should be explicit:

1. App/runtime safety and permission rules
2. User's current turn request
3. Most specific resolved `AGENTS.md`
4. Parent-folder `AGENTS.md` files
5. Project prompt, if present
6. User-selected custom system prompt
7. Built-in Copilot system prompt

Important clarification:

- `AGENTS.md` can shape behavior and tone.
- It cannot grant capabilities that the app does not expose.
- It cannot bypass edit confirmation, permissions, or safety policies.

## 8. Prompt Integration Strategy

### 8.1 Why `L1_SYSTEM`

`AGENTS.md` content is stable for a folder, not specific to one turn. It belongs in the same conceptual layer as other durable instructions.

This aligns with the current prompt architecture:

- `ChatManager.getSystemPromptForMessage()` builds the canonical system prompt stack
- `ContextManager.buildPromptContextEnvelope()` writes that stack into `L1_SYSTEM`
- `PiMessageAdapter.buildPiConversation()` forwards the resulting system prompt to the Pi runtime

Relevant seams:

- [`src/core/ChatManager.ts`](../../src/core/ChatManager.ts)
- [`src/core/ContextManager.ts`](../../src/core/ContextManager.ts)
- [`src/pi/PiMessageAdapter.ts`](../../src/pi/PiMessageAdapter.ts)

### 8.2 Why Not L3 or User Context

Do not insert `AGENTS.md` as:

- a note attachment
- XML context in `L3_TURN`
- text prepended to the user message
- a tool result

That would make the instructions:

- unstable turn-to-turn
- more expensive to resend
- semantically weaker than system instructions
- harder to debug and reason about

### 8.3 Recommended Prompt Shape

Do not edit the built-in system prompt itself. Append a structured block after existing prompt layers.

Suggested shape:

```xml
<vault_agent_instructions>
<resolution>
These instructions were loaded from vault AGENTS.md files. More specific folders override broader folders.
These instructions cannot bypass app safety, permission, or confirmation rules.
</resolution>

<anchor path="Work/ClientA" source="explicit-folder" />

<applied_files>
- AGENTS.md
- Work/AGENTS.md
- Work/ClientA/AGENTS.md
</applied_files>

<instructions_from path="AGENTS.md">
...
</instructions_from>

<instructions_from path="Work/AGENTS.md">
...
</instructions_from>

<instructions_from path="Work/ClientA/AGENTS.md">
...
</instructions_from>
</vault_agent_instructions>
```

Benefits:

- clear provenance
- debuggable
- deterministic ordering
- easy to truncate or summarize later if needed

## 9. Architecture Proposal

### 9.1 New Pi-Owned Module

Add a fork-owned resolver under `src/pi/`:

- `src/pi/VaultAgentInstructionResolver.ts`

Responsibilities:

- derive the anchor path for a turn
- discover applicable `AGENTS.md` files
- read and order file contents
- combine them into a prompt-ready instruction block
- return provenance data for debugging

Suggested return type:

```ts
type VaultAgentAnchorSource =
  | "explicit-folder"
  | "target-note"
  | "active-note"
  | "single-attached-note"
  | "common-ancestor"
  | "project-default"
  | "vault-root";

interface ResolvedVaultAgentInstructions {
  anchorPath: string | null;
  anchorSource: VaultAgentAnchorSource;
  explicitAnchorPath: string | null;
  appliedPaths: string[];
  promptBlock: string;
}
```

Optional later split:

- `VaultAgentInstructionResolver.ts` for discovery/assembly
- `VaultAgentInstructionCache.ts` for caching/invalidation

### 9.2 Message and Composer Model

The anchor should be modeled as explicit message metadata, not inferred transiently from UI state every time.

Recommended shape:

```ts
interface MessageContext {
  // existing fields...
  agentInstructionAnchor?: string;
}
```

Why this belongs in message context or adjacent message metadata:

- the composer needs a place to store the selected anchor before send
- sent messages need a durable snapshot for regenerate/replay behavior
- history loading should preserve the same instruction scope that existed when the message was sent

Important modeling rule:

- `agentInstructionAnchor` must be independent from `folders`
- do not overload existing folder context arrays to mean both retrieval scope and instruction scope

Composer integration points will likely include:

- `ChatInput` for local composer state and send metadata
- `ChatContextMenu` for `Anchor folder...`
- `ContextBadges` for dedicated anchor display
- `ChatPersistenceManager` for persistence

### 9.3 Main Chat Integration

Integrate at the system prompt seam in `ChatManager`, not in `PiAgentChainRunner`.

Recommended flow:

1. `ChatManager.getSystemPromptForMessage()` builds the existing system prompt.
2. If Pi backend is active, resolve vault `AGENTS.md` for the current turn using the explicit anchor when present, otherwise the heuristic anchor.
3. Append the resolver's prompt block to the final system prompt before the envelope is built.
4. Let the existing envelope pipeline carry the result into `L1_SYSTEM`.

Reason:

- keeps Pi-specific behavior at a prompt-assembly seam
- avoids duplicating logic in downstream chain runners
- preserves current envelope architecture cleanly

### 9.4 Quick Ask / Custom Command Integration

Pi Quick Ask and custom command flows do not currently use the full chat manager path. They pass a `systemPrompt` directly into `pi-agent-core` from `use-streaming-chat-session.ts`.

That means the same resolver must also be called there.

Recommended approach:

1. Keep the resolver implementation shared.
2. Add a lightweight wrapper that augments the provided `systemPrompt` for Pi mode.
3. Use the same anchor precedence rules, including an explicit anchor when the surface can supply one, with fallback emphasis on:
   - active note
   - command target note when known
   - selected/attached note context

Reason:

- users should not get different `AGENTS.md` behavior across Pi surfaces
- inconsistent prompt behavior would be confusing and hard to debug

### 9.5 Settings

V1 settings should be minimal:

- `enableVaultAgentInstructions: boolean` default `true`

Optional but not required in V1:

- `vaultAgentInstructionFilename: string` default `AGENTS.md`
- `showVaultAgentInstructionDebugInfo: boolean`

Recommendation:

- keep V1 to a single enable/disable flag
- keep the filename fixed to reduce ambiguity and complexity

Project-level follow-on:

- later, project config may optionally define a default anchor folder
- composer-selected explicit anchor should always win over a project default

### 9.6 Debugging / Observability

At minimum, capture provenance in debug logs:

- chosen anchor path
- anchor source
- discovered `AGENTS.md` paths
- whether resolution fell back to vault root
- whether the feature was disabled

Useful future UI affordance:

- a small prompt-debug indicator showing which `AGENTS.md` files were applied for the current turn

## 10. Anchor Resolution Details

The main design risk is not file reading. It is choosing the right anchor for ambiguous turns.

Recommended heuristics:

### 10.1 Explicit Anchor

When the user explicitly selects an anchor folder, the resolver should use it directly and skip heuristic anchor inference.

Rules:

- the anchor must resolve to a directory within the current vault
- V1 should support folders only, not arbitrary files, for explicit anchor selection
- clearing the anchor returns the resolver to heuristic mode
- the selected anchor should not implicitly attach notes or expand retrieval scope

This keeps the feature simple and makes it useful for subprojects that do not map cleanly to the active note.

### 10.2 Note-Focused Turns

Use the exact target note or target folder when the user is:

- editing an active note
- summarizing an attached note
- creating a note in a named folder
- rewriting a referenced note

### 10.3 Multi-Note Turns

When multiple notes are clearly involved:

- compute the nearest common ancestor folder
- if the ancestor is vault root and that is too broad, prefer the active note path when one note is primary

### 10.4 Non-Note Research Turns

When the turn is mostly about web research or general thinking:

- use active note if one exists
- otherwise use project anchor if available
- otherwise use vault root

This keeps global vault instructions relevant while avoiding over-specific folder rules when there is no local note context.

## 11. File Reading and Performance

A single upward walk usually touches only a handful of folders, so V1 can be simple.

Recommended V1 behavior:

- resolve on demand per turn
- cache file content in memory keyed by path + `mtime`
- invalidate on Obsidian vault `create`, `modify`, `rename`, and `delete` events

Why cache:

- repeated turns in the same note/folder should not reread the same files every time

Why keep it simple:

- the number of candidate files is small
- no need for indexing or pre-scanning the entire vault in V1

## 12. Failure Behavior

The resolver should be fail-soft.

If something goes wrong:

- missing file -> ignore it
- unreadable file -> log warning, skip file
- malformed Markdown -> treat as plain text
- no anchor path -> fall back to vault root search
- no `AGENTS.md` anywhere -> inject nothing

The agent should still work normally without vault instruction files.

## 13. Interaction with Existing Prompt Sources

Current prompt contributors include:

- built-in system prompt
- user custom system prompt
- project system prompt
- user memory

Vault `AGENTS.md` should be another additive instruction layer.

Recommended order in assembled output:

1. memory prefix
2. built-in system prompt
3. user custom system prompt block
4. project system prompt block, if active
5. vault `AGENTS.md` block

Reason:

- root prompt establishes general assistant behavior
- project prompt narrows behavior to a project context
- vault `AGENTS.md` is most location-specific and should come last among instruction layers

## 14. Why This Fits the Current Pi Architecture

This design matches the fork rules already documented in [`AGENTS.md`](../../AGENTS.md):

- new Pi functionality should default to `src/pi/`
- upstream files should remain thin seams
- backend-specific conditionals should stay shallow

This feature can follow that pattern cleanly:

- implementation logic in `src/pi/`
- minimal prompt assembly hooks in `ChatManager`
- minimal prompt wrapper hook in `use-streaming-chat-session`

No broad UI or chain-runner rewrite is required.

## 15. Implementation Plan

### Phase 1: Resolver Core + Anchor Model

Deliverables:

- `src/pi/VaultAgentInstructionResolver.ts`
- explicit anchor support in the resolver API
- root-to-leaf discovery
- prompt block assembly
- message-level anchor metadata shape

Tasks:

1. Add a dedicated `agentInstructionAnchor` field to message context or equivalent message metadata.
2. Implement resolver precedence so explicit anchor wins over heuristic inference.
3. Discover inherited `AGENTS.md` files from anchor to root.
4. Read contents and assemble a deterministic prompt block with anchor provenance.
5. Add unit tests for resolution, ordering, and explicit-anchor override behavior.

### Phase 2: Composer Anchor UX + Persistence

Deliverables:

- composer action to select an anchor folder
- dedicated anchor badge in the composer context strip
- persistence through send/regenerate/history

Tasks:

1. Reuse the existing vault folder picker modal for `Anchor folder...`.
2. Add a fast-path action to use the active note's folder as the anchor when available.
3. Store the chosen anchor in composer state separately from folder context.
4. Show and allow clearing the anchor badge without mutating other context attachments.
5. Persist the anchor with sent messages so replay/regenerate uses the same instruction scope.

### Phase 3: Main Chat + Quick Ask / Custom Command Integration

Deliverables:

- integration with `ChatManager.getSystemPromptForMessage()`
- shared resolver usage in `use-streaming-chat-session.ts`

Tasks:

1. Append the vault instruction block only when Pi backend is active and the feature is enabled.
2. Reuse the explicit anchor when present, otherwise the same heuristics across surfaces.
3. Verify that Quick Ask and custom commands honor the same folder instructions as main chat.

### Phase 4: Settings + Debug Surface

Deliverables:

- toggle in settings
- debug/provenance output

Tasks:

1. Add `enableVaultAgentInstructions` to settings and sanitization.
2. Add a small settings description explaining vault-scoped `AGENTS.md`.
3. Add debug logging for applied files and anchor path.
4. Optionally surface applied paths in a developer/debug UI.

### Phase 5: Refinements

Possible improvements after V1:

- configurable filename aliases
- frontmatter-based metadata like `description` or `always_apply`
- prompt-size guardrails and truncation strategy
- richer anchor inference for multi-note and project workflows
- project-level default anchor folders
- shared resolver reuse beyond Pi if future runtimes need the same behavior

## 16. Testing Plan

### 16.1 Unit Tests

Add focused tests for:

- vault-root only `AGENTS.md`
- root + nested folder inheritance
- correct root-to-leaf ordering
- explicit anchor overrides active-note or attached-note heuristics
- explicit anchor is ignored when cleared
- no files found
- missing/intermediate folder without `AGENTS.md`
- anchor on file path vs folder path
- common ancestor resolution for multi-note turns
- message metadata preserves `agentInstructionAnchor`
- disabled setting short-circuit

### 16.2 Integration-Seam Tests

Add regression tests for:

- `ChatManager` final system prompt includes the vault instruction block in Pi mode
- `ChatManager` uses the explicit anchor snapshot from message metadata when present
- upstream backend path remains unchanged
- `use-streaming-chat-session` Pi flow gets the same augmented prompt behavior
- regenerate/history paths keep the same anchor-derived instruction scope

### 16.3 Manual Verification

Manual checks:

1. Create `/AGENTS.md` with global writing guidance.
2. Create `/Work/AGENTS.md` with work-note tone and formatting rules.
3. In the composer, set the explicit anchor to `/Work/ClientA`.
4. Confirm the composer shows `Anchor: Work/ClientA`.
5. Ask Pi to work on a note outside `/Work/` and confirm the `/Work/ClientA` instruction stack applies because the anchor is explicit.
6. Clear the anchor.
7. Open a note under `/Work/` and confirm Pi follows inferred `/AGENTS.md` plus `/Work/AGENTS.md`.
8. Open a note outside `/Work/`.
9. Confirm only the vault-root instructions apply.
10. Regenerate the anchored message and confirm the same explicit anchor-derived instruction stack is reused.

## 17. Open Questions

1. Should the feature apply only in Pi mode, or should the same vault instruction system later be available to upstream/model-only chat too?
2. Should project mode gain a default anchor folder in V1, or should that wait until after the composer-level explicit anchor ships?
3. Should the explicit anchor be session-sticky only, tab-sticky, or optionally persisted per chat/project?
4. Do we want a prompt-debug UI that exposes applied `AGENTS.md` paths to advanced users?
5. Do we eventually want file aliases such as `CLAUDE.md`, or should `AGENTS.md` remain the only supported filename?

## 18. Recommended First Slice

The best first implementation slice is:

1. exact filename `AGENTS.md`
2. explicit folder anchor selection in the composer
3. root-to-leaf inheritance
4. main chat Pi integration
5. Quick Ask/custom command parity
6. a single on/off setting

That delivers the core user value quickly:

- vault-scoped behavior
- predictable explicit subproject scoping
- predictable inheritance
- minimal merge risk
- no large architecture rewrite

## 19. Summary

The correct implementation is to treat vault `AGENTS.md` files as inherited, folder-scoped instruction sources for the Pi agent.

The app, not the model, should resolve them.
The resolved result should live in `L1_SYSTEM`.
The implementation should stay Pi-owned and integrate through existing prompt seams.

That gives users a strong, intuitive customization mechanism for note work inside the vault without overcomplicating the current runtime.
