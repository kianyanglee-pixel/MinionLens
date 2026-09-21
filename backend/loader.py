#!/usr/bin/env python3
"""
loader.py — access to the SDOC hackathon inbox, loaded either from a
Supabase Storage bucket or an isolated local batch folder.

    # Supabase source, using SUPABASE_URL/SUPABASE_KEY from the environment:
    inbox = Inbox("supabase")

    # A different Supabase project — any project's URL + key, not just the
    # one configured in .env:
    inbox = Inbox("supabase", url="https://xyzcompany.supabase.co", key="...")

    # Isolated local batch folder (String or Path):
    inbox = Inbox("backend/data/batches/run_20260921_084144_3f331a")
"""
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DEFAULT_SUPABASE_BUCKET = "emails_and_attachment"


class Inbox:
    def __init__(self, source="supabase", url=None, key=None):
        """`url`/`key` optionally point a "supabase" source at a specific
        Supabase project instead of the one configured via SUPABASE_URL/
        SUPABASE_KEY in the environment — lets a caller (e.g. the "database"
        ingest source in routes.py) connect to any Supabase project by
        passing its link, defaulting to the currently-configured one when
        left unset."""
        self._url_override = url
        self._key_override = key

        # 1. Determine whether source is Supabase or a local/batch directory
        if isinstance(source, Path):
            self.source = str(source)
            self.is_supabase = False
            self.local_root = source.resolve()
        else:
            clean_source = str(source).rstrip("/\\")
            self.source = clean_source
            self.is_supabase = clean_source == "supabase" or clean_source.startswith("supabase://")
            
            if not self.is_supabase:
                if clean_source == "data":
                    self.local_root = (Path(__file__).resolve().parent / "data").resolve()
                else:
                    self.local_root = Path(clean_source).resolve()
            else:
                self.local_root = None

        # 2. Setup Supabase attributes if required
        self._supabase_client = None
        self._thread_local = threading.local()
        if self.is_supabase:
            self.bucket = (
                self.source[len("supabase://"):]
                if "://" in self.source
                else os.getenv("SUPABASE_BUCKET", DEFAULT_SUPABASE_BUCKET)
            )
        else:
            self.bucket = None
            self.inbox_dir = self.local_root / "inbox"
            self.attachments_dir = self.local_root / "attachments"

    # -- listing ---------------------------------------------------------
    def _download_email(self, name, attempts=3):
        """One inbox/<name> download, with a couple of retries for any
        remaining transient blip."""
        last_err = None
        for _ in range(attempts):
            try:
                return json.loads(self._supabase_download(f"inbox/{name}"))
            except Exception as err:
                last_err = err
        raise last_err

    def emails(self):
        """Return the list of email records (dicts)."""
        if self.is_supabase:
            files = self._supabase_list("inbox")
            names = sorted(f["name"] for f in files if f["name"].startswith("email_"))
            # One HTTP download per file, done serially, took 3.5+ minutes
            # for the full 520-email dataset before any processing could
            # even start. These are independent GETs, so fetch them
            # concurrently instead — order is preserved by executor.map.
            # Benchmarked against the real 520-email dataset: 210s serial ->
            # 27s at 8 workers -> 8s at 16 (24-32 only shaved off ~1s more,
            # not worth the extra open connections).
            with ThreadPoolExecutor(max_workers=16) as executor:
                return list(executor.map(self._download_email, names))

        # Local directory reading from batch-isolated folder
        if not self.inbox_dir.exists():
            return []

        json_paths = sorted(self.inbox_dir.glob("*.json"))
        records = []
        for p in json_paths:
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                records.append(data)
            except Exception as err:
                print(f"[!] Failed to read {p.name}: {err}")
        return records

    def __iter__(self):
        return iter(self.emails())

    def get(self, email_id):
        if self.is_supabase:
            return json.loads(self._supabase_download(f"inbox/{email_id}.json"))

        target_file = self.inbox_dir / f"{email_id}.json"
        if not target_file.exists():
            raise FileNotFoundError(f"Email {email_id} not found in {self.inbox_dir}")
        return json.loads(target_file.read_text(encoding="utf-8"))

    # -- attachments -----------------------------------------------------
    def read_bytes(self, att_path):
        """Raw bytes of an attachment. att_path can be 'attachments/email_004_SI.txt'
        or a relative/filename path."""
        if self.is_supabase:
            return self._supabase_download(att_path.lstrip("/"))

        # Strip any leading 'attachments/' or directory wrappers
        filename = Path(att_path).name
        local_file = self.attachments_dir / filename

        # Fallback to direct path resolution if not in attachments_dir
        if not local_file.exists():
            fallback = self.local_root / att_path
            if fallback.exists():
                local_file = fallback
            else:
                raise FileNotFoundError(f"Attachment not found: {att_path} in {self.attachments_dir}")

        return local_file.read_bytes()

    def read_text(self, att_path, encoding="utf-8"):
        return self.read_bytes(att_path).decode(encoding, errors="replace")

    # -- submission ------------------------------------------------------
    def submit(self, submission, filename="submission.json"):
        """Upload a submission as a JSON file under submissions/ in the
        same bucket and return the storage path."""
        if not self.is_supabase:
            raise NotImplementedError("submit() is only supported when source='supabase'")

        # Was hardcoded to "submission.json" regardless of `filename` —
        # every the_coach.py smoke-test run was silently overwriting the
        # real, graded submission.json instead of writing its own
        # submission_coach_{x}.json, defeating the whole point of §2.4-C's
        # frozen-snapshot guarantee (the graded file must only ever reflect
        # one real batch run, never a test run).
        path = f"submissions/{filename}"
        data = json.dumps(submission, indent=2).encode()
        self._supabase().storage.from_(self.bucket).upload(
            path,
            data,
            file_options={"content-type": "application/json", "upsert": "true"},
        )
        return {"bucket": self.bucket, "path": path}

    def sample_submission(self):
        if not self.is_supabase:
            sample_path = self.local_root / "sample_submission.json"
            if sample_path.exists():
                return json.loads(sample_path.read_text(encoding="utf-8"))
            raise FileNotFoundError("sample_submission.json not found locally")
        return json.loads(self._supabase_download("sample_submission.json"))

    # -- supabase helpers --------------------------------------------------
    def _new_supabase_client(self):
        from supabase import create_client
        url = self._url_override or os.getenv("SUPABASE_URL")
        key = self._key_override or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError(
                'Inbox("supabase") needs a url+key (either passed in directly, '
                "or via SUPABASE_URL/SUPABASE_KEY in the environment)"
            )
        return create_client(url, key)

    def _supabase(self):
        if self._supabase_client is None:
            self._supabase_client = self._new_supabase_client()
        return self._supabase_client

    def _thread_local_supabase(self):
        """A separate client per worker thread — sharing one client's
        underlying HTTP/2 connection across threads was corrupting under
        real concurrency on Windows (WinError 10035 / httpcore
        stream-handling errors). Each thread pays client-construction cost
        once, not once per call. Used by every download path (attachment
        reads during real concurrent pipeline processing, email listing,
        single-email lookups) since all of them can now run from a worker
        thread, not just the main thread."""
        client = getattr(self._thread_local, "client", None)
        if client is None:
            client = self._new_supabase_client()
            self._thread_local.client = client
        return client

    def _supabase_download(self, path):
        return self._thread_local_supabase().storage.from_(self.bucket).download(path)

    def _supabase_list(self, folder, page_size=1000):
        store = self._supabase().storage.from_(self.bucket)
        results = []
        offset = 0
        while True:
            page = store.list(folder, {"limit": page_size, "offset": offset})
            results.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    inbox = Inbox("supabase")
    ems = inbox.emails()
    print(f"{len(ems)} emails from Supabase bucket {inbox.bucket}")

# =========================================================================
# METHOD 2 (local files) and METHOD 3 (HTTP server) — DISABLED, kept for
# reference only. We no longer use local data, so none of this is wired
# into the Inbox class above. If you ever need it back, the easiest path
# is to reintroduce is_http/local-path branching in each Inbox method.
# =========================================================================

# import urllib.request
#
# class _DisabledSources:
#     """Reference implementation of METHOD 2 and METHOD 3, not used."""
#
#     def __init__(self, source):
#         self.source = source.rstrip("/")
#         # METHOD 3 — HTTP server (docker)
#         self.is_http = self.source.startswith("http://") or self.source.startswith("https://")
#         # METHOD 2 — local files (static bundle)
#         if not self.is_http and not Path(self.source).is_absolute():
#             self.source = str(Path(__file__).resolve().parent / self.source)
#
#     def emails(self):
#         if self.is_http:
#             return self._get_json("/emails")
#         inbox_dir = Path(self.source) / "inbox"
#         return [json.loads(p.read_text())
#                 for p in sorted(inbox_dir.glob("email_*.json"))]
#
#     def get(self, email_id):
#         if self.is_http:
#             return self._get_json(f"/emails/{email_id}")
#         return json.loads((Path(self.source) / "inbox" / f"{email_id}.json").read_text())
#
#     def read_bytes(self, att_path):
#         if self.is_http:
#             return self._get_bytes("/" + att_path.lstrip("/"))
#         return (Path(self.source) / att_path).read_bytes()
#
#     def submit(self, submission):
#         """POST a submission to the server and return the scoreboard. HTTP only."""
#         if not self.is_http:
#             raise RuntimeError("submit() needs an HTTP source; run the docker server")
#         data = json.dumps(submission).encode()
#         req = urllib.request.Request(self.source + "/submit", data=data,
#                                      headers={"Content-Type": "application/json"})
#         with urllib.request.urlopen(req) as r:
#             return json.loads(r.read())
#
#     def sample_submission(self):
#         if self.is_http:
#             return self._get_json("/sample_submission")
#         return json.loads((Path(self.source) / "sample_submission.json").read_text())
#
#     def _get_json(self, path):
#         with urllib.request.urlopen(self.source + path) as r:
#             return json.loads(r.read())
#
#     def _get_bytes(self, path):
#         with urllib.request.urlopen(self.source + path) as r:
#             return r.read()
