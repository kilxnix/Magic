"""Live functional probe of the card-support licensing API. Hits the public
deployment and asserts each endpoint + edge case behaves as documented."""
import json
import os
import urllib.request
import urllib.error
import urllib.parse

BASE = "https://deckreps.app/api/card-support"
# The API now requires a key. Set CARD_SUPPORT_API_KEY in the environment.
API_KEY = os.environ.get("CARD_SUPPORT_API_KEY", "")
AUTH = {"X-API-Key": API_KEY} if API_KEY else {}
passed = failed = 0


def check(label, cond, extra=""):
    global passed, failed
    mark = "PASS" if cond else "FAIL"
    if cond:
        passed += 1
    else:
        failed += 1
    print(f"  [{mark}] {label}" + (f"  -- {extra}" if extra else ""))


def _encode(path):
    # Percent-encode each path segment (keep the leading slash and query).
    if not path:
        return path
    head, _, query = path.partition("?")
    segs = [urllib.parse.quote(s) for s in head.split("/")]
    return "/".join(segs) + (("?" + query) if query else "")


def get(path="", headers=None):
    req = urllib.request.Request(BASE + _encode(path), headers={**AUTH, **(headers or {})})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        # r.headers is case-insensitive (email.message); don't dict() it.
        return r.status, r.headers, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, None


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(),
        headers={**AUTH, "Content-Type": "application/json"}, method="POST",
    )
    try:
        r = urllib.request.urlopen(req, timeout=30)
        return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


print("== Meta ==")
st, hdrs, body = get()
check("GET meta -> 200", st == 200)
check("meta has version", bool(body and body.get("version")))
etag = hdrs.get("ETag") or hdrs.get("etag")
check("meta sends ETag", bool(etag), etag)
check("totalCards>0", body and body["totalCards"] > 0, str(body.get("totalCards")))

print("== Meta conditional (304) ==")
st2, _, _ = get(headers={"If-None-Match": etag} if etag else {})
check("If-None-Match -> 304", st2 == 304)

print("== Single-card lookup ==")
st, _, b = get("/Sol Ring")
check("Sol Ring -> 200 playable", st == 200 and b.get("playable") is True)
st, _, b = get("/Chaos Orb")
check("Chaos Orb -> supported but not playable",
      st == 200 and b.get("supported") and not b.get("playable"), str(b.get("knownManual")))
st, _, b = get("/1 Sol Ring (LEA) 1")
check("decorated name normalizes -> 200", st == 200 and b.get("name") == "Sol Ring")
st, _, b = get("/Westvale Abbey")
check("DFC front-face resolves -> 200", st == 200)
st, _, _ = get("/Totally Made Up Card XYZ")
check("unknown card -> 404", st == 404)

print("== Batch ==")
st, b = post("/batch", {"names": ["Sol Ring", "Shahrazad", "No Such Card ZZZ"]})
ok = st == 200 and b["summary"]["requested"] == 3 and b["results"]["No Such Card ZZZ"] is None
check("batch mixed -> summary", ok, json.dumps(b["summary"]) if b else "")
st, _ = post("/batch", {"names": [f"C{i}" for i in range(501)]})
check("batch >500 -> 400", st == 400)

print("== Preflight ==")
deck = "Commander\n1 Sol Ring\n\n// note\nDeck\n1 Westvale Abbey\n1 Shahrazad\n1 Made Up ZZZ\nRamp (3)"
st, b = post("/preflight", {"decklist": deck})
ok = st == 200 and b["deckPlayable"] is False
check("preflight decklist -> 200, deckPlayable false", ok,
      json.dumps(b["summary"]) if b else "")
check("preflight flags Shahrazad unsupported",
      b and any(c["name"] == "Shahrazad" for c in b["unsupported"]))
check("preflight flags unknown card",
      b and any("Made Up" in c["name"] for c in b["unknown"]))
check("preflight skips headers (Ramp/Commander/Deck not counted)",
      b and b["summary"]["uniqueCards"] == 4)  # Sol Ring, Westvale, Shahrazad, Made Up
st, b = post("/preflight", {"names": ["Sol Ring", "Sol Ring"]})
check("preflight dedupes names", b and b["summary"]["uniqueCards"] == 1 and b["summary"]["totalCards"] == 2)
st, _ = post("/preflight", {})
check("preflight empty -> 400", st == 400)
st, _ = post("/preflight", {"decklist": "x" * 200_001})
check("preflight oversized -> 400", st == 400)

print("== Unsupported feed ==")
st, _, b = get("/unsupported?limit=3")
check("feed -> 200, paginated", st == 200 and b["returned"] == 3 and b["count"] > 1000,
      f"count={b['count'] if b else '?'}")
check("feed entries are not playable", b and all(c["playable"] is False for c in b["cards"]))
check("feed has version", b and bool(b.get("version")))

print(f"\n{passed} passed, {failed} failed")
