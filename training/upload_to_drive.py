"""
Upload training data files to Google Drive for use in Colab.

First-time setup:
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Create a project (or use existing)
  3. Enable the Google Drive API
  4. Create OAuth 2.0 credentials (Desktop application)
  5. Download the JSON file and save as training/credentials.json

Usage:
    python -m training.upload_to_drive

The script will:
  - Open a browser for Google OAuth consent (first time only)
  - Create a folder "MTG-Training" on your Google Drive
  - Upload scorer_train.jsonl, composer_train.jsonl, and training_decks.jsonl
  - Also upload the training scripts (train_scorer.py, train_composer.py)
  - Print shareable links
"""

import os
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# If modifying these scopes, delete token.json to re-auth
SCOPES = ["https://www.googleapis.com/auth/drive.file"]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CREDENTIALS_FILE = PROJECT_ROOT / "training" / "credentials.json"
TOKEN_FILE = PROJECT_ROOT / "training" / "token.json"

DRIVE_FOLDER_NAME = "MTG-Training"

# Files to upload: (local_path, description)
FILES_TO_UPLOAD = [
    (PROJECT_ROOT / "data" / "scorer_train.jsonl", "Scorer training data"),
    (PROJECT_ROOT / "data" / "composer_train.jsonl", "Composer training data"),
    (PROJECT_ROOT / "data" / "training_decks.jsonl", "Cleaned training decks"),
    (PROJECT_ROOT / "training" / "train_scorer.py", "Scorer training script"),
    (PROJECT_ROOT / "training" / "train_composer.py", "Composer training script"),
    (PROJECT_ROOT / "training" / "train_scorer.ipynb", "Scorer Colab notebook"),
    (PROJECT_ROOT / "training" / "train_composer.ipynb", "Composer Colab notebook"),
]


def authenticate():
    """Authenticate with Google Drive API, opening browser if needed."""
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("Refreshing expired token...")
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                print(
                    f"ERROR: {CREDENTIALS_FILE} not found.\n\n"
                    "To set up Google Drive API access:\n"
                    "  1. Go to https://console.cloud.google.com/apis/credentials\n"
                    "  2. Create a project (or use existing)\n"
                    "  3. Enable 'Google Drive API' under APIs & Services\n"
                    "  4. Create OAuth 2.0 Client ID (type: Desktop application)\n"
                    "  5. Download the JSON and save it as:\n"
                    f"     {CREDENTIALS_FILE}\n"
                )
                sys.exit(1)

            print("Opening browser for Google OAuth consent...")
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), SCOPES
            )
            creds = flow.run_local_server(port=0)

        # Save token for next time
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
        print("Token saved for future use.")

    return creds


def find_or_create_folder(service, folder_name):
    """Find existing folder or create a new one. Returns folder ID."""
    # Search for existing folder
    query = (
        f"name = '{folder_name}' and "
        f"mimeType = 'application/vnd.google-apps.folder' and "
        f"trashed = false"
    )
    results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
    files = results.get("files", [])

    if files:
        folder_id = files[0]["id"]
        print(f"Found existing folder '{folder_name}' (ID: {folder_id})")
        return folder_id

    # Create new folder
    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    folder_id = folder["id"]
    print(f"Created folder '{folder_name}' (ID: {folder_id})")
    return folder_id


def upload_file(service, local_path, folder_id):
    """Upload a file to a Google Drive folder. Overwrites if exists."""
    filename = local_path.name
    file_size = local_path.stat().st_size
    size_mb = file_size / (1024 * 1024)

    # Check if file already exists in folder
    query = (
        f"name = '{filename}' and "
        f"'{folder_id}' in parents and "
        f"trashed = false"
    )
    results = service.files().list(q=query, spaces="drive", fields="files(id)").execute()
    existing = results.get("files", [])

    media = MediaFileUpload(str(local_path), resumable=True)

    if existing:
        # Update existing file
        file_id = existing[0]["id"]
        updated = service.files().update(
            fileId=file_id, media_body=media, fields="id, webViewLink"
        ).execute()
        print(f"  Updated {filename} ({size_mb:.1f} MB)")
        return updated
    else:
        # Create new file
        metadata = {"name": filename, "parents": [folder_id]}
        created = service.files().create(
            body=metadata, media_body=media, fields="id, webViewLink"
        ).execute()
        print(f"  Uploaded {filename} ({size_mb:.1f} MB)")
        return created


def main():
    print("=== Google Drive Upload for MTG Training Data ===\n")

    # Authenticate
    creds = authenticate()
    service = build("drive", "v3", credentials=creds)
    print()

    # Create/find folder
    folder_id = find_or_create_folder(service, DRIVE_FOLDER_NAME)
    print()

    # Upload files
    print("Uploading files...")
    uploaded = []
    for local_path, description in FILES_TO_UPLOAD:
        if not local_path.exists():
            print(f"  SKIP {local_path.name} — file not found")
            continue
        result = upload_file(service, local_path, folder_id)
        uploaded.append((local_path.name, description, result.get("webViewLink", "")))

    # Print summary
    print(f"\n{'='*60}")
    print(f"Uploaded {len(uploaded)} files to Google Drive / {DRIVE_FOLDER_NAME}")
    print(f"{'='*60}")
    for name, desc, link in uploaded:
        print(f"  {name:30s}  {desc}")
        if link:
            print(f"    {link}")

    print(f"\nIn Colab, mount Drive and access files at:")
    print(f"  /content/drive/MyDrive/{DRIVE_FOLDER_NAME}/")
    print(f"\nColab mount code:")
    print(f"  from google.colab import drive")
    print(f"  drive.mount('/content/drive')")
    print(f"  DATA_DIR = '/content/drive/MyDrive/{DRIVE_FOLDER_NAME}'")


if __name__ == "__main__":
    main()
