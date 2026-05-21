# Object storage (MEGA S4 / S3-compatible)

Driver DDD files, Toll Collect CSVs and signed-PDF artefacts are stored in
a **private** MEGA S4 bucket (S3-compatible). This replaces the previous
Dropbox integration. Files are always streamed through the backend — the
bucket stays private and no public/permanent URLs are generated.

## Configuration (env only — never hard-code keys)

```
MEGA_S4_ACCESS_KEY_ID=...
MEGA_S4_SECRET_ACCESS_KEY=...
MEGA_S4_BUCKET=your-bucket
MEGA_S4_ENDPOINT=https://s3.g.s4.mega.io
MEGA_S4_REGION=eu-central-1
```

The S3 client uses the custom endpoint, `forcePathStyle` (path-style
addressing), SigV4, and credentials from the env. See
`backend/services/storage_service.py`.

## Architecture

- `backend/services/storage_service.py` — the only module that talks to S3.
  Clean API: `download_bytes`, `head`, `upload_bytes`, `delete`,
  `list_prefix`, plus errors `StorageNotConfigured` / `StorageFileNotFound` /
  `StorageError`. It also exposes a small `StorageClient` whose method names
  mirror the old Dropbox SDK (`files_download`, `files_upload`,
  `files_list_folder`, `files_delete_v2`, `files_get_metadata`,
  `files_create_folder_v2`) so business code didn't have to change.
- `backend/services/dropbox_service.py` — kept for compatibility;
  `get_server_dropbox_client()` now returns the storage client and
  `build_drivers_data()` reads the bucket.
- `backend/samsara_sync.py` — the Samsara → storage ingestion cron uploads
  via boto3 directly.

## Key layout

Existing naming is preserved (paths are used as object keys, minus the
leading slash):

```
Samsara-DDD/{driver_name}/{card}_{YYYY-MM-DD}.ddd
TollCollect/{period} Maut ....csv
Verstoesse-Unterschriften/{driver}/{date}_{token}.pdf
```

## Errors handled

Missing env (`StorageNotConfigured`), missing object
(`StorageFileNotFound`), upload/download/list/connection failures
(`StorageError`). Routes that previously reported "Brak połączenia z
Dropbox" now do the same when storage isn't configured.

## Manual deployment test

On a host with the env vars set:

```
cd backend
python test_storage_s4.py
```

It uploads a throwaway object under `_selftest/`, downloads and verifies
it, confirms an **anonymous HTTP GET is refused** (bucket is private),
checks the not-found path, then deletes it.

## Migrating existing files from Dropbox

Copy the existing folder tree (`/Samsara-DDD`, `/TollCollect`,
`/Verstoesse-Unterschriften`) into the bucket keeping the same paths
(without the leading slash), e.g. with `rclone` (Dropbox remote → S3
remote pointed at the MEGA S4 endpoint).
