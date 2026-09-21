#!/usr/bin/env python3
"""
loader.py — one-import access to the SDOC hackathon inbox (participants),
loaded from a Supabase Storage bucket.

    from loader import Inbox
    inbox = Inbox("supabase")
    for email in inbox:
        print(email["email_id"], email["subject"])
        for path in email["attachments"]:
            text = inbox.read_text(path)  # SI/BL .txt content

Older local-files / HTTP-server versions are commented out at the bottom
of this file for reference — we don't use local data anymore.

You do NOT have ground truth. Build a submission dict shaped like
sample_submission.json, then either score it with score_cli.py (if you
have a ground_truth.json) or upload it with inbox.submit(...).
"""
import json
import os
from pathlib import Path

DEFAULT_SUPABASE_BUCKET = "emails_and_attachment"


class Inbox:
    def __init__(self, source):
        self.source = source.rstrip("/")
        self.is_supabase = self.source == "supabase" or self.source.startswith("supabase://")
        self._supabase_client = None
        self.bucket = (self.source[len("supabase://"):] if "://" in self.source
                       else os.getenv("SUPABASE_BUCKET", DEFAULT_SUPABASE_BUCKET))

    # -- listing ---------------------------------------------------------
    def emails(self):
        """Return the list of email records (dicts)."""
        files = self._supabase_list("inbox")
        names = sorted(f["name"] for f in files if f["name"].startswith("email_"))
        return [json.loads(self._supabase_download(f"inbox/{name}")) for name in names]

    def __iter__(self):
        return iter(self.emails())

    def get(self, email_id):
        return json.loads(self._supabase_download(f"inbox/{email_id}.json"))

    # -- attachments -----------------------------------------------------
    def read_bytes(self, att_path):
        """Raw bytes of an attachment. att_path is the string exactly as it
        appears in email['attachments'] (e.g. 'attachments/email_004_SI.txt')."""
        return self._supabase_download(att_path.lstrip("/"))

    def read_text(self, att_path, encoding="utf-8"):
        return self.read_bytes(att_path).decode(encoding, errors="replace")

    # -- submission ------------------------------------------------------
    def submit(self, submission, filename="submission.json"):
        """Upload a submission as a JSON file under submissions/ in the
        same bucket and return the storage path. filename defaults to the
        frozen graded snapshot (submission.json); pass a different name
        (e.g. the_coach.py's submission_coach_{x}.json) to upload alongside
        it without ever overwriting it."""
        path = f"submissions/{filename}"
        data = json.dumps(submission, indent=2).encode()
        self._supabase().storage.from_(self.bucket).upload(
            path, data,
            file_options={"content-type": "application/json", "upsert": "true"},
        )
        return {"bucket": self.bucket, "path": path}

    def sample_submission(self):
        return json.loads(self._supabase_download("sample_submission.json"))

    # -- supabase helpers --------------------------------------------------
    def _supabase(self):
        if self._supabase_client is None:
            from supabase import create_client  # lazy import: optional dependency
            url = os.getenv("SUPABASE_URL")
            key = os.getenv("SUPABASE_KEY")
            if not url or not key:
                raise RuntimeError(
                    "Inbox(\"supabase\") needs SUPABASE_URL and SUPABASE_KEY in the environment"
                )
            self._supabase_client = create_client(url, key)
        return self._supabase_client

    def _supabase_download(self, path):
        return self._supabase().storage.from_(self.bucket).download(path)

    def _supabase_list(self, folder, page_size=1000):
        """list() only returns one page (Supabase defaults to 100 items),
        so page through with offset until a short page tells us we're done."""
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
    # tiny smoke test / demo against the Supabase bucket (only enabled source)
    from dotenv import load_dotenv
    load_dotenv()
    inbox = Inbox("supabase")
    ems = inbox.emails()
    print(f"{len(ems)} emails from Supabase bucket {inbox.bucket}")
    docs = [e for e in ems if e["attachments"]]
    print(f"{len(docs)} have attachments; example: {docs[0]['email_id']}")
    for a in docs[0]["attachments"]:
        head = inbox.read_text(a)[:60].replace("\n", " ") if a.endswith(".txt") else "(binary)"
        print(f"  {a}: {head}")
    for email in inbox:
        print(f"Email ID: {email['email_id']}")
        for att_path in email.get("attachments", []):
            if att_path.endswith(".txt"):
                text = inbox.read_text(att_path)
                print(f"  [Text] {att_path}: {text[:50]}...")
            else:
                raw = inbox.read_bytes(att_path)
                print(f"  [Binary] {att_path}: {len(raw)} bytes")
        break  # check just the first email


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
