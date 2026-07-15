import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import assets, auth, generation, preset_derivation, providers, system_settings, workspaces
from .assets import AssetService
from .auth import get_current_user
from .db import Database
from .security import hash_password
from .settings import Settings


def create_app() -> FastAPI:
    settings = Settings.from_env()
    db = Database(settings.database_path)
    db.initialize()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    with db.connect() as connection:
        admin = connection.execute("SELECT id FROM users WHERE username_norm='admin'").fetchone()
        if not admin:
            connection.execute(
                """INSERT INTO users(id,username,username_norm,password_hash,role,must_change_password)
                   VALUES(?,?,?,?, 'admin', 1)""",
                (str(uuid.uuid4()), "admin", "admin", hash_password("admin")),
            )

    app = FastAPI(title="Studio Basil", docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.db = db
    app.state.assets = AssetService(db, settings.storage_path)
    app.include_router(auth.router)
    app.include_router(providers.router)
    app.include_router(workspaces.router)
    app.include_router(assets.router)
    app.include_router(generation.router)
    app.include_router(preset_derivation.router)
    app.include_router(system_settings.router)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/quota")
    def quota(request: Request, user=Depends(get_current_user)):
        used, limit = request.app.state.assets.quota(user["id"])
        with request.app.state.db.connect() as connection:
            conversations = connection.execute(
                "SELECT COUNT(*) FROM workspaces WHERE user_id=?", (user["id"],)
            ).fetchone()[0]
        return {
            "used": used,
            "limit": limit,
            "conversations_used": conversations,
            "conversations_limit": 100,
        }

    @app.get("/api/admin/users")
    def admin_users(request: Request, user=Depends(get_current_user)):
        if user["role"] != "admin":
            return JSONResponse(status_code=403, content={"detail": "需要管理员权限"})
        with request.app.state.db.connect() as connection:
            rows = connection.execute(
                """SELECT u.id,u.username,u.role,u.disabled,u.created_at,
                   (SELECT COUNT(*) FROM assets a WHERE a.user_id=u.id AND a.kind='generated') image_count
                   FROM users u ORDER BY u.created_at"""
            ).fetchall()
        return [dict(row) for row in rows]

    if settings.frontend_path.exists():
        app.mount("/", StaticFiles(directory=settings.frontend_path, html=True), name="frontend")
    return app


app = create_app()
