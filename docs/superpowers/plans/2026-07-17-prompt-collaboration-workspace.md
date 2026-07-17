# Prompt Collaboration Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inline prompt collaboration workspace easy to restart, resize, and follow during multi-turn prompt authoring.

**Architecture:** Add one user-scoped deletion endpoint and keep all visual interaction state in `PromptCollaboration`. Use refs and layout effects for textarea sizing and scroll positioning, with CSS enforcing content-sized message rows.

**Tech Stack:** FastAPI, SQLite, React 19, TypeScript, Testing Library, Vitest, pytest.

---

### Task 1: Permanent collaboration reset API

**Files:**
- Modify: `backend/tests/test_reference_assets.py`
- Modify: `backend/image_studio/prompt_collaboration.py`

- [ ] Add a failing API test that creates collaboration history, deletes it, and verifies `GET` returns an empty list.
- [ ] Run `pytest backend/tests/test_reference_assets.py -q` and verify the new test fails because `DELETE` is not implemented.
- [ ] Add `DELETE /{workspace_id}/prompt-collaboration`, validate ownership, and delete rows scoped by `workspace_id` and `user_id`.
- [ ] Re-run `pytest backend/tests/test_reference_assets.py -q` and verify it passes.

### Task 2: Collaboration workspace interactions

**Files:**
- Modify: `frontend/src/PromptCollaboration.test.tsx`
- Modify: `frontend/src/PromptCollaboration.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add failing tests for confirmed reset, outgoing-message display, textarea resize semantics, and scrolling after new messages.
- [ ] Run `npm test -- PromptCollaboration.test.tsx` from `frontend` and verify failures describe the missing behavior.
- [ ] Add a compact toolbar with a reset action and confirmation, then call the deletion endpoint and clear local history.
- [ ] Optimistically append the outgoing user message, reconcile it with the server response, and scroll after every message-state change.
- [ ] Auto-size the textarea while keeping native vertical resize enabled within min/max bounds.
- [ ] Set the history grid to content-sized rows so the first message cannot stretch.
- [ ] Re-run the focused frontend test and verify it passes.

### Task 3: Verification and deployment

**Files:**
- No additional source files.

- [ ] Run the complete frontend test suite and production build.
- [ ] Run the complete backend test suite.
- [ ] Inspect the diff for unrelated changes and sensitive data.
- [ ] Commit and push the implementation.
- [ ] Pull and rebuild with Docker Compose in `/opt/studio-basil-xin`.
- [ ] Confirm container health and use the existing Chrome session to verify reset, input growth, compact messages, and automatic scrolling on `studio.basil.xin`.
