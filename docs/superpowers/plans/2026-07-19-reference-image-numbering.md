# Reference Image Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each visible reference number match the repeated `image[]` attachment number received by the image model.

**Architecture:** Keep the existing three ordered frontend collections and backend merge order. Add consecutive visual badges at render time, then centralize upstream filename and prompt numbering inside `generate_images` so every image-edit request uses the same contract.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, FastAPI, Python, pytest, httpx

---

### Task 1: Number Upstream Image Attachments

**Files:**
- Modify: `backend/tests/test_generation.py`
- Modify: `backend/image_studio/generation.py`

- [x] **Step 1: Write the failing upstream request test**

Extend `test_upstream_requests_receive_selected_size_quality_and_count` to pass two ordered references and assert both the filenames and prompt contract:

```python
edited = generate_images(
    **common,
    reference_images=[
        ("person-a.png", make_png(), "image/png"),
        ("person-b.png", make_png(), "image/png"),
    ],
)

sent_files = calls[1][1]["files"]
assert [item[1][0] for item in sent_files] == ["reference-01.png", "reference-02.png"]
assert "参考图 1 至参考图 2" in calls[1][1]["data"]["prompt"]
assert "第 N 个附件" in calls[1][1]["data"]["prompt"]
assert "位置以用户文字要求为准" in calls[1][1]["data"]["prompt"]
```

- [x] **Step 2: Run the backend test and verify RED**

Run:

```powershell
python -m pytest backend/tests/test_generation.py::test_upstream_requests_receive_selected_size_quality_and_count -q
```

Expected: FAIL because the current filenames retain their original names and the prompt lacks the numbering contract.

- [x] **Step 3: Add minimal numbering helpers**

Add these focused helpers above `generate_images`:

```python
def _reference_extension(mime_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime_type.lower(), ".png")


def reference_order_prompt(prompt: str, count: int) -> str:
    if count <= 0:
        return prompt
    return (
        f"{prompt}\n\n"
        f"参考图按附件顺序编号为参考图 1 至参考图 {count}。"
        "用户提到‘参考图 N’时，必须对应第 N 个附件；不要交换或重新排序。"
        "主体在画面中的位置以用户文字要求为准，不能仅根据参考图编号推断。"
    )
```

Apply the helpers inside `generate_images`:

```python
upstream_prompt = canvas_prompt(
    reference_order_prompt(prompt, len(reference_images)),
    size,
)

files = [
    (
        "image[]",
        (f"reference-{index:02d}{_reference_extension(mime)}", content, mime),
    )
    for index, (_name, content, mime) in enumerate(reference_images, start=1)
]
```

- [x] **Step 4: Run the focused backend test and verify GREEN**

Run:

```powershell
python -m pytest backend/tests/test_generation.py::test_upstream_requests_receive_selected_size_quality_and_count -q
```

Expected: `1 passed`.

- [x] **Step 5: Run backend generation regression tests**

Run:

```powershell
python -m pytest backend/tests/test_generation.py -q
```

Expected: all tests pass.

### Task 2: Display the Same Consecutive Numbers in the Reference Rail

**Files:**
- Modify: `frontend/src/Studio.test.tsx`
- Modify: `frontend/src/Studio.tsx`
- Modify: `frontend/src/styles.css`

- [x] **Step 1: Write the failing UI/request-order test**

Add a test that selects a generated asset, a library asset, and an uploaded file. It must assert:

```typescript
expect(screen.getByLabelText('参考图 1')).toHaveTextContent('1')
expect(screen.getByLabelText('参考图 2')).toHaveTextContent('2')
expect(screen.getByLabelText('参考图 3')).toHaveTextContent('3')

const orderedReferences = Array.from(submitted!.entries())
  .filter(([key]) => ['reference_asset_ids', 'library_reference_ids', 'references'].includes(key))
  .map(([key]) => key)
expect(orderedReferences).toEqual([
  'reference_asset_ids',
  'library_reference_ids',
  'references',
])
```

- [x] **Step 2: Run the focused frontend test and verify RED**

Run:

```powershell
pnpm exec vitest run Studio.test.tsx --maxWorkers=1 --testTimeout=20000
```

Expected: FAIL because no numbered badge exists.

- [x] **Step 3: Pass indexes through thumbnail components**

Update all three thumbnail components to accept an `index: number` prop and render:

```tsx
<span className="reference-index" aria-label={`参考图 ${index}`}>{index}</span>
```

Pass continuous offsets from the existing render order:

```tsx
{referencedAssets.map((asset, index) => (
  <CitedAssetThumb key={asset.id} asset={asset} index={index + 1} ... />
))}
{libraryReferences.map((asset, index) => (
  <LibraryReferenceThumb key={asset.id} asset={asset} index={referencedAssets.length + index + 1} ... />
))}
{references.map((file, index) => (
  <ReferenceThumb key={...} file={file} index={referencedAssets.length + libraryReferences.length + index + 1} ... />
))}
```

- [x] **Step 4: Style the badge without covering controls**

Add a compact top-left badge while keeping the remove control at top-right:

```css
.reference-index {
  position: absolute;
  top: 3px;
  left: 3px;
  z-index: 1;
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid color-mix(in srgb, #fff 46%, transparent);
  border-radius: 4px;
  background: rgba(10, 12, 11, .76);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
```

- [x] **Step 5: Run the focused frontend test and verify GREEN**

Run:

```powershell
pnpm exec vitest run Studio.test.tsx --maxWorkers=1 --testTimeout=20000
```

Expected: all `Studio.test.tsx` tests pass.

### Task 3: Full Verification, Commit, Push, and Deploy

**Files:**
- Verify all modified source and test files

- [ ] **Step 1: Run complete backend tests**

Run:

```powershell
python -m pytest backend/tests -q
```

Expected: all backend tests pass.

Observed: 46 backend tests passed and the pre-existing `backend/tests/test_frontend_styles.py::test_result_image_is_bounded_by_the_visible_stage` failed because it still expects `.selected-image-wrap { inset: 24px; }`, while the current full-stage layout intentionally uses `inset: 0`.

- [x] **Step 2: Run complete frontend tests and production build**

Run:

```powershell
pnpm --dir frontend exec vitest run --maxWorkers=1 --testTimeout=20000
pnpm --dir frontend build
```

Expected: all frontend tests pass and Vite completes the production build.

- [x] **Step 3: Review and commit implementation**

Run:

```powershell
git diff --check
git status --short
git add backend/image_studio/generation.py backend/tests/test_generation.py frontend/src/Studio.tsx frontend/src/Studio.test.tsx frontend/src/styles.css docs/superpowers/plans/2026-07-19-reference-image-numbering.md
git commit -m "fix: make reference image numbering explicit"
```

- [x] **Step 4: Push and deploy**

Run:

```powershell
git push origin main
ssh root@209.209.49.41 "cd /opt/studio-basil-xin && git pull --ff-only && docker compose up -d --build"
```

Expected: push succeeds and the production container becomes healthy.

- [x] **Step 5: Verify production**

Run:

```powershell
curl.exe -fsS https://studio.basil.xin/api/health
```

The existing logged-in Chrome tab was not available and a fresh navigation was blocked by the browser client, so browser UI verification could not be completed. No image-generation request was submitted.

Expected: health endpoint returns `{"status":"ok"}` and the browser UI matches the numbered-reference contract.
