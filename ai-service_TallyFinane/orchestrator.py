from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List

from openai import OpenAI

from config import Settings
from schemas import (
    ActionResult,
    MinimalUserContext,
    OrchestrateResponsePhaseA,
    OrchestrateResponsePhaseB,
    PendingSlotContext,
    RuntimeContext,
    ToolCall,
    ToolSchema,
)
from debug_logger import debug_log

# Mood ladder for dynamic mood calculation
MOOD_LADDER = ["frustrated", "tired", "normal", "hopeful", "happy", "proud"]


class Orchestrator:
    def __init__(self, client: OpenAI, config: Settings) -> None:
        self.client = client
        self.config = config
        self.prompts_dir = Path(__file__).parent / "prompts"
        # Cache gus identity prompt
        self._gus_identity: str | None = None

    def load_prompt(self, filename: str) -> str:
        """Load a prompt template from the prompts directory."""
        prompt_path = self.prompts_dir / filename
        return prompt_path.read_text(encoding="utf-8")

    def get_gus_identity(self) -> str:
        """Load and cache Gus identity prompt."""
        if self._gus_identity is None:
            self._gus_identity = self.load_prompt("gus_identity.txt")
        return self._gus_identity

    def calculate_final_mood(
        self,
        base_mood: str,
        mood_hint: int,
        budget_percent: float | None,
        streak_days: int,
    ) -> str:
        """
        Calculate final mood from base mood + hint + metrics.
        base_mood: From personality_snapshot.mood (DB), default "normal"
        mood_hint: -1, 0, +1 from backend
        This function only calculates mood; tone is NEVER modified.
        """
        # Map base_mood to MOOD_LADDER (handle legacy values)
        mood_mapping = {
            "normal": "normal",
            "happy": "happy",
            "disappointed": "tired",  # Map deprecated to tired
            "tired": "tired",
            "hopeful": "hopeful",
            "frustrated": "frustrated",
            "proud": "proud",
        }
        normalized_mood = mood_mapping.get(base_mood, "normal")
        current_idx = MOOD_LADDER.index(normalized_mood) if normalized_mood in MOOD_LADDER else 2

        # Apply hint as soft influence (±1 step max)
        target_idx = current_idx + mood_hint
        target_idx = max(0, min(len(MOOD_LADDER) - 1, target_idx))

        # Override for extreme cases
        if budget_percent is not None and budget_percent > 0.95:
            target_idx = 0  # frustrated
        elif streak_days >= 7 and (budget_percent is None or budget_percent < 0.5):
            target_idx = 5  # proud

        return MOOD_LADDER[target_idx]

    def _call_openai_json(
        self,
        messages: list,
        temperature: float,
        cid: str | None = None,
    ) -> dict:
        """Call OpenAI API with JSON response format."""
        start = time.time()
        debug_log.openai.link("Calling OpenAI (JSON)", {"model": self.config.OPENAI_MODEL, "temp": temperature}, cid)

        last_exc: Exception | None = None
        for attempt in range(self.config.MAX_RETRIES + 1):
            try:
                completion = self.client.chat.completions.create(
                    model=self.config.OPENAI_MODEL,
                    messages=messages,
                    temperature=temperature,
                    response_format={"type": "json_object"},
                    timeout=self.config.OPENAI_TIMEOUT,
                )
                raw = (completion.choices[0].message.content or "").strip()
                elapsed = (time.time() - start) * 1000
                debug_log.openai.perf("OpenAI JSON response", elapsed, cid)
                return json.loads(raw) if raw else {}
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < self.config.MAX_RETRIES:
                    debug_log.openai.warn(f"Retry {attempt + 1}/{self.config.MAX_RETRIES}", {"error": str(exc)[:50]}, cid)

        debug_log.openai.err("OpenAI call failed", {"error": str(last_exc)[:80]}, cid)
        raise last_exc  # type: ignore[misc]

    def _call_openai_text(
        self,
        messages: list,
        temperature: float,
        cid: str | None = None,
    ) -> str:
        """Call OpenAI API with text response."""
        start = time.time()
        debug_log.openai.link("Calling OpenAI (text)", {"model": self.config.OPENAI_MODEL, "temp": temperature}, cid)

        last_exc: Exception | None = None
        for attempt in range(self.config.MAX_RETRIES + 1):
            try:
                completion = self.client.chat.completions.create(
                    model=self.config.OPENAI_MODEL,
                    messages=messages,
                    temperature=temperature,
                    timeout=self.config.OPENAI_TIMEOUT,
                )
                result = (completion.choices[0].message.content or "").strip()
                elapsed = (time.time() - start) * 1000
                debug_log.openai.perf("OpenAI text response", elapsed, cid)
                return result
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < self.config.MAX_RETRIES:
                    debug_log.openai.warn(f"Retry {attempt + 1}/{self.config.MAX_RETRIES}", {"error": str(exc)[:50]}, cid)

        debug_log.openai.err("OpenAI call failed", {"error": str(last_exc)[:80]}, cid)
        raise last_exc  # type: ignore[misc]

    def phase_a(
        self,
        user_text: str,
        user_context: MinimalUserContext,
        tools: List[ToolSchema],
        pending: PendingSlotContext | None = None,
        available_categories: List[str] | None = None,
        cid: str | None = None,
    ) -> OrchestrateResponsePhaseA:
        """
        Phase A: Analyze user intent and decide on tool_call, clarification, or direct_reply.
        Now includes pending slot-fill context and available categories for intelligent deduction.
        """
        log = debug_log.orchestrator

        log.phase_a("Starting", {"user": user_context.user_id, "text": user_text[:50]}, cid)

        # Log pending context if present
        if pending:
            log.state("Pending context", {
                "tool": pending.tool,
                "collected": list(pending.collected_args.keys()),
                "missing": pending.missing_args,
            }, cid)

        system_prompt_template = self.load_prompt("phase_a_system.txt")

        # Format context and tools for the prompt
        user_context_json = json.dumps(
            user_context.model_dump(), ensure_ascii=False, indent=2
        )
        tool_schemas_json = json.dumps(
            [t.model_dump() for t in tools], ensure_ascii=False, indent=2
        )

        # Format pending context for the prompt
        if pending:
            pending_context_text = f"""ESTADO PENDIENTE (multi-turno activo):
- Herramienta: {pending.tool}
- Args YA recolectados: {json.dumps(pending.collected_args, ensure_ascii=False)}
- Args faltantes: {pending.missing_args}

IMPORTANTE: Combina los args recolectados con lo nuevo del usuario."""
        else:
            pending_context_text = "Sin contexto pendiente (mensaje nuevo)."

        # Format available categories
        if available_categories:
            categories_text = "Categorías del usuario: " + ", ".join(available_categories)
        else:
            categories_text = "Sin categorías disponibles (usar inferencia general)."

        system_prompt = system_prompt_template.format(
            user_context=user_context_json,
            tool_schemas=tool_schemas_json,
            pending_context=pending_context_text,
            available_categories=categories_text,
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        data = self._call_openai_json(
            messages=messages,
            temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
            cid=cid,
        )

        # Log raw LLM response for debugging
        log.state("LLM raw response", {"data": data}, cid)

        response_type = data.get("response_type", "clarification")

        # Validate response_type before constructing Pydantic model
        valid_types = ("tool_call", "clarification", "direct_reply")
        if response_type not in valid_types:
            log.err(
                "Invalid response_type from LLM",
                {"received": response_type, "valid": valid_types, "full_response": data},
                cid,
            )
            # Fallback to clarification with the LLM's text if available
            response_type = "clarification"

        # Build response based on response_type
        tool_call = None
        clarification = None
        direct_reply = None

        if response_type == "tool_call":
            tool_call_data = data.get("tool_call", {})
            tool_call = ToolCall(
                name=tool_call_data.get("name", "unknown"),
                args=tool_call_data.get("args", {}),
            )
            log.tool(f"Decided: {tool_call.name}", {"args": tool_call.args}, cid)
        elif response_type == "clarification":
            clarification = data.get("clarification", "No entendi tu mensaje. ¿Puedes dar mas detalles?")
            log.phase_a("Clarification", {"text": clarification[:50]}, cid)
        elif response_type == "direct_reply":
            direct_reply = data.get("direct_reply", "¡Hola! ¿En que puedo ayudarte?")
            log.phase_a("Direct reply", {"text": direct_reply[:50]}, cid)

        return OrchestrateResponsePhaseA(
            phase="A",
            response_type=response_type,
            tool_call=tool_call,
            clarification=clarification,
            direct_reply=direct_reply,
        )

    def phase_b(
        self,
        tool_name: str,
        action_result: ActionResult,
        user_context: MinimalUserContext,
        runtime_context: RuntimeContext | None = None,
        cid: str | None = None,
    ) -> OrchestrateResponsePhaseB:
        """
        Phase B: Generate a personalized final message based on the action result.
        Now includes Gus identity, dynamic mood calculation, and returns metadata.
        """
        log = debug_log.orchestrator

        log.phase_b("Starting", {"tool": tool_name, "ok": action_result.ok}, cid)

        system_prompt_template = self.load_prompt("phase_b_system.txt")
        gus_identity = self.get_gus_identity()

        # Extract personality or use defaults
        personality = user_context.personality
        tone = personality.tone if personality else "neutral"
        intensity = personality.intensity if personality else 0.5
        base_mood = personality.mood if personality and personality.mood else "normal"

        # Calculate final mood from runtime context
        runtime = runtime_context or RuntimeContext()
        metrics = runtime.metrics
        budget_percent = metrics.budget_percent if metrics else None
        streak_days = metrics.tx_streak_days if metrics else 0
        mood_hint = runtime.mood_hint or 0

        final_mood = self.calculate_final_mood(
            base_mood=base_mood,
            mood_hint=mood_hint,
            budget_percent=budget_percent,
            streak_days=streak_days,
        )

        log.mood("Calculated", {"base": base_mood, "hint": mood_hint, "final": final_mood}, cid)

        # Format data for the prompt
        data_json = json.dumps(action_result.data or {}, ensure_ascii=False)
        app_knowledge_json = ""
        ai_instruction = ""
        user_question = ""
        if action_result.data and isinstance(action_result.data, dict):
            app_knowledge_json = json.dumps(action_result.data.get("appKnowledge", {}), ensure_ascii=False)
            ai_instruction = action_result.data.get("aiInstruction", "")
            user_question = action_result.data.get("userQuestion", "")
        budget_json = json.dumps(
            user_context.active_budget.model_dump() if user_context.active_budget else None,
            ensure_ascii=False,
        )
        goals_summary = ", ".join(user_context.goals_summary) if user_context.goals_summary else "Sin metas definidas"

        # Build error info string
        error_info = ""
        if not action_result.ok and action_result.errorCode:
            error_info = f"- Error: {action_result.errorCode}"

        # Build variability context
        last_opening = runtime.last_opening or ""
        variability_hint = f"Ultima apertura usada: {last_opening}" if last_opening else ""

        # Build user style context
        user_style_info = ""
        if runtime.user_style:
            style = runtime.user_style
            style_parts = []
            if style.uses_lucas:
                style_parts.append("usa 'lucas' para dinero")
            if style.uses_chilenismos:
                style_parts.append("usa chilenismos")
            if style.emoji_level != "none":
                style_parts.append(f"nivel de emoji: {style.emoji_level}")
            if style.is_formal:
                style_parts.append("estilo formal")
            if style_parts:
                user_style_info = f"Estilo del usuario: {', '.join(style_parts)}"

        # Build cooldown context
        can_nudge = runtime.can_nudge
        can_budget_warning = runtime.can_budget_warning

        # Conversation summary context
        conv_summary = runtime.summary or ""

        system_prompt = f"""{gus_identity}

{system_prompt_template.format(
    tone=tone,
    intensity=intensity,
    mood=final_mood,
    tool_name=tool_name,
    ok=action_result.ok,
    data=data_json,
    user_question=user_question,
    app_knowledge=app_knowledge_json,
    ai_instruction=ai_instruction,
    error_info=error_info,
    active_budget=budget_json,
    goals_summary=goals_summary,
)}

CONTEXTO DE CONVERSACION:
{conv_summary if conv_summary else "Sin contexto previo"}

{user_style_info}

{variability_hint}

NUDGES PERMITIDOS:
- Puede incluir nudge general: {"Sí" if can_nudge else "No (en cooldown)"}
- Puede advertir presupuesto >90%: {"Sí" if can_budget_warning else "No (en cooldown)"}
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Genera el mensaje de respuesta."},
        ]

        final_message = self._call_openai_text(
            messages=messages,
            temperature=self.config.OPENAI_TEMPERATURE_PHASE_B,
            cid=cid,
        )

        # Extract opening for next message (deterministic)
        new_opening = self._extract_opening(final_message)

        # Detect if a nudge was included (simple heuristics)
        did_nudge = False
        nudge_type = None
        if can_nudge or can_budget_warning:
            lower_msg = final_message.lower()
            if can_budget_warning and budget_percent and budget_percent > 0.9:
                if any(w in lower_msg for w in ["presupuesto", "gastado", "límite", "cuidado"]):
                    did_nudge = True
                    nudge_type = "budget"
            elif can_nudge:
                if streak_days >= 3 and any(w in lower_msg for w in ["racha", "días seguidos", "constante"]):
                    did_nudge = True
                    nudge_type = "streak"

        # Generate updated summary (simple: append tool action)
        new_summary = None
        if action_result.ok and tool_name != "greeting":
            action_desc = self._summarize_action(tool_name, action_result)
            if conv_summary:
                new_summary = f"{conv_summary} {action_desc}"
            else:
                new_summary = action_desc

        log.phase_b("Done", {
            "mood": final_mood,
            "opening": new_opening,
            "nudge": nudge_type,
            "length": len(final_message),
        }, cid)

        return OrchestrateResponsePhaseB(
            phase="B",
            final_message=final_message,
            new_summary=new_summary,
            did_nudge=did_nudge,
            nudge_type=nudge_type,
        )

    def _extract_opening(self, response: str) -> str | None:
        """Extract opening word from response for variability tracking."""
        KNOWN_OPENINGS = ["listo", "anotado", "hecho", "ya quedó", "perfecto", "ok", "buena", "dale"]
        normalized = response.lower().strip()

        for opening in KNOWN_OPENINGS:
            if normalized.startswith(opening):
                return opening

        # Check for opening before comma/period
        import re
        match = re.match(r"^(\w+)[,\.!]", normalized)
        if match and match.group(1) in KNOWN_OPENINGS:
            return match.group(1)

        return None

    def _summarize_action(self, tool_name: str, result: ActionResult) -> str:
        """Generate a brief summary of the action for conversation memory."""
        if not result.ok:
            return ""

        data = result.data or {}

        if tool_name == "register_transaction":
            amount = data.get("amount", "?")
            category = data.get("category", "gasto")
            return f"Registró ${amount:,} en {category}." if isinstance(amount, (int, float)) else f"Registró gasto en {category}."
        elif tool_name == "ask_balance":
            return "Consultó su balance."
        elif tool_name == "ask_budget_status":
            return "Revisó estado de presupuesto."
        elif tool_name == "ask_goal_status":
            return "Consultó progreso de metas."
        elif tool_name == "ask_app_info":
            return "Preguntó sobre la app."
        else:
            return f"Usó {tool_name}."
