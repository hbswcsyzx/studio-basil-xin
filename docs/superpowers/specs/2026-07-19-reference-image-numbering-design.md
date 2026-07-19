# Reference Image Numbering Design

## Goal

Make the reference order visible and explicit without assigning subjects to canvas positions. The image shown as reference N in the studio must be the Nth multipart image sent to the image model.

## Current Behavior

The studio renders and submits references in the same three groups: cited generated assets, reference-library assets, then uploaded files. The backend preserves those groups and sends the resulting list as repeated `image[]` multipart fields. Transport order is therefore already consistent with the visible order, but the UI, filenames, and prompt do not state the numbering explicitly.

## User Experience

- Every selected reference thumbnail shows a small, readable index badge: `1`, `2`, through `10`.
- Indexes follow the current top-to-bottom reference rail order.
- Removing a reference closes the gap and recomputes the visible indexes.
- Adding or restoring references uses the existing ordering behavior; drag-to-reorder is out of scope.
- A reference index identifies an input image only. It does not imply left/right, foreground/background, or any other composition position. Those decisions remain in the user's prompt.

## Request Contract

The frontend continues to submit the three existing reference groups in the exact order used for rendering. The backend constructs one ordered reference list and sends it upstream without sorting.

For an upstream image-edit request:

- multipart images are named `reference-01.<ext>`, `reference-02.<ext>`, and so on;
- the repeated multipart field remains `image[]` for compatibility with the current upstream;
- the prompt states that `参考图 N` means the Nth attached image and that composition positions must follow the user's text;
- the numbering instruction is added only when at least one reference image exists.

The filename extension is derived from the image MIME type. Original asset IDs and local filenames are not exposed to the upstream filename because they do not carry useful ordering semantics.

## Prompt Behavior

The system adds a compact technical instruction before the existing canvas constraint:

> 参考图按附件顺序编号为参考图 1 至参考图 N。用户提到“参考图 N”时，必须对应第 N 个附件；不要交换或重新排序。主体在画面中的位置以用户文字要求为准，不能仅根据参考图编号推断。

The user's prompt remains otherwise unchanged. Style presets and size constraints remain independent from this instruction.

## Error Handling

The existing ten-reference limit and validation remain unchanged. Numbering is generated from the final validated list, so there can be no missing or duplicate number in an upstream request.

## Testing

- Frontend regression test: mixed reference types display consecutive badges in the same sequence used by `FormData`.
- Backend regression test: mixed references retain their incoming order.
- Upstream request test: multipart filenames are consecutive and the prompt contains the exact numbering contract.
- Existing generation, reference-limit, prompt, and frontend tests must continue to pass.

## Non-Goals

- Guaranteeing deterministic image composition from a generative model.
- Automatically mapping reference 1 to the left side or reference 2 to the right side.
- Adding drag-to-reorder controls.
- Changing the ten-reference limit or reference storage behavior.
