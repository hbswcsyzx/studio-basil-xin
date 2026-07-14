import json
import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .security import (
    hash_password,
    hash_session_token,
    new_session_token,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
COOKIE_NAME = "studio_session"


class Credentials(BaseModel):
    username: str
    password: str


class ProfileUpdate(BaseModel):
    username: str | None = None
    email: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=256)


class StylePresetInput(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=40)
    prompt: str = Field(min_length=1, max_length=4000)
    builtin: bool = False


class PreferencesUpdate(BaseModel):
    default_image_provider_id: str | None = None
    default_image_model: str | None = None
    default_text_provider_id: str | None = None
    default_text_model: str | None = None
    history_summary_enabled: bool | None = None
    style_presets: list[StylePresetInput] | None = Field(default=None, max_length=50)
    onboarding_completed: bool | None = None


def serialize_user(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "must_change_password": bool(row["must_change_password"]),
        "email": row["email"],
        "onboarding_completed": bool(row["onboarding_completed"]),
        "preferences": json.loads(row["preferences_json"] or "{}"),
    }


def get_current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="请先登录")
    with request.app.state.db.connect() as connection:
        row = connection.execute(
            """
            SELECT u.* FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
            """,
            (hash_session_token(token), datetime.now(UTC).isoformat()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="登录已失效")
    return dict(row)


def set_login_cookie(request: Request, response: Response, user_id: str) -> None:
    token, token_hash, expires = new_session_token()
    with request.app.state.db.connect() as connection:
        connection.execute(
            "INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
            (token_hash, user_id, expires),
        )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: Credentials, request: Request, response: Response):
    username = payload.username.strip()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=422, detail="用户名需为 3-32 位字母、数字或 . _ -")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="密码至少 8 位")
    user_id = str(uuid.uuid4())
    try:
        with request.app.state.db.connect() as connection:
            connection.execute(
                "INSERT INTO users(id, username, username_norm, password_hash) VALUES(?,?,?,?)",
                (user_id, username, username.casefold(), hash_password(payload.password)),
            )
    except Exception as exc:
        if "UNIQUE" in str(exc):
            raise HTTPException(status_code=409, detail="用户名已存在") from exc
        raise
    set_login_cookie(request, response, user_id)
    with request.app.state.db.connect() as connection:
        return serialize_user(connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())


@router.post("/login")
def login(payload: Credentials, request: Request, response: Response):
    with request.app.state.db.connect() as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE username_norm=?", (payload.username.strip().casefold(),)
        ).fetchone()
    if not user or user["disabled"] or not verify_password(user["password_hash"], payload.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    set_login_cookie(request, response, user["id"])
    return serialize_user(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with request.app.state.db.connect() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash=?", (hash_session_token(token),))
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
def me(user=Depends(get_current_user)):
    return serialize_user(user)


@router.patch("/profile")
def update_profile(payload: ProfileUpdate, request: Request, user=Depends(get_current_user)):
    updates = []
    values = []
    if payload.username is not None:
        username = payload.username.strip()
        if not USERNAME_RE.fullmatch(username):
            raise HTTPException(status_code=422, detail="用户名格式不正确")
        updates.extend(["username=?", "username_norm=?"])
        values.extend([username, username.casefold()])
    if payload.email is not None:
        email = payload.email.strip() or None
        if email and ("@" not in email or len(email) > 254):
            raise HTTPException(status_code=422, detail="邮箱格式不正确")
        updates.append("email=?")
        values.append(email)
    if payload.new_password is not None:
        if not payload.current_password or not verify_password(user["password_hash"], payload.current_password):
            raise HTTPException(status_code=400, detail="当前密码不正确")
        updates.extend(["password_hash=?", "must_change_password=0"])
        values.append(hash_password(payload.new_password))
    if updates:
        values.append(user["id"])
        try:
            with request.app.state.db.connect() as connection:
                connection.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", values)
        except Exception as exc:
            if "UNIQUE" in str(exc):
                raise HTTPException(status_code=409, detail="用户名已存在") from exc
            raise
    with request.app.state.db.connect() as connection:
        return serialize_user(connection.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())


@router.patch("/preferences")
def update_preferences(payload: PreferencesUpdate, request: Request, user=Depends(get_current_user)):
    preferences = json.loads(user["preferences_json"] or "{}")
    values = payload.model_dump(exclude_none=True)
    onboarding = values.pop("onboarding_completed", None)
    preferences.update(values)
    assignments = ["preferences_json=?"]
    params: list[object] = [json.dumps(preferences)]
    if onboarding is not None:
        assignments.append("onboarding_completed=?")
        params.append(int(onboarding))
    params.append(user["id"])
    with request.app.state.db.connect() as connection:
        connection.execute(
            f"UPDATE users SET {', '.join(assignments)} WHERE id=?", params
        )
        row = connection.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    return serialize_user(row)
