from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List

from openai import OpenAI

from config import Settings, settings as app_settings
from schemas import (
    ActionResult,
    ConversationMessage,
    MinimalUserContext,
    OrchestrateResponsePhaseA,
    OrchestrateResponsePhaseB,
    PendingSlotContext,
    PhaseAActionItem,
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

    def _call_gemini_json(
        self,
        messages: list,
        temperature: float,
        media: list | None = None,
        cid: str | None = None,
    ) -> dict:
        """Call Gemini API with JSON response format. Supports multimodal (images, audio, docs)."""
        try:
            from google import genai
            from google.genai import types
            import base64
        except ImportError:
            raise RuntimeError("google-genai not installed. Run: pip install google-genai")

        if not app_settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY not configured")

        start = time.time()
        log = debug_log.openai
        log.link("Calling Gemini (JSON)", {
            "model": app_settings.GEMINI_MODEL,
            "temp": temperature,
            "media": len(media) if media else 0,
        }, cid)

        client = genai.Client(api_key=app_settings.GEMINI_API_KEY)

        # Convert OpenAI message format to Gemini format
        system_instruction = None
        contents = []
        for msg in messages:
            if msg["role"] == "system":
                system_instruction = msg["content"]
            elif msg["role"] == "user":
                # Build parts: text + any media attachments
                parts = [types.Part.from_text(text=msg["content"])]

                # Append media to the last user message
                if media and msg == messages[-1]:
                    for m in media:
                        try:
                            raw_bytes = base64.b64decode(m.data if hasattr(m, 'data') else m['data'])
                            mime = m.mime_type if hasattr(m, 'mime_type') else m['mime_type']
                            parts.append(types.Part.from_bytes(data=raw_bytes, mime_type=mime))
                            log.state("Media attached", {"type": m.type if hasattr(m, 'type') else m['type'], "mime": mime}, cid)
                        except Exception as media_err:
                            log.warn(f"Failed to attach media: {str(media_err)[:50]}", cid=cid)

                contents.append(types.Content(role="user", parts=parts))
            elif msg["role"] == "assistant":
                contents.append(types.Content(role="model", parts=[types.Part.from_text(text=msg["content"])]))

        config = types.GenerateContentConfig(
            temperature=temperature,
            response_mime_type="application/json",
            system_instruction=system_instruction,
        )

        response = client.models.generate_content(
            model=app_settings.GEMINI_MODEL,
            contents=contents,
            config=config,
        )

        raw = (response.text or "").strip()
        # Sanitize: Flash-Lite sometimes wraps JSON in markdown code fences
        if raw.startswith("```"):
            raw = raw.strip("`").removeprefix("json").strip()
        elapsed = (time.time() - start) * 1000
        log.perf("Gemini JSON response", elapsed, cid)
        return json.loads(raw) if raw else {}

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
        conversation_history: List[ConversationMessage] | None = None,
        media: list | None = None,
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

        # Use manual replacement instead of .format() to avoid KeyError
        # (.format() conflicts with JSON curly braces in templates and data)
        system_prompt = system_prompt_template
        system_prompt = system_prompt.replace("{user_context}", user_context_json)
        system_prompt = system_prompt.replace("{tool_schemas}", tool_schemas_json)
        system_prompt = system_prompt.replace("{pending_context}", pending_context_text)
        system_prompt = system_prompt.replace("{available_categories}", categories_text)

        # Build message array: system + conversation history + current user message
        messages = [{"role": "system", "content": system_prompt}]

        # Inject Tier 1 conversation history with metadata enrichment
        if conversation_history:
            for msg in conversation_history:
                content = msg.content
                # Enrich messages with metadata for contextual reference
                if msg.metadata:
                    meta = msg.metadata
                    meta_parts = []
                    if meta.tool:
                        meta_parts.append(f"tool={meta.tool}")
                    if meta.action:
                        meta_parts.append(f"action={meta.action}")
                    if meta.amount is not None:
                        meta_parts.append(f"amount={meta.amount}")
                    if meta.category:
                        meta_parts.append(f"category={meta.category}")
                    if meta.txId:
                        meta_parts.append(f"txId={meta.txId}")
                    if meta.slotFill:
                        meta_parts.append("slotFill=true")
                    if meta.attemptedCategory:
                        meta_parts.append(f"attemptedCategory={meta.attemptedCategory}")
                    if meta.media:
                        for m_ref in meta.media:
                            icon = "📷" if m_ref.type == "image" else "🎤" if m_ref.type == "audio" else "📄"
                            desc = m_ref.description or m_ref.fileName or m_ref.type
                            meta_parts.append(f"media={icon} {desc}")
                    if meta_parts:
                        content = f"[{', '.join(meta_parts)}] {content}"
                messages.append({"role": msg.role, "content": content})
            log.state("History injected (Phase A)", {"count": len(conversation_history)}, cid)

        messages.append({"role": "user", "content": user_text})

        # Select provider for Phase A
        provider = app_settings.PHASE_A_PROVIDER
        has_media = bool(media)
        # Force Gemini if media is present (OpenAI doesn't support multimodal in JSON mode)
        use_gemini = (provider == "gemini" or has_media) and app_settings.GEMINI_API_KEY

        if use_gemini:
            log.phase_a("Using Gemini", {"model": app_settings.GEMINI_MODEL, "media": len(media) if media else 0}, cid)
            try:
                data = self._call_gemini_json(
                    messages=messages,
                    temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
                    media=media,
                    cid=cid,
                )
            except Exception as exc:
                if has_media:
                    # Can't fallback to OpenAI with media
                    raise
                # Fallback to OpenAI on Gemini failure (503, rate limit, etc.)
                log.warn(f"Gemini failed, falling back to OpenAI: {str(exc)[:60]}", cid=cid)
                data = self._call_openai_json(
                    messages=messages,
                    temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
                    cid=cid,
                )
        else:
            data = self._call_openai_json(
                messages=messages,
                temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
                cid=cid,
            )

        # Log raw LLM response for debugging
        log.state("LLM raw response", {"data": data}, cid)

        response_type = data.get("response_type", "clarification")

        # Validate response_type before constructing Pydantic model
        valid_types = ("tool_call", "clarification", "direct_reply", "actions")
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
        actions = None

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
        elif response_type == "actions":
            raw_actions = data.get("actions", [])
            if not isinstance(raw_actions, list) or len(raw_actions) == 0:
                log.err(
                    "response_type=actions but no actions array",
                    {"full_response": data},
                    cid,
                )
                # Fallback to clarification
                response_type = "clarification"
                clarification = "No entendí bien. ¿Puedes repetir qué necesitas?"
            else:
                actions = []
                for i, item in enumerate(raw_actions):
                    try:
                        actions.append(PhaseAActionItem(
                            id=item.get("id", i),
                            tool=item.get("tool", "unknown"),
                            args=item.get("args", {}),
                            status=item.get("status", "ready"),
                            missing=item.get("missing"),
                            question=item.get("question"),
                            depends_on=item.get("depends_on"),
                        ))
                    except Exception as e:
                        log.warn(f"Skipping malformed action item {i}: {e}", cid=cid)
                log.phase_a(
                    f"Multi-action: {len(actions)} items",
                    {"tools": [a.tool for a in actions]},
                    cid,
                )

        return OrchestrateResponsePhaseA(
            phase="A",
            response_type=response_type,
            tool_call=tool_call,
            clarification=clarification,
            direct_reply=direct_reply,
            actions=actions,
        )

    def phase_b(
        self,
        tool_name: str,
        action_result: ActionResult,
        user_context: MinimalUserContext,
        runtime_context: RuntimeContext | None = None,
        user_text: str | None = None,
        conversation_history: List[ConversationMessage] | None = None,
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

        # Count actions in summary for session depth awareness
        session_action_count = len([s for s in conv_summary.split('.') if s.strip()]) if conv_summary else 0

        # Resolve user name for personalization
        user_name = user_context.display_name or ""

        # Use manual replacement instead of .format() to avoid KeyError
        formatted_template = system_prompt_template
        formatted_template = formatted_template.replace("{tone}", tone)
        formatted_template = formatted_template.replace("{mood}", final_mood)
        formatted_template = formatted_template.replace("{user_name}", user_name or "desconocido")
        formatted_template = formatted_template.replace("{tool_name}", tool_name)
        formatted_template = formatted_template.replace("{ok}", str(action_result.ok))
        formatted_template = formatted_template.replace("{data}", data_json)
        formatted_template = formatted_template.replace("{user_question}", user_question)
        formatted_template = formatted_template.replace("{app_knowledge}", app_knowledge_json)
        formatted_template = formatted_template.replace("{ai_instruction}", ai_instruction)
        formatted_template = formatted_template.replace("{error_info}", error_info)
        formatted_template = formatted_template.replace("{active_budget}", budget_json)
        formatted_template = formatted_template.replace("{goals_summary}", goals_summary)

        system_prompt = f"""{gus_identity}

{formatted_template}

CONTEXTO DE LA SESION:
{conv_summary if conv_summary else "Primera interaccion de esta sesion."}
Acciones en esta sesion: {session_action_count}

{user_style_info}

{variability_hint}

NUDGES PERMITIDOS:
- Puede incluir nudge general: {"Sí" if can_nudge else "No (en cooldown)"}
- Puede advertir presupuesto >90%: {"Sí" if can_budget_warning else "No (en cooldown)"}
"""

        # Build message array: system + conversation history + user message
        messages = [{"role": "system", "content": system_prompt}]

        # Inject Tier 1 conversation history with metadata enrichment
        if conversation_history:
            for msg in conversation_history:
                content = msg.content
                if msg.metadata:
                    meta = msg.metadata
                    meta_parts = []
                    if meta.tool:
                        meta_parts.append(f"tool={meta.tool}")
                    if meta.action:
                        meta_parts.append(f"action={meta.action}")
                    if meta.amount is not None:
                        meta_parts.append(f"amount={meta.amount}")
                    if meta.category:
                        meta_parts.append(f"category={meta.category}")
                    if meta.txId:
                        meta_parts.append(f"txId={meta.txId}")
                    if meta.media:
                        for m_ref in meta.media:
                            icon = "📷" if m_ref.type == "image" else "🎤" if m_ref.type == "audio" else "📄"
                            desc = m_ref.description or m_ref.fileName or m_ref.type
                            meta_parts.append(f"media={icon} {desc}")
                    if meta_parts:
                        content = f"[{', '.join(meta_parts)}] {content}"
                messages.append({"role": msg.role, "content": content})
            log.state("History injected (Phase B)", {"count": len(conversation_history)}, cid)

        # Use real user text for natural continuation, fallback to fixed prompt
        final_user_content = user_text if user_text else "Genera el mensaje de respuesta."
        messages.append({"role": "user", "content": final_user_content})

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

        # Generate updated summary (with Tier 2 pattern compression)
        new_summary = None
        if action_result.ok and tool_name != "greeting":
            action_desc = self._summarize_action(tool_name, action_result)
            if conv_summary:
                raw_summary = f"{conv_summary} {action_desc}"
            else:
                raw_summary = action_desc
            # Tier 2: compress repeated transaction patterns
            new_summary = self._compress_summary(raw_summary)

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

    def nlu_test(
        self,
        user_text: str,
        provider: str = "openai",
        available_categories: List[str] | None = None,
        cid: str | None = None,
    ) -> dict:
        """
        Test NLU (Phase A only) with different providers.
        Returns raw LLM response + timing for comparison.
        """
        import time as _time

        log = debug_log.orchestrator
        log.phase_a(f"NLU Test ({provider})", {"text": user_text[:50]}, cid)

        # Build minimal context for testing
        from tool_schemas import get_tool_schemas
        tools = get_tool_schemas()

        dummy_context = MinimalUserContext(
            user_id="nlu-test",
            personality=None,
            prefs=None,
            active_budget=None,
            goals_summary=[],
        )

        system_prompt_template = self.load_prompt("phase_a_system.txt")
        user_context_json = json.dumps(dummy_context.model_dump(), ensure_ascii=False, indent=2)
        tool_schemas_json = json.dumps([t.model_dump() for t in tools], ensure_ascii=False, indent=2)
        pending_context_text = "Sin contexto pendiente (mensaje nuevo)."

        if available_categories:
            categories_text = "Categorías del usuario: " + ", ".join(available_categories)
        else:
            categories_text = "Categorías del usuario: Alimentación, Transporte, Hogar, Salud, Personal, Entretenimiento, Educación, Servicios"

        system_prompt = system_prompt_template
        system_prompt = system_prompt.replace("{user_context}", user_context_json)
        system_prompt = system_prompt.replace("{tool_schemas}", tool_schemas_json)
        system_prompt = system_prompt.replace("{pending_context}", pending_context_text)
        system_prompt = system_prompt.replace("{available_categories}", categories_text)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]

        start = _time.time()

        if provider == "gemini":
            data = self._call_gemini_json(
                messages=messages,
                temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
                cid=cid,
            )
        else:
            data = self._call_openai_json(
                messages=messages,
                temperature=self.config.OPENAI_TEMPERATURE_PHASE_A,
                cid=cid,
            )

        elapsed_ms = round((_time.time() - start) * 1000)

        return {
            "provider": provider,
            "model": app_settings.GEMINI_MODEL if provider == "gemini" else self.config.OPENAI_MODEL,
            "user_text": user_text,
            "response": data,
            "elapsed_ms": elapsed_ms,
        }

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
            tx_type = data.get("type", "expense")
            name = data.get("name", "")
            if isinstance(amount, (int, float)):
                if tx_type == "income":
                    label = name or "ingreso"
                    return f"Registró ingreso de ${amount:,} ({label})."
                base = f"Registró ${amount:,} en {category}"
                if name:
                    base += f" ({name})"
                return base + "."
            return f"Registró {'ingreso' if tx_type == 'income' else 'gasto'} en {category}."
        elif tool_name == "ask_balance":
            total_balance = data.get("totalBalance")
            total_spent = data.get("totalSpent")
            if total_balance and isinstance(total_balance, (int, float)):
                parts = [f"balance ${total_balance:,.0f}"]
                if total_spent and isinstance(total_spent, (int, float)) and total_spent > 0:
                    parts.append(f"${total_spent:,.0f} gastado este mes")
                return f"Consultó su balance ({', '.join(parts)})."
            return "Consultó su balance."
        elif tool_name == "ask_budget_status":
            budget_data = data.get("budget") or data
            remaining = budget_data.get("remaining") if isinstance(budget_data, dict) else None
            if remaining and isinstance(remaining, (int, float)):
                return f"Revisó presupuesto (le quedan ${remaining:,.0f})."
            return "Revisó estado de presupuesto."
        elif tool_name == "ask_goal_status":
            return "Consultó progreso de metas."
        elif tool_name == "manage_transactions":
            op = data.get("operation", "?")
            if op == "list":
                count = data.get("count", 0)
                return f"Listó sus últimas {count} transacciones."
            elif op == "edit":
                prev = data.get("previous", {})
                changes = data.get("changes", [])
                amt = prev.get("amount", "?")
                amt_str = f"${amt:,}" if isinstance(amt, (int, float)) else str(amt)
                return f"Editó transacción de {amt_str} ({', '.join(changes)})."
            elif op == "delete":
                deleted = data.get("deleted", {})
                amt = deleted.get("amount", "?")
                amt_str = f"${amt:,}" if isinstance(amt, (int, float)) else str(amt)
                return f"Eliminó transacción de {amt_str} en {deleted.get('category', '?')}."
            return f"Gestionó transacciones ({op})."
        elif tool_name == "manage_categories":
            op = data.get("operation", "?")
            if op == "create":
                name = data.get("category", {}).get("name", "?") if isinstance(data.get("category"), dict) else "?"
                return f"Creó categoría \"{name}\"."
            elif op == "create_and_register":
                cat_name = data.get("category", {}).get("name", "?") if isinstance(data.get("category"), dict) else "?"
                tx = data.get("transaction", {})
                amt = tx.get("amount", "?") if isinstance(tx, dict) else "?"
                if isinstance(amt, (int, float)):
                    return f"Creó categoría \"{cat_name}\" y registró ${amt:,}."
                return f"Creó categoría \"{cat_name}\" y registró gasto."
            elif op == "rename":
                old_name = data.get("old_name", "?")
                new_name = data.get("category", {}).get("name", "?") if isinstance(data.get("category"), dict) else "?"
                return f"Renombró categoría \"{old_name}\" a \"{new_name}\"."
            elif op == "delete":
                name = data.get("name", "?")
                return f"Eliminó categoría \"{name}\"."
            elif op == "list":
                count = data.get("count", 0)
                return f"Listó sus {count} categorías."
            return f"Gestionó categorías ({op})."
        elif tool_name == "ask_app_info":
            question = data.get("userQuestion", "")
            if question:
                return f"Preguntó: {question[:40]}."
            return "Preguntó sobre la app."
        else:
            return f"Usó {tool_name}."

    def _compress_summary(self, summary: str) -> str:
        """
        Tier 2: Compress repeated transaction patterns in summary.
        "Registró $15,000 en Comida. Registró $8,000 en Comida." →
        "Registró 2 gastos en Comida ($23,000 total)."
        """
        import re

        # Find all individual transaction entries by category
        individual_pattern = r"Registró \$([0-9,.]+) en ([^.]+)\."
        matches = list(re.finditer(individual_pattern, summary))

        if len(matches) < 2:
            return summary

        # Group by category (case-insensitive)
        from collections import defaultdict
        category_groups: dict[str, list[tuple[re.Match, float]]] = defaultdict(list)
        for m in matches:
            amount_str = m.group(1).replace(".", "").replace(",", "")
            amount = float(amount_str) if amount_str else 0
            category = m.group(2).strip()
            category_groups[category.lower()].append((m, amount))

        # Only compress categories with 2+ entries
        has_compression = False
        for cat_key, entries in category_groups.items():
            if len(entries) >= 2:
                has_compression = True
                break

        if not has_compression:
            return summary

        # Rebuild summary: replace repeated entries with compressed ones
        result_parts = []
        compressed_categories = set()
        non_tx_parts = []

        # Extract non-transaction parts
        last_end = 0
        for m, _ in sorted(
            [(m, a) for entries in category_groups.values() for m, a in entries],
            key=lambda x: x[0].start(),
        ):
            before = summary[last_end:m.start()].strip()
            if before:
                non_tx_parts.append(before)
            last_end = m.end()
        trailing = summary[last_end:].strip()
        if trailing:
            non_tx_parts.append(trailing)

        # Build compressed entries
        for cat_key, entries in category_groups.items():
            # Use the original category casing from the first entry
            category_name = entries[0][0].group(2).strip()
            if len(entries) >= 2:
                total = sum(amount for _, amount in entries)
                count = len(entries)
                result_parts.append(f"Registró {count} gastos en {category_name} (${total:,.0f} total).")
                compressed_categories.add(cat_key)
            else:
                # Keep single entries as-is
                result_parts.append(entries[0][0].group(0))

        # Combine: non-transaction parts + compressed transactions
        all_parts = non_tx_parts + result_parts
        return " ".join(p for p in all_parts if p)
