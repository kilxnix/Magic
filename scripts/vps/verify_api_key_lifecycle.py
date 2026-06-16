"""Live end-to-end check of the DB-backed API-key lifecycle. Runs ON the VPS;
reads ADMIN_TOKEN from .env, mints a quota-limited key, and exercises
deplete / 404-refund / exhaust / topup / revoke against 127.0.0.1:8000."""
import json
import re
import urllib.parse
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000"
admin_token = ""
for line in open("/opt/deckreps/app/.env", encoding="utf-8"):
    m = re.match(r"ADMIN_TOKEN=(.+)", line.strip())
    if m:
        admin_token = m.group(1)

ok = True


def call(method, path, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    safe = "/".join(urllib.parse.quote(seg) for seg in path.split("/"))
    req = urllib.request.Request(BASE + safe, data=data, method=method, headers=headers or {})
    try:
        r = urllib.request.urlopen(req, timeout=20)
        return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(label, cond, extra=""):
    global ok
    ok = ok and cond
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f"  -- {extra}" if extra else ""))


A = {"x-admin-token": admin_token, "Content-Type": "application/json"}

print("== mint a key (quota 3) ==")
st, created = call("POST", "/api/admin/api-keys", A, {"label": "verify-test", "quota": 3})
check("create -> 200 with secret", st == 200 and created and created.get("secret", "").startswith("csk_"))
secret = created["secret"] if created else ""
kid = created["keyId"] if created else ""
K = {"X-API-Key": secret}

print("== deplete + 404 refund ==")
check("req 1 (meta) -> 200", call("GET", "/api/card-support", K)[0] == 200)
check("404 unknown card -> 404", call("GET", "/api/card-support/No Such Card ZZZ", K)[0] == 404)
check("req 2 (meta) -> 200", call("GET", "/api/card-support", K)[0] == 200)
check("req 3 (meta) -> 200", call("GET", "/api/card-support", K)[0] == 200)
check("req 4 (meta) -> 403 quota exhausted", call("GET", "/api/card-support", K)[0] == 403)

print("== usage reflects refund (used 3, not 4) ==")
st, listing = call("GET", "/api/admin/api-keys", A)
row = next((k for k in listing["keys"] if k["keyId"] == kid), None) if listing else None
check("key shows requestsUsed == 3 (404 was refunded)", row and row["requestsUsed"] == 3,
      f"used={row['requestsUsed'] if row else '?'}, remaining={row['remaining'] if row else '?'}")

print("== top up + reuse ==")
check("topup +5 -> 200", call("POST", f"/api/admin/api-keys/{kid}/topup", A, {"addQuota": 5})[0] == 200)
check("req after topup -> 200", call("GET", "/api/card-support", K)[0] == 200)

print("== revoke -> 401 ==")
check("revoke -> 200", call("POST", f"/api/admin/api-keys/{kid}/revoke", A)[0] == 200)
check("revoked key -> 401", call("GET", "/api/card-support", K)[0] == 401)

print("== admin endpoints require auth ==")
check("create without admin token -> 401", call("POST", "/api/admin/api-keys", {"Content-Type": "application/json"}, {"label": "x"})[0] == 401)

print("\nRESULT:", "ALL PASS" if ok else "SOME FAILED")
