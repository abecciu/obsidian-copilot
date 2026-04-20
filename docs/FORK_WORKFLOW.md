# Fork Workflow

This repository is now carrying a fork-specific `pi-agent-core` backend while still trying to stay close to upstream Obsidian Copilot.

The goal of this workflow is:

- keep upstream syncs easy
- keep fork-specific code isolated
- make future features like skills and project support easy to layer on

## Recommended Branch Model

Use these branches:

- `master`
  Keep this branch as close to upstream as possible.
- `pi-agent-backend`
  Long-lived fork branch containing the pi backend integration.
- feature branches off `pi-agent-backend`
  Use these for larger additions such as skills, project runtime features, or UI changes.

Recommended examples:

- `pi-agent-backend`
- `pi-skills`
- `pi-project-support`
- `pi-streaming-hardening`

## Recommended Remote Model

As of April 20, 2026, this clone has:

```bash
origin https://github.com/logancyang/obsidian-copilot
```

That means `origin` is currently pointing at upstream, not your personal fork.

For a maintainable fork workflow, use this remote layout instead:

- `upstream` -> `https://github.com/logancyang/obsidian-copilot`
- `origin` -> your fork, for example `git@github.com:<your-user>/obsidian-copilot.git`

## One-Time Remote Setup

If your personal fork already exists on GitHub, run:

```bash
git remote rename origin upstream
git remote add origin git@github.com:<your-user>/obsidian-copilot.git
git remote -v
```

If you prefer HTTPS instead of SSH:

```bash
git remote rename origin upstream
git remote add origin https://github.com/<your-user>/obsidian-copilot.git
git remote -v
```

Expected result:

```bash
origin   git@github.com:<your-user>/obsidian-copilot.git
upstream https://github.com/logancyang/obsidian-copilot
```

## Capturing The Current Work

If your current pi backend changes are still sitting on `master`, move them to a dedicated branch immediately:

```bash
git switch -c pi-agent-backend
git add .
git commit -m "Add pi agent backend support"
git push -u origin pi-agent-backend
```

If you do not want to commit everything in the working tree, stage only the fork-related files instead of `git add .`.

Relevant files for the pi backend integration include:

- `package.json`
- `package-lock.json`
- `src/agentBackend.ts`
- `src/pi/`
- `src/plusUtils.ts`
- `src/LLMProviders/chainManager.ts`
- `src/LLMProviders/chainManager.test.ts`
- `src/settings/model.ts`
- `src/settings/model.test.ts`
- `src/settings/v2/components/BasicSettings.tsx`
- `src/settings/v2/components/PlusSettings.tsx`
- `src/components/chat-components/ChatControls.tsx`
- `src/components/chat-components/ChatInput.tsx`
- `src/components/chat-components/ChatToolControls.tsx`
- `src/constants.ts`
- `src/encryptionService.ts`
- `src/plusUtils.piBackend.test.ts`

## Daily Development Workflow

For normal fork work:

```bash
git switch pi-agent-backend
git pull --rebase origin pi-agent-backend
```

For a new feature on top of the pi backend:

```bash
git switch pi-agent-backend
git switch -c pi-skills
```

When the feature is done:

```bash
git switch pi-agent-backend
git merge --ff-only pi-skills
git push origin pi-agent-backend
```

If `--ff-only` fails, rebase the feature branch first:

```bash
git switch pi-skills
git rebase pi-agent-backend
git switch pi-agent-backend
git merge --ff-only pi-skills
```

## Syncing Upstream Changes

Use this flow whenever you want the latest upstream changes:

### 1. Update your local `master`

```bash
git fetch upstream
git switch master
git reset --hard upstream/master
```

This keeps local `master` aligned to upstream exactly.

If you also want your fork's `master` branch on GitHub to match upstream:

```bash
git push --force-with-lease origin master
```

Only do this if you are intentionally using `master` as a mirror of upstream.

### 2. Rebase your fork branch onto the updated upstream base

```bash
git switch pi-agent-backend
git rebase master
```

If there are conflicts:

```bash
git status
```

Resolve only the intended fork-owned differences, then continue:

```bash
git add <resolved-files>
git rebase --continue
```

When the rebase is done:

```bash
git push --force-with-lease origin pi-agent-backend
```

That is the normal cost of keeping a long-lived fork branch rebased cleanly.

## Conflict Strategy

Prefer this rule:

- fork-owned behavior lives under `src/pi/` and `src/agentBackend.ts`
- upstream files should remain thin integration points

When rebasing, preserve:

- backend selection plumbing
- pi settings
- license bypass behavior for `agentBackend === "pi"`
- pi runner dispatch
- pi-specific tests

Be conservative in upstream-owned areas:

- do not rewrite large unrelated upstream code paths
- keep patches small and localized
- prefer adapter layers over deep invasive edits

## How To Add Future Fork Features

For the next stages such as skills, projects, or richer tool support:

1. branch from `pi-agent-backend`
2. keep new logic in `src/pi/` when possible
3. only touch upstream files to wire the feature in
4. add tests that lock down the fork-specific behavior
5. merge back into `pi-agent-backend`

That keeps the fork delta reviewable and makes future upstream rebases much cheaper.

## Recovery Commands

If you need to see what is different between your fork branch and upstream:

```bash
git diff master...pi-agent-backend
```

If you want a compact summary:

```bash
git log --oneline --decorate --graph master..pi-agent-backend
```

If you want to inspect just the fork-owned files:

```bash
git diff master...pi-agent-backend -- src/pi src/agentBackend.ts
```

## Practical Recommendation

For this repository, the simplest maintainable setup is:

- `master` mirrors upstream
- `pi-agent-backend` is your long-lived fork branch
- every substantial new feature branches off `pi-agent-backend`

That gives you the smallest possible ongoing merge surface while still letting you keep the upstream UI and Obsidian integration intact.
