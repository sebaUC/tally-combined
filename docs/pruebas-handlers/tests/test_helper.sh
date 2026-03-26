#!/usr/bin/env bash
# Shared helper for all test suites — source this, don't run directly.

BASE_URL="https://tally-combined.onrender.com"
USER_ID="b470a4b9-a591-46d1-87d0-9f2e17dc6d80"
WAIT=5
TMPFILE=$(mktemp)

send() {
  local label="$1"
  local msg="$2"

  curl -s --max-time 60 -X POST "${BASE_URL}/bot/test" \
    -H "Content-Type: application/json" \
    -d "{\"message\":$(printf '%s' "$msg" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'),\"userId\":\"${USER_ID}\",\"verbose\":true}" \
    -o "$TMPFILE" 2>/dev/null

  python3 << PYEOF
import json
try:
    with open("$TMPFILE") as f:
        d = json.load(f)
except:
    print(json.dumps({"label":"$label","ERROR":"parse_failed"}))
    exit()

pa = d.get("debug",{}).get("phaseA",{})
tc = pa.get("tool_call") or {}
acts = pa.get("actions") or []
out = {
    "label": "$label",
    "ok": d.get("ok"),
    "pa_type": pa.get("response_type","?"),
    "tool": tc.get("name",""),
    "args": tc.get("args",{}),
    "actions": [a.get("tool","") for a in acts],
    "reply": d.get("reply","")[:200],
    "replies": len(d.get("replies",[])),
}
if tc.get("args",{}).get("category"):
    out["cat"] = tc["args"]["category"]
if tc.get("args",{}).get("operation"):
    out["op"] = tc["args"]["operation"]
if tc.get("args",{}).get("_pending_transaction"):
    out["ptx"] = tc["args"]["_pending_transaction"]
if tc.get("args",{}).get("type"):
    out["txtype"] = tc["args"]["type"]
if tc.get("args",{}).get("amount"):
    out["amount"] = tc["args"]["amount"]
if tc.get("args",{}).get("period"):
    out["period"] = tc["args"]["period"]
if pa.get("clarification"):
    out["clar"] = pa["clarification"][:100]
if pa.get("direct_reply"):
    out["dr"] = pa["direct_reply"][:100]
print(json.dumps(out, ensure_ascii=False))
PYEOF

  sleep "$WAIT"
}

cleanup() { rm -f "$TMPFILE"; }
trap cleanup EXIT
