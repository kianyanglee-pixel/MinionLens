import os
import re
import urllib.parse
from pathlib import Path
import requests

BASE_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "batches"

def get_batch_dirs(run_id: str):
    """Creates isolated directories for a specific run_id."""
    batch_root = BASE_DATA_DIR / run_id
    inbox_dir = batch_root / "inbox"
    attachments_dir = batch_root / "attachments"

    inbox_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    return batch_root, inbox_dir, attachments_dir

# ==========================================
# 1. AWS S3 Ingestion
# ==========================================
def sync_from_s3(s3_uri: str, target_dir: Path):
    import boto3
    from botocore import UNSIGNED
    from botocore.client import Config

    target_dir.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlparse(s3_uri)
    bucket_name = parsed.netloc
    prefix = parsed.path.lstrip("/")

    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    aws_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

    if aws_key and aws_secret:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=aws_key,
            aws_secret_access_key=aws_secret,
            region_name=aws_region
        )
    else:
        s3_client = boto3.client("s3", config=Config(signature_version=UNSIGNED))

    paginator = s3_client.get_paginator("list_objects_v2")
    count = 0

    print(f"[*] Listing S3 objects in: s3://{bucket_name}/{prefix}")
    for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue

            filename = Path(key).name
            dest_path = target_dir / filename
            print(f"    Downloading {filename} from S3...")
            s3_client.download_file(bucket_name, key, str(dest_path))
            count += 1

    return count

# ==========================================
# 2. Google Cloud Storage (GCS) Ingestion
# ==========================================
def sync_from_gcs(gcs_uri: str, target_dir: Path):
    from google.cloud import storage

    target_dir.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlparse(gcs_uri)
    bucket_name = parsed.netloc
    prefix = parsed.path.lstrip("/")

    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and Path(cred_path).exists():
        client = storage.Client.from_service_account_json(cred_path)
    else:
        try:
            client = storage.Client()
        except Exception:
            client = storage.Client.create_anonymous_client()

    bucket = client.bucket(bucket_name)
    blobs = bucket.list_blobs(prefix=prefix)

    count = 0
    print(f"[*] Listing GCS objects in: gs://{bucket_name}/{prefix}")
    for blob in blobs:
        if blob.name.endswith("/"):
            continue

        filename = Path(blob.name).name
        dest_path = target_dir / filename
        print(f"    Downloading {filename} from GCS...")
        blob.download_to_filename(str(dest_path))
        count += 1

    return count

# ==========================================
# 3. Google Drive Public/Shared Folder Ingestion
# ==========================================
def extract_gdrive_folder_id(url_or_id: str) -> str:
    match = re.search(r"folders/([a-zA-Z0-9-_]+)", url_or_id)
    if match:
        return match.group(1)
    return url_or_id.split("?")[0].strip()


def sync_from_gdrive_folder(folder_url_or_id: str, target_dir: Path, api_key: str = None):
    target_dir.mkdir(parents=True, exist_ok=True)
    folder_id = extract_gdrive_folder_id(folder_url_or_id)
    api_key = api_key or os.getenv("GOOGLE_API_KEY")

    if not api_key:
        raise ValueError("GOOGLE_API_KEY is required to list public Google Drive folders.")

    list_url = "https://www.googleapis.com/drive/v3/files"
    items = []
    page_token = None

    print(f"[*] Querying Google Drive folder {folder_id}...")
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "key": api_key,
            "fields": "nextPageToken, files(id, name, mimeType, size)",
            "pageSize": 1000
        }
        if page_token:
            params["pageToken"] = page_token

        res = requests.get(list_url, params=params, timeout=15)
        if res.status_code != 200:
            raise RuntimeError(f"Google Drive API error ({res.status_code}): {res.text}")

        data = res.json()
        items.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if not items:
        return 0

    count = 0
    session = requests.Session()

    for idx, item in enumerate(items, 1):
        file_id = item["id"]
        filename = item["name"]
        dest_path = target_dir / filename

        download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
        try:
            file_res = session.get(download_url, stream=True, timeout=20)
            if file_res.status_code != 200 or "text/html" in file_res.headers.get("Content-Type", ""):
                api_download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
                file_res = session.get(api_download_url, stream=True, timeout=20)

            file_res.raise_for_status()

            with open(dest_path, "wb") as f:
                for chunk in file_res.iter_content(chunk_size=32768):
                    if chunk:
                        f.write(chunk)
            count += 1
        except Exception as err:
            print(f"[!] Failed downloading {filename}: {err}")

    return count

# ==========================================
# 4. Batch-Isolated Local Upload Handler
# ==========================================
def save_uploaded_files_for_batch(run_id: str, inbox_files: list, attachment_files: list):
    batch_root, inbox_dir, attachments_dir = get_batch_dirs(run_id)

    inbox_count = 0
    for f in inbox_files:
        if f.filename:
            # Some browsers upload as 'inbox/email_01.json' or 'my_folder/email_01.json'
            # Using Path(f.filename).name extracts ONLY 'email_01.json'
            filename = Path(f.filename).name
            if filename.endswith(".json"):
                dest = inbox_dir / filename
                f.save(str(dest))
                inbox_count += 1

    att_count = 0
    for f in attachment_files:
        if f.filename:
            filename = Path(f.filename).name
            dest = attachments_dir / filename
            f.save(str(dest))
            att_count += 1

    print(f"[*] Saved {inbox_count} JSONs into {inbox_dir}")
    print(f"[*] Saved {att_count} attachments into {attachments_dir}")
    return inbox_count, att_count

if __name__ == "__main__":
    print(BASE_DATA_DIR)