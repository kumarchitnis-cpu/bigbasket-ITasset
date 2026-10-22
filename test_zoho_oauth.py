import os
import re
import sys
from getpass import getpass
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv


ENV_FILE = Path(__file__).resolve().with_name(".env")
if not ENV_FILE.is_file():
    sys.exit(f"ERROR: .env file not found: {ENV_FILE}")

load_dotenv(ENV_FILE, override=True)

client_id = (os.getenv("ENDPOINT_CENTRAL_CLIENT_ID") or "").strip()
client_secret = (os.getenv("ENDPOINT_CENTRAL_CLIENT_SECRET") or "").strip()
accounts_url = (
    os.getenv("ZOHO_ACCOUNTS_URL")
    or os.getenv("ZOHO_OAUTH_URL")
    or "https://accounts.zoho.in"
).strip().rstrip("/")

if accounts_url.endswith("/oauth/v2/token"):
    accounts_url = accounts_url[: -len("/oauth/v2/token")]
token_url = f"{accounts_url}/oauth/v2/token"

parsed_url = urlparse(token_url)
if parsed_url.scheme != "https" or not parsed_url.hostname:
    sys.exit("ERROR: Invalid Zoho Accounts URL.")
if not parsed_url.hostname.endswith(".zoho.in"):
    sys.exit("ERROR: Unexpected Zoho domain. Verify your account's data center.")
if not client_id or not client_secret:
    sys.exit(
        "ERROR: Set ENDPOINT_CENTRAL_CLIENT_ID and "
        "ENDPOINT_CENTRAL_CLIENT_SECRET in .env."
    )


def update_env_value(key, value):
    """Update one .env setting without printing its value."""
    text = ENV_FILE.read_text(encoding="utf-8")
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=.*$", re.MULTILINE)
    replacement = f"{key}={value}"

    if pattern.search(text):
        text = pattern.sub(lambda _: replacement, text, count=1)
    else:
        text = text.rstrip() + f"\n{replacement}\n"
    ENV_FILE.write_text(text, encoding="utf-8")


def post_token(payload):
    try:
        response = requests.post(token_url, data=payload, timeout=30)
    except requests.RequestException as exc:
        print("ERROR: Could not contact Zoho:", type(exc).__name__)
        sys.exit(1)

    try:
        result = response.json()
    except ValueError:
        result = {}

    if not response.ok or result.get("error"):
        print("ERROR: Zoho token request failed.")
        print("HTTP status:", response.status_code)
        print("Zoho error:", result.get("error", "Unexpected response"))
        sys.exit(1)

    if not result.get("access_token"):
        print("ERROR: Zoho response contains no access token.")
        sys.exit(1)
    return result


print("Zoho Endpoint Central OAuth setup")
print("Token endpoint:", token_url)
print("\nGenerate a fresh Self Client grant code using the required scopes.")
grant_code = getpass("Paste the fresh authorization/grant code: ").strip()
if not grant_code:
    sys.exit("ERROR: No grant code supplied.")

initial_token = post_token(
    {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": grant_code,
    }
)

refresh_token = initial_token.get("refresh_token")
if not refresh_token:
    print("Zoho issued an access token but did not return a refresh token.")
    print("The existing refresh token was not changed.")
    sys.exit(1)

update_env_value("ENDPOINT_CENTRAL_REFRESH_TOKEN", refresh_token)
os.environ["ENDPOINT_CENTRAL_REFRESH_TOKEN"] = refresh_token
print("\nSUCCESS: New refresh token saved in .env; its value was not printed.")

verification = post_token(
    {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }
)

print("\nSUCCESS: Zoho accepted the refresh token.")
print("Expires in:", verification.get("expires_in", "Not provided"))
print("API domain:", verification.get("api_domain", "Not provided"))
print("\nNext: Restart your backend and test the connection.")
