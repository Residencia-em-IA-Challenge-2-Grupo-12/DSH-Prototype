"""FastAPI / httpx tests for StudyBuddy A1 & A2 runners with stub LLM + stub toolBridge."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import httpx
import pytest

from studybuddy_pipeline.app import RunnerConfig, create_app
from tests.stub_llm import StubOpenAIServer

REPO_ROOT = Path(__file__).resolve().parents[3]


class StubToolBridge:
    def __init__(self, case: str) -> None:
        self.token = "secret-bridge-token"
        self.case = case
        if case == "bruno":
            self.student = "bruno"
            self.ws = REPO_ROOT / "fixtures/cold-start/bruno-text"
            cal = json.loads((REPO_ROOT / "fixtures/calendars/bruno.json").read_text(encoding="utf-8"))
        else:
            self.student = "ana"
            self.ws = REPO_ROOT / "fixtures/paired-replay/ana-held-out/workspace"
            cal = json.loads((REPO_ROOT / "fixtures/calendars/ana.json").read_text(encoding="utf-8"))
        self.events = cal["events"]
        self.planning_context: dict[str, Any] = {"caseId": case, "pending": None, "confirmed": None}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.plan_seq = 0

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: object) -> None:
                return

            def do_POST(self) -> None:
                if self.headers.get("x-study-run-token") != outer.token:
                    self._send(401, {"ok": False, "error": "Unauthorized"})
                    return
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                method = body["method"]
                args = body.get("args") or {}
                outer.calls.append((method, args))

                if method == "read_planning_context":
                    self._send(200, {"ok": True, "result": outer.planning_context})
                elif method == "list_synthetic_files":
                    rel = args.get("path") or ""
                    target = outer.ws / rel if rel else outer.ws
                    entries = [
                        {"name": p.name, "type": "directory" if p.is_dir() else "file"}
                        for p in sorted(target.iterdir())
                    ]
                    self._send(200, {"ok": True, "result": entries})
                elif method == "read_synthetic_file":
                    self._send(200, {"ok": True, "result": (outer.ws / args["path"]).read_text(encoding="utf-8")})
                elif method == "list_calendar":
                    self._send(
                        200,
                        {
                            "ok": True,
                            "result": {
                                "simulationToday": "2026-11-02",
                                "timezone": "America/Sao_Paulo",
                                "events": outer.events,
                            },
                        },
                    )
                elif method == "propose_planning_context":
                    rev = {"id": f"ctx-{len(outer.calls)}", "record": args["record"]}
                    outer.planning_context["pending"] = rev
                    self._send(200, {"ok": True, "result": rev})
                elif method == "draft_study_plan":
                    outer.plan_seq += 1
                    plan = {"id": f"plan-{outer.plan_seq}", "near": [{"id": "b1"}], "future": [{"id": "b2"}], "args": args}
                    self._send(200, {"ok": True, "result": plan})
                else:
                    self._send(403, {"ok": False, "error": f"Forbidden method: {method}"})

            def _send(self, code: int, payload: dict[str, Any]) -> None:
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}/tools/call"

    def confirm_pending(self) -> None:
        assert self.planning_context["pending"] is not None
        self.planning_context["confirmed"] = dict(self.planning_context["pending"])
        self.planning_context["pending"] = None

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()


@pytest.mark.anyio
async def test_a2_repair_loop_and_direct_avoid_dates_flow() -> None:
    llm = StubOpenAIServer(inject_repair_fault=True)
    bridge = StubToolBridge("ana")
    try:
        app = create_app(
            RunnerConfig(
                pipeline="a2",
                base_url=llm.base_url,
                model="stub-model",
                mode="scripted",
            )
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            health = (await client.get("/health")).json()
            assert health["pipeline"] == "a2"

            # Reject non-loopback toolBridge.url
            bad_sess = await client.post(
                "/sessions",
                json={
                    "version": 1,
                    "runId": "bad-1",
                    "caseId": "ana-held-out",
                    "student": "ana",
                    "locale": "en",
                    "clock": {"date": "2026-11-02", "timezone": "America/Sao_Paulo"},
                    "toolBridge": {"url": "https://evil.example.com/tools", "token": "t", "methods": []},
                },
            )
            assert bad_sess.status_code == 400

            start = (
                await client.post(
                    "/sessions",
                    json={
                        "version": 1,
                        "runId": "run-a2-ana",
                        "caseId": "ana-held-out",
                        "student": "ana",
                        "locale": "en",
                        "clock": {"date": "2026-11-02", "timezone": "America/Sao_Paulo"},
                        "toolBridge": {"url": bridge.url, "token": bridge.token, "methods": []},
                    },
                )
            ).json()
            sid = start["sessionId"]

            turn1 = (
                await client.post(
                    f"/sessions/{sid}/prompt",
                    json={"text": "Plan my Applied Data Ethics case memo over the next two weeks."},
                )
            ).json()
            assert turn1["question"] is not None
            assert [q["id"] for q in turn1["question"]["questions"]] == ["availability", "workload"]
            assert turn1["usage"]["availability"] == "available"

            # Test snapshot endpoint
            snap = (await client.get(f"/sessions/{sid}/snapshot")).json()
            assert snap["question"]["requestId"] == turn1["question"]["requestId"]

            turn2 = (
                await client.post(
                    f"/sessions/{sid}/answer",
                    json={
                        "requestId": turn1["question"]["requestId"],
                        "answers": [
                            {"id": "availability", "custom": "Wed/Thu/Fri 14:00-16:15", "selected": []},
                            {"id": "workload", "custom": "4h/week, max 2/day, 15m break", "selected": []},
                        ],
                    },
                )
            ).json()
            assert turn2["question"] is None
            assert bridge.planning_context["pending"] is not None

            # Confirm context and draft -> 0 LLM calls on A2!
            calls_before_draft = len(llm.requests)
            bridge.confirm_pending()
            turn3 = (
                await client.post(
                    f"/sessions/{sid}/prompt",
                    json={"text": "Draft the reviewable two-week study proposal using the confirmed inputs."},
                )
            ).json()
            assert len(llm.requests) == calls_before_draft
            assert bridge.plan_seq == 1

            # Correction -> avoidDates only directly drafts plan 2
            turn4 = (
                await client.post(
                    f"/sessions/{sid}/prompt",
                    json={"text": "Keep Wednesday, 4 November, free."},
                )
            ).json()
            assert turn4["error"] is None
            assert bridge.plan_seq == 2
            last_draft_call = [c for c in bridge.calls if c[0] == "draft_study_plan"][-1]
            assert last_draft_call[1]["avoidDates"] == ["2026-11-04"]

            await client.delete(f"/sessions/{sid}")
            trace = (await client.get("/runs/run-a2-ana/trace")).json()
            assert trace["pipeline"] == "a2"
            assert trace["validationRetries"] >= 1
            assert any(ev["agente"] == "Stage1.Ingestion" for ev in trace["rastro"])
            assert any(ev["agente"] == "Stage4.SynthesisVerifier" for ev in trace["rastro"])
    finally:
        bridge.close()
        llm.close()


@pytest.mark.anyio
async def test_a1_five_stage_loop_and_cancel_question() -> None:
    llm = StubOpenAIServer(inject_a1_loop_fault=True)
    bridge = StubToolBridge("bruno")
    try:
        app = create_app(
            RunnerConfig(
                pipeline="a1",
                base_url=llm.base_url,
                model="stub-model",
                mode="scripted",
            )
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            start = (
                await client.post(
                    "/sessions",
                    json={
                        "version": 1,
                        "runId": "run-a1-bruno",
                        "caseId": "bruno",
                        "student": "bruno",
                        "locale": "pt-BR",
                        "clock": {"date": "2026-11-02", "timezone": "America/Sao_Paulo"},
                        "toolBridge": {"url": bridge.url, "token": bridge.token, "methods": []},
                    },
                )
            ).json()
            sid = start["sessionId"]

            t1 = (
                await client.post(
                    f"/sessions/{sid}/prompt",
                    json={"text": "Ajude-me a planejar Algoritmos e Banco de Dados."},
                )
            ).json()
            assert t1["question"] is not None

            # Verify cancel-question route
            cancelled = (
                await client.post(
                    f"/sessions/{sid}/cancel-question",
                    json={"requestId": t1["question"]["requestId"]},
                )
            ).json()
            assert cancelled["question"] is None

            # Re-trigger prompt to exercise answer -> Analysis <-> Validation 2-iteration loop
            t1b = (
                await client.post(
                    f"/sessions/{sid}/prompt",
                    json={"text": "Ajude-me a planejar Algoritmos e Banco de Dados."},
                )
            ).json()
            assert t1b["question"] is not None
            t2 = (
                await client.post(
                    f"/sessions/{sid}/answer",
                    json={
                        "requestId": t1b["question"]["requestId"],
                        "answers": [{"id": "availability", "custom": "5h/semana até 15/11", "selected": []}],
                    },
                )
            ).json()
            assert t2["question"] is None
            assert bridge.planning_context["pending"] is not None

            trace = (await client.get("/runs/run-a1-bruno/trace")).json()
            agents = {ev["agente"] for ev in trace["rastro"]}
            assert {"Maestro", "Research", "Analysis", "Validation", "Communication"}.issubset(agents)
            assert trace["validationRetries"] >= 1
            assert any("stop_reason=approved" in ev["detalhe"] for ev in trace["rastro"])
    finally:
        bridge.close()
        llm.close()
