"""Object-storage service — MEGA S4 (S3-compatible) backend.

This is the single place that talks to S3. Business code stays storage-
agnostic: it goes through :func:`get_client`, which returns a small client
whose method names mirror the Dropbox SDK we used before
(``files_download`` / ``files_upload`` / ``files_list_folder`` /
``files_delete_v2`` / ``files_get_metadata`` / ``files_create_folder_v2``),
so the call sites barely change.

Design notes:
* credentials come from the environment only (see ``config``); nothing is
  hard-coded;
* the bucket stays private — we never create public/permanent URLs, files
  are streamed through the backend;
* path-style addressing + a custom endpoint are required for MEGA S4;
* "paths" are Dropbox-style (``/Samsara-DDD/Driver/file.ddd``); we strip the
  leading slash to form the S3 object key, and present listings back with a
  leading slash so existing path math keeps working.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone

from config import (
    MEGA_S4_ACCESS_KEY_ID,
    MEGA_S4_SECRET_ACCESS_KEY,
    MEGA_S4_BUCKET,
    MEGA_S4_ENDPOINT,
    MEGA_S4_REGION,
)

_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class StorageError(Exception):
    """Generic storage failure (connection, upload, etc.)."""


class StorageNotConfigured(StorageError):
    """MEGA S4 credentials / bucket are missing from the environment."""


class StorageFileNotFound(StorageError):
    """The requested object does not exist in the bucket."""


# ---------------------------------------------------------------------------
# Low-level S3 client
# ---------------------------------------------------------------------------

_s3 = None
_lock = threading.Lock()


def is_configured() -> bool:
    return bool(
        MEGA_S4_ACCESS_KEY_ID
        and MEGA_S4_SECRET_ACCESS_KEY
        and MEGA_S4_BUCKET
        and MEGA_S4_ENDPOINT
    )


def _bucket() -> str:
    return MEGA_S4_BUCKET


def _s3_client():
    """Lazily build a cached boto3 S3 client for the custom endpoint."""
    global _s3
    if _s3 is not None:
        return _s3
    with _lock:
        if _s3 is not None:
            return _s3
        if not is_configured():
            raise StorageNotConfigured(
                'MEGA S4 storage is not configured — set MEGA_S4_ACCESS_KEY_ID, '
                'MEGA_S4_SECRET_ACCESS_KEY, MEGA_S4_BUCKET (and optionally '
                'MEGA_S4_ENDPOINT / MEGA_S4_REGION).'
            )
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover
            raise StorageNotConfigured(
                'boto3 is not installed — add it to requirements.txt'
            ) from exc
        _s3 = boto3.client(
            's3',
            endpoint_url=MEGA_S4_ENDPOINT,
            region_name=MEGA_S4_REGION,
            aws_access_key_id=MEGA_S4_ACCESS_KEY_ID,
            aws_secret_access_key=MEGA_S4_SECRET_ACCESS_KEY,
            config=Config(
                signature_version='s3v4',
                s3={'addressing_style': 'path'},  # forcePathStyle
                retries={'max_attempts': 3, 'mode': 'standard'},
            ),
        )
        return _s3


def key_for(path: str) -> str:
    """Dropbox-style path -> S3 object key (no leading slash)."""
    return (path or '').lstrip('/')


def _is_not_found(exc) -> bool:
    resp = getattr(exc, 'response', None)
    if isinstance(resp, dict):
        code = (resp.get('Error') or {}).get('Code')
        if code in ('NoSuchKey', 'NotFound', '404'):
            return True
        status = (resp.get('ResponseMetadata') or {}).get('HTTPStatusCode')
        if status == 404:
            return True
    return type(exc).__name__ in ('NoSuchKey', 'NoSuchKeyError')


# ---------------------------------------------------------------------------
# Clean storage operations
# ---------------------------------------------------------------------------

def download_bytes(path: str) -> bytes:
    """Download an object's full content. Raises StorageFileNotFound / StorageError."""
    s3 = _s3_client()
    key = key_for(path)
    try:
        obj = s3.get_object(Bucket=_bucket(), Key=key)
        return obj['Body'].read()
    except Exception as exc:
        if _is_not_found(exc):
            raise StorageFileNotFound(f'Not found: {key}') from exc
        raise StorageError(f'Download failed for {key}: {exc}') from exc


def head(path: str) -> dict | None:
    """Return {name, size, modified(datetime), etag} or None when missing."""
    s3 = _s3_client()
    key = key_for(path)
    try:
        r = s3.head_object(Bucket=_bucket(), Key=key)
    except Exception as exc:
        if _is_not_found(exc):
            return None
        raise StorageError(f'Head failed for {key}: {exc}') from exc
    return {
        'name': os.path.basename(key),
        'size': r.get('ContentLength', 0),
        'modified': r.get('LastModified'),
        'etag': (r.get('ETag') or '').strip('"'),
    }


def upload_bytes(path: str, data: bytes, content_type: str | None = None) -> dict:
    """Upload bytes to the bucket (overwrites). Returns basic metadata."""
    s3 = _s3_client()
    key = key_for(path)
    extra = {}
    if content_type:
        extra['ContentType'] = content_type
    try:
        s3.put_object(Bucket=_bucket(), Key=key, Body=data, **extra)
    except Exception as exc:
        raise StorageError(f'Upload failed for {key}: {exc}') from exc
    return {'name': os.path.basename(key), 'size': len(data)}


def delete(path: str) -> None:
    s3 = _s3_client()
    key = key_for(path)
    try:
        s3.delete_object(Bucket=_bucket(), Key=key)
    except Exception as exc:
        raise StorageError(f'Delete failed for {key}: {exc}') from exc


def list_prefix(prefix: str) -> list[dict]:
    """List every object under a prefix. Returns dicts with
    {key, path_display, name, size, modified}."""
    s3 = _s3_client()
    pfx = key_for(prefix)
    if pfx and not pfx.endswith('/'):
        pfx += '/'
    out: list[dict] = []
    try:
        paginator = s3.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=_bucket(), Prefix=pfx):
            for obj in page.get('Contents', []) or []:
                key = obj['Key']
                if key.endswith('/'):
                    continue  # skip "folder" placeholder objects
                out.append({
                    'key': key,
                    'path_display': '/' + key,
                    'name': os.path.basename(key),
                    'size': obj.get('Size', 0),
                    'modified': obj.get('LastModified'),
                })
    except Exception as exc:
        raise StorageError(f'List failed for {pfx}: {exc}') from exc
    return out


# ---------------------------------------------------------------------------
# Dropbox-compatible client shim
# ---------------------------------------------------------------------------

class _Meta:
    """Mimics the bits of dropbox.files.FileMetadata the app reads."""

    def __init__(self, name='', path_display='', size=0, server_modified=None, content_hash=''):
        self.name = name
        self.path_display = path_display
        self.path_lower = path_display.lower()
        self.size = size
        self.server_modified = server_modified
        self.content_hash = content_hash
        self.is_file = True


class _Response:
    def __init__(self, content: bytes):
        self.content = content


class _Listing:
    def __init__(self, entries: list):
        self.entries = entries
        self.has_more = False
        self.cursor = ''


def _meta_from_head(path: str, h: dict) -> _Meta:
    return _Meta(
        name=h.get('name', os.path.basename(key_for(path))),
        path_display='/' + key_for(path),
        size=h.get('size', 0),
        server_modified=h.get('modified'),
        content_hash=h.get('etag', ''),
    )


class StorageClient:
    """Drop-in replacement for the subset of the Dropbox SDK we used."""

    def files_download(self, path):
        data = download_bytes(path)
        h = head(path) or {}
        return _meta_from_head(path, h), _Response(data)

    def files_upload(self, data, path, mode=None, mute=False, **_kw):
        upload_bytes(path, data)
        return _Meta(name=os.path.basename(key_for(path)), path_display='/' + key_for(path), size=len(data))

    def files_get_metadata(self, path):
        h = head(path)
        if h is None:
            raise StorageFileNotFound(f'Not found: {key_for(path)}')
        return _meta_from_head(path, h)

    def files_list_folder(self, folder, recursive=False):
        entries = [
            _Meta(
                name=it['name'],
                path_display=it['path_display'],
                size=it['size'],
                server_modified=it['modified'],
            )
            for it in list_prefix(folder)
        ]
        return _Listing(entries)

    def files_list_folder_continue(self, _cursor):
        return _Listing([])

    def files_delete_v2(self, path):
        delete(path)
        return None

    def files_create_folder_v2(self, _path):
        # S3 has no real folders; prefixes are implicit on upload.
        return None

    def users_get_current_account(self):
        # Used by the sync script only for a connectivity log line.
        class _Acct:
            class name:
                display_name = f'MEGA S4 ({MEGA_S4_BUCKET})'
        return _Acct()


def get_client():
    """Return a storage client, or None when storage isn't configured."""
    if not is_configured():
        return None
    try:
        _s3_client()  # surface config/credential problems early
    except StorageNotConfigured:
        return None
    return StorageClient()
