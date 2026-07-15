"""
Storage abstraction for project resources and work submissions.

Two modes, controlled by settings.STORAGE_PROVIDER:
  - "local": writes to disk under LOCAL_STORAGE_DIR. Fine for local dev only —
             do NOT use this in production on Railway, since the container
             filesystem is ephemeral and wiped on every redeploy/restart.
  - "s3":    uses boto3 against any S3-compatible endpoint. Cloudflare R2 is
             S3-compatible, so set S3_ENDPOINT_URL to your R2 endpoint
             (https://<account_id>.r2.cloudflarestorage.com) and this works
             unchanged against R2, AWS S3, or any other S3-compatible store.

Usage:
    from app.services.storage import storage

    key = storage.upload(file_bytes, key="projects/abc/resources/xyz.pdf", content_type="application/pdf")
    url = storage.get_download_url(key, filename="guidelines.pdf")
    storage.delete(key)
"""
import os
import uuid
from typing import Optional
from app.core.config import settings

LOCAL_STORAGE_DIR = os.environ.get("LOCAL_STORAGE_DIR", "/tmp/_storage")


def new_storage_key(prefix: str, filename: str) -> str:
    """Build a collision-safe storage key, e.g. projects/<id>/resources/<uuid>_<filename>."""
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"{prefix}/{uuid.uuid4().hex[:12]}_{safe_name}"


class LocalStorageBackend:
    def upload(self, data: bytes, key: str, content_type: Optional[str] = None) -> str:
        path = os.path.join(LOCAL_STORAGE_DIR, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return key

    def get_download_url(self, key: str, filename: Optional[str] = None, expires_in: int = 3600) -> str:
        # Served via our own backend route, not a direct disk path.
        return f"{settings.API_V1_STR}/storage/local/{key}"

    def read(self, key: str) -> bytes:
        path = os.path.join(LOCAL_STORAGE_DIR, key)
        with open(path, "rb") as f:
            return f.read()

    def delete(self, key: str) -> None:
        path = os.path.join(LOCAL_STORAGE_DIR, key)
        if os.path.exists(path):
            os.remove(path)


class S3StorageBackend:
    def __init__(self):
        import boto3
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION,
        )
        self._bucket = settings.S3_BUCKET_NAME

    def upload(self, data: bytes, key: str, content_type: Optional[str] = None) -> str:
        extra = {"ContentType": content_type} if content_type else {}
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, **extra)
        return key

    def get_download_url(self, key: str, filename: Optional[str] = None, expires_in: int = 3600) -> str:
        params = {"Bucket": self._bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        return self._client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires_in)

    def read(self, key: str) -> bytes:
        obj = self._client.get_object(Bucket=self._bucket, Key=key)
        return obj["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


def _build_backend():
    if settings.STORAGE_PROVIDER == "s3":
        return S3StorageBackend()
    return LocalStorageBackend()


storage = _build_backend()