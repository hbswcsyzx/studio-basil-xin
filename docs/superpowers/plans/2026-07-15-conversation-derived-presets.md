# Conversation-Derived Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fully manageable style and image-setting presets plus an AI action that derives editable preset drafts from the current conversation's prompts, refinement chains, parameters, favorites, and representative images.

**Architecture:** Keep the two preset libraries independent in per-user preferences. Add a backend derivation module that builds structured evidence and calls the user's default Responses model, while the frontend uses focused preset-management and review components instead of expanding the existing drawers further.

**Tech Stack:** FastAPI, Pydantic, SQLite JSON preferences, httpx, Pillow, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Preset Types, Defaults, And Preference Persistence

**Files:**
- Create: `frontend/src/presetDefaults.ts`
- Modify: `frontend/src/types.ts`
- Modify: `backend/image_studio/auth.py`
- Test: `backend/tests/test_auth.py`
- Test: `frontend/src/presetDefaults.test.ts`

- [ ] **Step 1: Write failing backend tests**

Add tests proving `style_presets: []` and `image_presets: []` remain explicit empty arrays, both libraries are user-scoped, and 51 entries return 422.

```python
def test_empty_preset_libraries_remain_empty(client, register):
    register()
    response = client.patch("/api/auth/preferences", json={"style_presets": [], "image_presets": []})
    assert response.status_code == 200
    assert response.json()["preferences"]["style_presets"] == []
    assert response.json()["preferences"]["image_presets"] == []
```

- [ ] **Step 2: Run tests and verify RED**

Run: `.\.venv\Scripts\pytest.exe backend\tests\test_auth.py -q`

Expected: image preset payload is ignored or rejected because the type does not exist.

- [ ] **Step 3: Add shared frontend types and backend validation**

Add `ImagePreset` with `id`, `name`, `size`, optional custom dimensions, `quality`, `count`, `background`, `output_format`, `output_compression`, and `builtin`. Add `image_presets?: ImagePreset[]` to `UserPreferences`. Add matching Pydantic input with count 1-4 and compression 0-100.

- [ ] **Step 4: Add defaults and resolvers**

Export rich `defaultStylePresets`, three `defaultImagePresets`, and resolvers that use defaults only when the preference key is `undefined`, never when it is an empty array.

```ts
export function resolveStylePresets(preferences: UserPreferences) {
  return preferences.style_presets === undefined ? defaultStylePresets : preferences.style_presets
}
export function resolveImagePresets(preferences: UserPreferences) {
  return preferences.image_presets === undefined ? defaultImagePresets : preferences.image_presets
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `.\.venv\Scripts\pytest.exe backend\tests\test_auth.py -q`

Run: `pnpm exec vitest run src/presetDefaults.test.ts`

Commit: `feat: add independent preset libraries`

### Task 2: Preset Management UI

**Files:**
- Create: `frontend/src/PresetManager.tsx`
- Create: `frontend/src/PresetManager.test.tsx`
- Modify: `frontend/src/SettingsDrawer.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write failing component tests**

Cover editing and renaming built-ins, deleting any preset with confirmation and immediate persistence, explicit restoration, segmented style/image views, and sticky unsaved state for text edits.

```ts
test('deletes a built-in style and persists the explicit empty list', async () => {
  await userEvent.click(screen.getByRole('button', { name: '删除 电影感' }))
  expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', expect.objectContaining({ method: 'PATCH' }))
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run src/PresetManager.test.tsx --reporter=dot`

Expected: `PresetManager` does not exist.

- [ ] **Step 3: Implement `PresetManager`**

Use props:

```ts
type Props = {
  user: User
  onUser: (user: User) => void
}
```

Provide `风格预设` and `图片设置预设` segmented controls, editable rows, delete buttons on all entries, restore buttons, add actions, validation, sticky save state, and immediate delete persistence through `/api/auth/preferences`.

- [ ] **Step 4: Integrate Settings**

Rename the navigation item to `预设管理`, render `PresetManager`, and remove the old inline style editor state and handlers from `SettingsDrawer`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/PresetManager.test.tsx src/SettingsDrawer.test.tsx --reporter=dot`

Commit: `feat: add complete preset management`

### Task 3: Apply Image Presets In The Workspace

**Files:**
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/Studio.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write failing workspace tests**

Test that selecting `横向 2K` applies all technical fields, manual changes set the selector to `自定义设置`, style selection changes no image parameter, and incompatible saved sizes show validation rather than substitution.

```ts
await userEvent.selectOptions(screen.getByRole('combobox', { name: '图片设置预设' }), 'landscape-2k')
expect(screen.getByRole('combobox', { name: '尺寸' })).toHaveValue('2048x1152')
expect(screen.getByRole('combobox', { name: '质量' })).toHaveValue('high')
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run src/Studio.test.tsx -t "image preset" --reporter=dot`

- [ ] **Step 3: Implement selector and state transitions**

Add `imagePreset` state, resolve per-user image presets, apply every preset field through one `applyImagePreset` function, and clear the selected preset whenever a technical control changes manually.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm exec vitest run src/Studio.test.tsx --reporter=dot`

Commit: `feat: apply image presets in studio`

### Task 4: Current-Conversation Evidence And Derivation API

**Files:**
- Create: `backend/image_studio/preset_derivation.py`
- Create: `backend/tests/test_preset_derivation.py`
- Modify: `backend/image_studio/main.py`

- [ ] **Step 1: Write failing evidence tests**

Create completed runs with cited asset IDs and assert that explicit delta instructions are listed as change evidence, terminal/favorite assets receive positive weight, failed runs are excluded, and representative images are unique and capped at six.

```python
evidence = build_conversation_evidence(app, workspace_id, user_id)
assert evidence["chains"][0]["changes"] == ["只把人物表情改得更严厉"]
assert len(select_representative_assets(evidence)) <= 6
```

- [ ] **Step 2: Verify RED**

Run: `.\.venv\Scripts\pytest.exe backend\tests\test_preset_derivation.py -q`

- [ ] **Step 3: Implement pure evidence helpers**

Implement `build_conversation_evidence`, `select_representative_assets`, and `encode_representative_image`. Preserve all successful prompts and params, build edges from `reference_asset_ids`, exclude failures, rank favorites and terminal assets, and resize images to a 768-pixel maximum edge in memory.

- [ ] **Step 4: Write failing endpoint tests**

Test 422 with no successful run, default text-provider selection, image-input fallback, strict result validation, and no preference mutation.

- [ ] **Step 5: Implement Responses call and router**

Add `POST /api/workspaces/{workspace_id}/derive-presets`. Use the user's default text provider/model, a strict JSON schema, up to six `input_image` items, one prompt-only retry on image rejection, and return drafts with analysis statistics. Never save preferences.

- [ ] **Step 6: Run tests and commit**

Run: `.\.venv\Scripts\pytest.exe backend\tests\test_preset_derivation.py -q`

Commit: `feat: derive presets from conversation evidence`

### Task 5: Derivation Review And Selective Save

**Files:**
- Create: `frontend/src/PresetReviewDialog.tsx`
- Create: `frontend/src/PresetReviewDialog.test.tsx`
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write failing dialog and workspace tests**

Cover the `归纳预设` action, loading state, missing-text-model routing, evidence display, low-confidence and prompt-only notices, editable drafts, save-style/save-image checkboxes, and selective preference update.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run src/PresetReviewDialog.test.tsx src/Studio.test.tsx -t "归纳" --reporter=dot`

- [ ] **Step 3: Implement review dialog**

Use props:

```ts
type Props = {
  open: boolean
  result: DerivedPresetResult | null
  user: User
  onClose: () => void
  onUser: (user: User) => void
}
```

Render statistics, accepted/change/uncertain evidence, editable drafts, and independent save checkboxes. Append only selected valid drafts to preferences.

- [ ] **Step 4: Integrate current-conversation action**

Add a compact `Sparkles` action to the conversation header. Call the derivation endpoint without provider/model fields, show progress without blocking image viewing, and open the review dialog on success.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/PresetReviewDialog.test.tsx src/Studio.test.tsx --reporter=dot`

Commit: `feat: review and save derived presets`

### Task 6: Full Verification, Push, Deploy, And Browser QA

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run complete verification**

Run: `.\.venv\Scripts\pytest.exe -q`

Run: `pnpm test -- --run --maxWorkers=1`

Run: `pnpm build`

Run: `git diff --check`

- [ ] **Step 2: Push**

Push `main` to `origin`, using the known reachable GitHub edge only if normal DNS is unavailable.

- [ ] **Step 3: Deploy**

On `/opt/studio-basil-xin`, run `git pull --ff-only origin main` and `COMPOSE_PROGRESS=plain docker compose up -d --build`. Verify the container is healthy and `/api/health` returns `{"status":"ok"}`.

- [ ] **Step 4: Browser QA without image generation**

Using the existing Studio tab and existing conversation:

- Delete and restore a built-in style preset.
- Edit and save a richer style prompt.
- Apply an image preset and confirm the exact technical controls.
- Run `归纳预设` against the current conversation only.
- Verify evidence, representative-image count, editable drafts, and selective save.
- Confirm light/dark and narrow layout remain coherent.
- Do not click `生成图片`.

- [ ] **Step 5: Report evidence**

Report commit, test counts, deployed health, browser observations, and whether visual analysis or prompt-only fallback was used.
