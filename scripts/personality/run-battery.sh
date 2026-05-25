#!/bin/bash
# ============================================================
# Personality Battery — Validación cualitativa del bot
# ============================================================
# Itera los 4 tonos (neutral, friendly, strict, toxic) sobre un
# único user de prueba. Por cada tono, corre todos los casos de
# `cases.json` contra /bot/test-v3 con verbose=true.
#
# Por cada turn imprime:
#   - El bloque insights que vio el LLM
#   - Las funciones que llamó (con args + result.ok)
#   - El reply final
#   - Los tokens usados
#
# Pre-requisitos:
#   - Backend corriendo en BASE_URL (default localhost:3000)
#   - jq instalado
#   - TEST_USER_ID: uuid del user de prueba (debe existir, tener
#     data_maturity='mature' ideal, sino igual corre pero los casos
#     de magnitud no se diferencian)
#   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (para PATCH del bot_tone)
#
# Uso:
#   export TEST_USER_ID=<uuid>
#   export SUPABASE_URL=...
#   export SUPABASE_SERVICE_ROLE_KEY=...
#   ./scripts/personality/run-battery.sh                 # todos los tonos
#   ./scripts/personality/run-battery.sh toxic           # un tono solo
#   ./scripts/personality/run-battery.sh toxic friendly  # subset
#
# Output:
#   - stdout: formato legible para revisión humana
#   - scripts/personality/out/battery-YYYYMMDD-HHMMSS.txt: log completo
#
# Costo aproximado: ~$0.0002 × 30 casos × 4 tonos = ~$0.024 con Flash
# ============================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
USER_ID="${TEST_USER_ID:-}"
SB_URL="${SUPABASE_URL:-}"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASES_FILE="${SCRIPT_DIR}/cases.json"
OUT_DIR="${SCRIPT_DIR}/out"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${OUT_DIR}/battery-${TS}.txt"

# ────────────────────────────────────────────────────────────
# Validación de pre-requisitos
# ────────────────────────────────────────────────────────────

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq no está instalado. brew install jq" >&2
  exit 1
fi

if [[ -z "$USER_ID" ]]; then
  echo "ERROR: TEST_USER_ID no exportado" >&2
  echo "Hint: export TEST_USER_ID=<uuid de un user real>" >&2
  exit 1
fi

if [[ -z "$SB_URL" || -z "$SB_KEY" ]]; then
  echo "ERROR: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos" >&2
  echo "Hint:" >&2
  echo "  export SUPABASE_URL=\$(grep SUPABASE_URL .env | cut -d= -f2)" >&2
  echo "  export SUPABASE_SERVICE_ROLE_KEY=\$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d= -f2)" >&2
  exit 1
fi

if [[ ! -f "$CASES_FILE" ]]; then
  echo "ERROR: $CASES_FILE no encontrado" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# ────────────────────────────────────────────────────────────
# Selección de tonos
# ────────────────────────────────────────────────────────────

ALL_TONES=(neutral friendly strict toxic)
if [[ $# -gt 0 ]]; then
  TONES=("$@")
  for t in "${TONES[@]}"; do
    if [[ ! " ${ALL_TONES[*]} " =~ \ ${t}\  ]]; then
      echo "ERROR: tono inválido '$t'. Válidos: ${ALL_TONES[*]}" >&2
      exit 1
    fi
  done
else
  TONES=("${ALL_TONES[@]}")
fi

# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────

# Pinta dos veces: stdout y archivo. tee no preserva colores; usamos echo.
log() {
  echo "$@" | tee -a "$LOG_FILE"
}

separator() {
  log "────────────────────────────────────────────────────────────"
}

double_sep() {
  log "════════════════════════════════════════════════════════════"
}

# Cambia user_prefs.bot_tone via PostgREST. Devuelve 0 si OK.
set_tone() {
  local tone="$1"
  local response
  response=$(curl -sS -X PATCH "${SB_URL}/rest/v1/user_prefs?id=eq.${USER_ID}" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "{\"bot_tone\":\"${tone}\"}" \
    -w "\n%{http_code}")
  local code
  code=$(echo "$response" | tail -n1)
  if [[ "$code" != "204" && "$code" != "200" ]]; then
    log "  ✗ PATCH bot_tone falló (HTTP $code)"
    log "    $response"
    return 1
  fi
  return 0
}

# Reset de conversación + invalidación de ctx para que el cambio de tono
# surta efecto sin esperar TTL.
reset_user() {
  curl -sS -X POST "${BASE_URL}/bot/test-v3" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"${USER_ID}\",\"message\":\"\",\"reset\":true}" \
    > /dev/null || true
}

# ────────────────────────────────────────────────────────────
# Loop principal
# ────────────────────────────────────────────────────────────

TOTAL_CASES=$(jq '.cases | length' "$CASES_FILE")
TOTAL_RUNS=$((TOTAL_CASES * ${#TONES[@]}))
RUN_COUNT=0

double_sep
log "  PERSONALITY BATTERY"
double_sep
log "  Run timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
log "  Base URL:      $BASE_URL"
log "  User ID:       $USER_ID"
log "  Cases:         $TOTAL_CASES por tono"
log "  Tonos:         ${TONES[*]} (${#TONES[@]} total)"
log "  Total runs:    $TOTAL_RUNS"
log "  Log file:      $LOG_FILE"
double_sep
log ""

for TONE in "${TONES[@]}"; do
  double_sep
  log "  TONO: $TONE"
  double_sep

  if ! set_tone "$TONE"; then
    log "  Saltando tono '$TONE' por falla en PATCH"
    continue
  fi
  log "  ✓ bot_tone actualizado a '$TONE'"

  reset_user
  log "  ✓ Conversación + ctx reseteados"
  log ""

  # Iterar cada caso
  jq -c '.cases[]' "$CASES_FILE" | while read -r CASE; do
    RUN_COUNT=$((RUN_COUNT + 1))
    CASE_ID=$(echo "$CASE" | jq -r '.id')
    CASE_CAT=$(echo "$CASE" | jq -r '.category')
    CASE_SUB=$(echo "$CASE" | jq -r '.subcategory')
    CASE_DESC=$(echo "$CASE" | jq -r '.description')
    CASE_MSG=$(echo "$CASE" | jq -r '.message')
    CASE_EXP=$(echo "$CASE" | jq -r '.expects | join(", ")')

    separator
    log "  [$RUN_COUNT/$TOTAL_RUNS] $CASE_ID  ($TONE)"
    log "  Categoría:  $CASE_CAT / $CASE_SUB"
    log "  Descripción: $CASE_DESC"
    log "  Esperado:   $CASE_EXP"
    log ""
    log "  > USER:"
    log "    $CASE_MSG"
    log ""

    # Llamar al endpoint con verbose — escribir a archivo para preservar
    # los escapes JSON (los \n dentro de strings se rompen si los capturamos
    # con $() porque bash los convierte en newlines reales).
    # Retry con backoff cuando Gemini devuelve 503/error genérico —
    # capacidad insuficiente del lado de Google a veces se da en burst.
    RESP_FILE="${OUT_DIR}/.resp.json"
    GENERIC_ERROR="Tuve un problema procesando tu mensaje"
    MAX_RETRIES=3
    for ATTEMPT in $(seq 1 $MAX_RETRIES); do
      curl -sS -X POST "${BASE_URL}/bot/test-v3" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg uid "$USER_ID" --arg msg "$CASE_MSG" \
          '{userId: $uid, message: $msg, verbose: true}')" \
        -o "$RESP_FILE"

      OK=$(jq -r '.ok // false' "$RESP_FILE")
      REPLY_CHECK=$(jq -r '.reply // ""' "$RESP_FILE")
      if [[ "$OK" == "true" && "$REPLY_CHECK" != *"$GENERIC_ERROR"* ]]; then
        break
      fi
      if [[ $ATTEMPT -lt $MAX_RETRIES ]]; then
        BACKOFF=$((2 ** ATTEMPT))
        log "  ⏳ Retry $ATTEMPT/$MAX_RETRIES (esperando ${BACKOFF}s)"
        sleep $BACKOFF
      fi
    done

    if [[ "$OK" != "true" ]]; then
      ERR=$(jq -r '.error // "unknown"' "$RESP_FILE")
      log "  ✗ ERROR (después de $MAX_RETRIES intentos): $ERR"
      log ""
      continue
    fi

    # Pequeño delay entre turns para no provocar 503 por ráfaga
    sleep 0.5

    # Bloque insights
    INSIGHTS_BLOCK=$(jq -r '.debug.insightsBlock // "(verbose vacío)"' "$RESP_FILE")
    log "  ── INSIGHTS BLOCK ──"
    while IFS= read -r line; do
      log "    $line"
    done <<< "$INSIGHTS_BLOCK"
    log ""

    # Insights raw (compacto, solo lo útil)
    INSIGHTS_RAW=$(jq -c '.debug.insightsRaw // null' "$RESP_FILE")
    if [[ "$INSIGHTS_RAW" != "null" ]]; then
      MATURITY=$(jq -r '.debug.insightsRaw.data_maturity // "n/a"' "$RESP_FILE")
      TX_COUNT=$(jq -r '.debug.insightsRaw.tx_count_at_compute // 0' "$RESP_FILE")
      ARCHETYPE=$(jq -r '.debug.insightsRaw.spender_archetype // "n/a"' "$RESP_FILE")
      TX_P50=$(jq -r '.debug.insightsRaw.tx_amount_dist.p50 // 0' "$RESP_FILE")
      TX_P90=$(jq -r '.debug.insightsRaw.tx_amount_dist.p90 // 0' "$RESP_FILE")
      TX_P95=$(jq -r '.debug.insightsRaw.tx_amount_dist.p95 // 0' "$RESP_FILE")
      log "  ── INSIGHTS RAW (resumen) ──"
      log "    maturity=$MATURITY · txs=$TX_COUNT · archetype=$ARCHETYPE"
      log "    tx_amount: p50=\$$TX_P50  p90=\$$TX_P90  p95=\$$TX_P95"
      log ""
    fi

    # Funciones llamadas
    FN_COUNT=$(jq '.functionsCalled | length' "$RESP_FILE")
    if [[ "$FN_COUNT" -eq 0 ]]; then
      log "  ── FUNCTIONS CALLED ──"
      log "    (ninguna — respuesta conversacional)"
      log ""
    else
      log "  ── FUNCTIONS CALLED ($FN_COUNT) ──"
      jq -c '.functionsCalled[]' "$RESP_FILE" | while read -r FC; do
        FN_NAME=$(echo "$FC" | jq -r '.name')
        FN_ARGS=$(echo "$FC" | jq -c '.args')
        FN_OK=$(echo "$FC" | jq -r '.result.ok // false')
        FN_ERR=$(echo "$FC" | jq -r '.result.error // ""')
        FN_DATA_KEYS=$(echo "$FC" | jq -r '.result.data | keys | join(",") // "—"' 2>/dev/null || echo "—")
        log "    ▸ $FN_NAME($FN_ARGS)"
        if [[ "$FN_OK" == "true" ]]; then
          log "        result.ok=true · data.keys=[$FN_DATA_KEYS]"
        else
          log "        result.ok=false · error=$FN_ERR"
        fi
      done
      log ""
    fi

    # Reply
    REPLY=$(jq -r '.reply' "$RESP_FILE")
    log "  ── REPLY ──"
    while IFS= read -r line; do
      log "    $line"
    done <<< "$REPLY"
    log ""

    # Tokens
    TIN=$(jq -r '.tokensUsed.input // 0' "$RESP_FILE")
    TOUT=$(jq -r '.tokensUsed.output // 0' "$RESP_FILE")
    TTOT=$(jq -r '.tokensUsed.total // 0' "$RESP_FILE")
    log "  ── TOKENS ──"
    log "    input=$TIN  output=$TOUT  total=$TTOT"
    log ""
  done

  # Cleanup del archivo temp del último turn del batch
  rm -f "${OUT_DIR}/.resp.json"

  log ""
done

double_sep
log "  ✓ Batería completa"
log "  Log: $LOG_FILE"
double_sep
