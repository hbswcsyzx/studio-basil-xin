import base64
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_path: Path
    storage_path: Path
    secret_key: str
    encryption_key: bytes
    cookie_secure: bool
    frontend_path: Path

    @classmethod
    def from_env(cls) -> "Settings":
        raw_key = os.environ.get("STUDIO_ENCRYPTION_KEY", "")
        try:
            encryption_key = base64.b64decode(raw_key, validate=True)
        except ValueError as exc:
            raise RuntimeError("STUDIO_ENCRYPTION_KEY must be valid base64") from exc
        if len(encryption_key) != 32:
            raise RuntimeError("STUDIO_ENCRYPTION_KEY must decode to 32 bytes")

        root = Path(__file__).resolve().parents[2]
        return cls(
            database_path=Path(os.environ.get("STUDIO_DATABASE_PATH", "/data/studio.db")),
            storage_path=Path(os.environ.get("STUDIO_STORAGE_PATH", "/data/storage")),
            secret_key=os.environ.get("STUDIO_SECRET_KEY", ""),
            encryption_key=encryption_key,
            cookie_secure=os.environ.get("STUDIO_COOKIE_SECURE", "true").lower()
            == "true",
            frontend_path=Path(os.environ.get("STUDIO_FRONTEND_PATH", root / "frontend" / "dist")),
        )

