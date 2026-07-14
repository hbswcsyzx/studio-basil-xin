# Image Refinement and Style Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete image aspect ratios, add per-user editable style templates, and let users cite generated images for short-instruction refinements.

**Architecture:** Keep style templates in the existing per-user preferences JSON and expose them through shared frontend defaults. Extend the generation form with owned stored-asset IDs so the existing image-edit path can combine server assets and uploads without duplicating storage.

**Tech Stack:** React 19, TypeScript, FastAPI, Pydantic, SQLite, Vitest, pytest, Docker Compose

---

### Task 1: Complete aspect-ratio-preserving image fitting

**Files:**
- Modify: `frontend/src/Studio.test.tsx`
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/SessionDrawer.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add failing assertions that the selected image has `viewport-fit-image` and history thumbnails have `contained-thumbnail`.
- [ ] Run `pnpm test -- --run src/Studio.test.tsx --reporter=verbose`; expect failure because the classes are absent.
- [ ] Apply the classes to selected, timeline, favorite, and reference images. Size the selected image box explicitly and use `width:100%; height:100%; object-fit:contain`; use `object-fit:contain` for every thumbnail.
- [ ] Re-run the focused test; expect all Studio tests to pass.

### Task 2: Persist editable style presets per user

**Files:**
- Create: `frontend/src/stylePresets.ts`
- Modify: `frontend/src/types.ts`
- Modify: `backend/image_studio/auth.py`
- Modify: `backend/tests/test_auth.py`

- [ ] Add a failing API test that PATCHes `style_presets` and verifies `/api/auth/me` returns the validated list only for that user.
- [ ] Define a Pydantic `StylePresetInput` with bounded `id`, `name`, `prompt`, and `builtin`; add `style_presets` to `PreferencesUpdate`.
- [ ] Add frontend `StylePreset` types plus exported built-in defaults and `resolveStylePresets(user.preferences)`.
- [ ] Run `pytest backend/tests/test_auth.py -q`; expect the new test and existing auth tests to pass.

### Task 3: Add the Style Presets settings section

**Files:**
- Modify: `frontend/src/SettingsDrawer.tsx`
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/Studio.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add failing frontend tests for a `风格预设` settings navigation item, editable built-in prompt, custom preset creation, and a main-menu action named `管理 / 自定义风格…`.
- [ ] Add `styles` to `SettingsSection`, render the editor list, restore-default action for built-ins, add/delete actions for custom entries, and save the full list through `/api/auth/preferences`.
- [ ] Replace the static Studio map with resolved user presets. Rename the empty option to `无预设风格`, remove the separate visible `风格` label, and route the management sentinel to `openSettings('styles')`.
- [ ] Run `pnpm test -- --run src/Studio.test.tsx --reporter=verbose`; expect the style tests to pass.

### Task 4: Load owned generated images into the edit request

**Files:**
- Modify: `backend/image_studio/generation.py`
- Modify: `backend/tests/test_generation.py`

- [ ] Add failing tests for `reference_asset_ids`, foreign IDs, the four-reference combined limit, `/images/edits` selection, and `params.reference_asset_ids` persistence.
- [ ] Accept repeated `reference_asset_ids` form values, resolve each with `owned_asset`, read bytes through `AssetService._safe_path`, deduplicate IDs, and combine them with uploads up to four total references.
- [ ] Persist `reference_asset_ids` and total `reference_count` in `params_json`; return 404 for foreign/missing assets and 422 for more than four combined references.
- [ ] Run `pytest backend/tests/test_generation.py -q`; expect all generation tests to pass.

### Task 5: Add one-click cited-image refinement

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/Studio.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add failing tests that `引用此图继续修改` adds the selected asset to the reference strip, clears the prompt, and submits `reference_asset_ids` with the preservation instruction.
- [ ] Track `referencedAssets` separately from uploaded files, enforce the shared four-reference limit, render removable stored-asset thumbnails, and append each ID to generation `FormData`.
- [ ] Prefix cited-image prompts with the invariant-preservation instruction and restore cited assets from `run.params.reference_asset_ids` when revisiting a run.
- [ ] Run the focused Studio tests; expect all refinement tests to pass.

### Task 6: Verify and deploy

**Files:**
- Verify all changed frontend and backend files

- [ ] Run `pytest -q`; expect all backend tests to pass.
- [ ] Run `pnpm test -- --run`; expect all frontend tests to pass.
- [ ] Run `pnpm build` and `git diff --check`; expect success with no formatting errors.
- [ ] Commit, push `main`, update `/opt/studio-basil-xin`, and run `docker compose up -d --build`.
- [ ] Confirm the container is healthy and `/api/health` returns `{"status":"ok"}`.
- [ ] In Chrome, verify portrait and landscape images are fully contained in the main stage and thumbnails, edit a style preset, cite a generated image, submit a short refinement instruction, and confirm the new result is saved.
