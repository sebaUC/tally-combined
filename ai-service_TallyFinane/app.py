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
            if not req.user_text or not req.user_text.strip():
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Phase A requires user_text", "code": ERROR_MISSING_USER_TEXT},
                )

            response = orchestrator.phase_a(
                user_text=req.user_text,
                user_context=req.user_context,
                tools=req.tools,
                pending=req.pending,
                available_categories=req.available_categories,
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


@app.get("/health")
def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": settings.OPENAI_MODEL,
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
