#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://tally-combined.onrender.com"
USER_ID="b470a4b9-a591-46d1-87d0-9f2e17dc6d80"
WAIT=5
TMPFILE=$(mktemp)
GROUP="${1:-all}"

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
if pa.get("clarification"):
    out["clar"] = pa["clarification"][:100]
if pa.get("direct_reply"):
    out["dr"] = pa["direct_reply"][:100]
print(json.dumps(out, ensure_ascii=False))
PYEOF

  sleep "$WAIT"
}

# ── GRUPO 1: Categoría existe ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "1" ]; then
  echo ""
  echo "=== G1: Categoría existe ==="
  send "G1.1" "gasté 5000 en comida"
  send "G1.2" "pagué 3000 en uber"
  send "G1.3" "me pagaron 500 mil"
fi

# ── GRUPO 2: Categoría NO existe → CATEGORY_NOT_FOUND ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "2" ]; then
  echo ""
  echo "=== G2: Categoría no existe ==="
  send "G2.1" "gasté 7000 en filosofía"
  send "G2.2" "gasté 3000 en gaming"
  send "G2.3" "gasté 2000 en bar"
fi

# ── GRUPO 3: Multi-turno: ¿La creo? → respuesta ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "3" ]; then
  echo ""
  echo "=== G3: Multi-turno ==="
  send "G3.0" "gasté 8000 en pilates"
  sleep 3
  send "G3.1_si" "sí"
  sleep 8
  send "G3.2" "gasté 5000 en yoga"
  sleep 3
  send "G3.3_otro_nombre" "sí, llámala Deporte"
  sleep 8
  send "G3.4" "gasté 3000 en cervecería"
  sleep 3
  send "G3.5_no" "no, olvídalo"
  sleep 8
  send "G3.6" "gasté 4000 en librería"
  sleep 3
  send "G3.7_existente" "ponlo en educación"
fi

# ── GRUPO 4: Crear + registrar en 1 mensaje ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "4" ]; then
  echo ""
  echo "=== G4: Crear + registrar ==="
  send "G4.1" "crea la categoría Mascotas y registra 15000 ahí"
  send "G4.2" "crea categoría Streaming"
fi

# ── GRUPO 5: Edge cases ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "5" ]; then
  echo ""
  echo "=== G5: Edge cases ==="
  send "G5.1_typo" "gasté 2000 en alimentasion"
  send "G5.2_ambiguo" "gasté 5000 en el super"
  send "G5.3_ingreso" "me depositaron 100 mil en sueldo"
  send "G5.4" "gasté 3000 en natación"
  sleep 3
  send "G5.5_cambio_tema" "cuánto llevo gastado?"
fi

# ── GRUPO 6: Anti-regresión ──
if [ "$GROUP" = "all" ] || [ "$GROUP" = "6" ]; then
  echo ""
  echo "=== G6: Anti-regresión ==="
  send "G6.1_no_dup" "gasté 10000 en comida"
  send "G6.2_ingreso" "ingresa 5590 pesos a mi cuenta"
  send "G6.3_norm" "registra 3000 en comida"
fi

rm -f "$TMPFILE"
echo ""
echo "=== COMPLETADO ==="
