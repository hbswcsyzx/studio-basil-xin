# Prompt Composer And Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prompt collaboration compact while correctly presenting structured assistant replies.

**Architecture:** Keep textarea measurement in `PromptCollaboration` and cap its calculated height at four rows. Render assistant content through `react-markdown` with `remark-gfm`; keep user content in a plain paragraph.

**Tech Stack:** React 19, TypeScript, react-markdown, remark-gfm, Vitest, Testing Library.

---

### Task 1: Lock the desired behavior with tests

**Files:**
- Modify: `frontend/src/PromptCollaboration.test.tsx`

- [ ] Assert `rows=1`, one-line height, a four-line height cap, and internal overflow.
- [ ] Assert assistant Markdown produces semantic strong and list elements while user Markdown stays literal.
- [ ] Run `npm test -- PromptCollaboration.test.tsx` and confirm both behaviors fail for the expected reason.

### Task 2: Implement the composer and renderer

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `frontend/src/PromptCollaboration.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add `react-markdown` and `remark-gfm` with the package manager.
- [ ] Change textarea measurement to a one-line minimum and four-line maximum, reset height after send/reset, and remove manual resize.
- [ ] Render assistant content with `ReactMarkdown` and `remarkGfm`; retain plain user paragraphs.
- [ ] Style Markdown blocks compactly inside collaboration messages.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Verify and deploy

**Files:**
- No additional source files.

- [ ] Run the frontend suite and production build.
- [ ] Inspect the diff and commit it.
- [ ] Push `main`, rebuild the server with Docker Compose, and verify health.
- [ ] Measure empty and multiline composer heights and inspect Markdown rendering in Chrome.
