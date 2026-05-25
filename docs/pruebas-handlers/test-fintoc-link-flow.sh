#!/usr/bin/env bash
# Test end-to-end del flujo de linking Fintoc.
# Requiere: backend corriendo local (PORT=3000), token JWT válido de un user existente.
#
# Uso:
#   export TALLY_JWT="eyJhbGciOi..."
#   ./test-fintoc-link-flow.sh

set -euo pipefail

API="${API:-http://localhost:3000}"
JWT="${TALLY_JWT:-}"

if [[ -z "$JWT" ]]; then
  echo "❌ TALLY_JWT env var requerido. Obtén uno con POST /auth/signin"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  POST /api/fintoc/link-intent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
INTENT_RESPONSE=$(curl -sS -X POST "$API/api/fintoc/link-intent" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "$INTENT_RESPONSE" | jq .
WIDGET_TOKEN=$(echo "$INTENT_RESPONSE" | jq -r '.widget_token')
echo "✅ widget_token: ${WIDGET_TOKEN:0:20}..."
echo

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  Ahora abre el widget Fintoc en el frontend."
echo "    Tras autenticarte, pega acá el exchange_token que ves en la consola:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "exchange_token> " EXCHANGE_TOKEN

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  POST /api/fintoc/exchange"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
EXCHANGE_RESPONSE=$(curl -sS -X POST "$API/api/fintoc/exchange" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"exchange_token\":\"$EXCHANGE_TOKEN\"}")
echo "$EXCHANGE_RESPONSE" | jq .
LINK_ID=$(echo "$EXCHANGE_RESPONSE" | jq -r '.link.id')
ACCOUNTS_COUNT=$(echo "$EXCHANGE_RESPONSE" | jq -r '.accounts | length')
echo "✅ link_id: $LINK_ID"
echo "✅ accounts conectadas: $ACCOUNTS_COUNT"
echo

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  GET /api/fintoc/links"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -sS "$API/api/fintoc/links" \
  -H "Authorization: Bearer $JWT" | jq .
echo

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  (opcional) DELETE /api/fintoc/links/$LINK_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "¿Desconectar el banco para limpiar el test? [y/N] " REVOKE
if [[ "$REVOKE" == "y" || "$REVOKE" == "Y" ]]; then
  curl -sS -X DELETE "$API/api/fintoc/links/$LINK_ID" \
    -H "Authorization: Bearer $JWT" -w "\nHTTP %{http_code}\n"
fi

echo
echo "✅ Flujo completo verificado."
