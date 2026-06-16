"""Idempotently add the card-support auth / rate-limit env mappings to the
web service's `environment:` block in docker-compose.yml. Contains no secrets;
actual values live in .env. Run on the VPS:  python3 patch_compose_card_support.py
"""
import sys

COMPOSE = "/opt/deckreps/app/docker-compose.yml"
ANCHOR = "      RATE_LIMIT_FEEDBACK_PER_MINUTE: ${RATE_LIMIT_FEEDBACK_PER_MINUTE:-10}\n"
ADD = (
    "      CARD_SUPPORT_API_KEYS: ${CARD_SUPPORT_API_KEYS:-}\n"
    "      CARD_SUPPORT_REQUIRE_AUTH: ${CARD_SUPPORT_REQUIRE_AUTH:-false}\n"
    "      CARD_SUPPORT_RATE_LIMIT_PER_MINUTE: ${CARD_SUPPORT_RATE_LIMIT_PER_MINUTE:-600}\n"
    "      CARD_SUPPORT_ANON_RATE_LIMIT_PER_MINUTE: ${CARD_SUPPORT_ANON_RATE_LIMIT_PER_MINUTE:-60}\n"
    "      TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-1}\n"
)

s = open(COMPOSE, encoding="utf-8").read()
if "CARD_SUPPORT_API_KEYS" in s:
    print("compose: already patched")
    sys.exit(0)
if ANCHOR not in s:
    print("compose: ANCHOR NOT FOUND — aborting")
    sys.exit(1)
open(COMPOSE, "w", encoding="utf-8").write(s.replace(ANCHOR, ANCHOR + ADD, 1))
print("compose: patched")
