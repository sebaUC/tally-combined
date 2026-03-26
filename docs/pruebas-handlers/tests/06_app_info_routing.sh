#!/usr/bin/env bash
# Test Suite: Info de la app, saludos, out-of-domain, clarifications
set -euo pipefail
source "$(dirname "$0")/test_helper.sh"

echo "=== APP INFO & ROUTING ==="
echo ""

echo "--- Saludos ---"
send "AR.01" "hola"
send "AR.02" "buenos días"
send "AR.03" "qué tal"

echo ""
echo "--- Info de la app ---"
send "AR.04" "qué puedes hacer"
send "AR.05" "cómo funciona esto"
send "AR.06" "es seguro"
send "AR.07" "quién eres"
send "AR.08" "quién te creó"

echo ""
echo "--- Out-of-domain (debe redirigir) ---"
send "AR.09" "qué es la fotosíntesis"
send "AR.10" "quién fue Napoleón"
send "AR.11" "escribe código en python"
send "AR.12" "qué buen clima hoy"

echo ""
echo "--- Clarification ---"
send "AR.13" "gasté algo"
send "AR.14" "registra"

echo ""
echo "=== COMPLETADO ==="
