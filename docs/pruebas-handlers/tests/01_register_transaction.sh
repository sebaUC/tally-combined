#!/usr/bin/env bash
# Test Suite: register_transaction — gastos, ingresos, balance_set, hallucination guard
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== REGISTER TRANSACTION ==="
echo ""

echo "--- Gastos básicos ---"
send "RT.01" "gasté 5000 en comida"
send "RT.02" "pagué 3000 en uber"
send "RT.03" "compré café por 2500"
send "RT.04" "15 lucas en el almuerzo"
send "RT.05" "gasté 8990 en el super"

echo ""
echo "--- Ingresos ---"
send "RT.06" "me pagaron 500 mil"
send "RT.07" "me depositaron 100000"
send "RT.08" "ingresa 5590 pesos a mi cuenta"
send "RT.09" "vendí la bicicleta en 80 lucas"

echo ""
echo "--- Balance set ---"
send "RT.10" "tengo 300 mil en mi cuenta"
send "RT.11" "mi saldo es 500000"

echo ""
echo "--- Hallucination guard (sin monto explícito) ---"
send "RT.12" "gasté en comida"
send "RT.13" "compré una bebida"
send "RT.14" "barra de proteína"

echo ""
echo "--- Montos con formato chileno ---"
send "RT.15" "gasté 10 lucas en ropa"
send "RT.16" "pagué 1.500 en agua"

echo ""
echo "=== COMPLETADO ==="
