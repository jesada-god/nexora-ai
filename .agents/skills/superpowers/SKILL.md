---
name: superpowers
description: Execute disciplined multi-step coding work that requires repository investigation and verification, including feature implementation, bug fixes, refactoring, debugging, and code review. Use when Codex must inspect a codebase, determine root cause or current design behavior, plan changes, modify or review code, run relevant checks, and audit the final diff. Do not use for general questions, explanations, small text-only edits, trivial isolated changes, or tasks that do not require repository analysis.
---

# Superpowers

Follow this workflow in order. Do not skip a stage silently. Keep the user informed when a constraint, failed check, or new finding changes the plan.

## 1. Inspect before acting

- Read every applicable `AGENTS.md`, starting at the repository root and continuing through directories that govern the files in scope.
- Run `git status --short --branch` before making changes.
- Inspect the relevant source, tests, configuration, manifests, and existing scripts. Prefer `rg` and `rg --files` for discovery.
- Treat all existing tracked and untracked working-tree changes as user-owned. Do not overwrite, discard, reformat, or absorb unrelated work.

## 2. Define the task contract

- Summarize the requested outcome, explicit constraints, and acceptance criteria before editing.
- Identify assumptions and resolve them from repository evidence when possible.
- Ask for direction only when a missing decision would materially change the implementation or expand authority.
- For code review, establish the requested review range and remain read-only unless the user explicitly requests fixes.

## 3. Establish root cause or design basis

- Reproduce the bug or failing behavior when safe and practical.
- Trace the relevant control flow, data flow, state transitions, and call sites.
- Distinguish the root cause from symptoms and supporting evidence.
- For features and refactors, identify the current behavior, extension point, invariants, and reason the existing design cannot already satisfy the requirement.
- Do not edit until there is an evidence-backed explanation of what must change. If reproduction is impossible, state what evidence is available and the remaining uncertainty.

## 4. Plan the smallest viable change

- List the implementation steps and the exact files expected to change.
- Map each planned change to an acceptance criterion or verified root cause.
- Reuse existing abstractions and dependencies where they fit.
- Avoid opportunistic cleanup, broad formatting, unrelated refactors, and speculative generalization.

## 5. Implement narrowly

- Change only what is necessary to satisfy the task contract.
- Preserve existing public behavior, compatibility, error handling, and style outside the intended change.
- Add or adjust focused tests when behavior changes or a regression needs protection.
- Do not add a dependency unless the requirement cannot reasonably be met with the repository's existing stack. Explain the necessity before adding one.
- Never commit, push, deploy, or modify external systems unless the user separately and explicitly authorizes that action.
- Never run destructive Git commands, including `git reset --hard`, `git clean`, or commands that discard user changes.

## 6. Verify with real repository commands

- Discover available commands from actual manifests and scripts; do not invent command names.
- Run the smallest relevant checks first, then broader checks in proportion to risk. Consider lint, typecheck, focused tests, broader tests, and build when they exist and apply.
- Record each command, exit result, and material failure.
- Diagnose failures and distinguish failures caused by the change from pre-existing or environmental failures.
- Never claim success, correctness, or a passing check that was not actually verified.

## 7. Audit the diff

- Run `git status --short` and inspect the diff for every file intentionally changed.
- Confirm the diff matches the plan and contains no secrets, generated noise, debug artifacts, accidental formatting, or unrelated edits.
- Compare the final changed-file list with the pre-existing working-tree state so user changes are not misattributed.
- Correct scope drift before reporting completion.

## 8. Report honestly

- Lead with the outcome and whether the acceptance criteria were met.
- List files changed and summarize why each changed.
- Report verification commands and results, including checks not run and why.
- Report remaining risks, limitations, failures, assumptions, and follow-up work.
- If verification is incomplete, say the task remains unverified rather than presenting it as complete.

## Trigger examples

Positive triggers:

- "Implement pagination for this endpoint and add regression tests."
- "Find the root cause of this intermittent state bug and fix it."
- "Refactor this service without changing behavior, then run the relevant checks."
- "Review this branch for correctness and regressions."

Negative triggers:

- "What is dependency injection?"
- "Explain what this function does."
- "Fix the spelling in this sentence."
- "Rename this single heading."
