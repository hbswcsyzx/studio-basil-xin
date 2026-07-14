import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


password_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def encrypt_secret(key: bytes, value: str) -> str:
    nonce = secrets.token_bytes(12)
    payload = nonce + AESGCM(key).encrypt(nonce, value.encode("utf-8"), None)
    return base64.urlsafe_b64encode(payload).decode("ascii")


def decrypt_secret(key: bytes, value: str) -> str:
    payload = base64.urlsafe_b64decode(value)
    return AESGCM(key).decrypt(payload[:12], payload[12:], None).decode("utf-8")


def new_session_token() -> tuple[str, str, str]:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    expires = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    return token, token_hash, expires


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()

