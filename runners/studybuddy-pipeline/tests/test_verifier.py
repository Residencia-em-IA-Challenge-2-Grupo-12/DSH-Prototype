"""Unit tests for deterministic Python verifier rules."""

from __future__ import annotations

import json
from pathlib import Path

from studybuddy_pipeline.contracts import ClockInfo, PlanningContextRecord
from studybuddy_pipeline.tool_bridge import EvidenceBundle, format_calendar_digest
from studybuddy_pipeline.verifier import (
    compute_horizon_weeks,
    verify_planning_context,
    verify_quote_in_evidence,
    verify_utc_timezone_conversion,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _make_evidence(case: str) -> tuple[EvidenceBundle, ClockInfo]:
    clock = ClockInfo(date="2026-11-02", timezone="America/Sao_Paulo")
    if case == "bruno":
        cal = json.loads((REPO_ROOT / "fixtures/calendars/bruno.json").read_text(encoding="utf-8"))
        ws = REPO_ROOT / "fixtures/cold-start/bruno-text"
        paths = ["courses/algoritmos.md", "courses/banco-de-dados.md", "notices/aviso-turma-n02.md"]
    else:
        cal = json.loads((REPO_ROOT / "fixtures/calendars/ana.json").read_text(encoding="utf-8"))
        ws = REPO_ROOT / "fixtures/paired-replay/ana-held-out/workspace"
        paths = ["course/clinic-reminder.txt", "course/module-outline.md", "lms/assessment-export.json"]
    files = {p: (ws / p).read_text(encoding="utf-8") for p in paths}
    digest, summary = format_calendar_digest(cal["events"], clock)
    return (
        EvidenceBundle(
            file_paths=paths,
            files=files,
            calendar_events=cal["events"],
            planning_context={},
            clock=clock,
            calendar_digest=digest,
            busy_windows_summary=summary,
        ),
        clock,
    )


def test_quote_normalization_and_pdf_pages() -> None:
    clock = ClockInfo(date="2026-11-02", timezone="America/Sao_Paulo")
    ev = EvidenceBundle(
        file_paths=["courses/alg.md", "courses/syllabus.pdf"],
        files={
            "courses/alg.md": "- **Envio final:**   14/12/2026 às 18:00",
            "courses/syllabus.pdf": "Capa do curso\fPágina dois: Prova em 14/12/2026 às 09:00",
        },
        calendar_events=[],
        planning_context={},
        clock=clock,
        calendar_digest="",
        busy_windows_summary="",
    )
    assert verify_quote_in_evidence("courses/alg.md", "Envio final: 14/12/2026 às 18:00", None, ev) == []
    assert [v.code for v in verify_quote_in_evidence("courses/alg.md", "Envio final: 14/12/2026 às 18:00", 1, ev)] == ["pdf_page_mismatch"]
    assert verify_quote_in_evidence("courses/syllabus.pdf", "Prova em 14/12/2026 às 09:00", 2, ev) == []
    assert [v.code for v in verify_quote_in_evidence("courses/syllabus.pdf", "Prova em 14/12/2026 às 09:00", 1, ev)] == ["quote_not_found"]


def test_utc_conversion_catch() -> None:
    errs = verify_utc_timezone_conversion(
        "Applied Data Ethics",
        "2026-12-01",
        "20:30",
        '"dueAt": "2026-12-01T20:30:00Z"',
        "America/Sao_Paulo",
    )
    assert len(errs) == 1
    assert errs[0].code == "timezone_conversion_mismatch"
    assert "17:30" in errs[0].message

    ok = verify_utc_timezone_conversion(
        "Applied Data Ethics",
        "2026-12-01",
        "17:30",
        '"dueAt": "2026-12-01T20:30:00Z"',
        "America/Sao_Paulo",
    )
    assert ok == []


def test_full_verifier_catches_suffix_and_passes_valid_fixtures() -> None:
    ev_ana, clock = _make_evidence("ana")
    valid_ana = PlanningContextRecord.model_validate(
        {
            "courses": [
                {
                    "name": "Applied Data Ethics",
                    "date": "2026-12-01",
                    "time": "17:30",
                    "citation": {
                        "path": "lms/assessment-export.json",
                        "quote": '"dueAt": "2026-12-01T20:30:00Z"',
                    },
                    "resolution": "LMS export revision 2 supersedes outline.",
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
            "assumption": "Two-week plan keeping weekends open.",
        }
    )
    assert verify_planning_context(valid_ana, ev_ana, clock) == []
    assert verify_planning_context(valid_ana, ev_ana, clock, avoid_dates=["2026-11-04"]) == []
    assert compute_horizon_weeks("2026-11-02", "2026-11-15") == 2

    # Infeasible when removing Thu+Fri in week 1 alongside Nov 4 exclusion
    infeasible = verify_planning_context(
        valid_ana, ev_ana, clock, avoid_dates=["2026-11-04", "2026-11-05"]
    )
    assert any(v.code == "weekly_target_infeasible" for v in infeasible)

    # Task suffix rejected
    bad_name = valid_ana.model_copy(
        update={
            "courses": [
                valid_ana.courses[0].model_copy(update={"name": "Applied Data Ethics - Case memo"})
            ]
        }
    )
    assert any(v.code == "course_name_has_task_suffix" for v in verify_planning_context(bad_name, ev_ana, clock))

    # Bruno valid without and with Monday removal
    ev_bruno, clock_b = _make_evidence("bruno")
    valid_bruno = PlanningContextRecord.model_validate(
        {
            "courses": [
                {
                    "name": "Algoritmos",
                    "date": "2026-12-14",
                    "time": "09:00",
                    "citation": {
                        "path": "notices/aviso-turma-n02.md",
                        "quote": "A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo.",
                    },
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
            "assumption": "Duas semanas sem prioridade fixa.",
        }
    )
    assert verify_planning_context(valid_bruno, ev_bruno, clock_b) == []
    assert verify_planning_context(valid_bruno, ev_bruno, clock_b, avoid_dates=["2026-11-02", "2026-11-09"]) == []
