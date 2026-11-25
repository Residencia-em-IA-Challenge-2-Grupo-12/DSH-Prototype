"""Deterministic stub OpenAI-compatible HTTP server for offline A1 & A2 tests."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


BRUNO_RECORD = {
    "courses": [
        {
            "name": "Algoritmos",
            "date": "2026-12-14",
            "time": "09:00",
            "citation": {
                "path": "notices/aviso-turma-n02.md",
                "quote": "A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.",
            },
            "resolution": "Aviso da turma N02 transferiu a prova de 07/12 para 14/12.",
        },
        {
            "name": "Banco de Dados",
            "date": "2026-12-14",
            "time": "18:00",
            "citation": {
                "path": "courses/banco-de-dados.md",
                "quote": "Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo",
            },
        },
    ],
    "studyWindows": [
        {"weekday": 1, "start": "19:00", "end": "21:15"},
        {"weekday": 3, "start": "19:00", "end": "21:15"},
        {"weekday": 6, "start": "14:00", "end": "16:15"},
        {"weekday": 0, "start": "10:00", "end": "12:15"},
    ],
    "targetHours": 5,
    "maxDailyStudyHours": 2,
    "studyBreakMinutes": 15,
    "through": "2026-11-15",
    "assumption": "Disponibilidade provisória para duas semanas; plantão opcional fora de courses.",
}

ANA_RECORD = {
    "courses": [
        {
            "name": "Applied Data Ethics",
            "date": "2026-12-01",
            "time": "17:30",
            "citation": {
                "path": "lms/assessment-export.json",
                "quote": '"dueAt": "2026-12-01T20:30:00Z"',
            },
            "resolution": "LMS revision 2 replaces the earlier October module outline date.",
        }
    ],
    "studyWindows": [
        {"weekday": 3, "start": "14:00", "end": "16:15"},
        {"weekday": 4, "start": "14:00", "end": "16:15"},
        {"weekday": 5, "start": "14:00", "end": "16:15"},
    ],
    "targetHours": 4,
    "maxDailyStudyHours": 2,
    "studyBreakMinutes": 15,
    "through": "2026-11-15",
    "assumption": "Two-week plan keeping weekends open; optional Nov 19 clinic noted.",
}


class StubOpenAIServer:
    """In-process deterministic OpenAI /v1/chat/completions stub supporting A1 & A2 + fault injection."""

    def __init__(self, *, inject_repair_fault: bool = False, inject_a1_loop_fault: bool = False) -> None:
        self.inject_repair_fault = inject_repair_fault
        self.inject_a1_loop_fault = inject_a1_loop_fault
        self.requests: list[dict[str, Any]] = []
        self._fault_fired: set[str] = set()
        self._lock = threading.Lock()

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: object) -> None:
                return

            def do_POST(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                body = json.loads(raw.decode("utf-8"))
                with outer._lock:
                    outer.requests.append(body)
                    response_json = outer._dispatch(body)
                payload = json.dumps(response_json).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}/v1"

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _detect_case(self, text: str) -> str:
        if "Applied Data Ethics" in text or "Student: ana" in text or "Estudante: ana" in text:
            return "ana"
        return "bruno"

    def _reply(self, content_obj: dict[str, Any], prompt_toks: int = 120, comp_toks: int = 60) -> dict[str, Any]:
        return {
            "id": "stub-chat-1",
            "object": "chat.completion",
            "usage": {"prompt_tokens": prompt_toks, "completion_tokens": comp_toks, "total_tokens": prompt_toks + comp_toks},
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(content_obj, ensure_ascii=False),
                    },
                }
            ],
        }

    def _dispatch(self, body: dict[str, Any]) -> dict[str, Any]:
        # Guard: verify unsupported sampling params are never sent and max_tokens >= 8192
        for forbidden in ("temperature", "top_p", "top_k", "presence_penalty", "tools"):
            if forbidden in body:
                raise AssertionError(f"Unexpected parameter in pipeline request: {forbidden}")
        assert body.get("max_tokens", 0) >= 8192

        messages = body.get("messages") or []
        sys_msg = str(messages[0].get("content") or "") if messages else ""
        full_user = "\n".join(str(m.get("content") or "") for m in messages[1:])
        case = self._detect_case(full_user)

        # ---- Approach A2 ----
        if "structured-extraction module" in sys_msg:
            if case == "ana":
                return self._reply(
                    {
                        "deadlines": [
                            {
                                "course": "Applied Data Ethics",
                                "date": "2026-12-01",
                                "time": "17:30",
                                "source_path": "lms/assessment-export.json",
                                "page": None,
                                "quote": '"dueAt": "2026-12-01T20:30:00Z"',
                                "is_optional": False,
                                "supersedes_earlier": True,
                                "resolution_note": "Revision 2 replaces October outline.",
                            }
                        ],
                        "conflicts": [
                            {
                                "course": "Applied Data Ethics",
                                "description": "Outline says Nov 24 vs LMS revision 2 Dec 1",
                                "resolved": True,
                                "resolution_note": "LMS revision 2 explicitly replaces outline.",
                            }
                        ],
                        "missing_preferences": {
                            "studyWindows": True,
                            "targetHours": True,
                            "maxDailyStudyHours": True,
                            "studyBreakMinutes": True,
                            "through": False,
                        },
                        "calendar_summary": "Work 08-12, lunch 12-13, evening classes Mon/Wed/Thu.",
                    }
                )
            return self._reply(
                {
                    "deadlines": [
                        {
                            "course": "Algoritmos",
                            "date": "2026-12-14",
                            "time": "09:00",
                            "source_path": "notices/aviso-turma-n02.md",
                            "page": None,
                            "quote": "A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.",
                            "is_optional": False,
                            "supersedes_earlier": True,
                            "resolution_note": "Aviso da turma N02 atualizou a data.",
                        },
                        {
                            "course": "Banco de Dados",
                            "date": "2026-12-14",
                            "time": "18:00",
                            "source_path": "courses/banco-de-dados.md",
                            "page": None,
                            "quote": "Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo",
                            "is_optional": False,
                            "supersedes_earlier": False,
                            "resolution_note": None,
                        },
                    ],
                    "conflicts": [
                        {
                            "course": "Algoritmos",
                            "description": "Cronograma inicial 07/12 vs aviso 14/12",
                            "resolved": True,
                            "resolution_note": "Aviso fixado substitui o cronograma inicial.",
                        }
                    ],
                    "missing_preferences": {
                        "studyWindows": True,
                        "targetHours": True,
                        "maxDailyStudyHours": True,
                        "studyBreakMinutes": True,
                        "through": True,
                    },
                    "calendar_summary": "Trabalho 13-18 seg-sex; aulas ter/qui noite.",
                }
            )

        if "structured-synthesis module" in sys_msg:
            if self.inject_repair_fault and "a2_synth" not in self._fault_fired and len(messages) == 2:
                self._fault_fired.add("a2_synth")
                bad = json.loads(json.dumps(ANA_RECORD if case == "ana" else BRUNO_RECORD))
                bad["courses"][0]["name"] = f"{bad['courses'][0]['name']} - Case memo"
                bad["courses"][0]["citation"]["quote"] = "Nonexistent fabricated quote here"
                bad["assumption"] = "x" * 605
                if case == "ana":
                    bad["courses"][0]["time"] = "20:30"
                return self._reply(bad)
            return self._reply(ANA_RECORD if case == "ana" else BRUNO_RECORD)

        if "structured-revision module" in sys_msg:
            if case == "ana":
                return self._reply(
                    {
                        "mode": "avoid_dates_only",
                        "avoid_dates": ["2026-11-04"],
                        "updated_record": None,
                        "rationale": "Only Nov 4 is excluded; recurring Wed/Thu/Fri stay valid.",
                    }
                )
            updated = json.loads(json.dumps(BRUNO_RECORD))
            updated["studyWindows"] = [w for w in updated["studyWindows"] if w["weekday"] != 1]
            return self._reply(
                {
                    "mode": "context_update",
                    "avoid_dates": ["2026-11-02", "2026-11-09"],
                    "updated_record": updated,
                    "rationale": "Removed Mondays from recurring windows.",
                }
            )

        # ---- Approach A1 ----
        if "agente orquestrador e triagista" in sys_msg:
            if "has_confirmed=True, has_pending=False, already_drafted=False" in full_user:
                intent = "draft_plan"
            elif "already_drafted=True" in full_user:
                intent = "revise_plan"
            else:
                intent = "initial_plan"
            return self._reply(
                {
                    "intent": intent,
                    "student_goal": f"Plano de estudos ({case})",
                    "stated_constraints": {},
                    "routing_note": f"Roteado para {intent}",
                }
            )

        if "agente Research" in sys_msg:
            if case == "ana":
                return self._reply(
                    {
                        "authoritative_courses": [
                            {
                                "course": "Applied Data Ethics",
                                "date": "2026-12-01",
                                "time": "17:30",
                                "source_path": "lms/assessment-export.json",
                                "page": None,
                                "quote": '"dueAt": "2026-12-01T20:30:00Z"',
                                "is_optional": False,
                                "supersedes_earlier": True,
                                "resolution_note": "LMS revision 2 supersedes outline.",
                            }
                        ],
                        "optional_milestones": ["19 November optional clinic"],
                        "conflicts": [],
                        "missing_info": ["studyWindows", "targetHours", "maxDailyStudyHours", "studyBreakMinutes"],
                        "clarification_needed": True,
                        "questions": [
                            {"id": "availability", "question": "Which weekdays and time windows work for your two-week plan?", "choices": []},
                            {"id": "workload", "question": "What weekly hours, daily cap, and break minutes work best?", "choices": []},
                        ],
                        "calendar_notes": "Weekdays busy 08:00-12:00.",
                    }
                )
            return self._reply(
                {
                    "authoritative_courses": [
                        {
                            "course": "Algoritmos",
                            "date": "2026-12-14",
                            "time": "09:00",
                            "source_path": "notices/aviso-turma-n02.md",
                            "page": None,
                            "quote": "A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.",
                            "is_optional": False,
                            "supersedes_earlier": True,
                            "resolution_note": "Aviso da turma N02.",
                        },
                        {
                            "course": "Banco de Dados",
                            "date": "2026-12-14",
                            "time": "18:00",
                            "source_path": "courses/banco-de-dados.md",
                            "page": None,
                            "quote": "Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo",
                            "is_optional": False,
                            "supersedes_earlier": False,
                            "resolution_note": None,
                        },
                    ],
                    "optional_milestones": ["Plantão 19/11", "Oficina 28/11"],
                    "conflicts": [],
                    "missing_info": ["availability", "workload"],
                    "clarification_needed": True,
                    "questions": [
                        {"id": "availability", "question": "Quais dias, horários, meta semanal e pausa prefere?", "choices": []}
                    ],
                    "calendar_notes": "Trabalho 13:00-18:00 seg-sex.",
                }
            )

        if "agente Analysis" in sys_msg:
            is_rev = "Modo: revisão de plano já confirmado" in full_user
            if is_rev:
                if case == "ana":
                    return self._reply(
                        {
                            "action": "draft_avoid_dates_only",
                            "record": None,
                            "avoid_dates": ["2026-11-04"],
                            "rationale": "Excluir apenas 2026-11-04.",
                        }
                    )
                updated = json.loads(json.dumps(BRUNO_RECORD))
                updated["studyWindows"] = [w for w in updated["studyWindows"] if w["weekday"] != 1]
                return self._reply(
                    {
                        "action": "propose_context",
                        "record": updated,
                        "avoid_dates": ["2026-11-02", "2026-11-09"],
                        "rationale": "Remover segundas-feiras do contexto.",
                    }
                )

            if self.inject_a1_loop_fault and "Feedback da iteração anterior" not in full_user:
                bad = json.loads(json.dumps(ANA_RECORD if case == "ana" else BRUNO_RECORD))
                bad["courses"][0]["citation"]["quote"] = "Wrong unverified quote for loop test"
                return self._reply(
                    {
                        "action": "propose_context",
                        "record": bad,
                        "avoid_dates": [],
                        "rationale": "Primeira tentativa com citação incorreta.",
                    }
                )
            return self._reply(
                {
                    "action": "propose_context",
                    "record": ANA_RECORD if case == "ana" else BRUNO_RECORD,
                    "avoid_dates": [],
                    "rationale": "Contexto validado pelas fontes.",
                }
            )

        if "agente Validation" in sys_msg:
            has_det_err = '"severity": "error"' in full_user
            return self._reply(
                {
                    "approved": not has_det_err,
                    "overload_risk": False,
                    "violations": [],
                    "summary": "Reprovado por achados determinísticos" if has_det_err else "Aprovado sem bloqueios",
                }
            )

        if "agente Communication" in sys_msg:
            return self._reply({"markdown": "Resumo verificado pronto para revisão do operador."})

        raise AssertionError(f"Unhandled stub prompt: {sys_msg[:120]}")
