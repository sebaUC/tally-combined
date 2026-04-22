#!/bin/bash

# Test script for Hybrid Bot V1
# Usage: ./scripts/test-bot.sh [base_url] [user_id]
#
# Examples:
#   ./scripts/test-bot.sh                           # Uses defaults
#   ./scripts/test-bot.sh http://localhost:3000     # Custom URL
#   ./scripts/test-bot.sh http://localhost:3000 abc-123  # Custom URL and user ID

BASE_URL="${1:-http://localhost:3000}"
USER_ID="${2:-test-user-$(date +%s)}"

echo "=============================================="
echo "  Hybrid Bot V1 - Test Suite"
echo "=============================================="
echo "Base URL: $BASE_URL"
echo "User ID:  $USER_ID"
echo "=============================================="
echo ""

# Function to make a test request
test_request() {
  local name="$1"
  local message="$2"
  local verbose="${3:-false}"

  echo "----------------------------------------"
  echo "TEST: $name"
  echo "Message: \"$message\""
  echo ""

  response=$(curl -s -X POST "$BASE_URL/bot/test" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"$message\", \"userId\": \"$USER_ID\", \"verbose\": $verbose}")

  # Extract key fields
  ok=$(echo "$response" | grep -o '"ok":[^,}]*' | head -1)
  reply=$(echo "$response" | grep -o '"reply":"[^"]*"' | head -1 | sed 's/"reply":"//;s/"$//')
  total_ms=$(echo "$response" | grep -o '"totalMs":[0-9]*' | head -1 | sed 's/"totalMs"://')

  echo "OK: $ok"
  echo "Reply: $reply"
  echo "Time: ${total_ms}ms"
  echo ""

  if [ "$verbose" = "true" ]; then
    echo "Full response:"
    echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
    echo ""
  fi
}

echo ""
echo "=== Test 1: Greeting (direct_reply) ==="
test_request "Greeting" "hola"

echo ""
echo "=== Test 2: Complete Transaction ==="
test_request "Complete Transaction" "gasté 15 lucas en comida"

echo ""
echo "=== Test 3: Transaction Missing Amount (clarification) ==="
test_request "Missing Amount" "gasté en comida"

echo ""
echo "=== Test 4: Transaction Missing Category (clarification) ==="
test_request "Missing Category" "gasté 5000"

echo ""
echo "=== Test 5: Check Budget ==="
test_request "Budget Status" "cómo voy con mi presupuesto"

echo ""
echo "=== Test 6: Check Goals ==="
test_request "Goal Status" "cómo van mis metas"

echo ""
echo "=== Test 7: Check Balance (disabled feature) ==="
test_request "Balance" "cuánto tengo"

echo ""
echo "=== Test 8: Unknown Intent ==="
test_request "Unknown" "asdfghjkl"

echo ""
echo "=== Test 9: Verbose Mode (full debug) ==="
test_request "Verbose Greeting" "buenos días" true

echo ""
echo "=============================================="
echo "  Test Suite Complete"
echo "=============================================="
echo ""
echo "To run individual tests:"
echo "  curl -X POST $BASE_URL/bot/test \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"message\": \"hola\", \"userId\": \"$USER_ID\"}'"
echo ""
