"""FastAPI HTTP runner implementing http-runner-v1 for StudyBuddy Approach A1 & A2."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, HTTPException

from .contracts import (
    AnswerRequest,
    CancelQuestionRequest,
    EngineMetadata,
    PromptRequest,
    RunTraceSummary,
    SessionStartRequest,
    SessionStartResponse,
    SnapshotResponse,
)
from .llm_client import OpenAICompatibleClient
from .pipeline_a1 import PipelineA1Session
from .pipeline_a2 import PipelineA2Session
from .tool_bridge import ToolBridgeClient, assert_loopback_http_url


@dataclass
class RunnerConfig:
    pipeline: Literal["a1", "a2"]
    base_url: str
    model: str
    api_key: str | None = None
    mode: Literal["scripted", "live"] = "live"
    reasoning_effort: str | None = None
    engine_name: str | None = None
    revision: str = "studybuddy-pipeline-0.1.0"
    extra_headers: dict[str, str] | None = None


PipelineSession = PipelineA1Session | PipelineA2Session


def create_app(config: RunnerConfig) -> FastAPI:
    harness = f"studybuddy-pipeline-{config.pipeline}-v1"
    app = FastAPI(title="StudyBuddy Pipeline Runner", version="0.1.0")
    app.state.sessions = {}  # type: dict[str, PipelineSession]
    app.state.run_traces = {}  # type: dict[str, RunTraceSummary]

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "pipeline": config.pipeline,
            "harness": harness,
            "model": config.model,
            "mode": config.mode,
        }

    @app.post("/sessions", response_model=SessionStartResponse)
    async def create_session(req: SessionStartRequest) -> SessionStartResponse:
        try:
            assert_loopback_http_url(req.toolBridge.url, "toolBridge.url")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        session_id = f"{config.pipeline}-{uuid.uuid4().hex[:12]}"
        llm = OpenAICompatibleClient(
            base_url=config.base_url,
            model=config.model,
            api_key=config.api_key,
            reasoning_effort=config.reasoning_effort,
            extra_headers=dict(config.extra_headers or {}),
        )
        bridge = ToolBridgeClient(config=req.toolBridge, student=req.student, clock=req.clock)
        if config.pipeline == "a1":
            session: PipelineSession = PipelineA1Session(
                session_id=session_id,
                request=req,
                llm=llm,
                bridge=bridge,
            )
        else:
            session = PipelineA2Session(
                session_id=session_id,
                request=req,
                llm=llm,
                bridge=bridge,
            )
        app.state.sessions[session_id] = session
        app.state.run_traces[req.runId] = session.trace_summary()
        return SessionStartResponse(
            sessionId=session_id,
            engine=EngineMetadata(
                name=config.engine_name or f"StudyBuddy {config.pipeline.upper()} ({config.model})",
                revision=config.revision,
                mode=config.mode,
                model=config.model,
                harness=harness,
            ),
            usage=llm.usage_dict(),
        )

    def _get_session(session_id: str) -> PipelineSession:
        session = app.state.sessions.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    @app.post("/sessions/{session_id}/prompt", response_model=SnapshotResponse)
    async def prompt_session(session_id: str, body: PromptRequest) -> SnapshotResponse:
        session = _get_session(session_id)
        try:
            snap = await session.prompt(body.text)
            app.state.run_traces[session.request.runId] = session.trace_summary()
            return snap
        except Exception as exc:
            app.state.run_traces[session.request.runId] = session.trace_summary()
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/sessions/{session_id}/answer", response_model=SnapshotResponse)
    async def answer_session(session_id: str, body: AnswerRequest) -> SnapshotResponse:
        session = _get_session(session_id)
        try:
            snap = await session.answer(body.requestId, body.answers)
            app.state.run_traces[session.request.runId] = session.trace_summary()
            return snap
        except Exception as exc:
            app.state.run_traces[session.request.runId] = session.trace_summary()
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/sessions/{session_id}/cancel-question", response_model=SnapshotResponse)
    async def cancel_question(session_id: str, body: CancelQuestionRequest) -> SnapshotResponse:
        session = _get_session(session_id)
        try:
            snap = await session.cancel_question(body.requestId)
            app.state.run_traces[session.request.runId] = session.trace_summary()
            return snap
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/sessions/{session_id}/snapshot", response_model=SnapshotResponse)
    async def snapshot_session(session_id: str) -> SnapshotResponse:
        session = _get_session(session_id)
        return session.snapshot()

    @app.delete("/sessions/{session_id}")
    async def delete_session(session_id: str) -> dict[str, object]:
        session = app.state.sessions.pop(session_id, None)
        if session is not None:
            app.state.run_traces[session.request.runId] = session.trace_summary()
            await session.llm.close()
            await session.bridge.close()
        return {}

    @app.get("/runs/{run_id}/trace", response_model=RunTraceSummary)
    async def run_trace(run_id: str) -> RunTraceSummary:
        trace = app.state.run_traces.get(run_id)
        if trace is None:
            raise HTTPException(status_code=404, detail="Run trace not found")
        return trace

    return app
