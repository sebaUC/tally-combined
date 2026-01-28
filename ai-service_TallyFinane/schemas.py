from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# =============================================================================
# Enums matching Supabase database
# =============================================================================

# From bot_tone_enum
ToneType = Literal["neutral", "friendly", "serious", "motivational", "strict"]

# From bot_mood_enum
MoodType = Literal["normal", "happy", "disappointed", "tired", "hopeful", "frustrated", "proud"]

# From notification_level_enum
NotificationLevelType = Literal["none", "light", "medium", "intense"]

# From goal_status_enum
GoalStatusType = Literal["in_progress", "completed", "canceled"]

# From payment_type_t
PaymentTypeType = Literal["credito", "debito"]

# From tx_source_t
TxSourceType = Literal["manual", "chat_intent", "import", "bank_api", "ai_extraction"]


# =============================================================================
# Shared Models (matching Supabase tables)
# =============================================================================


class ToolCall(BaseModel):
    """Tool call returned by Phase A."""
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)


class Personality(BaseModel):
    """Maps to personality_snapshot table."""
    tone: ToneType
    intensity: float  # 0.0 - 1.0
    mood: Optional[MoodType] = None  # Optional for backward compatibility


class UserPrefs(BaseModel):
    """Maps to user_prefs table."""
    notification_level: NotificationLevelType
    unified_balance: Optional[bool] = None


class Budget(BaseModel):
    """
    Maps to spending_expectations table.
    Note: 'spent' is calculated by NestJS from transactions, not stored in DB.
    """
    period: str  # "daily" | "weekly" | "monthly" - stored as string in DB
    amount: float
    spent: Optional[float] = None  # Calculated field, not in spending_expectations


class Goal(BaseModel):
    """Maps to goals table (summary version for context)."""
    name: str
    target_amount: float
    progress_amount: float
    status: Optional[GoalStatusType] = None


class MinimalUserContext(BaseModel):
    """
    User context sent from NestJS to AI-service.
    Aggregated from multiple Supabase tables.
    """
    user_id: str
    personality: Optional[Personality] = None  # From personality_snapshot
    prefs: Optional[UserPrefs] = None  # From user_prefs
    active_budget: Optional[Budget] = None  # From spending_expectations WHERE active=true
    goals_summary: List[str] = Field(default_factory=list)  # Formatted strings like "Viaje (45%)"


class ActionResult(BaseModel):
    """
    Result of a tool execution by NestJS.
    Sent to Phase B for message generation.
    """
    ok: bool
    action: str
    data: Optional[Dict[str, Any]] = None
    userMessage: Optional[str] = None  # For slot-filling clarification from handler
    errorCode: Optional[str] = None


# =============================================================================
# Tool Schema Definitions
# =============================================================================


class ToolSchemaParameter(BaseModel):
    type: str
    description: str


class ToolSchemaParameters(BaseModel):
    type: str = "object"
    properties: Dict[str, ToolSchemaParameter]
    required: List[str] = Field(default_factory=list)


class ToolSchema(BaseModel):
    name: str
    description: str
    parameters: ToolSchemaParameters


# =============================================================================
# Phase A - Intent Analysis
# =============================================================================


class PendingSlotContext(BaseModel):
    """
    Pending slot-fill state from previous turn.
    Used to continue multi-turn transactions.
    """
    tool: str  # Tool name waiting for more info (e.g., "register_transaction")
    collected_args: Dict[str, Any] = Field(default_factory=dict)  # Already collected args
    missing_args: List[str] = Field(default_factory=list)  # What's still needed
    asked_at: Optional[str] = None  # ISO timestamp when we asked


class OrchestrateRequestPhaseA(BaseModel):
    """
    Phase A request: Analyze user text and determine action.
    """
    phase: Literal["A"]
    user_text: str
    user_context: MinimalUserContext
    tools: List[ToolSchema]
    # NEW: Slot-filling context from previous turn
    pending: Optional[PendingSlotContext] = None
    # NEW: User's actual category names for matching
    available_categories: List[str] = Field(default_factory=list)


class OrchestrateResponsePhaseA(BaseModel):
    """
    Phase A response: Returns tool_call, clarification, or direct_reply.
    """
    phase: Literal["A"] = "A"
    response_type: Literal["tool_call", "clarification", "direct_reply"]
    tool_call: Optional[ToolCall] = None
    clarification: Optional[str] = None
    direct_reply: Optional[str] = None


# =============================================================================
# Phase B - Reply Generation
# =============================================================================


class UserMetrics(BaseModel):
    """User engagement metrics from backend."""
    tx_streak_days: int = 0
    week_tx_count: int = 0
    budget_percent: Optional[float] = None  # spent/amount (0.0-1.0+)


class UserStyle(BaseModel):
    """User writing style detected by backend."""
    uses_lucas: bool = False
    uses_chilenismos: bool = False
    emoji_level: Literal["none", "light", "moderate"] = "none"
    is_formal: bool = False


class RuntimeContext(BaseModel):
    """
    Runtime context for Phase B (richer generation).
    Passed from backend with conversation state and metrics.
    """
    # Conversation memory
    summary: Optional[str] = None  # Natural language recap from previous messages

    # Metrics for AI mood calculation
    metrics: Optional[UserMetrics] = None

    # Mood hint from backend (-1, 0, +1), AI computes final mood
    mood_hint: Optional[int] = Field(default=0, ge=-1, le=1)

    # Cooldown flags (for nudge decisions)
    can_nudge: bool = True
    can_budget_warning: bool = True

    # Variability (for opening rotation)
    last_opening: Optional[str] = None  # "Listo", "Anotado", etc.

    # User style (regex detected)
    user_style: Optional[UserStyle] = None


class OrchestrateRequestPhaseB(BaseModel):
    """
    Phase B request: Generate personalized message from action result.
    """
    phase: Literal["B"]
    tool_name: str
    action_result: ActionResult
    user_context: MinimalUserContext
    runtime_context: Optional[RuntimeContext] = None  # NEW: Extended context


class OrchestrateResponsePhaseB(BaseModel):
    """
    Phase B response: Final message + metadata for backend to save.
    """
    phase: Literal["B"] = "B"
    final_message: str
    # NEW: Metadata for backend to persist
    new_summary: Optional[str] = None  # Updated conversation summary
    did_nudge: Optional[bool] = False  # Whether a nudge was included
    nudge_type: Optional[Literal["budget", "goal", "streak"]] = None  # Type of nudge


# =============================================================================
# Union Types for Request Routing
# =============================================================================


OrchestrateRequest = Union[OrchestrateRequestPhaseA, OrchestrateRequestPhaseB]
OrchestrateResponse = Union[OrchestrateResponsePhaseA, OrchestrateResponsePhaseB]


# =============================================================================
# Error Codes
# =============================================================================


ERROR_INVALID_PHASE = "INVALID_PHASE"
ERROR_MISSING_USER_TEXT = "MISSING_USER_TEXT"
ERROR_MISSING_ACTION_RESULT = "MISSING_ACTION_RESULT"
ERROR_LLM_ERROR = "LLM_ERROR"
ERROR_LLM_TIMEOUT = "LLM_TIMEOUT"
