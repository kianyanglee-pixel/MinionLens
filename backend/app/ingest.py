import os
import re
import urllib.parse
from pathlib import Path
import requests

BASE_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INBOX_DIR = BASE_DATA_DIR / "inbox"
ATTACHMENTS_DIR = BASE_DATA_DIR / "attachments"

def ensure_directories():
    """Ensure data directories exist."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

# ==========================================
# 1. AWS S3 Ingestion
# ==========================================
def sync_from_s3(s3_uri: str, target_dir: Path):
    """
    Syncs files from s3://bucket/prefix/ to local target_dir.
    Supports credentials from env or anonymous access for public buckets.
    """
    import boto3
    from botocore import UNSIGNED
    from botocore.client import Config

    ensure_directories()
    parsed = urllib.parse.urlparse(s3_uri)
    bucket_name = parsed.netloc
    prefix = parsed.path.lstrip("/")

    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    aws_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

    # Use explicit credentials if present, else unsigned config for public buckets
    if aws_key and aws_secret:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=aws_key,
            aws_secret_access_key=aws_secret,
            region_name=aws_region
        )
    else:
        # Allows reading public buckets without AWS credentials
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
    """
    Syncs files from gs://bucket/prefix/ to local target_dir.
    Supports authenticated or anonymous client access.
    """
    from google.cloud import storage

    ensure_directories()
    parsed = urllib.parse.urlparse(gcs_uri)
    bucket_name = parsed.netloc
    prefix = parsed.path.lstrip("/")

    # Check for credentials json path
    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and Path(cred_path).exists():
        client = storage.Client.from_service_account_json(cred_path)
    else:
        try:
            client = storage.Client()
        except Exception:
            # Fallback for publicly readable GCS buckets
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
    """Extracts 33+ character folder ID from common Google Drive link formats."""
    match = re.search(r"folders/([a-zA-Z0-9-_]+)", url_or_id)
    if match:
        return match.group(1)
    return url_or_id.split("?")[0].strip()


def sync_from_gdrive_folder(folder_url_or_id: str, target_dir: Path, api_key: str = None):
    ensure_directories()
    folder_id = extract_gdrive_folder_id(folder_url_or_id)
    api_key = api_key or os.getenv("GOOGLE_API_KEY")

    if not api_key:
        raise ValueError("GOOGLE_API_KEY is required to list public Google Drive folders.")

    print(f"[*] Parsed Clean Folder ID: {folder_id}")

    # 1. Query files in folder
    query = f"'{folder_id}' in parents and trashed = false"
    list_url = "https://www.googleapis.com/drive/v3/files"
    params = {
        "q": query,
        "key": api_key,
        "fields": "files(id, name, mimeType, size)",
        "pageSize": 100
    }

    print("[*] Fetching file list from Google Drive API...")
    res = requests.get(list_url, params=params, timeout=15)
    
    if res.status_code != 200:
        raise RuntimeError(f"Google Drive API error ({res.status_code}): {res.text}")

    items = res.json().get("files", [])
    print(f"[*] Found {len(items)} files in Google Drive folder.")

    if not items:
        return 0

    count = 0
    # Create persistent session with headers
    session = requests.Session()
    
    for idx, item in enumerate(items, 1):
        file_id = item["id"]
        filename = item["name"]
        print(f"[{idx}/{len(items)}] Downloading '{filename}'...")

        dest_path = target_dir / filename

        # Primary download URL (Direct Web Content link for public files)
        download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
        
        try:
            file_res = session.get(download_url, stream=True, timeout=20)
            
            # If Google serves a confirm token page (for large files) or falls back to API:
            if file_res.status_code != 200 or "text/html" in file_res.headers.get("Content-Type", ""):
                api_download_url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}"
                file_res = session.get(api_download_url, stream=True, timeout=20)

            file_res.raise_for_status()

            with open(dest_path, "wb") as f:
                for chunk in file_res.iter_content(chunk_size=32768):
                    if chunk:
                        f.write(chunk)
            
            count += 1
            print(f"    -> Saved to {dest_path.name}")

        except Exception as err:
            print(f"    [!] Failed downloading {filename}: {err}")

    return count

# ==========================================
# 4. Local Upload Handler (Multi-part Form)
# ==========================================
def save_uploaded_files(inbox_files, attachment_files):
    """Saves files uploaded directly from browser formData."""
    ensure_directories()
    inbox_count = 0
    att_count = 0

    for file_storage in inbox_files:
        if file_storage.filename.endswith(".json"):
            file_storage.save(str(INBOX_DIR / Path(file_storage.filename).name))
            inbox_count += 1

    for file_storage in attachment_files:
        file_storage.save(str(ATTACHMENTS_DIR / Path(file_storage.filename).name))
        att_count += 1

    return inbox_count, att_count