#!/usr/bin/env bash
# Test Suite: Anti-regresión — bugs específicos que se corrigieron
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== ANTI-REGRESIÓN ==="
echo ""

echo "--- Bug A: Confirmación duplicada (Phase B no debe repetir ✅) ---"
send "REG.01" "gasté 10000 en comida"

echo ""
echo "--- Bug B: Ingresos no deben pedir categoría ---"
send "REG.02" "ingresa 5590 pesos a mi cuenta"
send "REG.03" "me pagaron 500 mil"

echo ""
echo "--- Bug F: actions:[] + tool_call normalización ---"
send "REG.04" "registra 3000 en comida"

echo ""
echo "--- Hallucination guard: monto inventado ---"
send "REG.05" "gasté 8990 en agua"
sleep 3
send "REG.06" "barra de proteína"

echo ""
echo "--- Tono aplicado en cierre ---"
send "REG.07" "gasté 5000 en comida"
send "REG.08" "me pagaron 200 mil"

echo ""
echo "--- Balance set no crea transacción ---"
send "REG.09" "tengo 300 mil en mi cuenta"

echo ""
echo "--- Metadata no se filtra al usuario ---"
send "REG.10" "gasté 7000 en transporte"

echo ""
echo "=== COMPLETADO ==="
