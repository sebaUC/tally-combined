#!/bin/bash
# ============================================================
# Test — Layer 1 metrics service (PR1)
# ============================================================
# Seed 100 transacciones para un user de prueba, dispara el recompute
# vía endpoint interno /internal/insights/recompute, y verifica el shape
# de user_insights resultante.
#
# Pre-requisitos:
#   - Backend corriendo en BASE_URL (default localhost:3000)
#   - INTERNAL_SERVICE_TOKEN configurado en backend .env
#   - Variable de entorno INTERNAL_SERVICE_TOKEN exportada acá
#   - Supabase URL + SERVICE_ROLE_KEY exportados para psql/curl directos
#   - User de prueba existente: TEST_USER_ID (uuid) + categoría
#
# Uso:
#   export INTERNAL_SERVICE_TOKEN=...
#   export TEST_USER_ID=<uuid>
#   ./scripts/insights/test-layer1-mature.sh
#
# Si no se exporta TEST_USER_ID, el script falla con un mensaje claro
# (NO se crea un user automáticamente — eso requiere auth flow real).
# ============================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${INTERNAL_SERVICE_TOKEN:-}"
USER_ID="${TEST_USER_ID:-}"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: INTERNAL_SERVICE_TOKEN no exportado"
  echo "Hint: export INTERNAL_SERVICE_TOKEN=\$(grep INTERNAL_SERVICE_TOKEN .env | cut -d= -f2)"
  exit 1
fi

if [[ -z "$USER_ID" ]]; then
  echo "ERROR: TEST_USER_ID no exportado"
  echo "Hint: usar un user real existente. export TEST_USER_ID=<uuid>"
  exit 1
fi

echo "=============================================="
echo "  Layer 1 Metrics — Test"
echo "=============================================="
echo "BASE_URL: $BASE_URL"
echo "USER_ID:  $USER_ID"
echo "=============================================="

# ────────────────────────────────────────────────────────────
# 1. Disparar recompute
# ────────────────────────────────────────────────────────────
echo ""
echo "[1/3] POST /internal/insights/recompute ..."
RESPONSE=$(curl -sS -X POST "${BASE_URL}/internal/insights/recompute" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"${USER_ID}\"}")

echo "Respuesta:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

OK=$(echo "$RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('ok'))")
if [[ "$OK" != "True" ]]; then
  echo "FAIL: recompute no devolvió ok=true"
  exit 1
fi

# ────────────────────────────────────────────────────────────
# 2. Verificar shape esperado (campos clave)
# ────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Verificando shape de la respuesta..."

EXPECTED_FIELDS=("userId" "data_maturity" "tx_count_at_compute" "computed_at")
for field in "${EXPECTED_FIELDS[@]}"; do
  VALUE=$(echo "$RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('${field}', '__MISSING__'))")
  if [[ "$VALUE" == "__MISSING__" ]]; then
    echo "FAIL: campo '$field' ausente en la respuesta"
    exit 1
  fi
  echo "  ✓ $field = $VALUE"
done

# ────────────────────────────────────────────────────────────
# 3. Reportar resumen del estado del user
# ────────────────────────────────────────────────────────────
echo ""
echo "[3/3] Resumen del compute:"
echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  Maturity: {d.get('data_maturity')}\")
print(f\"  Tx count: {d.get('tx_count_at_compute')}\")
print(f\"  Computed at: {d.get('computed_at')}\")
"

echo ""
echo "=============================================="
echo "  ✓ Layer 1 metrics test passed"
echo "=============================================="
echo ""
echo "Verificación adicional (correr manualmente en Supabase):"
echo ""
echo "  SELECT user_id, data_maturity, tx_count_at_compute,"
echo "         jsonb_pretty(daily_spend_dist) AS daily_dist,"
echo "         jsonb_array_length(monthly_trajectory) AS months"
echo "  FROM user_insights"
echo "  WHERE user_id = '${USER_ID}';"
