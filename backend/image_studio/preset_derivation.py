import base64
import io
import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from .auth import get_current_user
from .generation import validate_output_size
from .providers import api_endpoint, owned_provider
from .security import decrypt_secret
from .workspaces import owned_workspace


router = APIRouter(tags=["preset derivation"])


class StyleDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    prompt: str = Field(min_length=20, max_length=4000)
    confidence: float = Field(ge=0, le=1)
    accepted: list[str] = Field(max_length=12)
    changes: list[str] = Field(max_length=12)
    uncertain: list[str] = Field(max_length=12)


class ImageDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    size: str = Field(pattern=r"^\d+x\d+$")
    quality: str = Field(pattern=r"^(auto|medium|high)$")
    count: int = Field(ge=1, le=4)
    background: str = Field(pattern=r"^(auto|opaque|transparent)$")
    output_format: str = Field(pattern=r"^(png|jpeg|webp)$")
    output_compression: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    accepted: list[str] = Field(max_length=12)
    changes: list[str] = Field(max_length=12)
    uncertain: list[str] = Field(max_length=12)


class PresetDrafts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=1000)
    style_draft: StyleDraft
    image_draft: ImageDraft


def build_conversation_evidence(app, workspace_id: str, user_id: str) -> dict[str, Any]:
    with app.state.db.connect() as connection:
        run_rows = connection.execute(
            "SELECT rowid AS sequence,* FROM runs WHERE workspace_id=? AND user_id=? ORDER BY rowid",
            (workspace_id, user_id),
        ).fetchall()
        asset_rows = connection.execute(
            "SELECT rowid AS sequence,* FROM assets WHERE workspace_id=? AND user_id=? AND kind='generated' ORDER BY rowid",
            (workspace_id, user_id),
        ).fetchall()

    completed = [row for row in run_rows if row["status"] == "completed"]
    assets_by_run: dict[str, list[dict[str, Any]]] = {}
    asset_parent_run: dict[str, str] = {}
    for row in asset_rows:
        item = {
            "id": row["id"],
            "run_id": row["run_id"],
            "path": row["path"],
            "mime_type": row["mime_type"],
            "width": row["width"],
            "height": row["height"],
            "favorite": bool(row["favorite"]),
            "created_at": row["created_at"],
            "sequence": row["sequence"],
        }
        assets_by_run.setdefault(row["run_id"], []).append(item)
        if row["run_id"]:
            asset_parent_run[row["id"]] = row["run_id"]

    completed_ids = {row["id"] for row in completed}
    parent_ids_by_run: dict[str, set[str]] = {}
    children_by_run: dict[str, set[str]] = {run_id: set() for run_id in completed_ids}
    parsed_params: dict[str, dict[str, Any]] = {}
    for row in completed:
        try:
            params = json.loads(row["params_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            params = {}
        parsed_params[row["id"]] = params
        references = params.get("reference_asset_ids", [])
        if isinstance(references, str):
            references = [references]
        parents = {
            asset_parent_run[asset_id]
            for asset_id in references
            if asset_id in asset_parent_run and asset_parent_run[asset_id] in completed_ids
        }
        parent_ids_by_run[row["id"]] = parents
        for parent_id in parents:
            children_by_run[parent_id].add(row["id"])

    runs = []
    for row in completed:
        run_assets = assets_by_run.get(row["id"], [])
        runs.append(
            {
                "id": row["id"],
                "prompt": row["prompt"],
                "model": row["model"],
                "params": parsed_params[row["id"]],
                "status": "completed",
                "created_at": row["created_at"],
                "sequence": row["sequence"],
                "parent_run_ids": sorted(parent_ids_by_run[row["id"]]),
                "is_terminal": not children_by_run[row["id"]],
                "assets": run_assets,
            }
        )

    roots = [run for run in runs if not run["parent_run_ids"]]
    run_by_id = {run["id"]: run for run in runs}
    chains = []
    covered: set[str] = set()
    for root in roots:
        pending = [root["id"]]
        chain_ids = []
        while pending:
            current = pending.pop(0)
            if current in chain_ids:
                continue
            chain_ids.append(current)
            pending.extend(sorted(children_by_run[current], key=lambda item: run_by_id[item]["sequence"]))
        covered.update(chain_ids)
        chains.append(
            {
                "run_ids": chain_ids,
                "changes": [run_by_id[item]["prompt"] for item in chain_ids if run_by_id[item]["parent_run_ids"]],
            }
        )
    for run in runs:
        if run["id"] not in covered:
            chains.append({"run_ids": [run["id"]], "changes": [run["prompt"]]})

    return {
        "workspace_id": workspace_id,
        "runs": runs,
        "chains": chains,
        "statistics": {
            "successful_runs": len(runs),
            "generated_images": sum(len(run["assets"]) for run in runs),
            "favorite_images": sum(asset["favorite"] for run in runs for asset in run["assets"]),
            "refinement_steps": sum(bool(run["parent_run_ids"]) for run in runs),
            "failed_runs_excluded": sum(row["status"] == "failed" for row in run_rows),
        },
    }


def select_representative_assets(evidence: dict[str, Any], limit: int = 6) -> list[dict[str, Any]]:
    candidates: dict[str, tuple[int, dict[str, Any]]] = {}
    for run in evidence.get("runs", []):
        for asset in run.get("assets", []):
            score = (100 if asset.get("favorite") else 0) + (50 if run.get("is_terminal") else 0)
            score += int(asset.get("sequence", 0))
            previous = candidates.get(asset["id"])
            if previous is None or score > previous[0]:
                candidates[asset["id"]] = (score, asset)
    return [item for _, item in sorted(candidates.values(), key=lambda pair: pair[0], reverse=True)[:limit]]


def encode_representative_image(app, asset: dict[str, Any]) -> str:
    path = app.state.assets._safe_path(asset["path"])
    with Image.open(path) as opened:
        opened.load()
        image = opened.convert("RGB")
        image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, "JPEG", quality=84, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _public_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "runs": [
            {
                "prompt": run["prompt"],
                "params": run["params"],
                "is_terminal": run["is_terminal"],
                "favorite_result_count": sum(asset["favorite"] for asset in run["assets"]),
                "result_dimensions": [f"{asset['width']}x{asset['height']}" for asset in run["assets"]],
            }
            for run in evidence["runs"]
        ],
        "chains": evidence["chains"],
        "statistics": evidence["statistics"],
    }


def _responses_payload(model: str, evidence: dict[str, Any], images: list[str]) -> dict[str, Any]:
    instructions = (
        "你是图片创作偏好分析器。只分析提供的当前会话证据，不推断其他会话。"
        "收藏结果和微调链末端是强正向证据；微调提示词表示用户要求改变的内容；失败请求不代表审美否定。"
        "风格预设不得包含尺寸、比例、质量或数量，图片设置预设不得包含风格描述。"
        "样本不足时降低 confidence 并写入 uncertain。输出必须严格符合 JSON schema。"
    )
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": "请根据以下当前会话证据归纳一个风格草稿和一个独立的图片设置草稿：\n"
            + json.dumps(_public_evidence(evidence), ensure_ascii=False),
        }
    ]
    content.extend({"type": "input_image", "image_url": image} for image in images)
    return {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "conversation_preset_drafts",
                "strict": True,
                "schema": PresetDrafts.model_json_schema(),
            }
        },
    }


def _extract_output_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return payload["output_text"]
    for output in payload.get("output", []):
        for content in output.get("content", []):
            if content.get("text"):
                return content["text"]
    raise ValueError("上游没有返回归纳结果")


def request_preset_drafts(
    *, base_url: str, api_key: str, model: str, evidence: dict[str, Any], images: list[str]
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    attempts = [images, []] if images else [[]]
    first_error = None
    with httpx.Client(trust_env=False, timeout=120) as client:
        for index, attempt_images in enumerate(attempts):
            try:
                response = client.post(
                    api_endpoint(base_url, "responses"),
                    headers=headers,
                    json=_responses_payload(model, evidence, attempt_images),
                )
                response.raise_for_status()
                drafts = PresetDrafts.model_validate_json(_extract_output_text(response.json()))
                validate_output_size(drafts.image_draft.size)
                return {
                    "drafts": drafts.model_dump(),
                    "used_visual_analysis": bool(attempt_images),
                    "fallback_reason": "上游文本模型不支持图片输入，已改用提示词和参数归纳。" if index else None,
                }
            except httpx.HTTPStatusError as exc:
                if index == 0 and images:
                    first_error = exc
                    continue
                detail = getattr(exc.response, "text", str(exc))[:600]
                raise RuntimeError(f"预设归纳请求失败：{detail}") from exc
            except (ValueError, json.JSONDecodeError) as exc:
                raise RuntimeError(f"预设归纳结果格式不正确：{exc}") from exc
    raise RuntimeError(f"预设归纳请求失败：{first_error}")


@router.post("/api/workspaces/{workspace_id}/derive-presets")
def derive_presets(workspace_id: str, request: Request, user=Depends(get_current_user)):
    owned_workspace(request, workspace_id, user["id"])
    evidence = build_conversation_evidence(request.app, workspace_id, user["id"])
    if not evidence["runs"]:
        raise HTTPException(status_code=422, detail="当前会话还没有成功生成的图片，暂时无法归纳预设")

    preferences = json.loads(user["preferences_json"] or "{}")
    provider_id = preferences.get("default_text_provider_id")
    model = preferences.get("default_text_model")
    if not provider_id or not model:
        raise HTTPException(status_code=422, detail="请先在设置中选择默认文本模型")
    provider = owned_provider(request, provider_id, user["id"])
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    representatives = select_representative_assets(evidence)
    images = [encode_representative_image(request.app, asset) for asset in representatives]
    try:
        result = request_preset_drafts(
            base_url=provider["base_url"],
            api_key=api_key,
            model=model,
            evidence=evidence,
            images=images,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        **result["drafts"],
        "statistics": {**evidence["statistics"], "representative_images": len(images)},
        "used_visual_analysis": result["used_visual_analysis"],
        "fallback_reason": result["fallback_reason"],
    }
