#!/usr/bin/env bash
# Test Suite: Consultas — balance, presupuesto, metas
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== BALANCE, BUDGET, GOALS ==="
echo ""

echo "--- Balance general ---"
send "BB.01" "cuál es mi saldo"
send "BB.02" "cuánto tengo"
send "BB.03" "dame mi balance"

echo ""
echo "--- Balance con filtros ---"
send "BB.04" "cuánto gasté hoy"
send "BB.05" "cuánto gasté esta semana"
send "BB.06" "cuánto gasté en comida"
send "BB.07" "cuánto gasté en transporte esta semana"
send "BB.08" "mis ingresos este mes"

echo ""
echo "--- Presupuesto ---"
send "BB.09" "cómo va mi presupuesto"
send "BB.10" "cuánto me queda de presupuesto"

echo ""
echo "--- Metas ---"
send "BB.11" "cómo van mis metas"
send "BB.12" "cuánto llevo ahorrado"

echo ""
echo "=== COMPLETADO ==="
