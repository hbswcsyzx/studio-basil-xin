import json
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from .auth import get_current_user
from .security import decrypt_secret, encrypt_secret


router = APIRouter(prefix="/api/providers", tags=["providers"])


class ProviderInput(BaseModel):
    name: str
    base_url: str
    api_key: str


def normalize_base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="上游地址必须以 http:// 或 https:// 开头")
    return value


def api_endpoint(base_url: str, path: str) -> str:
    suffix = path.lstrip("/")
    if base_url.rstrip("/").endswith("/v1"):
        return f"{base_url.rstrip('/')}/{suffix}"
    return f"{base_url.rstrip('/')}/v1/{suffix}"


def fetch_models(base_url: str, api_key: str) -> list[str]:
    try:
        with httpx.Client(trust_env=False, timeout=30) as client:
            response = client.get(
                api_endpoint(base_url, "models"),
                headers={"Authorization": f"Bearer {api_key}"},
            )
        response.raise_for_status()
        return [item["id"] for item in response.json().get("data", []) if item.get("id")]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=502, detail=f"无法从上游获取模型：{exc}") from exc


def serialize_provider(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "has_api_key": bool(row["api_key_encrypted"]),
        "models": json.loads(row["models_json"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def owned_provider(request: Request, provider_id: str, user_id: str):
    with request.app.state.db.connect() as connection:
        row = connection.execute(
            "SELECT * FROM providers WHERE id=? AND user_id=?", (provider_id, user_id)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="上游配置不存在")
    return row


@router.get("")
def list_providers(request: Request, user=Depends(get_current_user)):
    with request.app.state.db.connect() as connection:
        rows = connection.execute(
            "SELECT * FROM providers WHERE user_id=? ORDER BY created_at", (user["id"],)
        ).fetchall()
    return [serialize_provider(row) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_provider(payload: ProviderInput, request: Request, user=Depends(get_current_user)):
    provider_id = str(uuid.uuid4())
    with request.app.state.db.connect() as connection:
        connection.execute(
            """INSERT INTO providers(id,user_id,name,base_url,api_key_encrypted)
               VALUES(?,?,?,?,?)""",
            (
                provider_id,
                user["id"],
                payload.name.strip() or "OpenAI Compatible",
                normalize_base_url(payload.base_url),
                encrypt_secret(request.app.state.settings.encryption_key, payload.api_key),
            ),
        )
        row = connection.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
    return serialize_provider(row)


@router.put("/{provider_id}")
def update_provider(
    provider_id: str, payload: ProviderInput, request: Request, user=Depends(get_current_user)
):
    owned_provider(request, provider_id, user["id"])
    with request.app.state.db.connect() as connection:
        connection.execute(
            """UPDATE providers SET name=?,base_url=?,api_key_encrypted=?,updated_at=CURRENT_TIMESTAMP
               WHERE id=? AND user_id=?""",
            (
                payload.name.strip() or "OpenAI Compatible",
                normalize_base_url(payload.base_url),
                encrypt_secret(request.app.state.settings.encryption_key, payload.api_key),
                provider_id,
                user["id"],
            ),
        )
        row = connection.execute("SELECT * FROM providers WHERE id=?", (provider_id,)).fetchone()
    return serialize_provider(row)


@router.delete("/{provider_id}", status_code=204)
def delete_provider(provider_id: str, request: Request, user=Depends(get_current_user)):
    owned_provider(request, provider_id, user["id"])
    with request.app.state.db.connect() as connection:
        connection.execute("DELETE FROM providers WHERE id=? AND user_id=?", (provider_id, user["id"]))


@router.post("/{provider_id}/models")
def refresh_models(provider_id: str, request: Request, user=Depends(get_current_user)):
    provider = owned_provider(request, provider_id, user["id"])
    api_key = decrypt_secret(request.app.state.settings.encryption_key, provider["api_key_encrypted"])
    models = sorted(set(fetch_models(provider["base_url"], api_key)))
    with request.app.state.db.connect() as connection:
        connection.execute(
            "UPDATE providers SET models_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (json.dumps(models), provider_id),
        )
    return {"models": models}
