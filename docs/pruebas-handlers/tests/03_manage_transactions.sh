#!/usr/bin/env bash
# Test Suite: manage_transactions — listar, editar, eliminar
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== MANAGE TRANSACTIONS ==="
echo ""

echo "--- Listar ---"
send "MT.01" "mis últimos gastos"
send "MT.02" "ver transacciones"
send "MT.03" "dame mis gastos"

echo ""
echo "--- Eliminar ---"
send "MT.04" "gasté 9999 en test"
sleep 3
send "MT.05" "borra el último gasto"
send "MT.06" "elimina eso"

echo ""
echo "--- Editar ---"
send "MT.07" "gasté 5000 en comida"
sleep 3
send "MT.08" "cámbialo a 3000"
send "MT.09" "no eran 5000, eran 8000"

echo ""
echo "--- Referencias contextuales ---"
send "MT.10" "gasté 7777 en transporte"
sleep 3
send "MT.11" "elimínalo"

echo ""
echo "=== COMPLETADO ==="
