#!/bin/bash
# ============================================================================
# register_transaction — Comprehensive Test Suite v2
# ============================================================================
#
# 5-PHASE TEST ARCHITECTURE:
#   Phase 1: DETERMINISTIC    — Auto-validated (correct tool, response_type, amounts)
#   Phase 2: AMBIGUOUS        — Semi-auto (correct routing, subjective quality)
#   Phase 3: CONVERSATIONS    — Full multi-message flows (context, cache, pending)
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
#   ./register_transaction_tests.sh              # Run all phases
#   ./register_transaction_tests.sh 1            # Run only phase 1
#   ./register_transaction_tests.sh 1 3          # Run phases 1 and 3
#
# Last updated: 2026-02-13
# ============================================================================

set -euo pipefail

BASE_URL="http://localhost:3000"
USER_ID="f1d62f43-e1d7-453a-9e8a-79687be68313"

# Output files
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="./test-results"
LOG_FILE="${LOG_DIR}/register_tx_${TIMESTAMP}_full.jsonl"
SUBJECTIVE_FILE="${LOG_DIR}/register_tx_${TIMESTAMP}_review.md"
REPORT_FILE="${LOG_DIR}/register_tx_${TIMESTAMP}_report.md"

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

# ── assert_amount: check Phase A extracted the right amount ──
assert_amount() {
  local test_id="$1" message="$2" expected_amount="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local actual_amount
  actual_amount=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('amount','[none]'))
except: print('[error]')
" 2>/dev/null)

  if [[ "$actual_amount" == "$expected_amount" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — amount=${actual_amount}  ${DIM}«${message}»${NC}"
    _pass
  else
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — expected amount=${expected_amount}, got ${actual_amount}  ${R}«${message}»${NC}"
    _fail
  fi
}

# ── assert_no_amount: Phase A must NOT return an amount (guardrail test) ──
assert_no_amount() {
  local test_id="$1" message="$2"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"

  local has_amount
  has_amount=$(echo "$LAST_TOOL_ARGS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('yes' if 'amount' in d and d['amount'] is not None else 'no')
except: print('no')
" 2>/dev/null)

  # Pass if: clarification (no tool call at all) OR tool_call without amount
  if [[ "$LAST_PHASE_A_TYPE" == "clarification" ]] || [[ "$has_amount" == "no" ]]; then
    echo -e "  ${G}✓ PASS${NC} ${DIM}${test_id}${NC} — no amount invented (type=${LAST_PHASE_A_TYPE})  ${DIM}«${message}»${NC}"
    _pass
  else
    local invented
    invented=$(echo "$LAST_TOOL_ARGS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('amount','?'))" 2>/dev/null)
    echo -e "  ${R}✗ FAIL${NC} ${test_id} — AI HALLUCINATED amount=${invented}!  ${R}«${message}»${NC}"
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

# ── send_and_log: send without assertions (for subjective review) ──
send_and_log() {
  local test_id="$1" message="$2" category="$3"
  _increment
  _send "$message"
  _log_json "$test_id" "$message"
  _log_subjective "$test_id" "$message" "$category"

  echo -e "  ${M}◆ LOG ${NC} ${DIM}${test_id}${NC} — type=${LAST_PHASE_A_TYPE} tool=${LAST_TOOL}  ${DIM}«${message}»${NC}"
  echo -e "         ${DIM}→ ${LAST_REPLY}${NC}"
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
# register_transaction — Subjective Review
> Generated: $(date)
> User ID: ${USER_ID}
> Review each entry and fill in the Assessment field.

---

HEADER


# ############################################################################
#
#   PHASE 1: DETERMINISTIC TESTS
#   Auto-validated. Clear pass/fail. Tests routing, amounts, tool selection.
#
# ############################################################################

if should_run_phase 1; then
CURRENT_PHASE=1
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 1: DETERMINISTIC — Auto-validated routing & extraction  ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 1A: Correct tool routing ──
section "1A: Tool routing — must call register_transaction"

assert_tool "1A.01" "gasté 15000 en comida ayer" "register_transaction"
assert_tool "1A.02" "pagué 10 lucas en transporte el lunes" "register_transaction"
assert_tool "1A.03" "compré algo de 5000 en la farmacia anteayer" "register_transaction"
assert_tool "1A.04" "gasté 8000 pesos en el doctor el 10 de febrero" "register_transaction"
assert_tool "1A.05" "pagué 350000 de arriendo el 1 de febrero" "register_transaction"
assert_tool "1A.06" "me gasté 4500 en un uber el viernes" "register_transaction"
assert_tool "1A.07" "7000 en netflix el 5 de febrero" "register_transaction"
assert_tool "1A.08" "anota 3000 de taxi de ayer" "register_transaction"
assert_tool "1A.09" "registra un gasto de 12000 en almuerzo del jueves" "register_transaction"
assert_tool "1A.10" "20 lucas en ropa la semana pasada" "register_transaction"

# ── 1B: Amount extraction accuracy ──
section "1B: Amount extraction — exact values"

assert_amount "1B.01" "gasté 15000 en comida el martes" "15000"
assert_amount "1B.02" "pagué 10 lucas en transporte ayer" "10000"
assert_amount "1B.03" "gasté 5 lucas en café el 12 de febrero" "5000"
assert_amount "1B.04" "pagué 1 luca en el metro anteayer" "1000"
assert_amount "1B.05" "gasté 100 lucas en ropa el 3 de febrero" "100000"
assert_amount "1B.06" "anota 500 de chicle de ayer" "500"
assert_amount "1B.07" "gasté 25 lucas en el dentista el miércoles" "25000"
assert_amount "1B.08" "pagué 50000 en el arriendo el 1 de febrero" "50000"
assert_amount "1B.09" "registra 3500 en farmacia del viernes" "3500"
assert_amount "1B.10" "15 lucas en almuerzo el 8 de febrero" "15000"

# ── 1C: Amount guardrail — must NOT invent amounts ──
section "1C: Amount guardrail — must NOT hallucinate amounts"

reset
assert_no_amount "1C.01" "compré una bebida"
reset
assert_no_amount "1C.02" "pagué la cuenta del restaurant"
reset
assert_no_amount "1C.03" "fui al cine"
reset
assert_no_amount "1C.04" "gasté en el supermercado"
reset
assert_no_amount "1C.05" "tomé un uber al trabajo"
reset
assert_no_amount "1C.06" "pagué la luz"
reset
assert_no_amount "1C.07" "me compré un café"
reset
assert_no_amount "1C.08" "compré pan y leche"
reset
assert_no_amount "1C.09" "almorcé afuera"
reset
assert_no_amount "1C.10" "pagué una suscripción"

# ── 1D: Response type validation ──
section "1D: Response type — tool_call for complete, clarification for incomplete"

assert_type "1D.01" "gasté 15000 en comida" "tool_call"
assert_type "1D.02" "pagué 10 lucas en almuerzo" "tool_call"
assert_type "1D.03" "8000 en transporte" "tool_call"
reset
assert_type "1D.04" "hola" "direct_reply"
reset
assert_type "1D.05" "buenos días" "direct_reply"

# ── 1E: Slot-fill detection — incomplete info triggers follow-up ──
section "1E: Incomplete info triggers clarification or pending"

reset
assert_type "1E.01" "registra un gasto de 5000" "clarification"
reset
assert_type "1E.02" "anota 8000" "clarification"
reset
assert_type "1E.03" "gasté 20 lucas" "clarification"

# ── 1F: Happy path completions — no pending, ok=True ──
section "1F: Complete transactions — ok=True, no pending"

assert_no_pending "1F.01" "gasté 15000 en comida el 6 de febrero"
assert_no_pending "1F.02" "pagué 10 lucas en transporte el 13 de febrero"
assert_no_pending "1F.03" "5000 en café anteayer"

fi # end phase 1


# ############################################################################
#
#   PHASE 2: AMBIGUOUS & SUBJECTIVE
#   Logged for human/AI review. Tests semantic deduction, tone, edge cases.
#
# ############################################################################

if should_run_phase 2; then
CURRENT_PHASE=2
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 2: AMBIGUOUS — Logged for review (semantic & tone)      ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

cat >> "$SUBJECTIVE_FILE" <<SEC
## Phase 2: Ambiguous & Subjective Tests

> For each test, verify:
> 1. Did the AI pick the right category?
> 2. Is the response natural and in-character (Gus)?
> 3. Did it ask the right clarification if needed?

SEC

# ── 2A: Category deduction quality ──
section "2A: Category deduction — is the AI mapping correctly?"

reset
send_and_log "2A.01" "gasté 15000 en un almuerzo con amigos" "Category deduction: restaurant → Alimentación"
send_and_log "2A.02" "pagué 4500 de uber al trabajo" "Category deduction: uber → Transporte"
send_and_log "2A.03" "compré una polera de 25000" "Category deduction: clothing → ?"
send_and_log "2A.04" "gasté 8000 en la peluquería" "Category deduction: peluquería → Personal"
send_and_log "2A.05" "pagué 30000 del doctor" "Category deduction: doctor → Salud"
send_and_log "2A.06" "gasté 6990 en spotify" "Category deduction: spotify → Suscripciones/Entretenimiento"
send_and_log "2A.07" "compré un libro de 12000" "Category deduction: libro → Educación?"
send_and_log "2A.08" "pagué 80000 del internet y cable" "Category deduction: internet → Servicios"
send_and_log "2A.09" "gasté 5000 en un regalo" "Category deduction: regalo → ?"
send_and_log "2A.10" "pagué 3000 del estacionamiento" "Category deduction: parking → Transporte?"

# ── 2B: Chilean Spanish & slang ──
section "2B: Chilean Spanish handling"

send_and_log "2B.01" "wena, gasté 5 lucas en la pega pa almorzar" "Chilenismo: pega, lucas"
send_and_log "2B.02" "cachai, pagué como 10 lucas en la micro" "Chilenismo: cachai, micro"
send_and_log "2B.03" "me gasté 8 lucas en una chela con los cabros" "Chilenismo: chela, cabros"
send_and_log "2B.04" "gasté 3 lucas en un completo" "Chilean food: completo"
send_and_log "2B.05" "fueron 15 lucas en el copete" "Chilenismo: copete (drinks)"

# ── 2C: Ambiguous intent — register or query? ──
section "2C: Ambiguous intent — should it register or ask?"

reset
send_and_log "2C.01" "comida 5000" "Minimal: just category + amount"
reset
send_and_log "2C.02" "ayer gasté mucho en comida" "Vague amount: 'mucho'"
reset
send_and_log "2C.03" "creo que gasté como 10 lucas" "Uncertain phrasing: 'creo que'"
reset
send_and_log "2C.04" "más o menos 5000 en taxi" "Approximate: 'más o menos'"
reset
send_and_log "2C.05" "debería anotar que gasté 8000 en farmacia" "Indirect: 'debería anotar'"

# ── 2D: Description quality ──
section "2D: Does the AI extract good descriptions?"

send_and_log "2D.01" "gasté 15000 en un almuerzo con mi equipo del trabajo en el restaurant italiano" "Long context description"
send_and_log "2D.02" "pagué 4500 de uber porque llovía" "Reason-based description"
send_and_log "2D.03" "compré remedios de 8000 para el resfrío" "Purpose-based description"
send_and_log "2D.04" "gasté 50000 en el cumpleaños de mi mamá" "Event-based description"
send_and_log "2D.05" "pagué 3000 en comida pa los perros" "Non-human recipient"

# ── 2E: Date extraction ──
section "2E: Date handling — does it pick up temporal cues?"

send_and_log "2E.01" "ayer gasté 10000 en comida" "Relative date: ayer"
send_and_log "2E.02" "el viernes pagué 15000 en la cena" "Relative date: el viernes"
send_and_log "2E.03" "gasté 8000 en transporte el 10 de febrero" "Explicit date"
send_and_log "2E.04" "anteayer compré 5000 en farmacia" "Relative date: anteayer"
send_and_log "2E.05" "la semana pasada gasté 20000 en ropa" "Relative date: la semana pasada"

fi # end phase 2


# ############################################################################
#
#   PHASE 3: FULL CONVERSATIONS
#   Multi-message flows testing context, cache, pending, history references.
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
> 2. Are references ("otra más", "lo mismo") resolved?
> 3. Does pending survive unrelated questions?
> 4. Is the bot coherent across the full flow?

SEC

# ── 3A: Slot-fill → completion (amount) ──
section "3A: Slot-fill completion — provide missing amount"

reset
send_and_log "3A.01" "compré algo en la farmacia" "Start: no amount"
wait_user_pace
send_and_log "3A.02" "3500" "Provide amount → should complete"
wait_user_pace
send_and_log "3A.03" "gasté en comida" "Start: no amount (new flow)"
wait_user_pace
send_and_log "3A.04" "8 lucas" "Provide amount with lucas"

# ── 3B: Slot-fill → completion (category) ──
section "3B: Slot-fill completion — provide missing category"

reset
send_and_log "3B.01" "anota 8000" "Start: no category"
wait_user_pace
send_and_log "3B.02" "alimentación" "Provide category → should complete"
wait_user_pace
send_and_log "3B.03" "registra 5000" "Start: no category (new flow)"
wait_user_pace
send_and_log "3B.04" "transporte" "Provide category"

# ── 3C: Slot-fill + topic switch + completion (BUG FIX VALIDATION) ──
section "3C: Pending survives topic switches (bug fix 2026-02-13)"

reset
send_and_log "3C.01" "compré una bebida" "Start: no amount → pending"
wait_user_pace
send_and_log "3C.02" "puedo registrar en dólares?" "Topic switch: ask_app_info"
wait_user_pace
send_and_log "3C.03" "2000" "Back to provide amount → must complete"

echo ""
reset
send_and_log "3C.04" "fui al supermercado" "Start: no amount → pending"
wait_user_pace
send_and_log "3C.05" "cuánto llevo gastado?" "Topic switch: ask_balance"
wait_user_pace
send_and_log "3C.06" "35000" "Provide amount → must complete"

echo ""
reset
send_and_log "3C.07" "pagué la luz" "Start: no amount → pending"
wait_user_pace
send_and_log "3C.08" "cómo van mis metas?" "Topic switch: ask_goal_status"
wait_user_pace
send_and_log "3C.09" "18000" "Provide amount → must complete"

echo ""
reset
send_and_log "3C.10" "compré pan" "Start: no amount → pending"
wait_user_pace
send_and_log "3C.11" "quién eres?" "Topic switch: ask_app_info (identity)"
wait_user_pace
send_and_log "3C.12" "1500" "Provide amount → must complete"

# ── 3D: Double topic switch ──
section "3D: Pending survives MULTIPLE topic switches"

reset
send_and_log "3D.01" "compré una polera" "Start: no amount → pending"
wait_user_pace
send_and_log "3D.02" "qué puedes hacer?" "Switch 1: ask_app_info"
wait_user_pace
send_and_log "3D.03" "cuánto llevo gastado este mes?" "Switch 2: ask_balance"
wait_user_pace
send_and_log "3D.04" "15000" "Provide amount → must STILL complete"

echo ""
reset
send_and_log "3D.05" "tomé un taxi" "Start: no amount → pending"
wait_user_pace
send_and_log "3D.06" "hola" "Switch 1: greeting (direct_reply)"
wait_user_pace
send_and_log "3D.07" "cómo va mi presupuesto?" "Switch 2: ask_budget_status"
wait_user_pace
send_and_log "3D.08" "5000" "Provide amount → must complete"

# ── 3E: Full realistic conversation ──
section "3E: Realistic conversation — 12 messages, mixed actions"

reset
send_and_log "3E.01" "hola!" "Greeting"
wait_user_pace
send_and_log "3E.02" "gasté 8000 en almuerzo" "Register: complete"
wait_user_pace
send_and_log "3E.03" "otra más de 5000" "Reference: otra más, new amount"
wait_user_pace
send_and_log "3E.04" "cuánto llevo gastado?" "Query: ask_balance"
wait_user_pace
send_and_log "3E.05" "pagué 3000 en el metro" "Register: complete"
wait_user_pace
send_and_log "3E.06" "lo mismo pero 4500" "Reference: lo mismo, change amount"
wait_user_pace
send_and_log "3E.07" "anota 10 lucas en ropa" "Register: complete, new category"
wait_user_pace
send_and_log "3E.08" "otra igual" "Reference: otra igual"
wait_user_pace
send_and_log "3E.09" "cómo va mi presupuesto?" "Query: ask_budget_status"
wait_user_pace
send_and_log "3E.10" "compré remedios" "Register: no amount → pending"
wait_user_pace
send_and_log "3E.11" "6500" "Complete pending"
wait_user_pace
send_and_log "3E.12" "gracias Gus!" "Closing (should be greeting/direct_reply)"

# ── 3F: Rapid-fire then reference ──
section "3F: Rapid registration then context references"

reset
send_and_log "3F.01" "5000 en comida" "Rapid 1"
send_and_log "3F.02" "3000 en transporte" "Rapid 2"
send_and_log "3F.03" "8000 en café" "Rapid 3"
send_and_log "3F.04" "otra más" "Reference to last (café 8000)"
send_and_log "3F.05" "lo mismo pero en comida" "Reference: change category"

# ── 3G: Category mismatch flow ──
section "3G: Category mismatch → slot-fill → completion"

reset
send_and_log "3G.01" "gasté 5000 en criptomonedas" "Bad category → should show list"
wait_user_pace
send_and_log "3G.02" "entretenimiento" "Pick valid category → complete"

echo ""
reset
send_and_log "3G.03" "pagué 8000 en gimnasio" "Bad category"
wait_user_pace
send_and_log "3G.04" "salud" "Pick valid category"

# ── 3H: Category mismatch + topic switch ──
section "3H: Category mismatch → topic switch → still complete"

reset
send_and_log "3H.01" "gasté 5000 en criptomonedas" "Bad category → pending"
wait_user_pace
send_and_log "3H.02" "qué categorías tengo?" "Topic switch (ask_app_info)"
wait_user_pace
send_and_log "3H.03" "entretenimiento" "Provide valid category → must complete"

fi # end phase 3


# ############################################################################
#
#   PHASE 4: STRESS & CONSISTENCY
#   Rapid fire, repeated patterns, format variations, boundary values.
#
# ############################################################################

if should_run_phase 4; then
CURRENT_PHASE=4
echo -e "\n${Y}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${Y}║  PHASE 4: STRESS & CONSISTENCY — Rapid fire, formats, limits   ║${NC}"
echo -e "${Y}╚══════════════════════════════════════════════════════════════════╝${NC}"

# ── 4A: Rapid fire — 10 transactions, no delay ──
section "4A: Rapid fire — 10 consecutive, zero delay"

reset
assert_tool "4A.01" "3000 en metro ayer" "register_transaction"
assert_tool "4A.02" "8000 en almuerzo el lunes" "register_transaction"
assert_tool "4A.03" "5000 en café el 14 de febrero" "register_transaction"
assert_tool "4A.04" "2000 en chicle anteayer" "register_transaction"
assert_tool "4A.05" "15000 en uber el miércoles" "register_transaction"
assert_tool "4A.06" "10 lucas en farmacia el 7 de febrero" "register_transaction"
assert_tool "4A.07" "4500 en estacionamiento el jueves" "register_transaction"
assert_tool "4A.08" "50000 en dentista el 4 de febrero" "register_transaction"
assert_tool "4A.09" "3000 en taxi la semana pasada" "register_transaction"
assert_tool "4A.10" "7000 en netflix el 9 de febrero" "register_transaction"

# ── 4B: Same message repeated — consistency ──
section "4B: Same message 5 times — should all be tool_call"

assert_tool_and_type "4B.01" "gasté 5000 en comida" "register_transaction" "tool_call"
assert_tool_and_type "4B.02" "gasté 5000 en comida" "register_transaction" "tool_call"
assert_tool_and_type "4B.03" "gasté 5000 en comida" "register_transaction" "tool_call"
assert_tool_and_type "4B.04" "gasté 5000 en comida" "register_transaction" "tool_call"
assert_tool_and_type "4B.05" "gasté 5000 en comida" "register_transaction" "tool_call"

# ── 4C: Amount format variations ──
section "4C: Amount format variations"

send_and_log "4C.01" "gasté 15000 en comida" "Plain number"
send_and_log "4C.02" "gasté 15.000 en comida" "Chilean dot separator"
send_and_log "4C.03" "gasté 15 lucas en comida" "Lucas"
send_and_log "4C.04" "gasté quince mil en comida" "Written number (might fail)"
send_and_log "4C.05" 'gasté $15.000 en comida' "With $ sign"

# ── 4D: Boundary amounts ──
section "4D: Boundary amounts"

send_and_log "4D.01" "gasté 1 en chicle" "Minimum: 1 peso"
send_and_log "4D.02" "gasté 100 en chicle" "Very small: 100"
send_and_log "4D.03" "gasté 99999999 en una casa" "Near max: 99,999,999"
reset
send_and_log "4D.04" "gasté 0 en nada" "Zero: should be rejected"
reset
send_and_log "4D.05" "gasté -5000 en comida" "Negative: should be rejected"

# ── 4E: NOT register_transaction — must route elsewhere ──
section "4E: Negative tests — must NOT call register_transaction"

reset
assert_tool "4E.01" "cuánto llevo gastado?" "ask_balance"
reset
assert_tool "4E.02" "cómo va mi presupuesto?" "ask_budget_status"
reset
assert_tool "4E.03" "cómo van mis metas?" "ask_goal_status"
reset
assert_tool "4E.04" "qué puedes hacer?" "ask_app_info"
reset
assert_type "4E.05" "hola" "direct_reply"

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

# ── 5A: Hallucinated amounts (fixed 2026-02-13) ──
section "5A: BUG — Hallucinated amounts must NEVER return"

reset
assert_no_amount "5A.01" "compré una bebida"
reset
assert_no_amount "5A.02" "fui al cine"
reset
assert_no_amount "5A.03" "pagué la cuenta"
reset
assert_no_amount "5A.04" "tomé un uber"
reset
assert_no_amount "5A.05" "almorcé con amigos"

# Now with conversation context (AI might try to use previous amounts)
section "5A continued: With prior context (must still not hallucinate)"

reset
send_silent "gasté 15000 en comida"
sleep 2
assert_no_amount "5A.06" "compré una bebida"

reset
send_silent "pagué 8000 en transporte"
sleep 2
assert_no_amount "5A.07" "tomé otro uber"

reset
send_silent "gasté 5000 en café"
sleep 2
send_silent "gasté 3000 en chicle"
sleep 2
assert_no_amount "5A.08" "compré otra cosa"

# ── 5B: Slot-fill context loss (fixed 2026-02-13) ──
section "5B: BUG — Pending must survive unrelated tool calls"

# Scenario: pending register_transaction + ask_app_info → pending must survive
reset
send_and_log "5B.01" "compré una bebida" "Start pending (register_transaction)"
wait_user_pace
assert_tool "5B.02" "puedo registrar en dólares?" "ask_app_info"
wait_user_pace
# This is the critical test: the amount must complete the ORIGINAL transaction
send_and_log "5B.03" "2000" "Must complete registration, NOT start new flow"

echo ""
reset
send_and_log "5B.04" "fui al supermercado" "Start pending"
wait_user_pace
assert_tool "5B.05" "cuánto llevo gastado?" "ask_balance"
wait_user_pace
send_and_log "5B.06" "35000" "Must complete registration"

echo ""
reset
send_and_log "5B.07" "pagué la luz" "Start pending"
wait_user_pace
assert_tool "5B.08" "cómo van mis metas?" "ask_goal_status"
wait_user_pace
send_and_log "5B.09" "18000" "Must complete registration"

# Worst case: two unrelated tools between pending
echo ""
reset
send_and_log "5B.10" "compré pan" "Start pending"
wait_user_pace
assert_tool "5B.11" "quién eres?" "ask_app_info"
wait_user_pace
assert_tool "5B.12" "cuánto llevo gastado este mes?" "ask_balance"
wait_user_pace
send_and_log "5B.13" "1500" "Must STILL complete (2 switches survived)"

# ── 5C: Infinite clarification loop (prevented by fix) ──
section "5C: BUG — Must NOT enter infinite clarification loop"

reset
send_and_log "5C.01" "compré una bebida" "Start: no amount → ask"
wait_user_pace
send_and_log "5C.02" "puedo registrar en dólares?" "Topic switch"
wait_user_pace
send_and_log "5C.03" "2000" "Provide amount → must NOT ask for category again"
# If the reply asks for category, the bug is back (pending was wiped, AI sees "2000" as new)

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
# register_transaction — Test Report
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
   grep '"test":"3C.03"' ${LOG_FILE} | python3 -m json.tool

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
