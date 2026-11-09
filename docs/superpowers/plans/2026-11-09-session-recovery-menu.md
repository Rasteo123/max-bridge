# Session Recovery and Context Menu Implementation Plan

> **For agentic workers:** Use Superpowers systematic debugging and TDD for each bounded fix; the primary agent integrates, reviews, verifies and deploys.

**Goal:** Recover broken MAX sessions automatically and stop incidental dismissal of message menus.

**Architecture:** Gateway owns per-user session lifecycle; React menu owns deliberate dismissal. Independent fixes share no product files.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-session-recovery-menu-design.md`

## Global Constraints

- Preserve saved sessions and October MAX singleton compatibility.
- Recover only active accounts, only `chats.list` after `worker_failure`, retry once, at most one reset per user per 60 seconds.
- Share concurrent recovery and honor logout generation checks.
- Never replay mutations after ambiguous worker failures or log secrets/messages.
- Preserve menu appearance and deliberate dismissal.

## Review Focus

- Logout while close/reopen is in flight must prevent reviving the session.
- Repeated persistent errors and overlapping reads must not cause reset loops.
- Failures for one user must not reset another user's context.
- Background message updates, keyboard changes, and internal reaction scrolling must not dismiss an open menu.
- Outside tap, Escape, action selection, and chat change must still dismiss.

### Task 1: Gateway recovery (primary agent)

**Files:** `apps/api/src/runtime/bridge-runtime-gateway.ts`, `apps/api/src/runtime/bridge-runtime-gateway.test.ts`.

- [x] Write regressions for successful recovery, bounded retry/cooldown, concurrent callers, isolation, inactive accounts and logout races.
- [x] Run the new regressions; confirm failure due to absent recovery.
- [x] Extend safe read recovery with close/reopen from encrypted saved state, single-flight and cooldown; preserve existing missing-session path.
- [x] Run gateway tests and confirm success.

### Task 2: Menu persistence (menu worker)

**Files:** `apps/web/src/features/messenger/PressContextMenu.tsx`, related component and context-menu tests as required by root cause.

- [x] Reproduce incidental dismissal in regression tests and real browser.
- [x] Run regressions and confirm failure.
- [x] Apply minimal behavior fix preserving intentional dismissal and focus navigation.
- [x] Run context menu and related browser checks.

### Task 3: Integration and delivery (primary agent)

- [x] Review combined changes; run `npm run verify` and relevant Playwright tests.
- [ ] Commit source, publish branch, build and install a versioned server release with rollback available.
- [ ] Verify health and the actual worker's authenticated chat-list result without exposing private content.

## Verification and review

- Gateway recovery: 6 failing new regressions before implementation, all 9 new plus 20 existing gateway tests pass afterwards.
- Menu: incoming native auto-scroll, internal reactions scroll and resize each reproduced the failure before the fix.
- Review found short-height/expanded menus could place actions offscreen. Added a failing browser regression, viewport height limit, menu scrolling and expansion reposition; regression passes.
- Full verify: lint, types, build, 756 passing tests; 2 existing opt-in tests skipped. Browser suite: 15/15 pass.
- Existing responsive browser tests referenced a removed header button; they now exercise the current return swipe.
