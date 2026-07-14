# Image Refinement and Style Presets Design

## Goals

- Display generated images and thumbnails completely, preserving aspect ratio without cropping or distortion.
- Make built-in and user-created style prompt templates editable per account.
- Let users refine an existing generated image with a short delta instruction instead of rewriting the original prompt.

## Image Fitting

The selected image fills the available output-stage box with `width: 100%`, `height: 100%`, and `object-fit: contain`. The stage, not the viewport document, defines the usable height after the header and generation controls are accounted for. Timeline, favorite, and reference thumbnails also use `object-fit: contain`; none use `cover`.

## Style Presets

Style presets are stored in `users.preferences_json` as a small per-user list. Built-in presets are supplied as defaults when the account has no saved list. Users can edit every prompt, reset built-in prompts, add custom presets, rename custom presets, and delete custom presets.

Settings gains a `风格预设` section. The main workspace removes the standalone `风格` label, renames the empty choice to `无预设风格`, lists saved presets, and ends with `管理 / 自定义风格…`, which opens the matching Settings section.

## Image Refinement

The selected-image action bar gains `引用此图继续修改`. Clicking it adds that generated asset to the existing reference strip, clears and focuses the prompt input, and changes the input guidance to ask only for the requested change. The user can remove the cited asset like any other reference.

On generation, cited asset IDs are submitted alongside uploaded reference files. The backend verifies every asset belongs to the current user, reads its stored bytes, and sends all references through the upstream `/images/edits` path. Uploaded and cited references share the existing four-image limit. Citing an existing asset does not duplicate storage or consume quota.

For cited generated assets, the outgoing prompt adds a concise preservation instruction: retain composition, identity, clothing, background, style, and other unspecified details; apply only the user's requested changes. The run stores cited asset IDs in `params_json`, so restoring a run can restore its refinement context when the source assets still exist.

## Errors And Safety

- Unknown or foreign asset IDs return 404 and are never sent upstream.
- More than four combined references returns 422.
- Deleted cited assets are omitted when restoring historical UI state, while the saved run remains viewable.
- Existing generation quota behavior is unchanged.

## Verification

- Frontend tests cover image fitting classes, style management navigation, editable presets, and cited-asset submission/restoration.
- Backend tests cover ownership, combined reference limits, stored image loading, edit-endpoint selection, and persisted reference IDs.
- Production browser QA checks portrait and landscape images in the main stage and every thumbnail surface, then completes a cited-image refinement flow.
