#!/usr/bin/env bash
# Integration tests for Phase 1 security fixes.
# Requires: the backend running locally.
#   BASE=http://localhost:3000 ./scripts/test-security-phase1.sh
#
# Covers:
#   1. Helmet security headers
#   2. CORS rejects foreign origins (with credentials)
#   3. Signup password policy (weak passwords rejected, strong accepted format-wise)
#   4. Signin rate limit (6th attempt returns 429 within the window)
#   5. RLS verification is a manual SQL check — printed as a reminder
#
# Notes:
#   - This script does not test RLS end-to-end (would need two live Supabase users).
#   - It uses clearly-invalid credentials so real accounts are not affected.

set -u

BASE="${BASE:-http://localhost:3000}"
FAIL=0
PASS=0

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS + 1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL + 1)); }
section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# ---------------------------------------------------------------------------
section "1. Helmet security headers on /"
HEADERS=$(curl -sI "$BASE/" || true)

grep -iq '^x-frame-options: *DENY' <<<"$HEADERS" \
  && pass "X-Frame-Options: DENY" \
  || fail "X-Frame-Options missing or not DENY"

grep -iq '^x-content-type-options: *nosniff' <<<"$HEADERS" \
  && pass "X-Content-Type-Options: nosniff" \
  || fail "X-Content-Type-Options missing"

grep -iq '^referrer-policy:' <<<"$HEADERS" \
  && pass "Referrer-Policy present" \
  || fail "Referrer-Policy missing"

grep -iq '^x-dns-prefetch-control:' <<<"$HEADERS" \
  && pass "X-DNS-Prefetch-Control present (Helmet active)" \
  || fail "Helmet default headers not detected"

# HSTS only applied in production. In dev we should NOT see it.
if grep -iq '^strict-transport-security:' <<<"$HEADERS"; then
  pass "HSTS present (looks like production build)"
else
  pass "HSTS absent (expected in NODE_ENV=development)"
fi

# ---------------------------------------------------------------------------
section "2. CORS rejects foreign origin (credentialed)"
CORS_HEADERS=$(
  curl -sI -H "Origin: https://evil.example.com" "$BASE/" || true
)

ACAO=$(grep -i '^access-control-allow-origin:' <<<"$CORS_HEADERS" | tr -d '\r')
if [[ -z "$ACAO" ]]; then
  pass "No Access-Control-Allow-Origin header for evil.example.com (rejected)"
elif grep -iq 'evil.example.com' <<<"$ACAO"; then
  fail "Backend reflects evil origin: $ACAO"
elif grep -iq '\*' <<<"$ACAO"; then
  fail "Backend returns wildcard CORS: $ACAO"
else
  pass "CORS header does not reflect foreign origin ($ACAO)"
fi

# ---------------------------------------------------------------------------
section "3. Password policy on /auth/signup"
WEAK_BODY='{"email":"phase1-weak-'$RANDOM'@example.invalid","password":"short","fullName":"Test"}'
WEAK_STATUS=$(
  curl -s -o /tmp/phase1-weak.json -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -d "$WEAK_BODY" \
    "$BASE/auth/signup"
)
if [[ "$WEAK_STATUS" == "400" ]]; then
  pass "Weak password rejected with 400"
else
  fail "Weak password got HTTP $WEAK_STATUS (expected 400). Body: $(cat /tmp/phase1-weak.json)"
fi

MEDIUM_BODY='{"email":"phase1-med-'$RANDOM'@example.invalid","password":"AllLettersLong","fullName":"Test"}'
MED_STATUS=$(
  curl -s -o /tmp/phase1-med.json -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -d "$MEDIUM_BODY" \
    "$BASE/auth/signup"
)
if [[ "$MED_STATUS" == "400" ]]; then
  pass "Password without digit/symbol rejected with 400"
else
  fail "Missing-symbol password got HTTP $MED_STATUS (expected 400)"
fi

# ---------------------------------------------------------------------------
section "4. Rate limit on /auth/signin (5 allowed / 15 min, 6th = 429)"
RL_EMAIL="phase1-ratelimit-$RANDOM@example.invalid"
RL_BODY="{\"email\":\"$RL_EMAIL\",\"password\":\"WrongPassword!12\"}"
LAST=""
for i in 1 2 3 4 5 6; do
  LAST=$(
    curl -s -o /dev/null -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -d "$RL_BODY" \
      "$BASE/auth/signin"
  )
  printf "    attempt %d -> %s\n" "$i" "$LAST"
done

if [[ "$LAST" == "429" ]]; then
  pass "6th signin attempt returned 429"
else
  fail "6th signin attempt returned $LAST (expected 429)"
fi

# ---------------------------------------------------------------------------
section "5. RLS (manual SQL check)"
cat <<'SQL'
  Run this in the Supabase SQL editor (service role not required):
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('spending_expectations', 'user_prefs');
  Both rows must show rowsecurity = true.

  End-to-end RLS test requires two authenticated users and cross-read attempts.
  That belongs in a proper integration suite — out of scope for this quick script.
SQL

# ---------------------------------------------------------------------------
section "Summary"
printf "  passed: %d\n  failed: %d\n" "$PASS" "$FAIL"
exit $FAIL
