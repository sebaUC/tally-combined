#!/bin/bash
# ============================================================================
# ask_app_info — Comprehensive Test Suite
# ============================================================================
#
# 5-PHASE TEST ARCHITECTURE:
#   Phase 1: DETERMINISTIC    — Auto-validated (correct tool routing, response type)
#   Phase 2: AMBIGUOUS        — Semi-auto (routing + subjective reply quality)
#   Phase 3: CONVERSATIONS    — Multi-message flows (pending survival, topic switches)
#   Phase 4: STRESS           — Rapid fire, consistency, edge cases
#   Phase 5: REGRESSIONS      — Specific bug fix validations
#
# OUTPUTS:
#   Console  → PASS/FAIL summary per test with counters
#   Log file → Full JSON responses for every test (for AI/human analysis)
#   Report   → Final summary with pass rate per phase
#
# BEFORE RUNNING:
#   1. Replace USER_ID with a real user UUID (completed onboarding)
#   2. Backend running on port 3000, AI service on 8000, Redis available
#
# USAGE:
#   ./ask_app_info_tests.sh              # Run all phases
#   ./ask_app_info_tests.sh 1            # Run only phase 1
#   ./ask_app_info_tests.sh 1 3          # Run phases 1 and 3
#
# Last updated: 2026-02-16
# ============================================================================

set -euo pipefail

BASE_URL="http://localhost:3000"
USER_ID="f1d62f43-e1d7-453a-9e8a-79687be68313"

# Output files
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="./test-results"
LOG_FILE="${LOG_DIR}/ask_app_info_${TIMESTAMP}_full.jsonl"
SUBJECTIVE_FILE="${LOG_DIR}/ask_app_info_${TIMESTAMP}_review.md"
REPORT_FILE="${LOG_DIR}/ask_app_info_${TIMESTAMP}_report.md"

mkdir -p "$LOG_DIR"

# ── Colors ──
R='\033[0;31m'    G='\033[0;32m'    Y='\033[1;33m'
C='\033[0;36m'    M='\033[0;35m'    W='\033[1;37m'
DIM='\033[2m'     NC='\033[0m'

# ── Counters ──
TOTAL=0  PASS=0  FAIL=0  WARN=0  SKIP=0
P1_TOTAL=0  P1_PASS=0  P1_FAIL=0
P2_TOTAL=0  P2_PASS=0  P2_FAIL=0
P3_TOTAL=0  P3_PASS=0  P3_FAIL=0
P4_TOTAL=0  P4_PASS=0  P4_FAIL=0
P5_TOTAL=0  P5_PASS=0  P5_FAIL=0
CURRENT_PHASE=0

# ── Which phases to run ──
if [[ $# -eq 0 ]]; then
  PHASES_TO_RUN=(1 2 3 4 5)
else
  PHASES_TO_RUN=("$@")
fi
should_run_phase() {
  for p in "${PHASES_TO_RUN[@]}"; do
    [[ "$p" == "$1" ]] && return 0
  done
  return 1
}

# ============================================================================
# CORE: Send message and capture full response
# ============================================================================
LAST_RESPONSE=""
LAST_REPLY=""
LAST_PHASE_A_TYPE=""
LAST_TOOL=""
LAST_TOOL_OK=""
LAST_TOOL_ARGS=""
LAST_TOOL_RESULT=""
LAST_PENDING=""

_send() {
  local message="$1"

  LAST_RESPONSE=$(curl -s -X POST "${BASE_URL}/bot/test" \
    -H "Content-Type: application/json" \
    -d "{\"message\":$(echo "$message" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))'),\"userId\":\"${USER_ID}\",\"verbose\":true}" \
    2>/dev/null || echo '{"ok":false,"reply":"[curl failed]"}')

  # Parse fields
  LAST_REPLY=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('reply','[no reply]'))
except: print('[parse error]')
" 2>/dev/null)

  LAST_PHASE_A_TYPE=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    pa=d.get('debug',{}).get('phaseA',{})
    print(pa.get('response_type','[none]'))
except: print('[error]')
" 2>/dev/null)

  LAST_TOOL=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('debug',{}).get('toolName','[none]'))
except: print('[error]')
" 2>/dev/null)

  LAST_TOOL_OK=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('debug',{}).get('toolResult')
    print(str(r.get('ok','N/A')) if r else 'N/A')
except: print('[error]')
" 2>/dev/null)

  LAST_TOOL_ARGS=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    tc=d.get('debug',{}).get('phaseA',{}).get('tool_call',{})
    print(json.dumps(tc.get('args',{})))
except: print('{}')
" 2>/dev/null)

  LAST_TOOL_RESULT=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('debug',{}).get('toolResult',{})
    print(json.dumps(r) if r else '{}')
except: print('{}')
" 2>/dev/null)

  LAST_PENDING=$(echo "$LAST_RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('debug',{}).get('toolResult',{})
    p=r.get('pending') if r else None
    print(json.dumps(p) if p else 'null')
except: print('null')
" 2>/dev/null)
}

# ============================================================================
# ASSERTIONS
# ============================================================================

_log_json() {
  local test_id="$1" message="$2"
  echo "{\"test\":\"${test_id}\",\"message\":$(echo "$message" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))'),\"phase_a_type\":\"${LAST_PHASE_A_TYPE}\",\"tool\":\"${LAST_TOOL}\",\"tool_ok\":\"${LAST_TOOL_OK}\",\"tool_args\":${LAST_TOOL_ARGS},\"reply\":$(echo "$LAST_REPLY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))'),\"pending\":${LAST_PENDING}}" >> "$LOG_FILE"
}

_log_subjective() {
  local test_id="$1" message="$2" category="$3"
  cat >> "$SUBJECTIVE_FILE" <<ENTRY

### ${test_id}
- **Category:** ${category}
- **Input:** \`${message}\`
- **Phase A:** ${LAST_PHASE_A_TYPE}
- **Tool:** ${LAST_TOOL}
- **Tool OK:** ${LAST_TOOL_OK}
- **Args:** \`${LAST_TOOL_ARGS}\`
- **Reply:** ${LAST_REPLY}
- **Pending:** \`${LAST_PENDING}\`
- **Assessment:** _TODO_

ENTRY
}

_increment() {
  TOTAL=$((TOTAL + 1))
  case $CURRENT_PHASE in
    1) P1_TOTAL=$((P1_TOTAL + 1)) ;;
    2) P2_TOTAL=$((P2_TOTAL + 1)) ;;
    3) P3_TOTAL=$((P3_TOTAL + 1)) ;;
    4) P4_TOTAL=$((P4_TOTAL + 1)) ;;
    5) P5_TOTAL=$((P5_TOTAL + 1)) ;;
  esac
}

_pass() {
  PASS=$((PASS + 1))
  case $CURRENT_PHASE in
    1) P1_PASS=$((P1_PASS + 1)) ;;
    2) P2_PASS=$((P2_PASS + 1)) ;;
    3) P3_PASS=$((P3_PASS + 1)) ;;
    4) P4_PASS=$((P4_PASS + 1)) ;;
    5) P5_PASS=$((P5_PASS + 1)) ;;
  esac
}

_fail() {
  FAIL=$((FAIL + 1))
  case $CURRENT_PHASE in
    1) P1_FAIL=$((P1_FAIL + 1)) ;;
    2) P2_FAIL=$((P2_FAIL + 1)) ;;
    3) P3_FAIL=$((P3_FAIL + 1)) ;;
    4) P4_FAIL=$((P4_FAIL + 1)) ;;
    5) P5_FAIL=$((P5_FAIL + 1)) ;;
  esac
}

# ── assert_tool: check correct tool was called ──
assert_tool() {
  local test_id="$1" message="$2" expected_tool="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL" == "$expected_tool" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected tool=${expected_tool}, got ${LAST_TOOL}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_type: check Phase A response type ──
assert_type() {
  local test_id="$1" message="$2" expected_type="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_PHASE_A_TYPE" == "$expected_type" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — type=${LAST_PHASE_A_TYPE}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected type=${expected_type}, got ${LAST_PHASE_A_TYPE}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_tool_and_type: check both ──
assert_tool_and_type() {
  local test_id="$1" message="$2" expected_tool="$3" expected_type="$4"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL" == "$expected_tool" && "$LAST_PHASE_A_TYPE" == "$expected_type" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL} type=${LAST_PHASE_A_TYPE}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected tool=${expected_tool}/type=${expected_type}, got ${LAST_TOOL}/${LAST_PHASE_A_TYPE}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_tool_and_ok: check tool + ok field ──
assert_tool_and_ok() {
  local test_id="$1" message="$2" expected_tool="$3" expected_ok="$4"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL" == "$expected_tool" && "$LAST_TOOL_OK" == "$expected_ok" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL} ok=${LAST_TOOL_OK}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected tool=${expected_tool}/ok=${expected_ok}, got ${LAST_TOOL}/ok=${LAST_TOOL_OK}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_ok: tool result ok field ──
assert_ok() {
  local test_id="$1" message="$2" expected_ok="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL_OK" == "$expected_ok" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — ok=${LAST_TOOL_OK}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected ok=${expected_ok}, got ${LAST_TOOL_OK}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_reply_contains: check reply contains substring (case-insensitive) ──
assert_reply_contains() {
  local test_id="$1" message="$2" substring="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local found
  found=$(echo "$LAST_REPLY" | python3 -c "
import sys
reply = sys.stdin.read().strip().lower()
sub = '${substring}'.lower()
print('yes' if sub in reply else 'no')
" 2>/dev/null)

  if [[ "$found" == "yes" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — reply contains '${substring}'  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — reply missing '${substring}'  ${R}«${message}»${NC}"
    echo -e "         ${DIM}→ ${LAST_REPLY:0:100}...${NC}"
    _fail
  fi
}

# ── assert_reply_not_contains: check reply does NOT contain substring ──
assert_reply_not_contains() {
  local test_id="$1" message="$2" substring="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local found
  found=$(echo "$LAST_REPLY" | python3 -c "
import sys
reply = sys.stdin.read().strip().lower()
sub = '${substring}'.lower()
print('yes' if sub in reply else 'no')
" 2>/dev/null)

  if [[ "$found" == "no" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — reply does NOT contain '${substring}'  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — reply unexpectedly contains '${substring}'  ${R}«${message}»${NC}"
    echo -e "         ${DIM}→ ${LAST_REPLY:0:100}...${NC}"
    _fail
  fi
}

# ── assert_topic: check suggestedTopic in Phase A args ──
assert_topic() {
  local test_id="$1" message="$2" expected_topic="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local actual_topic
  actual_topic=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('suggestedTopic','[none]'))
except: print('[error]')
" 2>/dev/null)

  if [[ "$actual_topic" == "$expected_topic" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — topic=${actual_topic}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected topic=${expected_topic}, got ${actual_topic}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_not_tool: check tool is NOT the specified one ──
assert_not_tool() {
  local test_id="$1" message="$2" not_expected="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL" != "$not_expected" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL} (not ${not_expected})  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected NOT ${not_expected}, but got it  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── send_and_log: send without assertions (for subjective review) ──
send_and_log() {
  local test_id="$1" message="$2" category="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"
  _log_subjective "$test_id" "$message" "$category"

  echo -e "  ${M}◆ LOG ${NC} ${DIM}${test_id}${NC} — type=${LAST_PHASE_A_TYPE} tool=${LAST_TOOL}  ${DIM}«${message}»${NC}"
  echo -e "         ${DIM}→ ${LAST_REPLY:0:120}${NC}"
  _pass  # Counted as pass for metrics; real assessment is in review file
}

# ── send_silent: send without printing (for setup steps) ──
send_silent() {
  local message="$1"
  _send "$message"
}

# ── Helpers ──
reset() {
  send_silent "hola"
  sleep 1
}

wait_user_pace() {
  sleep 2
}

section() {
  echo -e "\n${W}─── $1 ───${NC}"
}

# ── Initialize subjective review file ──
cat > "$SUBJECTIVE_FILE" <<HEADER
# ask_app_info — Subjective Review
> Generated: $(date)
> User ID: ${USER_ID}
> Review each entry and fill in the Assessment field.

---

HEADER


# ############################################################################
#
#   PHASE 1: DETERMINISTIC TESTS
#   Auto-validated. Clear pass/fail. Tests routing, tool selection, ok field.
#
# ############################################################################

if should_run_phase 1; then
CURRENT_PHASE=1
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 1: DETERMINISTIC — Auto-validated routing & type        ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 1A: Must route to ask_app_info (Circle 1 — core questions) ──
section "1A: Tool routing — must call ask_app_info (Circle 1)"

reset
assert_tool "1A.01" "¿Qué puedes hacer?" "ask_app_info"
assert_tool "1A.02" "¿Para qué sirves?" "ask_app_info"
assert_tool "1A.03" "¿Cómo me ayudas?" "ask_app_info"
assert_tool "1A.04" "¿Qué funciones tienes?" "ask_app_info"
assert_tool "1A.05" "¿Cómo registro un gasto?" "ask_app_info"
assert_tool "1A.06" "Ayuda" "ask_app_info"
assert_tool "1A.07" "Help" "ask_app_info"
assert_tool "1A.08" "¿Cómo empiezo?" "ask_app_info"
assert_tool "1A.09" "¿Funciona en WhatsApp?" "ask_app_info"
assert_tool "1A.10" "¿Es gratis?" "ask_app_info"

# ── 1B: Identity questions — must route to ask_app_info (NOT direct_reply) ──
section "1B: Identity routing — must call ask_app_info"

reset
assert_tool "1B.01" "¿Cómo te llamas?" "ask_app_info"
assert_tool "1B.02" "¿Quién eres?" "ask_app_info"
assert_tool "1B.03" "¿Cuál es tu nombre?" "ask_app_info"
assert_tool "1B.04" "¿De dónde eres?" "ask_app_info"
assert_tool "1B.05" "¿Quién te creó?" "ask_app_info"

# ── 1C: ok=True always (handler never fails) ──
section "1C: Handler always returns ok=True"

assert_tool_and_ok "1C.01" "¿Qué puedes hacer?" "ask_app_info" "True"
assert_tool_and_ok "1C.02" "¿Es seguro?" "ask_app_info" "True"
assert_tool_and_ok "1C.03" "¿Cómo te llamas?" "ask_app_info" "True"
assert_tool_and_ok "1C.04" "¿Funciona en Telegram?" "ask_app_info" "True"
assert_tool_and_ok "1C.05" "¿Cuánto cuesta?" "ask_app_info" "True"

# ── 1D: Response type — all should be tool_call ──
section "1D: Response type — must be tool_call"

assert_tool_and_type "1D.01" "¿Qué puedes hacer?" "ask_app_info" "tool_call"
assert_tool_and_type "1D.02" "¿Es seguro?" "ask_app_info" "tool_call"
assert_tool_and_type "1D.03" "¿Cómo registro un gasto?" "ask_app_info" "tool_call"

# ── 1E: Negative routing — must NOT call ask_app_info ──
section "1E: Negative tests — must NOT call ask_app_info"

reset
assert_tool "1E.01" "gasté 5000 en comida" "register_transaction"
reset
assert_tool "1E.02" "cuánto llevo gastado?" "ask_balance"
reset
assert_tool "1E.03" "cómo va mi presupuesto?" "ask_budget_status"
reset
assert_tool "1E.04" "cómo van mis metas?" "ask_goal_status"
reset
assert_type "1E.05" "hola" "direct_reply"

# ── 1F: Circle 3 — out of domain → direct_reply, NOT ask_app_info ──
section "1F: Circle 3 — must use direct_reply, NOT ask_app_info"

reset
assert_type "1F.01" "¿Cuál es la capital de Francia?" "direct_reply"
reset
assert_type "1F.02" "¿Cómo funciona la fotosíntesis?" "direct_reply"
reset
assert_type "1F.03" "Resuelve x² + 5x + 6 = 0" "direct_reply"
reset
assert_type "1F.04" "¿Quién ganó el mundial del 2022?" "direct_reply"
reset
assert_type "1F.05" "¿Cuál es la receta del pastel de choclo?" "direct_reply"

fi # end phase 1


# ############################################################################
#
#   PHASE 2: AMBIGUOUS & SUBJECTIVE
#   Logged for human/AI review. Tests reply quality, topic extraction, tone.
#
# ############################################################################

if should_run_phase 2; then
CURRENT_PHASE=2
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 2: AMBIGUOUS — Logged for review (topic & quality)      ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

cat >> "$SUBJECTIVE_FILE" <<SEC

## Phase 2: Ambiguous & Subjective Tests

> For each test, verify:
> 1. Did Phase A route correctly to ask_app_info?
> 2. Is the reply relevant to the question?
> 3. Is Gus in character? (serio pero amable, professional)
> 4. Does the reply use knowledge from appKnowledge?

SEC

# ── 2A: Capabilities — does the reply explain features? ──
section "2A: Capabilities — feature explanations"

reset
send_and_log "2A.01" "¿Qué cosas sabes hacer?" "Capabilities: general overview"
send_and_log "2A.02" "¿Me puedes ayudar con mis finanzas?" "Capabilities: finance help"
send_and_log "2A.03" "¿Puedes llevar mis cuentas?" "Capabilities: expense tracking"
send_and_log "2A.04" "¿Sirves para algo más que registrar gastos?" "Capabilities: beyond expenses"
send_and_log "2A.05" "¿Me puedes decir en qué gasto más?" "Capabilities: analytics question"

# ── 2B: How-to — does the reply give instructions? ──
section "2B: How-to — instructions and guidance"

send_and_log "2B.01" "¿Cómo te digo que gasté plata?" "How-to: register expense"
send_and_log "2B.02" "¿Tengo que usar comandos especiales?" "How-to: interaction style"
send_and_log "2B.03" "¿Puedo escribirte en español normal?" "How-to: language support"
send_and_log "2B.04" "¿Entiendes si te digo lucas?" "How-to: Chilean slang"
send_and_log "2B.05" "¿Qué pasa si me equivoco al escribir?" "How-to: error handling"

# ── 2C: Limitations — does the reply explain what it can't do? ──
section "2C: Limitations — honest about constraints"

send_and_log "2C.01" "¿Qué no puedes hacer?" "Limitations: general"
send_and_log "2C.02" "¿Puedes ver mi cuenta del banco?" "Limitations: bank access"
send_and_log "2C.03" "¿Puedes hacer transferencias?" "Limitations: transfers"
send_and_log "2C.04" "¿Me puedes dar consejos de inversión?" "Limitations: investment advice"
send_and_log "2C.05" "¿Puedes acceder a mi tarjeta?" "Limitations: card access"

# ── 2D: Security — does the reply reassure about privacy? ──
section "2D: Security — privacy and data protection"

send_and_log "2D.01" "¿Es seguro decirte cuánto gano?" "Security: income privacy"
send_and_log "2D.02" "¿Vendes mi información?" "Security: data selling"
send_and_log "2D.03" "¿Quién puede ver mis gastos?" "Security: access control"
send_and_log "2D.04" "¿Puedo borrar mi información?" "Security: data ownership"
send_and_log "2D.05" "¿Mis datos están protegidos?" "Security: encryption"

# ── 2E: Channels — does the reply explain platform support? ──
section "2E: Channels — platform information"

send_and_log "2E.01" "¿En qué apps estás?" "Channels: platform list"
send_and_log "2E.02" "¿Cómo vinculo mi cuenta?" "Channels: account linking"
send_and_log "2E.03" "¿Vas a estar en Instagram?" "Channels: future platforms"
send_and_log "2E.04" "¿Funciona en el computador?" "Channels: desktop access"
send_and_log "2E.05" "¿Se sincroniza entre dispositivos?" "Channels: sync"

# ── 2F: Pricing — does the reply handle cost questions? ──
section "2F: Pricing — cost and plan questions"

send_and_log "2F.01" "¿Cuánto cuesta?" "Pricing: cost"
send_and_log "2F.02" "¿Tiene plan premium?" "Pricing: plans"
send_and_log "2F.03" "¿Qué incluye el plan gratis?" "Pricing: free tier"

# ── 2G: Circle 2 — related finance topics ──
section "2G: Circle 2 — related finance (should route to ask_app_info)"

reset
send_and_log "2G.01" "¿Qué es la UF?" "Circle 2: UF explanation"
send_and_log "2G.02" "¿Cómo puedo ahorrar más?" "Circle 2: saving tips"
send_and_log "2G.03" "¿Conviene tener tarjeta de crédito?" "Circle 2: credit card advice"
send_and_log "2G.04" "¿Cómo hago un presupuesto?" "Circle 2: budgeting advice"
send_and_log "2G.05" "¿Cómo salgo de las deudas?" "Circle 2: debt help"

# ── 2H: Circle 3 — out of domain (should be direct_reply) ──
section "2H: Circle 3 — out of domain (logged for quality of redirect)"

reset
send_and_log "2H.01" "¿Cómo funciona la fotosíntesis?" "Circle 3: science redirect"
reset
send_and_log "2H.02" "¿Quién fue Napoleón?" "Circle 3: history redirect"
reset
send_and_log "2H.03" "¿Cuántos planetas hay?" "Circle 3: astronomy redirect"
reset
send_and_log "2H.04" "¿Qué es mejor, iPhone o Android?" "Circle 3: tech redirect"
reset
send_and_log "2H.05" "¿Cómo hago una página web?" "Circle 3: programming redirect"

fi # end phase 2


# ############################################################################
#
#   PHASE 3: CONVERSATIONS
#   Multi-message flows. ask_app_info + other tools. Pending survival.
#
# ############################################################################

if should_run_phase 3; then
CURRENT_PHASE=3
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 3: CONVERSATIONS — Multi-message context flows          ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

cat >> "$SUBJECTIVE_FILE" <<SEC

## Phase 3: Conversation Flows

> For each conversation, verify:
> 1. Does ask_app_info return without interfering with pending state?
> 2. Are topic switches handled correctly?
> 3. Does the bot stay coherent across mixed tool calls?

SEC

# ── 3A: ask_app_info during pending register_transaction ──
section "3A: ask_app_info does NOT destroy pending state"

reset
send_and_log "3A.01" "compré una bebida" "Start: register_transaction pending (no amount)"
wait_user_pace
send_and_log "3A.02" "¿puedo registrar en dólares?" "Switch: ask_app_info (limitation)"
wait_user_pace
send_and_log "3A.03" "2000" "Must complete registration (pending survived)"

echo ""
reset
send_and_log "3A.04" "fui al supermercado" "Start: register_transaction pending"
wait_user_pace
send_and_log "3A.05" "¿cómo me ayudas?" "Switch: ask_app_info (capabilities)"
wait_user_pace
send_and_log "3A.06" "35000" "Must complete registration"

# ── 3B: Multiple ask_app_info in sequence ──
section "3B: Multiple ask_app_info questions in sequence"

reset
send_and_log "3B.01" "¿Qué puedes hacer?" "Question 1: capabilities"
wait_user_pace
send_and_log "3B.02" "¿Es seguro?" "Question 2: security"
wait_user_pace
send_and_log "3B.03" "¿Funciona en WhatsApp?" "Question 3: channels"
wait_user_pace
send_and_log "3B.04" "¿Es gratis?" "Question 4: pricing"

# ── 3C: ask_app_info mixed with other tools ──
section "3C: Mixed tool conversation — register, ask_app_info, balance"

reset
send_and_log "3C.01" "hola!" "Greeting"
wait_user_pace
send_and_log "3C.02" "¿Qué puedes hacer?" "ask_app_info"
wait_user_pace
send_and_log "3C.03" "gasté 8000 en almuerzo" "register_transaction"
wait_user_pace
send_and_log "3C.04" "¿Es seguro darte mis datos?" "ask_app_info (security)"
wait_user_pace
send_and_log "3C.05" "cuánto llevo gastado?" "ask_balance"
wait_user_pace
send_and_log "3C.06" "¿Cómo borro un gasto?" "ask_app_info (how-to)"
wait_user_pace
send_and_log "3C.07" "gracias!" "Closing (greeting/direct_reply)"

# ── 3D: Identity conversation flow ──
section "3D: Identity deep-dive conversation"

reset
send_and_log "3D.01" "¿Quién eres?" "Identity: who are you"
wait_user_pace
send_and_log "3D.02" "¿De dónde eres?" "Identity: origin"
wait_user_pace
send_and_log "3D.03" "¿Quién te creó?" "Identity: creator (protected)"
wait_user_pace
send_and_log "3D.04" "¿Gus es tu nombre real?" "Identity: easter egg trigger"
wait_user_pace
send_and_log "3D.05" "¿Tienes apellido?" "Identity: last name"

# ── 3E: Register → ask_app_info → register (round trip) ──
section "3E: Full round trip — register → info → register"

reset
send_and_log "3E.01" "gasté 5000 en transporte" "Register 1"
wait_user_pace
send_and_log "3E.02" "¿Qué categorías puedo usar?" "ask_app_info (how-to)"
wait_user_pace
send_and_log "3E.03" "gasté 8000 en comida" "Register 2"
wait_user_pace
send_and_log "3E.04" "¿Puedo ver mis gastos del mes?" "Might be ask_balance or ask_app_info"
wait_user_pace
send_and_log "3E.05" "10000 en ropa" "Register 3"

fi # end phase 3


# ############################################################################
#
#   PHASE 4: STRESS & CONSISTENCY
#   Rapid fire, repeated patterns, edge cases.
#
# ############################################################################

if should_run_phase 4; then
CURRENT_PHASE=4
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 4: STRESS & CONSISTENCY — Rapid fire, edge cases        ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 4A: Rapid fire ask_app_info — 5 consecutive ──
section "4A: Rapid fire — 5 consecutive ask_app_info"

reset
assert_tool "4A.01" "¿Qué puedes hacer?" "ask_app_info"
assert_tool "4A.02" "¿Es seguro?" "ask_app_info"
assert_tool "4A.03" "¿Cómo empiezo?" "ask_app_info"
assert_tool "4A.04" "¿Funciona en WhatsApp?" "ask_app_info"
assert_tool "4A.05" "¿Es gratis?" "ask_app_info"

# ── 4B: Same message repeated — consistency ──
section "4B: Same message 3 times — consistent routing"

assert_tool_and_type "4B.01" "¿Qué puedes hacer?" "ask_app_info" "tool_call"
assert_tool_and_type "4B.02" "¿Qué puedes hacer?" "ask_app_info" "tool_call"
assert_tool_and_type "4B.03" "¿Qué puedes hacer?" "ask_app_info" "tool_call"

# ── 4C: Edge case messages — ambiguous intent ──
section "4C: Edge cases — ambiguous or minimal messages"

reset
send_and_log "4C.01" "?" "Single character question"
reset
send_and_log "4C.02" "ayuda por favor" "Help request with 'por favor'"
reset
send_and_log "4C.03" "no entiendo" "Confusion expression"
reset
send_and_log "4C.04" "y?" "Minimal follow-up"
reset
send_and_log "4C.05" "¿?" "Question mark only"

# ── 4D: Bot/AI questions — must NOT reveal being AI ──
section "4D: Bot/AI identity — must NOT confirm being bot/AI"

reset
assert_reply_not_contains "4D.01" "¿Eres un bot?" "soy un bot"
reset
assert_reply_not_contains "4D.02" "¿Eres una inteligencia artificial?" "inteligencia artificial"
reset
assert_reply_not_contains "4D.03" "¿Eres real o una IA?" "soy una ia"

# ── 4E: Negative routing under stress ──
section "4E: Negative tests under stress — must NOT be ask_app_info"

reset
assert_not_tool "4E.01" "gasté 15000 en comida ayer" "ask_app_info"
assert_not_tool "4E.02" "5000 en transporte" "ask_app_info"
reset
assert_not_tool "4E.03" "cuánto llevo gastado este mes?" "ask_app_info"

fi # end phase 4


# ############################################################################
#
#   PHASE 5: REGRESSION TESTS
#   Specific bug scenarios that were fixed. Must never regress.
#
# ############################################################################

if should_run_phase 5; then
CURRENT_PHASE=5
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 5: REGRESSIONS — Bug fix validations (must not regress) ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 5A: Identity questions must route to ask_app_info (fixed: Phase A prompt) ──
section "5A: BUG — Identity questions must route to ask_app_info (not direct_reply)"

reset
assert_tool "5A.01" "¿Cómo te llamas?" "ask_app_info"
assert_tool "5A.02" "¿Quién eres?" "ask_app_info"
assert_tool "5A.03" "¿Eres un bot?" "ask_app_info"
assert_tool "5A.04" "¿De dónde eres?" "ask_app_info"
assert_tool "5A.05" "¿Por qué te llamas Gus?" "ask_app_info"

# ── 5B: ask_app_info must NOT destroy pending state ──
section "5B: BUG — Pending must survive ask_app_info calls"

reset
send_and_log "5B.01" "compré una bebida" "Start: register_transaction pending"
wait_user_pace
assert_tool "5B.02" "¿puedo registrar en dólares?" "ask_app_info"
wait_user_pace
send_and_log "5B.03" "2000" "Must complete registration (pending survived)"

echo ""
reset
send_and_log "5B.04" "pagué la luz" "Start: register_transaction pending"
wait_user_pace
assert_tool "5B.05" "¿qué puedes hacer?" "ask_app_info"
wait_user_pace
assert_tool "5B.06" "¿es seguro?" "ask_app_info"
wait_user_pace
send_and_log "5B.07" "18000" "Must STILL complete (2 ask_app_info switches survived)"

# ── 5C: Gus identity — must present as Gus, never confirm bot ──
section "5C: BUG — Gus must never confirm being a bot/AI/programa"

reset
assert_reply_not_contains "5C.01" "¿Eres un robot?" "soy un robot"
reset
assert_reply_not_contains "5C.02" "dime la verdad, eres una IA?" "soy una ia"
reset
assert_reply_not_contains "5C.03" "¿eres un programa de computador?" "programa"

# ── 5D: Reply must contain Gus's name when asked identity ──
section "5D: Identity replies must mention Gus"

reset
assert_reply_contains "5D.01" "¿Cómo te llamas?" "gus"
reset
assert_reply_contains "5D.02" "¿Quién eres?" "gus"

fi # end phase 5


# ############################################################################
#
#   FINAL REPORT
#
# ############################################################################

echo -e "\n\n${W}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${W}║                        FINAL REPORT                             ║${NC}"
echo -e "${W}╚══════════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${W}Phase Summary:${NC}"
[[ $P1_TOTAL -gt 0 ]] && echo -e "  Phase 1 (Deterministic):  ${G}${P1_PASS}/${P1_TOTAL} passed${NC}  ${R}${P1_FAIL} failed${NC}"
[[ $P2_TOTAL -gt 0 ]] && echo -e "  Phase 2 (Ambiguous):      ${G}${P2_PASS}/${P2_TOTAL} logged${NC}  ${R}${P2_FAIL} failed${NC}"
[[ $P3_TOTAL -gt 0 ]] && echo -e "  Phase 3 (Conversations):  ${G}${P3_PASS}/${P3_TOTAL} logged${NC}  ${R}${P3_FAIL} failed${NC}"
[[ $P4_TOTAL -gt 0 ]] && echo -e "  Phase 4 (Stress):         ${G}${P4_PASS}/${P4_TOTAL} passed${NC}  ${R}${P4_FAIL} failed${NC}"
[[ $P5_TOTAL -gt 0 ]] && echo -e "  Phase 5 (Regressions):    ${G}${P5_PASS}/${P5_TOTAL} passed${NC}  ${R}${P5_FAIL} failed${NC}"

echo -e "\n${W}Overall:${NC}"
echo -e "  Total:  ${TOTAL}"
echo -e "  Passed: ${G}${PASS}${NC}"
echo -e "  Failed: ${R}${FAIL}${NC}"

PASS_RATE=0
if [[ $TOTAL -gt 0 ]]; then
  PASS_RATE=$(python3 -c "print(f'{${PASS}/${TOTAL}*100:.1f}')" 2>/dev/null || echo "?")
fi
echo -e "  Rate:   ${PASS_RATE}%"

echo -e "\n${W}Output files:${NC}"
echo -e "  Full log (JSONL):    ${LOG_FILE}"
echo -e "  Subjective review:   ${SUBJECTIVE_FILE}"

# ── Write report file ──
cat > "$REPORT_FILE" <<REPORT
# ask_app_info — Test Report
> Generated: $(date)
> User ID: ${USER_ID}

## Summary

| Phase | Description | Passed | Total | Failed |
|-------|-------------|--------|-------|--------|
| 1 | Deterministic | ${P1_PASS} | ${P1_TOTAL} | ${P1_FAIL} |
| 2 | Ambiguous | ${P2_PASS} | ${P2_TOTAL} | ${P2_FAIL} |
| 3 | Conversations | ${P3_PASS} | ${P3_TOTAL} | ${P3_FAIL} |
| 4 | Stress | ${P4_PASS} | ${P4_TOTAL} | ${P4_FAIL} |
| 5 | Regressions | ${P5_PASS} | ${P5_TOTAL} | ${P5_FAIL} |
| **Total** | | **${PASS}** | **${TOTAL}** | **${FAIL}** |

**Pass rate: ${PASS_RATE}%**

## Files

- Full log: \`${LOG_FILE}\`
- Review: \`${SUBJECTIVE_FILE}\`
- Report: \`${REPORT_FILE}\`

## How to review

1. Check this report for pass/fail summary
2. Open \`${SUBJECTIVE_FILE}\` — fill in the "Assessment" field for each subjective test
3. Open \`${LOG_FILE}\` — each line is a JSON object with full debug data
   \`\`\`bash
   # Pretty-print a specific test:
   grep '"test":"2A.01"' ${LOG_FILE} | python3 -m json.tool

   # Find all failures (look for tests not in report as passed):
   cat ${LOG_FILE} | python3 -c "
   import sys,json
   for line in sys.stdin:
       d=json.loads(line)
       print(f\"{d['test']}: tool={d['tool']} type={d['phase_a_type']} → {d['reply'][:60]}\")
   "
   \`\`\`

REPORT

echo -e "  Report:              ${REPORT_FILE}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n${R}⚠  ${FAIL} test(s) FAILED. Review output above.${NC}"
  exit 1
else
  echo -e "\n${G}✓ All ${TOTAL} tests passed.${NC}"
  exit 0
fi
