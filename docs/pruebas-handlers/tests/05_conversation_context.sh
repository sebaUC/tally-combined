#!/usr/bin/env bash
# Test Suite: Contexto conversacional — historial, referencias, multi-acción, cambio de tema
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== CONVERSATION CONTEXT ==="
echo ""

echo "--- Multi-acción ---"
send "CC.01" "gasté 5 lucas en comida y 3 lucas en uber"
send "CC.02" "gasté 1000 en café, 5000 en almuerzo y 2000 en metro"
send "CC.03" "cuánto llevo gastado y agrega 3 lucas en uber"

echo ""
echo "--- Registro rápido consecutivo ---"
send "CC.04" "gasté 2000 en café"
send "CC.05" "3000 en almuerzo"
send "CC.06" "y 1500 en metro"

echo ""
echo "--- Cambio de tema ---"
send "CC.07" "gasté 5000 en algo raro"
sleep 3
send "CC.08" "cuánto llevo gastado"

echo ""
echo "--- Saludos + acción ---"
send "CC.09" "hola, gasté 5 lucas en comida"

echo ""
echo "--- Referencias al historial ---"
send "CC.10" "gasté 4444 en transporte"
sleep 3
send "CC.11" "lo mismo"
sleep 3
send "CC.12" "otra igual"

echo ""
echo "=== COMPLETADO ==="
