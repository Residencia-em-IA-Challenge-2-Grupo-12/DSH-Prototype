"""Approach A2: Modern SOTA Typed State-Machine + Deterministic Verifier (zero roleplay)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .contracts import (
    AnswerItem,
    Cronometro,
    Evento,
    ExtractionBundle,
    PendingQuestion,
    PlanningContextRecord,
    QuestionItem,
    RevisionDecision,
    RunTraceSummary,
    SessionStartRequest,
    SnapshotMessage,
    SnapshotResponse,
    ViolationItem,
)
from .llm_client import OpenAICompatibleClient, StructuredOutputError
from .tool_bridge import EvidenceBundle, ToolBridgeClient
from .verifier import (
    candidate_quote_lines,
    compute_horizon_weeks,
    verify_planning_context,
    verify_quote_in_evidence,
    verify_utc_timezone_conversion,
)


def _extraction_system_prompt(clock_date: str, timezone: str) -> str:
    return (
        "You are a deterministic structured-extraction module. Return ONLY valid JSON (no markdown, no prose).\n"
        f"Simulation clock: today is {clock_date}, timezone is {timezone}.\n"
        "Extract academic course deadlines and missing planning preferences from the workspace files, calendar, and student request.\n"
        "Rules:\n"
        "1. Distinguish authoritative deadlines from superseded/older dates (e.g., newer LMS revisions or official notices supersede older outlines). Set supersedes_earlier=true and explain in resolution_note.\n"
        "2. Do NOT treat optional clinics, office hours, or feedback sessions as graded course deadlines unless no primary assessment exists; mark optional items with is_optional=true.\n"
        "3. Copy citation quotes VERBATIM from the exact file (and 1-based integer page for .pdf files; null for non-PDF files).\n"
        "4. Convert any UTC or offset timestamp to local date (YYYY-MM-DD) and local 24h time (HH:MM) in the simulation timezone.\n"
        "5. Mark a conflict as resolved=true if a file explicitly states one source replaces/updates another; set resolved=false ONLY if two authoritative sources genuinely conflict with no resolution.\n"
        "6. In missing_preferences, set each boolean field to true if the student has NOT yet specified it in the request or workspace files.\n"
        "JSON schema:\n"
        "{\n"
        '  "deadlines": [{"course": str, "date": "YYYY-MM-DD", "time": "HH:MM", "source_path": str, "page": int|null, "quote": str, "is_optional": bool, "supersedes_earlier": bool, "resolution_note": str|null}],\n'
        '  "conflicts": [{"course": str, "description": str, "resolved": bool, "resolution_note": str|null}],\n'
        '  "missing_preferences": {"studyWindows": bool, "targetHours": bool, "maxDailyStudyHours": bool, "studyBreakMinutes": bool, "through": bool},\n'
        '  "calendar_summary": str\n'
        "}"
    )


def _synthesis_system_prompt(clock_date: str, timezone: str) -> str:
    return (
        "You are a deterministic structured-synthesis module. Return ONLY valid JSON matching PlanningContextRecord.\n"
        f"Simulation clock: today is {clock_date}, timezone is {timezone}.\n"
        "Critical schema constraints:\n"
        "- courses: 1 to 8 objects, ONE entry per academic course (do NOT list optional clinics/feedback sessions as courses).\n"
        "- courses[].name: clean course title ONLY (omit task suffixes such as 'case memo', 'prova escrita', 'projeto final', 'exam').\n"
        "- courses[].date: YYYY-MM-DD, courses[].time: HH:MM (24h local time in simulation timezone; convert Z/UTC timestamps accurately).\n"
        "- courses[].citation: {path, quote, page?}. quote must appear VERBATIM in that file. Include integer 1-based page ONLY for .pdf files; OMIT page (or null) for non-PDF files.\n"
        "- courses[].resolution: concise note ONLY when resolving a superseded/conflicting source; otherwise null.\n"
        "- studyWindows: non-empty list of {weekday: 0..6, start: 'HH:MM', end: 'HH:MM'} where 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.\n"
        "- targetHours: int 1..20; maxDailyStudyHours: int 1..8 (1h per study session); studyBreakMinutes: int 0..120.\n"
        "- through: YYYY-MM-DD >= today. Respect the student's stated preference horizon ONLY (e.g., 'até 15/11' -> '2026-11-15', or 'two weeks' starting day 1 on clock.date -> clock.date + 13 days). NEVER set 'through' to a later exam/project deadline unless the student explicitly asks to schedule all the way until that exam.\n"
        "- assumption: concise string STRICTLY <= 600 characters summarizing key assumptions and optional milestones.\n"
        "JSON schema:\n"
        "{\n"
        '  "courses": [{"name": str, "date": "YYYY-MM-DD", "time": "HH:MM", "citation": {"path": str, "page": int|null, "quote": str}, "resolution": str|null}],\n'
        '  "studyWindows": [{"weekday": int, "start": "HH:MM", "end": "HH:MM"}],\n'
        '  "targetHours": int,\n'
        '  "maxDailyStudyHours": int,\n'
        '  "studyBreakMinutes": int,\n'
        '  "through": "YYYY-MM-DD",\n'
        '  "assumption": str\n'
        "}"
    )


def _revision_system_prompt(clock_date: str, timezone: str) -> str:
    return (
        "You are a deterministic structured-revision module. Return ONLY valid JSON matching RevisionDecision.\n"
        f"Simulation clock: today is {clock_date}, timezone is {timezone}.\n"
        "Decide how to apply the student's correction to the already-confirmed PlanningContextRecord:\n"
        "- Use mode='avoid_dates_only' when the student only excludes specific date(s) (e.g. 'Keep Wednesday, 4 November, free') while keeping recurring weekly windows, hours, breaks, through date, and deadlines unchanged. Put the excluded YYYY-MM-DD dates in avoid_dates and set updated_record=null.\n"
        "- Use mode='context_update' when the student removes/changes recurring weekdays, time windows, weekly target hours, daily cap, break minutes, through date, or deadlines (including removing all occurrences of a weekday in the scope). Provide the complete updated_record preserving all unchanged fields and verbatim citations, plus any extra avoid_dates if needed.\n"
        "- CRITICAL: Keep the confirmed 'through' date unchanged unless the student explicitly gives a different end date. Phrases like 'leave the following week tentative' mean keeping the second week inside 'through' so it stays as the tentative future section — NEVER shorten 'through' to 1 week.\n"
        "JSON schema:\n"
        "{\n"
        '  "mode": "avoid_dates_only" | "context_update",\n'
        '  "avoid_dates": ["YYYY-MM-DD"],\n'
        '  "updated_record": PlanningContextRecord | null,\n'
        '  "rationale": str\n'
        "}"
    )


@dataclass
class PipelineA2Session:
    session_id: str
    request: SessionStartRequest
    llm: OpenAICompatibleClient
    bridge: ToolBridgeClient

    messages: list[SnapshotMessage] = field(default_factory=list)
    pending_question: PendingQuestion | None = None
    busy: bool = False
    error: str | None = None

    evidence: EvidenceBundle | None = None
    extraction: ExtractionBundle | None = None
    latest_record: PlanningContextRecord | None = None
    last_drafted_context_id: str | None = None
    pending_avoid_dates: list[str] = field(default_factory=list)
    initial_request_text: str = ""
    operator_answers: list[dict[str, str]] = field(default_factory=list)

    rastro: list[Evento] = field(default_factory=list)
    validation_retries: int = 0
    questions_asked: int = 0
    question_turns: int = 0

    def _is_pt(self) -> bool:
        return self.request.locale.lower().startswith("pt")

    def _log(self, agente: str, acao: str, detalhe: str = "", segundos: float = 0.0, llm_calls: int = 0) -> None:
        self.rastro.append(
            Evento(agente=agente, acao=acao, detalhe=detalhe, segundos=segundos, llm_calls=llm_calls)
        )

    def snapshot(self) -> SnapshotResponse:
        return SnapshotResponse(
            messages=list(self.messages),
            question=self.pending_question,
            busy=self.busy,
            error=self.error,
            usage=self.llm.usage_dict(),
        )

    def trace_summary(self) -> RunTraceSummary:
        return RunTraceSummary(
            runId=self.request.runId,
            pipeline="a2",
            model=self.llm.model,
            llmCalls=self.llm.llm_calls,
            toolCalls=self.bridge.tool_calls,
            toolErrors=list(self.bridge.tool_errors),
            validationRetries=self.validation_retries,
            questionsAsked=self.questions_asked,
            questionTurns=self.question_turns,
            rastro=list(self.rastro),
        )

    async def _stage1_ingest(self) -> EvidenceBundle:
        with Cronometro() as c:
            bundle = await self.bridge.ingest_evidence()
        self.evidence = bundle
        self._log(
            "Stage1.Ingestion",
            "coletou arquivos e calendário via toolBridge",
            f"arquivos={len(bundle.file_paths)}, eventos={len(bundle.calendar_events)}",
            c.segundos,
            0,
        )
        return bundle

    async def _stage2_extract(self, evidence: EvidenceBundle, prompt_text: str) -> ExtractionBundle:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            user_msg = (
                f"Student: {self.request.student}\n"
                f"Locale: {self.request.locale}\n"
                f"Clock: {self.request.clock.date} ({self.request.clock.timezone})\n\n"
                f"Student request:\n{prompt_text}\n\n"
                f"Workspace files:\n{evidence.format_files_for_prompt()}\n\n"
                f"Calendar (next 21 days, 0=Sun..6=Sat):\n{evidence.calendar_digest}\n"
            )
            messages = [
                {"role": "system", "content": _extraction_system_prompt(self.request.clock.date, self.request.clock.timezone)},
                {"role": "user", "content": user_msg},
            ]
            try:
                bundle, _ = await self.llm.complete_json(messages, ExtractionBundle)
            except StructuredOutputError as exc:
                self.validation_retries += 1
                repair_messages = messages + [
                    {"role": "assistant", "content": exc.raw_text},
                    {
                        "role": "user",
                        "content": f"Fix ONLY the JSON schema errors below and return valid JSON:\n{json.dumps(exc.errors)}",
                    },
                ]
                bundle, _ = await self.llm.complete_json(repair_messages, ExtractionBundle)
            calls_used = self.llm.llm_calls - calls_before
        self.extraction = bundle
        self._log(
            "Stage2.Extraction",
            "extraiu prazos e preferências faltantes",
            f"deadlines={len(bundle.deadlines)}, conflicts={len(bundle.conflicts)}",
            c.segundos,
            calls_used,
        )
        return bundle

    def _stage3_gate_and_clarify(
        self,
        evidence: EvidenceBundle,
        extraction: ExtractionBundle,
    ) -> PendingQuestion | None:
        with Cronometro() as c:
            quote_issues: list[str] = []
            for item in extraction.deadlines:
                if item.is_optional:
                    continue
                errs = verify_quote_in_evidence(item.source_path, item.quote, item.page, evidence)
                errs.extend(
                    verify_utc_timezone_conversion(
                        item.course,
                        item.date,
                        item.time,
                        item.quote,
                        self.request.clock.timezone,
                    )
                )
                if errs:
                    quote_issues.extend(v.message for v in errs)

            missing = extraction.missing_preferences
            req_lower = self.initial_request_text.lower()
            if not re.search(r"\b\d{1,2}:\d{2}\b", req_lower):
                missing.studyWindows = True
            if not re.search(r"\b\d+\s*(?:h|hs|hora|horas|hour|hours)\b", req_lower):
                missing.targetHours = True
            unresolved_conflicts = [cf for cf in extraction.conflicts if not cf.resolved]
            questions: list[QuestionItem] = []

            if missing.studyWindows or missing.through:
                if self._is_pt():
                    q_text = (
                        f"Considerando seus compromissos atuais ({evidence.busy_windows_summary}), "
                        "quais dias da semana, horários e data final (ex.: até 15/11) estão disponíveis para estudar?"
                    )
                else:
                    q_text = (
                        f"Given your current calendar commitments ({evidence.busy_windows_summary}), "
                        "which weekdays, time windows, and end date work for your study sessions?"
                    )
                questions.append(QuestionItem(id="availability", groupId="intake", question=q_text))

            if missing.targetHours or missing.maxDailyStudyHours or missing.studyBreakMinutes:
                if self._is_pt():
                    q_text = (
                        "Qual é sua meta de horas semanais de estudo, o limite máximo de blocos de 1 hora por dia "
                        "e o intervalo em minutos entre blocos no mesmo dia?"
                    )
                else:
                    q_text = (
                        "What weekly study hours target, maximum 1-hour sessions per day, "
                        "and break duration (minutes) between same-day blocks work best?"
                    )
                questions.append(QuestionItem(id="workload", groupId="intake", question=q_text))

            if unresolved_conflicts:
                desc = "; ".join(f"{cf.course}: {cf.description}" for cf in unresolved_conflicts)
                q_text = (
                    f"Há conflito de prazos não resolvido ({desc}). Qual prazo oficial devo considerar?"
                    if self._is_pt()
                    else f"There is an unresolved deadline conflict ({desc}). Which official deadline should we plan around?"
                )
                questions.append(QuestionItem(id="deadline_conflict", groupId="intake", question=q_text))

            pending: PendingQuestion | None = None
            if questions:
                pending = PendingQuestion(requestId="intake-clarification", questions=questions)

        self._log(
            "Stage3.Gate",
            "avaliou citações e lacunas de preferências",
            f"perguntas={len(questions)}, alertas_citacao={len(quote_issues)}",
            c.segundos,
            0,
        )
        return pending

    async def _stage4_synthesize_context(
        self,
        evidence: EvidenceBundle,
        extraction: ExtractionBundle,
    ) -> PlanningContextRecord:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            verified_hints: list[dict[str, Any]] = []
            for d in extraction.deadlines:
                if d.is_optional:
                    continue
                q_errs = verify_quote_in_evidence(d.source_path, d.quote, d.page, evidence)
                if not q_errs:
                    verified_hints.append(d.model_dump())

            answers_text = "\n".join(
                f"- [{ans['id']}]: {ans['text']}" for ans in self.operator_answers
            ) or "(none)"

            base_user_msg = (
                f"Student: {self.request.student}\n"
                f"Clock: {self.request.clock.date} ({self.request.clock.timezone})\n"
                f"Initial request: {self.initial_request_text}\n"
                f"Operator answers:\n{answers_text}\n\n"
                f"Verified extracted deadlines:\n{json.dumps(verified_hints, ensure_ascii=False, indent=2)}\n\n"
                f"Workspace files:\n{evidence.format_files_for_prompt()}\n\n"
                f"Calendar (0=Sun..6=Sat):\n{evidence.calendar_digest}\n"
            )
            messages: list[dict[str, str]] = [
                {"role": "system", "content": _synthesis_system_prompt(self.request.clock.date, self.request.clock.timezone)},
                {"role": "user", "content": base_user_msg},
            ]

            last_record: PlanningContextRecord | None = None
            last_errors: list[str] = []

            for attempt in range(3):
                try:
                    record, raw_text = await self.llm.complete_json(messages, PlanningContextRecord)
                except StructuredOutputError as exc:
                    last_errors = exc.errors
                    if attempt == 2:
                        raise RuntimeError(f"A2 Stage 4 schema synthesis failed after retries: {exc.errors}") from exc
                    self.validation_retries += 1
                    messages.extend([
                        {"role": "assistant", "content": exc.raw_text},
                        {
                            "role": "user",
                            "content": (
                                "Repair ONLY these validation errors and return valid JSON:\n"
                                + json.dumps(exc.errors, ensure_ascii=False)
                            ),
                        },
                    ])
                    continue

                violations = verify_planning_context(record, evidence, self.request.clock)
                if not violations:
                    last_record = record
                    last_errors = []
                    break

                last_record = record
                last_errors = [f"[{v.code} / {v.field}] {v.message}" for v in violations]
                if attempt == 2:
                    raise RuntimeError("A2 Stage 4 verification failed after retries: " + "; ".join(last_errors))
                self.validation_retries += 1
                messages.extend([
                    {"role": "assistant", "content": raw_text},
                    {
                        "role": "user",
                        "content": (
                            "Fix ONLY these verification violations and return the corrected PlanningContextRecord JSON:\n"
                            + json.dumps(last_errors, ensure_ascii=False)
                        ),
                    },
                ])

            assert last_record is not None
            await self.bridge.call("propose_planning_context", {"record": last_record.to_bridge_record()})
            self.latest_record = last_record
            calls_used = self.llm.llm_calls - calls_before

        self._log(
            "Stage4.SynthesisVerifier",
            "validou em código e submeteu propose_planning_context",
            f"courses={len(last_record.courses)}, through={last_record.through}, retries={self.validation_retries}",
            c.segundos,
            calls_used,
        )
        return last_record

    async def _stage4_revise(
        self,
        evidence: EvidenceBundle,
        confirmed_record: PlanningContextRecord,
        correction_text: str,
    ) -> tuple[str, list[str], PlanningContextRecord | None]:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            user_msg = (
                f"Clock: {self.request.clock.date} ({self.request.clock.timezone})\n"
                f"Confirmed PlanningContextRecord:\n{json.dumps(confirmed_record.to_bridge_record(), ensure_ascii=False, indent=2)}\n\n"
                f"Student correction request:\n{correction_text}\n\n"
                f"Workspace files:\n{evidence.format_files_for_prompt()}\n\n"
                f"Calendar (0=Sun..6=Sat):\n{evidence.calendar_digest}\n"
            )
            messages: list[dict[str, str]] = [
                {"role": "system", "content": _revision_system_prompt(self.request.clock.date, self.request.clock.timezone)},
                {"role": "user", "content": user_msg},
            ]

            chosen: RevisionDecision | None = None
            for attempt in range(3):
                try:
                    decision, raw_text = await self.llm.complete_json(messages, RevisionDecision)
                except StructuredOutputError as exc:
                    if attempt == 2:
                        raise RuntimeError(f"A2 revision parsing failed: {exc.errors}") from exc
                    self.validation_retries += 1
                    messages.extend([
                        {"role": "assistant", "content": exc.raw_text},
                        {"role": "user", "content": f"Fix ONLY these JSON errors:\n{json.dumps(exc.errors)}"},
                    ])
                    continue

                violations: list[ViolationItem] = []
                if decision.mode == "avoid_dates_only":
                    if not decision.avoid_dates:
                        violations.append(
                            ViolationItem(
                                code="missing_avoid_dates",
                                field="avoid_dates",
                                message="mode='avoid_dates_only' requires at least one YYYY-MM-DD in avoid_dates.",
                            )
                        )
                    else:
                        violations.extend(
                            verify_planning_context(
                                confirmed_record,
                                evidence,
                                self.request.clock,
                                avoid_dates=decision.avoid_dates,
                            )
                        )
                else:
                    if decision.updated_record is None:
                        violations.append(
                            ViolationItem(
                                code="missing_updated_record",
                                field="updated_record",
                                message="mode='context_update' requires updated_record.",
                            )
                        )
                    else:
                        if (
                            compute_horizon_weeks(self.request.clock.date, confirmed_record.through) >= 2
                            and compute_horizon_weeks(self.request.clock.date, decision.updated_record.through) < 2
                        ):
                            violations.append(
                                ViolationItem(
                                    code="horizon_truncated",
                                    field="through",
                                    message=(
                                        f"Do not shorten 'through' from '{confirmed_record.through}' to "
                                        f"'{decision.updated_record.through}'; keeping week 2 tentative requires retaining the multi-week horizon."
                                    ),
                                )
                            )
                        violations.extend(
                            verify_planning_context(
                                decision.updated_record,
                                evidence,
                                self.request.clock,
                                avoid_dates=decision.avoid_dates,
                            )
                        )

                if not violations:
                    chosen = decision
                    break

                if attempt == 2:
                    raise RuntimeError(
                        "A2 revision verification failed: " + "; ".join(v.message for v in violations)
                    )
                self.validation_retries += 1
                err_payload = [f"[{v.code} / {v.field}] {v.message}" for v in violations]
                messages.extend([
                    {"role": "assistant", "content": raw_text},
                    {"role": "user", "content": f"Fix ONLY these verification violations:\n{json.dumps(err_payload, ensure_ascii=False)}"},
                ])

            assert chosen is not None
            calls_used = self.llm.llm_calls - calls_before

        if chosen.mode == "avoid_dates_only":
            weeks = compute_horizon_weeks(self.request.clock.date, confirmed_record.through)
            with Cronometro() as c_draft:
                plan = await self.bridge.call(
                    "draft_study_plan",
                    {"weeks": weeks, "avoidDates": chosen.avoid_dates},
                )
            self._log(
                "Stage4.Revision",
                "aplicou revisão avoidDates diretamente em draft_study_plan",
                f"avoidDates={chosen.avoid_dates}, near={len(plan.get('near', []))}, future={len(plan.get('future', []))}",
                round(c.segundos + c_draft.segundos, 3),
                calls_used,
            )
            return "avoid_dates_only", chosen.avoid_dates, None

        assert chosen.updated_record is not None
        with Cronometro() as c_prop:
            await self.bridge.call("propose_planning_context", {"record": chosen.updated_record.to_bridge_record()})
        self.pending_avoid_dates = list(chosen.avoid_dates)
        self.latest_record = chosen.updated_record
        self._log(
            "Stage4.Revision",
            "validou e propôs contexto atualizado via propose_planning_context",
            f"windows={len(chosen.updated_record.studyWindows)}, avoidDates={chosen.avoid_dates}",
            round(c.segundos + c_prop.segundos, 3),
            calls_used,
        )
        return "context_update", chosen.avoid_dates, chosen.updated_record

    async def _draft_confirmed_plan(self, confirmed: dict[str, Any]) -> dict[str, Any]:
        record_raw = confirmed.get("record") or {}
        through = str(record_raw.get("through") or self.request.clock.date)
        weeks = compute_horizon_weeks(self.request.clock.date, through)
        args: dict[str, Any] = {"weeks": weeks}
        if self.pending_avoid_dates:
            args["avoidDates"] = list(self.pending_avoid_dates)
        with Cronometro() as c:
            plan = await self.bridge.call("draft_study_plan", args)
        self.last_drafted_context_id = str(confirmed.get("id"))
        self.pending_avoid_dates = []
        self._log(
            "Stage4.PlannerBridge",
            "gerou proposta revisável via draft_study_plan (0 LLM)",
            f"weeks={weeks}, near={len(plan.get('near', []))}, future={len(plan.get('future', []))}",
            c.segundos,
            0,
        )
        return plan

    def _format_context_summary(self, record: PlanningContextRecord) -> str:
        courses_txt = ", ".join(f"{c.name} ({c.date} {c.time})" for c in record.courses)
        if self._is_pt():
            return (
                f"Contexto de planejamento enviado para revisão: {courses_txt}; "
                f"{record.targetHours}h/semana até {record.through}, "
                f"máx. {record.maxDailyStudyHours}h/dia, pausa de {record.studyBreakMinutes} min."
            )
        return (
            f"Planning context submitted for review: {courses_txt}; "
            f"{record.targetHours}h/week through {record.through}, "
            f"max {record.maxDailyStudyHours}h/day, {record.studyBreakMinutes}m break."
        )

    def _format_plan_summary(self, plan: dict[str, Any]) -> str:
        near_n = len(plan.get("near") or [])
        future_n = len(plan.get("future") or [])
        if self._is_pt():
            return (
                f"Proposta revisável gerada ({near_n} blocos na semana próxima, "
                f"{future_n} blocos na semana futura), aguardando aprovação explícita."
            )
        return (
            f"Reviewable study proposal drafted ({near_n} near-term blocks, "
            f"{future_n} future blocks), awaiting separate approval."
        )

    async def prompt(self, text: str) -> SnapshotResponse:
        if self.pending_question is not None:
            raise RuntimeError("Answer or cancel the pending question before sending a prompt")
        trimmed = text.strip()
        if not trimmed:
            raise RuntimeError("Prompt text is required")
        self.busy = True
        self.error = None
        self.messages.append(SnapshotMessage(type="user", text=trimmed))
        try:
            evidence = await self._stage1_ingest()
            ctx = evidence.planning_context
            confirmed = ctx.get("confirmed")
            pending = ctx.get("pending")

            # Case 1: Operator confirmed a planning context that hasn't been drafted yet -> 0 LLM calls.
            if confirmed and not pending and confirmed.get("id") != self.last_drafted_context_id:
                plan = await self._draft_confirmed_plan(confirmed)
                self.messages.append(SnapshotMessage(type="assistant", text=self._format_plan_summary(plan)))
                return self.snapshot()

            # Case 2: Already drafted for the current confirmed context -> operator correction turn.
            if confirmed and confirmed.get("id") == self.last_drafted_context_id:
                confirmed_record = PlanningContextRecord.model_validate(confirmed["record"])
                mode, avoid_dates, updated = await self._stage4_revise(evidence, confirmed_record, trimmed)
                if mode == "avoid_dates_only":
                    msg = (
                        f"Proposta revisada excluindo {avoid_dates}, mantendo a semana futura pendente."
                        if self._is_pt()
                        else f"Updated proposal drafted excluding {avoid_dates}, keeping the future week tentative."
                    )
                    self.messages.append(SnapshotMessage(type="assistant", text=msg))
                else:
                    assert updated is not None
                    self.messages.append(SnapshotMessage(type="assistant", text=self._format_context_summary(updated)))
                return self.snapshot()

            # Case 3: Initial request -> Stage 2 Extraction + Stage 3 Deterministic Gate.
            if not self.initial_request_text:
                self.initial_request_text = trimmed
            extraction = await self._stage2_extract(evidence, trimmed)
            pending_q = self._stage3_gate_and_clarify(evidence, extraction)
            if pending_q is not None:
                self.pending_question = pending_q
                self.question_turns += 1
                self.questions_asked += len(pending_q.questions)
                intro = (
                    "Analisei seus materiais e calendário. Responda às perguntas abaixo para montarmos o plano."
                    if self._is_pt()
                    else "I reviewed your course files and calendar. Please clarify the details below before I propose a context."
                )
                self.messages.append(SnapshotMessage(type="assistant", text=intro))
                return self.snapshot()

            record = await self._stage4_synthesize_context(evidence, extraction)
            self.messages.append(SnapshotMessage(type="assistant", text=self._format_context_summary(record)))
            return self.snapshot()
        except Exception as exc:
            self.error = str(exc)
            raise
        finally:
            self.busy = False

    async def answer(self, request_id: str, answers: list[AnswerItem]) -> SnapshotResponse:
        if not self.pending_question or self.pending_question.requestId != request_id:
            raise RuntimeError("Question is no longer pending")
        if not answers:
            raise RuntimeError("Answers are required")

        self.busy = True
        self.error = None
        self.pending_question = None
        try:
            for item in answers:
                display = item.custom.strip() or ", ".join(item.selected).strip()
                if display:
                    self.messages.append(SnapshotMessage(type="user", text=display))
                    self.operator_answers.append({"id": item.id, "text": display})

            evidence = self.evidence or await self._stage1_ingest()
            extraction = self.extraction or ExtractionBundle()
            record = await self._stage4_synthesize_context(evidence, extraction)
            self.messages.append(SnapshotMessage(type="assistant", text=self._format_context_summary(record)))
            return self.snapshot()
        except Exception as exc:
            self.error = str(exc)
            raise
        finally:
            self.busy = False

    async def cancel_question(self, request_id: str) -> SnapshotResponse:
        if not self.pending_question or self.pending_question.requestId != request_id:
            raise RuntimeError("Question is no longer pending")
        self.pending_question = None
        self._log("Stage3.Gate", "pergunta cancelada pelo operador", f"requestId={request_id}", 0.0, 0)
        return self.snapshot()
