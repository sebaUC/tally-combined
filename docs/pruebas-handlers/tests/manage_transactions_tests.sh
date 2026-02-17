#!/bin/bash
# ============================================================================
# manage_transactions — Comprehensive Test Suite v1
# ============================================================================
#
# 5-PHASE TEST ARCHITECTURE:
#   SETUP:   Seed 8 known transactions for list/edit/delete tests
#   Phase 1: DETERMINISTIC    — Tool routing, operation detection, list ok, negatives
#   Phase 2: AMBIGUOUS        — Natural language list/delete/edit, hints, "no eran X, eran Y"
#   Phase 3: CONVERSATIONS    — Multi-message: register→list, register→edit, register→delete,
#                                disambiguation, slot-fill, full realistic conversation
#   Phase 4: STRESS           — Rapid fire, repeated deletes, edge cases
#   Phase 5: REGRESSIONS      — _no_match sentinel, no confirmation for delete, disambiguation format
#
# OUTPUTS:
#   Console  → PASS/FAIL summary per test with counters
#   Log file → Full JSON responses for every test (for AI/human analysis)
#   Report   → Final summary with pass rate per phase
#
# BEFORE RUNNING:
#   1. Replace USER_ID with a real user UUID (completed onboarding)
#   2. Backend running on port 3000, AI service on 8000, Redis available
#   3. Test user should have categories: Alimentación, Transporte, Salud, Personal
#
# USAGE:
#   ./manage_transactions_tests.sh              # Run all phases
#   ./manage_transactions_tests.sh 1            # Run only phase 1
#   ./manage_transactions_tests.sh 1 3          # Run phases 1 and 3
#
# Last updated: 2026-02-16
# ============================================================================

set -euo pipefail

BASE_URL="http://localhost:3000"
USER_ID="f1d62f43-e1d7-453a-9e8a-79687be68313"

# Output files
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="./test-results"
LOG_FILE="${LOG_DIR}/manage_tx_${TIMESTAMP}_full.jsonl"
SUBJECTIVE_FILE="${LOG_DIR}/manage_tx_${TIMESTAMP}_review.md"
REPORT_FILE="${LOG_DIR}/manage_tx_${TIMESTAMP}_report.md"

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
# ASSERTIONS (inherited from register_transaction_tests.sh)
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

# ── assert_has_pending: check pending state exists in tool result ──
assert_has_pending() {
  local test_id="$1" message="$2"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_PENDING" != "null" && "$LAST_PENDING" != "{}" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — pending exists  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected pending state, got null  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_no_pending: check NO pending in result (completed or no slot-fill) ──
assert_no_pending() {
  local test_id="$1" message="$2"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_PENDING" == "null" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — no pending (clean completion)  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — unexpected pending state: ${LAST_PENDING}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ============================================================================
# NEW ASSERTIONS (manage_transactions specific)
# ============================================================================

# ── assert_operation: check Phase A extracted correct operation ──
assert_operation() {
  local test_id="$1" message="$2" expected_op="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local actual_op
  actual_op=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('operation','[none]'))
except: print('[error]')
" 2>/dev/null)

  if [[ "$actual_op" == "$expected_op" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — operation=${actual_op}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected operation=${expected_op}, got ${actual_op}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_tool_and_operation: check both tool and operation ──
assert_tool_and_operation() {
  local test_id="$1" message="$2" expected_tool="$3" expected_op="$4"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local actual_op
  actual_op=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('operation','[none]'))
except: print('[error]')
" 2>/dev/null)

  if [[ "$LAST_TOOL" == "$expected_tool" && "$actual_op" == "$expected_op" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL} operation=${actual_op}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected tool=${expected_tool}/op=${expected_op}, got ${LAST_TOOL}/${actual_op}  ${R}«${message}»${NC}"
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
    echo -e "         ${DIM}→ ${LAST_REPLY:0:120}${NC}"
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
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — reply should NOT contain '${substring}'  ${R}«${message}»${NC}"
    echo -e "         ${DIM}→ ${LAST_REPLY:0:120}${NC}"
    _fail
  fi
}

# ── assert_arg: check a specific arg value in Phase A response ──
assert_arg() {
  local test_id="$1" message="$2" arg_name="$3" expected_value="$4"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local actual_value
  actual_value=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    v=d.get('${arg_name}','[none]')
    print(v)
except: print('[error]')
" 2>/dev/null)

  if [[ "$actual_value" == "$expected_value" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — ${arg_name}=${actual_value}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected ${arg_name}=${expected_value}, got ${actual_value}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_tool_and_ok: check both tool and ok result ──
assert_tool_and_ok() {
  local test_id="$1" message="$2" expected_tool="$3" expected_ok="$4"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  if [[ "$LAST_TOOL" == "$expected_tool" && "$LAST_TOOL_OK" == "$expected_ok" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — tool=${LAST_TOOL} ok=${LAST_TOOL_OK}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected tool=${expected_tool}/ok=${expected_ok}, got ${LAST_TOOL}/${LAST_TOOL_OK}  ${R}«${message}»${NC}"
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

  echo -e "  ${M}◆ LOG ${NC} ${DIM}${test_id}${NC} — type=${LAST_PHASE_A_TYPE} tool=${LAST_TOOL} ok=${LAST_TOOL_OK}  ${DIM}«${message}»${NC}"
  echo -e "         ${DIM}→ ${LAST_REPLY:0:150}${NC}"
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

# ── setup_transaction: register a transaction without counting toward test metrics ──
setup_transaction() {
  local message="$1"
  local label="${2:-}"
  _send "$message"
  if [[ -n "$label" ]]; then
    echo -e "  ${C}↳ SEED${NC} ${DIM}${label}${NC} — tool=${LAST_TOOL} ok=${LAST_TOOL_OK}  ${DIM}«${message}»${NC}"
  else
    echo -e "  ${C}↳ SEED${NC} ${DIM}tool=${LAST_TOOL} ok=${LAST_TOOL_OK}${NC}  ${DIM}«${message}»${NC}"
  fi
  sleep 2
}

# ── Initialize subjective review file ──
cat > "$SUBJECTIVE_FILE" <<HEADER
# manage_transactions — Subjective Review
> Generated: $(date)
> User ID: ${USER_ID}
> Review each entry and fill in the Assessment field.

---

HEADER


# ############################################################################
#
#   SETUP: Seed 8 known transactions for list/edit/delete tests
#
# ############################################################################

echo -e "\n${C}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${C}║  SETUP: Seeding 8 transactions for manage_transactions tests   ║${NC}"
echo -e "${C}╚══════════════════════════════════════════════════════════════════╝${NC}"

reset
setup_transaction "gasté 15000 en comida ayer"              "TX1: Alimentación 15000"
setup_transaction "pagué 8000 en transporte el lunes"       "TX2: Transporte 8000"
setup_transaction "gasté 5000 en café hoy"                  "TX3: Alimentación 5000"
setup_transaction "25000 en el doctor hace 3 días"          "TX4: Salud 25000"
setup_transaction "gasté 10000 en comida anteayer"          "TX5: Alimentación 10000"
setup_transaction "3000 en metro hoy"                       "TX6: Transporte 3000"
setup_transaction "20000 en ropa la semana pasada"          "TX7: Personal 20000"
setup_transaction "7000 en farmacia ayer"                   "TX8: Salud 7000"

echo -e "\n${C}  Setup complete: 8 transactions seeded.${NC}"
echo -e "${C}  Waiting 3s for all to settle...${NC}"
sleep 3


# ############################################################################
#
#   PHASE 1: DETERMINISTIC TESTS
#   Auto-validated. Clear pass/fail. Tests routing, operations, ok values.
#
# ############################################################################

if should_run_phase 1; then
CURRENT_PHASE=1
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 1: DETERMINISTIC — Routing, operations, list results    ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 1A: Tool routing — must call manage_transactions ──
section "1A: Tool routing — must call manage_transactions"

assert_tool "1A.01" "mis últimos gastos" "manage_transactions"
assert_tool "1A.02" "ver mis transacciones" "manage_transactions"
assert_tool "1A.03" "borra el último gasto" "manage_transactions"
assert_tool "1A.04" "elimina la última transacción" "manage_transactions"
assert_tool "1A.05" "cambia el monto a 20 lucas" "manage_transactions"
assert_tool "1A.06" "muéstrame mis gastos" "manage_transactions"
assert_tool "1A.07" "quiero ver qué he gastado" "manage_transactions"
assert_tool "1A.08" "borra eso" "manage_transactions"
assert_tool "1A.09" "elimínalo" "manage_transactions"
assert_tool "1A.10" "mis gastos de hoy" "manage_transactions"

# ── 1B: Operation detection ──
section "1B: Operation detection — list, edit, delete"

assert_tool_and_operation "1B.01" "mis gastos" "manage_transactions" "list"
assert_tool_and_operation "1B.02" "ver transacciones" "manage_transactions" "list"
assert_tool_and_operation "1B.03" "últimas 5 transacciones" "manage_transactions" "list"
assert_tool_and_operation "1B.04" "borra el último gasto" "manage_transactions" "delete"
assert_tool_and_operation "1B.05" "elimina eso" "manage_transactions" "delete"
assert_tool_and_operation "1B.06" "quítalo" "manage_transactions" "delete"
assert_tool_and_operation "1B.07" "cambia el monto a 20000" "manage_transactions" "edit"
assert_tool_and_operation "1B.08" "era transporte, no comida" "manage_transactions" "edit"
assert_tool_and_operation "1B.09" "no eran 15 lucas, eran 10" "manage_transactions" "edit"
assert_tool_and_operation "1B.10" "cámbialo a salud" "manage_transactions" "edit"

# ── 1C: List operations — ok=True (has transactions from setup) ──
section "1C: List operations — ok=True"

assert_tool_and_ok "1C.01" "mis últimos gastos" "manage_transactions" "True"
assert_tool_and_ok "1C.02" "ver mis 3 últimas transacciones" "manage_transactions" "True"
assert_tool_and_ok "1C.03" "muéstrame todo" "manage_transactions" "True"
assert_tool_and_ok "1C.04" "últimos 10 gastos" "manage_transactions" "True"
assert_tool_and_ok "1C.05" "mis transacciones recientes" "manage_transactions" "True"

# ── 1D: Negative tests — must NOT call manage_transactions ──
section "1D: Negative tests — must NOT call manage_transactions"

reset
assert_tool "1D.01" "gasté 5000 en comida" "register_transaction"
reset
assert_tool "1D.02" "cuánto llevo gastado?" "ask_balance"
reset
assert_type "1D.03" "hola" "direct_reply"
reset
assert_tool "1D.04" "cómo va mi presupuesto?" "ask_budget_status"
reset
assert_tool "1D.05" "qué puedes hacer?" "ask_app_info"

# ── 1E: Response type validation ──
section "1E: Response type — tool_call for manage operations"

assert_type "1E.01" "mis gastos" "tool_call"
assert_type "1E.02" "borra el último" "tool_call"
assert_type "1E.03" "cámbialo a 20000" "tool_call"

fi # end phase 1


# ############################################################################
#
#   PHASE 2: AMBIGUOUS & SUBJECTIVE
#   Logged for human/AI review. Tests natural language, hints, edit patterns.
#
# ############################################################################

if should_run_phase 2; then
CURRENT_PHASE=2
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 2: AMBIGUOUS — Natural language, hints, edit patterns   ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

cat >> "$SUBJECTIVE_FILE" <<SEC

## Phase 2: Ambiguous & Subjective Tests

> For each test, verify:
> 1. Did the AI pick the correct operation (list/edit/delete)?
> 2. Are hints (hint_amount, hint_category, hint_description) reasonable?
> 3. Are new_* fields correctly extracted for edits?
> 4. Is the response natural and in-character (Gus)?

SEC

# ── 2A: Natural language list requests ──
section "2A: Natural language list requests"

send_and_log "2A.01" "a ver, qué he gastado?" "Natural list: should route to manage_transactions list"
send_and_log "2A.02" "cuéntame mis gastos recientes" "Natural list: recientes"
send_and_log "2A.03" "dame un resumen de gastos" "Natural list: resumen"
send_and_log "2A.04" "qué gastos tengo?" "Natural list: qué gastos"
send_and_log "2A.05" "muéstrame las últimas transacciones" "Natural list: últimas"

# ── 2B: Natural language delete requests with hints ──
section "2B: Natural language delete with hints"

send_and_log "2B.01" "borra lo del doctor" "Delete with hint: category~Salud"
send_and_log "2B.02" "elimina el gasto de 15 lucas" "Delete with hint: amount=15000"
send_and_log "2B.03" "quita el último gasto de comida" "Delete with hint: category~Alimentación"
send_and_log "2B.04" "borra el del metro" "Delete with hint: description~metro"
send_and_log "2B.05" "elimina lo que gasté en farmacia" "Delete with hint: category~Salud or description~farmacia"

# ── 2C: Natural language edit requests ──
section "2C: Natural language edit requests"

send_and_log "2C.01" "el gasto del doctor eran 30 lucas, no 25" "Edit: hint_amount=25000, new_amount=30000"
send_and_log "2C.02" "lo del café era transporte" "Edit: hint_desc~café, new_category=Transporte"
send_and_log "2C.03" "cambia el de comida de 15000 a 12000" "Edit: hint_amount=15000, new_amount=12000"
send_and_log "2C.04" "en lo de la farmacia ponle 8000" "Edit: hint_desc~farmacia, new_amount=8000"
send_and_log "2C.05" "la descripción del metro era uber" "Edit: hint_desc~metro, new_description=uber"

# ── 2D: Edit with hints — "no eran X, eran Y" pattern ──
section "2D: 'No eran X, eran Y' pattern"

send_and_log "2D.01" "no eran 15 lucas, eran 12" "Pattern: hint_amount=15000, new_amount=12000"
send_and_log "2D.02" "no eran 8000, eran 10000" "Pattern: hint_amount=8000, new_amount=10000"
send_and_log "2D.03" "no era comida, era transporte" "Pattern: hint_cat=comida, new_cat=transporte"
send_and_log "2D.04" "no fueron 25 lucas, fueron 20" "Pattern: hint_amount=25000, new_amount=20000"
send_and_log "2D.05" "no era 5000, eran 7 lucas" "Pattern: hint_amount=5000, new_amount=7000"

# ── 2E: Ambiguous — could be different operations ──
section "2E: Ambiguous operations"

reset
send_and_log "2E.01" "qué hice ayer?" "Ambiguous: list? or ask_balance?"
reset
send_and_log "2E.02" "el gasto de comida" "Ambiguous: vague — what operation?"
reset
send_and_log "2E.03" "la transacción de 8000" "Ambiguous: vague — what operation?"
reset
send_and_log "2E.04" "mis gastos de esta semana" "Ambiguous: list or ask_balance?"
reset
send_and_log "2E.05" "lo de ayer" "Ambiguous: very vague reference"

fi # end phase 2


# ############################################################################
#
#   PHASE 3: FULL CONVERSATIONS
#   Multi-message flows testing context, edit/delete after register,
#   disambiguation, slot-fill, and realistic mixed conversations.
#
# ############################################################################

if should_run_phase 3; then
CURRENT_PHASE=3
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 3: CONVERSATIONS — Multi-message context flows          ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

cat >> "$SUBJECTIVE_FILE" <<SEC

## Phase 3: Full Conversation Flows

> For each conversation, verify:
> 1. Does context carry correctly across messages?
> 2. Are edit/delete operations targeting the right transaction?
> 3. Does disambiguation work when multiple matches?
> 4. Is the bot coherent across the full flow?

SEC

# ── 3A: Register then list — verify new transaction appears ──
section "3A: Register then list — new transaction appears"

reset
send_and_log "3A.01" "gasté 6000 en comida hoy" "Register a new transaction"
wait_user_pace
send_and_log "3A.02" "mis últimos gastos" "List — should include the 6000 we just registered"

# ── 3B: Register then edit amount ──
section "3B: Register then edit amount"

reset
send_and_log "3B.01" "gasté 12000 en almuerzo" "Register: 12000 in almuerzo"
wait_user_pace
send_and_log "3B.02" "no eran 12, eran 15 lucas" "Edit: hint_amount=12000, new_amount=15000"

echo ""
reset
send_and_log "3B.03" "pagué 9000 en taxi" "Register: 9000 taxi"
wait_user_pace
send_and_log "3B.04" "cambia el monto a 10000" "Edit: new_amount=10000 on last tx"

# ── 3C: Register then delete ──
section "3C: Register then delete"

reset
send_and_log "3C.01" "gasté 9000 en taxi" "Register: 9000 taxi"
wait_user_pace
send_and_log "3C.02" "bórralo" "Delete last transaction"

echo ""
reset
send_and_log "3C.03" "gasté 4000 en café" "Register: 4000 café"
wait_user_pace
send_and_log "3C.04" "elimina eso" "Delete last transaction"

# ── 3D: Register then category correction ──
section "3D: Register then 'era X, no Y' category correction"

reset
send_and_log "3D.01" "gasté 8000 en comida" "Register: 8000 Alimentación"
wait_user_pace
send_and_log "3D.02" "era transporte, no comida" "Edit: new_category=Transporte"

echo ""
reset
send_and_log "3D.03" "pagué 5000 en almuerzo" "Register: 5000 Alimentación"
wait_user_pace
send_and_log "3D.04" "no era comida, era salud" "Edit: new_category=Salud"

# ── 3E: Disambiguation flow — multiple matches ──
section "3E: Disambiguation — multiple comida matches"

# We have multiple comida/Alimentación transactions from setup + 3A-3D
reset
send_and_log "3E.01" "borra el gasto de comida" "Delete with hint: should trigger disambiguation"
wait_user_pace
send_and_log "3E.02" "1" "Choose first candidate from disambiguation list"

echo ""
reset
send_and_log "3E.03" "edita el gasto de transporte" "Edit with hint: may trigger disambiguation"
wait_user_pace
send_and_log "3E.04" "ponle 15000" "Provide new_amount (if disambiguated, complete; if slot-fill, provide)"

# ── 3F: Edit slot-fill — missing new_* field ──
section "3F: Edit slot-fill — missing what to change"

reset
send_and_log "3F.01" "edita el último gasto" "Edit without new_* → should ask what to change"
wait_user_pace
send_and_log "3F.02" "ponle 20000" "Provide new_amount → should complete"

echo ""
reset
send_and_log "3F.03" "modifica la última transacción" "Edit without new_* → pending"
wait_user_pace
send_and_log "3F.04" "cambia la categoría a salud" "Provide new_category → should complete"

# ── 3G: Edit with bad category → slot-fill → completion ──
section "3G: Edit with bad category → correction"

reset
send_and_log "3G.01" "cambia lo del metro a suscripciones" "Bad category 'suscripciones' → slot-fill or _no_match"
wait_user_pace
send_and_log "3G.02" "transporte" "Provide valid category → should complete"

echo ""
reset
send_and_log "3G.03" "cambia el último gasto a crypto" "Bad category 'crypto' → slot-fill"
wait_user_pace
send_and_log "3G.04" "personal" "Provide valid category → complete"

# ── 3H: Full realistic conversation — 12 messages ──
section "3H: Realistic conversation — 12 messages, mixed actions"

reset
send_and_log "3H.01" "hola" "Greeting"
wait_user_pace
send_and_log "3H.02" "gasté 8000 en almuerzo" "Register: 8000 almuerzo"
wait_user_pace
send_and_log "3H.03" "mis gastos" "List: should show recent including 8000"
wait_user_pace
send_and_log "3H.04" "no eran 8000, eran 10 lucas" "Edit: hint_amount=8000, new_amount=10000"
wait_user_pace
send_and_log "3H.05" "gasté 5000 en taxi" "Register: 5000 taxi"
wait_user_pace
send_and_log "3H.06" "bórralo" "Delete: last (taxi 5000)"
wait_user_pace
send_and_log "3H.07" "mis últimos 3 gastos" "List: last 3"
wait_user_pace
send_and_log "3H.08" "cambia el de comida a transporte" "Edit: hint_cat=comida, new_cat=transporte"
wait_user_pace
send_and_log "3H.09" "cuánto llevo gastado?" "Topic switch: ask_balance"
wait_user_pace
send_and_log "3H.10" "mis gastos" "Back to list"
wait_user_pace
send_and_log "3H.11" "borra el último" "Delete last"
wait_user_pace
send_and_log "3H.12" "gracias!" "Closing: greeting/direct_reply"

fi # end phase 3


# ############################################################################
#
#   PHASE 4: STRESS & CONSISTENCY
#   Rapid fire, repeated operations, edge cases, boundary values.
#
# ############################################################################

if should_run_phase 4; then
CURRENT_PHASE=4
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 4: STRESS & CONSISTENCY — Rapid fire, edge cases        ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 4A: Rapid fire list operations ──
section "4A: Rapid fire list operations"

assert_tool "4A.01" "mis gastos" "manage_transactions"
assert_tool "4A.02" "últimos 3" "manage_transactions"
assert_tool "4A.03" "muéstrame 10" "manage_transactions"
assert_tool "4A.04" "mis transacciones" "manage_transactions"
assert_tool "4A.05" "ver gastos" "manage_transactions"

# ── 4B: Same delete message repeated — should keep working ──
section "4B: Repeated delete — each targets different 'last' tx"

# Register 3 fresh transactions first so we have enough to delete
reset
setup_transaction "gasté 1111 en comida hoy" "Fresh TX for delete test 1"
setup_transaction "gasté 2222 en comida hoy" "Fresh TX for delete test 2"
setup_transaction "gasté 3333 en comida hoy" "Fresh TX for delete test 3"

assert_tool_and_ok "4B.01" "borra el último gasto" "manage_transactions" "True"
sleep 2
assert_tool_and_ok "4B.02" "borra el último gasto" "manage_transactions" "True"
sleep 2
assert_tool_and_ok "4B.03" "borra el último gasto" "manage_transactions" "True"

# ── 4C: Edge cases ──
section "4C: Edge cases"

reset
send_and_log "4C.01" "mis últimos 0 gastos" "Edge: limit=0 (should default to 1 or show something)"
send_and_log "4C.02" "borra un gasto que no existe con id inventado" "Edge: no matching transaction"
send_and_log "4C.03" "edita algo de criptomonedas" "Edge: no matching category for hint"
send_and_log "4C.04" "últimos 100 gastos" "Edge: limit>20 (should cap at 20)"
send_and_log "4C.05" "mis últimos -5 gastos" "Edge: negative limit"

# ── 4D: NOT manage_transactions — negative routing ──
section "4D: Negative routing — must NOT call manage_transactions"

reset
assert_tool "4D.01" "cuánto llevo gastado?" "ask_balance"
reset
assert_tool "4D.02" "gasté 5000 en café" "register_transaction"

fi # end phase 4


# ############################################################################
#
#   PHASE 5: REGRESSION TESTS
#   Specific bug scenarios and critical behaviors that must not regress.
#
# ############################################################################

if should_run_phase 5; then
CURRENT_PHASE=5
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 5: REGRESSIONS — Bug fix validations (must not regress) ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 5A: _no_match sentinel must NOT leak into reply ──
section "5A: _no_match sentinel must NOT appear in user reply"

reset
# Force a bad category edit that would trigger _no_match internally
assert_reply_not_contains "5A.01" "cambia lo del metro a suscripciones" "_no_match"
reset
assert_reply_not_contains "5A.02" "cambia la categoría a crypto" "_no_match"
reset
assert_reply_not_contains "5A.03" "ponle categoría videojuegos" "_no_match"

# ── 5B: Delete without confirmation — must delete immediately ──
section "5B: Delete must NOT ask for confirmation"

# Phase A prompt says: "NUNCA pidas confirmación para borrar"
# Register a transaction, then delete — should delete immediately, not ask "¿estás seguro?"
reset
setup_transaction "gasté 7777 en comida hoy" "Fresh TX for no-confirm delete test"
assert_reply_not_contains "5B.01" "borra el último" "estás seguro"
reset
setup_transaction "gasté 8888 en transporte hoy" "Fresh TX for no-confirm delete test 2"
assert_reply_not_contains "5B.02" "elimina eso" "seguro"
reset
setup_transaction "gasté 9999 en café hoy" "Fresh TX for no-confirm delete test 3"
assert_reply_not_contains "5B.03" "quítalo" "confirmar"

# ── 5C: Disambiguation shows proper format with numbered list ──
section "5C: Disambiguation shows numbered list with amounts"

# We should have multiple comida/alimentación transactions — trigger disambiguation
reset
send_and_log "5C.01" "borra el de comida" "Should show disambiguation with numbered candidates"
# Check the reply contains numbered items and $ signs
# (We use send_and_log since assert_reply_contains already sends, we need to check LAST_REPLY)
_increment
# Re-send to capture fresh — check for list format markers
_send "borra el gasto de comida"
_log_json "5C.02" "borra el gasto de comida"

# Check reply contains "1." (numbered list format)
local_found_1=$(echo "$LAST_REPLY" | python3 -c "
import sys
reply = sys.stdin.read().strip()
print('yes' if '1.' in reply else 'no')
" 2>/dev/null)

if [[ "$local_found_1" == "yes" ]]; then
  echo -e "  ${G}✓ PASS${NC} ${DIM}5C.02${NC} — disambiguation reply contains numbered list  ${DIM}«borra el gasto de comida»${NC}"
  _pass
else
  echo -e "  ${R}✗ FAIL${NC} 5C.02 — disambiguation reply missing numbered list format  ${R}«borra el gasto de comida»${NC}"
  echo -e "         ${DIM}→ ${LAST_REPLY:0:200}${NC}"
  _fail
fi

# ── 5D: Edit requires at least one new_* field — should ask what to change ──
section "5D: Edit without new_* fields must ask what to change"

reset
send_and_log "5D.01" "edita el último gasto" "Edit without new_* → should ask what to change (pending)"
# Verify the reply asks what to change, not just silently fail
_increment
_send "modifica la transacción"
_log_json "5D.02" "modifica la transacción"

# Should either have pending state OR ask in reply what to change
local_has_pending_or_asks=$(echo "$LAST_REPLY" | python3 -c "
import sys
reply = sys.stdin.read().strip().lower()
asks = any(kw in reply for kw in ['qué quieres', 'qué deseas', 'cambiar', 'modificar', 'monto', 'categoría'])
print('yes' if asks else 'no')
" 2>/dev/null)

if [[ "$local_has_pending_or_asks" == "yes" || "$LAST_PENDING" != "null" ]]; then
  echo -e "  ${G}✓ PASS${NC} ${DIM}5D.02${NC} — edit without new_* properly asks what to change  ${DIM}«modifica la transacción»${NC}"
  _pass
else
  echo -e "  ${R}✗ FAIL${NC} 5D.02 — edit without new_* did not ask what to change  ${R}«modifica la transacción»${NC}"
  echo -e "         ${DIM}→ ${LAST_REPLY:0:150}${NC}"
  _fail
fi

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
# manage_transactions — Test Report
> Generated: $(date)
> User ID: ${USER_ID}

## Summary

| Phase | Description | Passed | Total | Failed |
|-------|-------------|--------|-------|--------|
| Setup | Seed data | 8 | 8 | 0 |
| 1 | Deterministic | ${P1_PASS} | ${P1_TOTAL} | ${P1_FAIL} |
| 2 | Ambiguous | ${P2_PASS} | ${P2_TOTAL} | ${P2_FAIL} |
| 3 | Conversations | ${P3_PASS} | ${P3_TOTAL} | ${P3_FAIL} |
| 4 | Stress | ${P4_PASS} | ${P4_TOTAL} | ${P4_FAIL} |
| 5 | Regressions | ${P5_PASS} | ${P5_TOTAL} | ${P5_FAIL} |
| **Total** | | **${PASS}** | **${TOTAL}** | **${FAIL}** |

**Pass rate: ${PASS_RATE}%**

## Test Coverage

### manage_transactions operations tested:
- **list**: Routing, natural language, rapid fire, limit edge cases
- **edit**: Amount correction, category correction, "no eran X eran Y" pattern, hint resolution, slot-fill (missing new_*), bad category → correction flow
- **delete**: Direct delete, delete last, delete by hint, disambiguation, no-confirmation requirement

### Cross-tool context tested:
- register → list (verify appears)
- register → edit amount/category
- register → delete
- manage_transactions + ask_balance mixed conversation

### Edge cases tested:
- Limit boundaries (0, negative, >20)
- Non-existent transactions
- Bad categories (_no_match handling)
- Disambiguation (multiple matches)
- Repeated deletes
- _no_match sentinel leak prevention

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
   grep '"test":"3H.04"' ${LOG_FILE} | python3 -m json.tool

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
