# Image Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a lightweight multi-user image-generation studio centered on direct image output.

**Architecture:** FastAPI owns authentication, encrypted provider credentials, SQLite persistence, file storage, quota enforcement, and OpenAI-compatible proxying. React provides a responsive output-first workspace. A multi-stage Docker build produces one runtime container behind Caddy.

**Tech Stack:** Python 3.12, FastAPI, SQLite, SQLAlchemy, cryptography, pwdlib/Argon2, httpx, React 19, TypeScript, Vite, Vitest, Playwright, Docker, Caddy.

---

### Task 1: Backend skeleton and authentication

**Files:** `backend/app/main.py`, `backend/app/db.py`, `backend/app/auth.py`, `backend/tests/test_auth.py`

- [ ] Write registration/login/isolation tests and run `pytest backend/tests/test_auth.py -q`; expect failures because endpoints do not exist.
- [ ] Implement SQLite initialization, Argon2 password hashing, opaque cookie sessions, public registration, `admin/admin`, and forced admin password change.
- [ ] Re-run the test file and confirm all authentication tests pass.

### Task 2: Providers and encrypted credentials

**Files:** `backend/app/crypto.py`, `backend/app/providers.py`, `backend/tests/test_providers.py`

- [ ] Write failing tests for AES-GCM round trips, user scoping, base URL normalization, and mocked `/v1/models` discovery.
- [ ] Implement provider CRUD and model refresh without ever returning the stored key.
- [ ] Re-run provider tests and confirm they pass.

### Task 3: Workspaces, runs, assets, and quota

**Files:** `backend/app/workspaces.py`, `backend/app/assets.py`, `backend/tests/test_workspaces.py`

- [ ] Write failing tests for workspace ownership, 1,000 generated-image quota, image download, asset deletion, and cascading workspace file cleanup.
- [ ] Implement session/run persistence, safe user file paths, image metadata, quota calculation, and cleanup.
- [ ] Re-run workspace tests and confirm they pass.

### Task 4: OpenAI-compatible image and Responses proxy

**Files:** `backend/app/upstream.py`, `backend/app/generation.py`, `backend/tests/test_generation.py`

- [ ] Write failing mocked-upstream tests for JSON generations, multipart edits, `b64_json`, URL downloads, Responses prompt suggestions, timeouts, and upstream errors.
- [ ] Implement generation/edit/optimization services and persist successful outputs atomically.
- [ ] Re-run generation tests and then the complete backend suite.

### Task 5: Output-first React workspace

**Files:** `frontend/src/App.tsx`, `frontend/src/features/**`, `frontend/src/styles.css`, `frontend/src/**/*.test.tsx`

- [ ] Write failing component tests for login/register, collapsed sessions, dominant output canvas, direct generate form, provider drawer, theme selection, downloads, and quota state.
- [ ] Implement the smallest components that satisfy those workflows using Lucide icons and accessible native controls.
- [ ] Run `pnpm test` and fix until all frontend tests pass.

### Task 6: Packaging and browser verification

**Files:** `Dockerfile`, `docker-compose.yml`, `.env.example`, `frontend/playwright.config.ts`, `frontend/e2e/studio.spec.ts`

- [ ] Write a Playwright test for register -> provider -> model refresh -> create session -> generate -> select -> download -> delete.
- [ ] Build frontend and backend container; run backend and frontend suites.
- [ ] Capture desktop/mobile screenshots in light/dark themes and verify no overlap, clipping, blank canvas, or horizontal overflow.

### Task 7: Server deployment

- [ ] Upload the project to `/opt/image-studio` without secrets.
- [ ] Generate server-only session and encryption keys, start the Compose service on `127.0.0.1:8787`, and verify health.
- [ ] Configure the server's existing Caddy installation outside the repository to proxy `studio.basil.xin` to `127.0.0.1:8787`; validate and reload Caddy.
- [ ] Verify registration, login, provider model discovery, a live image request, image download, restart persistence, and public IP access.
