from __future__ import annotations

from typing import Union
import uuid

from fastapi import FastAPI, HTTPException, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request
from openai import APITimeoutError, OpenAI

from config import settings
from orchestrator import Orchestrator
from schemas import (
    ERROR_INVALID_PHASE,
    ERROR_LLM_ERROR,
    ERROR_LLM_TIMEOUT,
    ERROR_MISSING_ACTION_RESULT,
    ERROR_MISSING_USER_TEXT,
    OrchestrateRequestPhaseA,
    OrchestrateRequestPhaseB,
    OrchestrateResponsePhaseA,
    OrchestrateResponsePhaseB,
)
from debug_logger import debug_log

# =============================================================================
# App Setup
# =============================================================================

app = FastAPI(title="AI Service - TallyFinance", version=settings.SERVICE_VERSION)
client = OpenAI(api_key=settings.OPENAI_API_KEY)
orchestrator = Orchestrator(client=client, config=settings)
log = debug_log.app


# =============================================================================
# Endpoints
# =============================================================================


@app.post(
    "/orchestrate",
    response_model=Union[OrchestrateResponsePhaseA, OrchestrateResponsePhaseB],
)
def orchestrate(
    req: Union[OrchestrateRequestPhaseA, OrchestrateRequestPhaseB],
    x_correlation_id: str = Header(default=None),
):
    """
    Main orchestration endpoint.

    Phase A: Analyze user text and return tool_call, clarification, or direct_reply.
    Phase B: Generate personalized message from action result.
    """
    # Use correlation ID from header or generate one
    cid = x_correlation_id or str(uuid.uuid4())[:8]

    try:
        log.separator(cid)
        log.recv(f"Phase {req.phase}", {"user": req.user_context.user_id}, cid)

        if req.phase == "A":
            # Validate Phase A requirements
            if not isinstance(req, OrchestrateRequestPhaseA):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Invalid request for Phase A", "code": ERROR_INVALID_PHASE},
                )
            has_media = bool(req.media)
            if (not req.user_text or not req.user_text.strip()) and not has_media:
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Phase A requires user_text or media", "code": ERROR_MISSING_USER_TEXT},
                )
            # If no text but has media, set a default prompt based on media type
            if (not req.user_text or not req.user_text.strip()) and has_media:
                media_types = [m.type for m in req.media]
                if "audio" in media_types:
                    req.user_text = (
                        "IMPORTANTE: El usuario envió un mensaje de voz. "
                        "TRANSCRIBE lo que dice en el audio y usa ESA información para decidir. "
                        "IGNORA transacciones previas del historial — solo procesa lo que dice el audio."
                    )
                elif "image" in media_types:
                    req.user_text = (
                        "El usuario envió una foto. Analiza la imagen y extrae la información financiera "
                        "(monto, comercio, categoría). Si es una boleta o recibo, extrae el total."
                    )
                else:
                    req.user_text = "Analiza este archivo y extrae la información financiera."

            response = orchestrator.phase_a(
                user_text=req.user_text,
                user_context=req.user_context,
                tools=req.tools,
                pending=req.pending,
                available_categories=req.available_categories,
                conversation_history=req.conversation_history or [],
                media=req.media if req.media else None,
                cid=cid,
            )

            log.send("Phase A response", {"type": response.response_type}, cid)
            return response

        elif req.phase == "B":
            # Validate Phase B requirements
            if not isinstance(req, OrchestrateRequestPhaseB):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Invalid request for Phase B", "code": ERROR_INVALID_PHASE},
                )
            if req.action_result is None:
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Phase B requires action_result", "code": ERROR_MISSING_ACTION_RESULT},
                )

            response = orchestrator.phase_b(
                tool_name=req.tool_name,
                action_result=req.action_result,
                user_context=req.user_context,
                runtime_context=req.runtime_context,
                user_text=req.user_text,
                conversation_history=req.conversation_history or [],
                cid=cid,
            )

            log.send("Phase B response", {"length": len(response.final_message)}, cid)
            return response

        else:
            raise HTTPException(
                status_code=400,
                detail={"detail": "Phase must be 'A' or 'B'", "code": ERROR_INVALID_PHASE},
            )

    except HTTPException:
        raise
    except APITimeoutError as e:
        log.err("LLM timeout", {"error": str(e)[:50]}, cid)
        raise HTTPException(
            status_code=503,
            detail={"detail": f"LLM timeout: {e}", "code": ERROR_LLM_TIMEOUT},
        )
    except Exception as e:  # noqa: BLE001
        log.err("LLM error", {"error": str(e)[:80]}, cid)
        raise HTTPException(
            status_code=500,
            detail={"detail": f"LLM error: {e}", "code": ERROR_LLM_ERROR},
        )


# =============================================================================
# NLU Testing Endpoint
# =============================================================================


@app.post("/nlu-test")
def nlu_test(req: dict):
    """
    Test NLU (Phase A) with different providers.

    Body:
      - text: str (required) — User message to analyze
      - provider: "openai" | "gemini" | "both" (default: "both")
      - categories: list[str] (optional) — Available categories

    Returns comparison of intent detection across providers.
    """
    text = req.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="'text' is required")

    provider = req.get("provider", "both")
    categories = req.get("categories")
    cid = str(uuid.uuid4())[:8]

    results = []

    if provider in ("openai", "both"):
        try:
            result = orchestrator.nlu_test(
                user_text=text,
                provider="openai",
                available_categories=categories,
                cid=cid,
            )
            results.append(result)
        except Exception as e:
            results.append({"provider": "openai", "error": str(e)})

    if provider in ("gemini", "both"):
        try:
            result = orchestrator.nlu_test(
                user_text=text,
                provider="gemini",
                available_categories=categories,
                cid=cid,
            )
            results.append(result)
        except Exception as e:
            results.append({"provider": "gemini", "error": str(e)})

    # Build comparison summary if both ran successfully
    comparison = None
    if len(results) == 2 and "error" not in results[0] and "error" not in results[1]:
        r0 = results[0]["response"]
        r1 = results[1]["response"]
        same_type = r0.get("response_type") == r1.get("response_type")
        same_tool = (
            r0.get("tool_call", {}).get("name") == r1.get("tool_call", {}).get("name")
            if same_type and r0.get("response_type") == "tool_call"
            else None
        )
        comparison = {
            "same_response_type": same_type,
            "same_tool": same_tool,
            "latency_diff_ms": results[1]["elapsed_ms"] - results[0]["elapsed_ms"],
        }

    return {
        "text": text,
        "results": results,
        "comparison": comparison,
    }


@app.get("/health")
def health():
    """Health check endpoint."""
    phase_a_provider = settings.PHASE_A_PROVIDER if settings.GEMINI_API_KEY else "openai"
    phase_a_model = settings.GEMINI_MODEL if phase_a_provider == "gemini" else settings.OPENAI_MODEL
    return {
        "status": "healthy",
        "phase_a": {"provider": phase_a_provider, "model": phase_a_model},
        "phase_b": {"provider": "openai", "model": settings.OPENAI_MODEL},
        "version": settings.SERVICE_VERSION,
    }


@app.get("/")
def root():
    """Root endpoint with service info."""
    return {
        "status": "ok",
        "service": "ai-service",
        "version": settings.SERVICE_VERSION,
    }


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Log request validation errors with the incoming body to diagnose 422 issues.
    """
    try:
        raw_body = (await request.body()).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        raw_body = "<unavailable>"

    log.err("Validation error 422", {"errors": str(exc.errors())[:100], "body": raw_body[:100]})
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )
