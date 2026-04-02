# Task Manager PRD (MVP)

## Overview
Personal, desktop-first task system that enforces a hard WIP limit, minimizes input friction, and captures working context automatically. A Telegram bot acts as a fast remote control. An optional agent mode performs bulk edits with strict `preview → apply → undo`.

## Problem
- Traditional task tools don’t prevent over-parallelization.
- Switching tasks is costly because context is lost.
- Excess input friction causes abandonment.

## Background & Rationale
- The user abandons tools that require more than minimal input; typing must be optional beyond the task title.
- The core behavior issue is over-parallelization; WIP=3 is the primary enforcement mechanism.
- Task switching is frequent (IDE + browser), so Return-anchor is required to reduce resume cost.
- The agent is for bulk operations, not autonomous control; safety requires `preview → apply → undo`.
- Privacy is critical; avoid screen capture by default and store only metadata.
- Desktop-first on macOS (menu bar + hotkey) is the fastest access path; Telegram is a lightweight remote control.

## Assumptions
- Single-user, personal workflow.
- Primary OS is macOS.
- Primary IDE is Cursor and primary browser is Comet.
- Telegram is acceptable for non-sensitive interactions.

## Goals
- Reduce parallel work to a fixed WIP=3.
- Make task capture and status changes one action.
- Preserve and restore task context with minimal effort.
- Enable safe bulk operations via agent mode.
- Minimize typing: only task title is required; everything else is click/auto.

## Non-Goals
- Team collaboration.
- Full calendar replacement.
- Full-screen monitoring by default.
- Cross‑platform desktop at MVP.

## Target User
- Single power user on macOS.
- Primary workflow: desktop (menu bar), secondary: Telegram.
- Uses IDE and browser frequently; needs fast context capture.

## Core User Flows
1. **Quick add**: enter a single-line task → appears in Queue.
2. **Start task**: move to Doing; if WIP=3, must Swap or keep in Queue.
3. **Pause/Resume**: capture context on pause; resume opens stored context.
4. **Done**: close task and prompt next action.
5. **Agent bulk edit**: user command → plan → preview → apply/undo.
6. **Triage**: one-by-one task cleanup with buttons (project/priority/due/skip).

## MVP Scope
### Desktop (macOS)
- Menu bar app + global hotkey.
- Projects with Kanban: Queue / Doing / Done.
- Hard WIP=3 with Swap dialog.
- Quick add (one line + Enter).
- Start / Pause / Done one-click actions (+ hotkeys).
- Context capture on Pause (active app + window title).
- Manual "Attach current" for context when needed.
- Agent panel with `preview → apply → undo`.
- Sensitive app list to skip context capture.

### Telegram Bot
- Quick inbox.
- Start / Pause / Done / Swap buttons.
- Notifications and reminders.
- Agent mode with `preview → apply → undo`.
- Triage mode with one-task-at-a-time buttons.

### Backend
- Single API + DB for desktop and bot.
- Sync tasks/projects and agent operations.

## UX Specification
- UI/UX wireframes and screen states will be defined in a separate UX spec document.

## Functional Requirements
- Task states: Inbox/Queue/Doing/Done (Inbox optional).
- WIP guard blocks >3 in Doing.
- Context attachment stored per task.
- Agent commands return structured options and defaults.
- Every change must be reversible (undo/redo), with deep history.
- Return-anchor stored on Pause and used by Resume.

## Non-Functional Requirements
- Privacy-first: no automatic screen capture at MVP.
- Offline-first desktop UX (cached data + sync later).
- Response time: core actions < 200ms locally.

## Interaction Principles
- One action → result (no multi-step forms).
- Agent questions must provide 2–6 buttons with a default choice when questions are needed.
- If data can be inferred and the action is fully undoable, agent may auto-apply.
- Explicit confirmation is required only for non-undoable operations or high ambiguity.
- No autonomous changes from screen context; only on explicit Apply.
- Undo/Redo must be first-class (dedicated buttons/shortcuts).

## Agent Execution Model (Preview → Apply → Undo)
- **Preview**: agent produces a proposed change plan and a diff of affected entities.
- **Apply**: by default, agent may auto-apply if the change is fully undoable.
- **Undo**: the system can roll back the last change (or a specific change id).
- **Redo**: the system can re-apply a reverted change.
- Non-undoable operations (external side effects) must still require explicit confirmation.

## Agent Framework (Extensibility)
- Use an extensible agent framework to support custom tools and future expansion.
- Candidates: LangGraph and LangChain (evaluate later based on MVP needs).

## Context Sources (MVP)
- Active app + window title via Accessibility.
- Cursor context via extension (workspace/file/git).
- Browser tab URL via extension (Comet).
- Manual attach button for edge cases.

## Sync Strategy (MVP)
- Simplest possible sync: local-first storage with periodic sync when backend is available.
- App remains fully functional offline; backend is optional at runtime.
- Conflict resolution (MVP): last-write-wins by `updated_at`, with conflicts logged for manual review.

## Permission Flows (MVP)
- Ask for Accessibility permission only when user enables context capture.
- Show a short rationale screen before the OS prompt.
- If denied, keep all core task flows working and provide a settings shortcut.

## Security & Privacy (MVP)
- Local by default: context metadata stored locally first.
- Backend sync stores tasks and metadata only; no screen content by default.
- Telegram is treated as a first-class client with parity to GUI data.
- Screen content is never sent to Telegram by default (metadata only).
- Tokens stored in OS keychain.
- Sensitive apps/domains list blocks context capture.

## Tech Stack (MVP)
- Desktop: cross-platform app with Tauri (Rust core) + React + TypeScript + Vite.
- Desktop capabilities: tray/menu bar, global hotkeys, permissions via native bridges.
- Local storage: SQLite (single-file DB).
- Backend API: FastAPI (Python) + Postgres in production; SQLite for local dev.
- Telegram: Telegram Bot API via a Python client.
- Agent orchestration: LangGraph + LangChain (tools/schema + extensibility).

## Acceptance Criteria (MVP)
- Creating a task requires only a single-line title and one action.
- Starting a 4th task is blocked unless user swaps or keeps it in Queue.
- Pause stores a Return-anchor; Resume opens the stored context.
- Agent bulk edits always show a preview and support undo.
- Triage can be completed with buttons only (no mandatory typing).
- Telegram supports Start/Pause/Done/Swap and agent actions with buttons.

## Data Model (Minimum)
- Project(id, name, order)
- Task(id, project_id, title, status, next_step, dod, return_ref, tags, created_at, updated_at)
- ContextSnapshot(id, task_id, app_name, window_title, url, file_path, created_at)
- AuditLog(id, actor, action, payload, created_at)
- ChangeSet(id, actor, plan, diff, undo_payload, redo_payload, created_at)

## Success Metrics
- % of time WIP<=3.
- Median time to resume a paused task.
- Weekly tasks completed per project.
- Daily active use on desktop and Telegram.

## Post‑MVP Candidates
- Calendar deep‑work slots + protected focus windows.
- Distraction detection using allowed‑context rules.
- Optional screen capture or OCR (off by default).
- Mobile sync beyond Telegram bot.

## Alignment With Best Practices
- GTD: Capture -> Clarify -> Organize -> Review -> Engage.
- Personal Kanban: visualization plus WIP limit.
- Time blocking / deep work: focused slots and distraction control (post-MVP).
- Behavioral design: reduce friction and rely on defaults, not willpower.

## WIP Override Mechanism
To avoid harming fast, high-volume workflows, allow a controlled override:
- When WIP is full, user can choose "Temporary overflow".
- Overflow requires a reason (select one button) and a timebox (15/30/60 min).
- System auto-reverts: after timebox, user must Swap or push overflow back to Queue.
- Overflow is tracked in AuditLog and visible in metrics.

## Glossary
- **WIP**: Work in progress; the hard limit is 3 tasks in Doing.
- **Queue**: Ready tasks not yet started.
- **Doing**: Active tasks, limited to WIP=3.
- **Return-anchor**: Stored context to resume work (app/title/URL/file).
- **Context snapshot**: A captured metadata set for a task’s working context.
- **Triage**: One-by-one cleanup with buttons (project/priority/due/skip).
- **Agent mode**: Structured bulk operations with `preview → apply → undo`.
- **Swap**: Replace a Doing task when WIP is full.
- **Attach current**: Manually link current context to a task.

## Risks
- Permission friction for context capture.
- Overly intrusive agent behavior.
- Data privacy concerns with third-party channels.

## Milestones
1. PRD finalized + scope locked.
2. UX wireframes for desktop + Telegram flows.
3. Technical spike for context capture + sync.
4. MVP build + 2-week self-test.
5. Iteration on friction points.

## Open Questions
- Local‑first vs backend‑first storage.
- Which contexts are essential at MVP beyond app/title?
- What is the minimal set of agent tools for usefulness?

## Release & QA
- Manual, real-world testing by the owner during MVP.

## Undo/Redo UX
- Desktop: global Undo/Redo buttons + shortcuts.
- Telegram: inline “Undo” after each agent action + `/undo` and `/redo` commands.
