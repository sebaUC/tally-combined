#!/usr/bin/env bash
# Test Suite: Categorías — CRUD, CATEGORY_NOT_FOUND, crear+registrar, multi-turno
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== CATEGORY FLOW ==="
echo ""

echo "--- Categoría existe (match) ---"
send "CF.01" "gasté 5000 en comida"
send "CF.02" "pagué 3000 en uber"
send "CF.03" "gasté 2000 en alimentasion"

echo ""
echo "--- Categoría NO existe (CATEGORY_NOT_FOUND) ---"
send "CF.04" "gasté 7000 en filosofía"
send "CF.05" "gasté 3000 en gaming"

echo ""
echo "--- Multi-turno: ¿La creo? → sí ---"
send "CF.06" "gasté 8000 en crossfit"
sleep 3
send "CF.07_si" "sí"

echo ""
sleep 8
echo "--- Multi-turno: ¿La creo? → no ---"
send "CF.08" "gasté 3000 en tatuajes"
sleep 3
send "CF.09_no" "no, olvídalo"

echo ""
sleep 8
echo "--- Multi-turno: elegir existente ---"
send "CF.10" "gasté 4000 en vinos"
sleep 3
send "CF.11_existente" "ponlo en alimentación"

echo ""
echo "--- Crear + registrar en 1 mensaje ---"
send "CF.12" "crea la categoría Mascotas y registra 15000 ahí"

echo ""
echo "--- CRUD categorías ---"
send "CF.13" "mis categorías"
send "CF.14" "crea categoría Streaming"
send "CF.15" "renombra Streaming a Suscripciones"

echo ""
echo "=== COMPLETADO ==="
