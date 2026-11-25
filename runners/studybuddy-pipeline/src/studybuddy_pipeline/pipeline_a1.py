"""Approach A1: StudyBuddy Planned 5-Stage Role Baseline (Maestro -> Research -> Analysis <-> Validation -> Communication)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .contracts import (
    AnalysisDraft,
    AnswerItem,
    CommunicationMessage,
    Cronometro,
    DraftQuestion,
    Evento,
    MaestroTriage,
    PendingQuestion,
    PlanningContextRecord,
    QuestionItem,
    ResearchDossier,
    RunTraceSummary,
    SessionStartRequest,
    SnapshotMessage,
    SnapshotResponse,
    ValidationReport,
    ViolationItem,
)
from .llm_client import OpenAICompatibleClient, StructuredOutputError
from .tool_bridge import EvidenceBundle, ToolBridgeClient
from .verifier import (
    compute_horizon_weeks,
    verify_planning_context,
    verify_quote_in_evidence,
    verify_utc_timezone_conversion,
)

MAX_LOOP_ITERATIONS = 2


def _maestro_prompt(clock_date: str, timezone: str) -> str:
    return (
        "Você é o Maestro (agente orquestrador e triagista do StudyBuddy). Responda APENAS em JSON válido.\n"
        f"Relógio simulado: {clock_date} ({timezone}).\n"
        "Classifique a intenção da mensagem atual do estudante:\n"
        "- 'initial_plan': pedido inicial ou retomada antes de existir contexto confirmado.\n"
        "- 'draft_plan': quando já existe contexto confirmado pronto para gerar o rascunho de estudo e o operador pede para gerar a proposta.\n"
        "- 'revise_plan': quando já existe um rascunho gerado e o operador pede correção/ajuste (ex.: deixar dias livres ou alterar janelas).\n"
        "JSON esperado:\n"
        '{"intent": "initial_plan"|"draft_plan"|"revise_plan", "student_goal": str, "stated_constraints": {str: str}, "routing_note": str}'
    )


def _research_prompt(clock_date: str, timezone: str) -> str:
    return (
        "Você é o agente Research (especialista em coleta e verificação documental do StudyBuddy). Responda APENAS em JSON válido.\n"
        f"Relógio simulado: {clock_date} ({timezone}).\n"
        "Analise os arquivos acadêmicos e o calendário fornecidos para:\n"
        "1. Identificar os prazos autoritativos (diferenciando avisos/revisões recentes de cronogramas antigos substituídos; converta horários UTC para o fuso da simulação).\n"
        "2. Separar entregas/provas obrigatórias de plantões/clínicas opcionais.\n"
        "3. Verificar se faltam preferências essenciais do estudante (janelas/dias/horários, meta semanal, máximo diário de blocos de 1h, pausa em minutos, data final) ou se há conflito não resolvido.\n"
        "4. Se faltarem preferências essenciais, defina clarification_needed=true e liste perguntas objetivas em questions (use ids 'availability', 'workload').\n"
        "JSON esperado:\n"
        "{\n"
        '  "authoritative_courses": [{"course": str, "date": "YYYY-MM-DD", "time": "HH:MM", "source_path": str, "page": int|null, "quote": str, "is_optional": bool, "supersedes_earlier": bool, "resolution_note": str|null}],\n'
        '  "optional_milestones": [str],\n'
        '  "conflicts": [{"course": str, "description": str, "resolved": bool, "resolution_note": str|null}],\n'
        '  "missing_info": [str],\n'
        '  "clarification_needed": bool,\n'
        '  "questions": [{"id": str, "question": str, "choices": [str]}],\n'
        '  "calendar_notes": str\n'
        "}"
    )


def _analysis_prompt(clock_date: str, timezone: str) -> str:
    return (
        "Você é o agente Analysis (planejador pedagógico e construtor de contexto do StudyBuddy). Responda APENAS em JSON válido.\n"
        f"Relógio simulado: {clock_date} ({timezone}).\n"
        "Monte o AnalysisDraft para a etapa atual:\n"
        "- Em planejamento inicial: use action='propose_context' e preencha 'record' (PlanningContextRecord completo).\n"
        "- Em revisão de plano já rascunhado: se o estudante apenas pediu para evitar data(s) pontual(is) mantendo o resto igual, use action='draft_avoid_dates_only' com avoid_dates=['YYYY-MM-DD'] e record=null; se mudou dias recorrentes/janelas/carga/prazos, use action='propose_context' com record atualizado.\n"
        "Regras obrigatórias de schema:\n"
        "- courses[].name: apenas o nome da disciplina (sem sufixos como 'case memo', 'prova escrita', 'projeto final').\n"
        "- courses[].citation: {path, quote, page?} com citação VERBATIM; page inteiro 1-based SOMENTE para .pdf, null para outros arquivos.\n"
        "- studyWindows[].weekday: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb.\n"
        "- through: YYYY-MM-DD >= hoje (2 semanas contando hoje como dia 1 terminam em clock.date + 13 dias).\n"
        "- assumption: <= 600 caracteres.\n"
        "JSON esperado:\n"
        "{\n"
        '  "action": "propose_context" | "draft_avoid_dates_only",\n'
        '  "record": {"courses": [{"name": str, "date": "YYYY-MM-DD", "time": "HH:MM", "citation": {"path": str, "page": int|null, "quote": str}, "resolution": str|null}], "studyWindows": [{"weekday": int, "start": "HH:MM", "end": "HH:MM"}], "targetHours": int, "maxDailyStudyHours": int, "studyBreakMinutes": int, "through": "YYYY-MM-DD", "assumption": str} | null,\n'
        '  "avoid_dates": ["YYYY-MM-DD"],\n'
        '  "rationale": str\n'
        "}"
    )


def _validation_prompt(clock_date: str, timezone: str) -> str:
    return (
        "Você é o agente Validation (auditor de guardrails e sobrecarga do StudyBuddy, #46/#47). Responda APENAS em JSON válido.\n"
        f"Relógio simulado: {clock_date} ({timezone}).\n"
        "Audite o AnalysisDraft quanto a: aderência às fontes (sem datas inventadas), risco de sobrecarga diária/semanal, fidelidade às restrições declaradas pelo estudante e regras determinísticas.\n"
        "Use severity='error' apenas para violações materiais que exijam correção; use 'warning' para observações menores.\n"
        "JSON esperado:\n"
        '{"approved": bool, "overload_risk": bool, "violations": [{"code": str, "field": str, "message": str, "severity": "error"|"warning"}], "summary": str}'
    )


def _communication_prompt(locale: str) -> str:
    lang = "português brasileiro (pt-BR)" if locale.lower().startswith("pt") else "English"
    return (
        f"Você é o agente Communication (redator final do StudyBuddy, #50). Responda APENAS em JSON válido em {lang}.\n"
        "Gere uma resposta clara e fiel EXCLUSIVAMENTE aos fatos verificados e saídas das ferramentas fornecidas (sem inventar blocos, horários ou fontes).\n"
        'JSON esperado: {"markdown": str}'
    )


@dataclass
class PipelineA1Session:
    session_id: str
    request: SessionStartRequest
    llm: OpenAICompatibleClient
    bridge: ToolBridgeClient

    messages: list[SnapshotMessage] = field(default_factory=list)
    pending_question: PendingQuestion | None = None
    busy: bool = False
    error: str | None = None

    evidence: EvidenceBundle | None = None
    dossier: ResearchDossier | None = None
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
            pipeline="a1",
            model=self.llm.model,
            llmCalls=self.llm.llm_calls,
            toolCalls=self.bridge.tool_calls,
            toolErrors=list(self.bridge.tool_errors),
            validationRetries=self.validation_retries,
            questionsAsked=self.questions_asked,
            questionTurns=self.question_turns,
            rastro=list(self.rastro),
        )

    async def _complete_json_with_syntax_retry(self, messages: list[dict[str, str]], model_cls: Any) -> Any:
        try:
            parsed, _ = await self.llm.complete_json(messages, model_cls)
            return parsed
        except StructuredOutputError as exc:
            repair = messages + [
                {"role": "assistant", "content": exc.raw_text},
                {"role": "user", "content": f"Corrija APENAS o JSON inválido e retorne JSON válido:\n{json.dumps(exc.errors)}"},
            ]
            parsed, _ = await self.llm.complete_json(repair, model_cls)
            return parsed

    async def _stage_maestro(self, text: str, planning_ctx: dict[str, Any]) -> MaestroTriage:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            has_confirmed = bool(planning_ctx.get("confirmed"))
            has_pending = bool(planning_ctx.get("pending"))
            already_drafted = bool(
                has_confirmed and planning_ctx["confirmed"].get("id") == self.last_drafted_context_id
            )
            user_msg = (
                f"Mensagem do estudante: {text}\n"
                f"Estado atual: has_confirmed={has_confirmed}, has_pending={has_pending}, already_drafted={already_drafted}\n"
            )
            triage: MaestroTriage = await self._complete_json_with_syntax_retry(
                [
                    {"role": "system", "content": _maestro_prompt(self.request.clock.date, self.request.clock.timezone)},
                    {"role": "user", "content": user_msg},
                ],
                MaestroTriage,
            )
            # Enforce grounded state routing invariants in orchestrator code
            if has_confirmed and not has_pending and not already_drafted:
                triage.intent = "draft_plan"
            elif already_drafted:
                triage.intent = "revise_plan"
            calls_used = self.llm.llm_calls - calls_before
        self._log(
            "Maestro",
            f"triagem → {triage.intent}",
            f"objetivo={triage.student_goal or '-'}; nota={triage.routing_note or '-'}",
            c.segundos,
            calls_used,
        )
        return triage

    async def _stage_research(self, text: str) -> tuple[EvidenceBundle, ResearchDossier]:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            evidence = await self.bridge.ingest_evidence()
            self.evidence = evidence
            user_msg = (
                f"Estudante: {self.request.student} | Locale: {self.request.locale}\n"
                f"Pedido: {text}\n\n"
                f"Arquivos do workspace:\n{evidence.format_files_for_prompt()}\n\n"
                f"Calendário (0=Dom..6=Sáb):\n{evidence.calendar_digest}\n"
            )
            dossier: ResearchDossier = await self._complete_json_with_syntax_retry(
                [
                    {"role": "system", "content": _research_prompt(self.request.clock.date, self.request.clock.timezone)},
                    {"role": "user", "content": user_msg},
                ],
                ResearchDossier,
            )
            # Verify extracted quotes in Research dossier to pass helpful annotations downstream
            for course in dossier.authoritative_courses:
                errs = verify_quote_in_evidence(course.source_path, course.quote, course.page, evidence)
                errs.extend(
                    verify_utc_timezone_conversion(
                        course.course, course.date, course.time, course.quote, self.request.clock.timezone
                    )
                )
                if errs:
                    course.resolution_note = (course.resolution_note or "") + " [VERIFICAR: " + "; ".join(v.message for v in errs) + "]"
            calls_used = self.llm.llm_calls - calls_before
        self.dossier = dossier
        self._log(
            "Research",
            "coletou fontes e produziu dossiê",
            f"arquivos={len(evidence.file_paths)}, cursos={len(dossier.authoritative_courses)}, "
            f"clarification_needed={dossier.clarification_needed}",
            c.segundos,
            calls_used,
        )
        return evidence, dossier

    def _build_a1_clarification_question(
        self,
        evidence: EvidenceBundle,
        dossier: ResearchDossier,
    ) -> PendingQuestion:
        raw_qs = list(dossier.questions)
        if not raw_qs:
            if self._is_pt():
                raw_qs = [
                    DraftQuestion(
                        id="availability",
                        question=(
                            f"Com base no calendário ({evidence.busy_windows_summary}), quais dias/horários, "
                            "data limite e metas de horas semanais/diárias e pausa você prefere?"
                        ),
                    )
                ]
            else:
                raw_qs = [
                    DraftQuestion(
                        id="availability",
                        question=(
                            f"Considering your calendar ({evidence.busy_windows_summary}), which weekdays/times, "
                            "end date, weekly hours, daily session cap, and break minutes work for you?"
                        ),
                    )
                ]
        items: list[QuestionItem] = []
        for idx, q in enumerate(raw_qs[:4], start=1):
            qid = q.id.strip() or f"q{idx}"
            items.append(QuestionItem(id=qid, groupId="a1-intake", question=q.question.strip()))
        return PendingQuestion(requestId="a1-clarification", questions=items)

    async def _stage_analysis_validation_loop(
        self,
        evidence: EvidenceBundle,
        dossier: ResearchDossier,
        *,
        is_revision: bool,
        turn_text: str,
        confirmed_record: PlanningContextRecord | None = None,
    ) -> AnalysisDraft:
        answers_str = "\n".join(f"- [{a['id']}]: {a['text']}" for a in self.operator_answers) or "(nenhuma)"
        feedback_block = ""
        prev_error_count: int | None = None
        last_draft: AnalysisDraft | None = None
        stop_reason = "approved"
        iters_run = 0

        for iteration in range(1, MAX_LOOP_ITERATIONS + 1):
            iters_run = iteration
            with Cronometro() as c_an:
                calls_before = self.llm.llm_calls
                an_user = (
                    f"Modo: {'revisão de plano já confirmado' if is_revision else 'contexto inicial'}\n"
                    f"Pedido/Correção atual: {turn_text}\n"
                    f"Pedido inicial: {self.initial_request_text}\n"
                    f"Respostas do operador:\n{answers_str}\n\n"
                    f"Contexto já confirmado:\n{json.dumps(confirmed_record.to_bridge_record(), ensure_ascii=False, indent=2) if confirmed_record else 'null'}\n\n"
                    f"Dossiê Research:\n{dossier.model_dump_json(indent=2)}\n\n"
                    f"Arquivos do workspace:\n{evidence.format_files_for_prompt()}\n\n"
                    f"Calendário (0=Dom..6=Sáb):\n{evidence.calendar_digest}\n"
                    + (f"\nFeedback da iteração anterior do Validation (CORRIJA):\n{feedback_block}\n" if feedback_block else "")
                )
                try:
                    draft: AnalysisDraft = await self._complete_json_with_syntax_retry(
                        [
                            {"role": "system", "content": _analysis_prompt(self.request.clock.date, self.request.clock.timezone)},
                            {"role": "user", "content": an_user},
                        ],
                        AnalysisDraft,
                    )
                except StructuredOutputError as exc:
                    if iteration == MAX_LOOP_ITERATIONS:
                        raise RuntimeError(f"A1 Analysis falhou no schema: {exc.errors}") from exc
                    self.validation_retries += 1
                    feedback_block = json.dumps(exc.errors, ensure_ascii=False)
                    self._log(
                        "Analysis",
                        f"falhou no schema (iteração {iteration})",
                        "; ".join(exc.errors),
                        c_an.segundos,
                        self.llm.llm_calls - calls_before,
                    )
                    continue
                last_draft = draft
                calls_an = self.llm.llm_calls - calls_before
            self._log(
                "Analysis",
                f"propôs rascunho {draft.action} (iteração {iteration})",
                draft.rationale[:180] or "-",
                c_an.segundos,
                calls_an,
            )

            # Deterministic guardrails + Validation LLM persona audit
            with Cronometro() as c_val:
                calls_before = self.llm.llm_calls
                det_violations: list[ViolationItem] = []
                if draft.action == "draft_avoid_dates_only":
                    if not confirmed_record or not draft.avoid_dates:
                        det_violations.append(
                            ViolationItem(
                                code="invalid_avoid_dates_action",
                                field="avoid_dates",
                                message="action='draft_avoid_dates_only' requires confirmed_record and non-empty avoid_dates.",
                            )
                        )
                    else:
                        det_violations.extend(
                            verify_planning_context(
                                confirmed_record,
                                evidence,
                                self.request.clock,
                                avoid_dates=draft.avoid_dates,
                            )
                        )
                elif draft.record is None:
                    det_violations.append(
                        ViolationItem(
                            code="missing_record",
                            field="record",
                            message="action='propose_context' requires a valid 'record'.",
                        )
                    )
                else:
                    det_violations.extend(
                        verify_planning_context(
                            draft.record,
                            evidence,
                            self.request.clock,
                            avoid_dates=draft.avoid_dates,
                        )
                    )

                val_user = (
                    f"Pedido/Correção: {turn_text}\n"
                    f"Respostas do operador:\n{answers_str}\n\n"
                    f"Rascunho AnalysisDraft:\n{draft.model_dump_json(indent=2)}\n\n"
                    f"Achados determinísticos pré-checados:\n"
                    f"{json.dumps([v.model_dump() for v in det_violations], ensure_ascii=False, indent=2)}\n"
                )
                report: ValidationReport = await self._complete_json_with_syntax_retry(
                    [
                        {"role": "system", "content": _validation_prompt(self.request.clock.date, self.request.clock.timezone)},
                        {"role": "user", "content": val_user},
                    ],
                    ValidationReport,
                )
                merged_violations = list(det_violations)
                existing_msgs = {v.message for v in merged_violations}
                for v in report.violations:
                    if v.severity == "error" and v.message not in existing_msgs:
                        merged_violations.append(v)
                        existing_msgs.add(v.message)
                blocking = [v for v in merged_violations if v.severity == "error"]
                approved = len(blocking) == 0 and (report.approved or len(det_violations) == 0)
                calls_val = self.llm.llm_calls - calls_before

            self._log(
                "Validation",
                f"auditou proposta (iteração {iteration}) → {'APROVADO' if approved else 'REPROVADO'}",
                f"bloqueios={len(blocking)}, overload_risk={report.overload_risk}; {report.summary[:140]}",
                c_val.segundos,
                calls_val,
            )

            if approved:
                stop_reason = "approved"
                break
            if iteration == MAX_LOOP_ITERATIONS:
                stop_reason = (
                    "no_progress"
                    if prev_error_count is not None and len(blocking) >= prev_error_count
                    else "max_iterations_reached"
                )
                break
            prev_error_count = len(blocking)
            self.validation_retries += 1
            feedback_block = json.dumps([v.model_dump() for v in blocking], ensure_ascii=False, indent=2)

        self._log(
            "Maestro",
            "encerrou loop Analysis↔Validation",
            f"stop_reason={stop_reason}, iterations={iters_run}",
            0.0,
            0,
        )
        assert last_draft is not None
        if stop_reason != "approved":
            # Surface explicit error if final draft still fails deterministic verification
            check_target = confirmed_record if last_draft.action == "draft_avoid_dates_only" else last_draft.record
            if check_target is None:
                raise RuntimeError(f"A1 Analysis↔Validation stopped ({stop_reason}) without a valid record")
            remaining = verify_planning_context(
                check_target, evidence, self.request.clock, avoid_dates=last_draft.avoid_dates
            )
            if remaining:
                raise RuntimeError(
                    f"A1 Validation stopped ({stop_reason}) with unresolved errors: "
                    + "; ".join(v.message for v in remaining)
                )
        return last_draft

    async def _stage_communication(self, payload_summary: dict[str, Any]) -> str:
        with Cronometro() as c:
            calls_before = self.llm.llm_calls
            msg_obj: CommunicationMessage = await self._complete_json_with_syntax_retry(
                [
                    {"role": "system", "content": _communication_prompt(self.request.locale)},
                    {"role": "user", "content": f"Dados verificados para comunicar:\n{json.dumps(payload_summary, ensure_ascii=False, indent=2)}"},
                ],
                CommunicationMessage,
            )
            calls_used = self.llm.llm_calls - calls_before
        self._log(
            "Communication",
            "gerou síntese final em Markdown",
            f"{len(msg_obj.markdown)} chars",
            c.segundos,
            calls_used,
        )
        return msg_obj.markdown

    async def _execute_draft_plan(self, confirmed: dict[str, Any], avoid_dates: list[str] | None = None) -> dict[str, Any]:
        record_raw = confirmed.get("record") or {}
        through = str(record_raw.get("through") or self.request.clock.date)
        weeks = compute_horizon_weeks(self.request.clock.date, through)
        args: dict[str, Any] = {"weeks": weeks}
        effective_avoid = avoid_dates if avoid_dates is not None else self.pending_avoid_dates
        if effective_avoid:
            args["avoidDates"] = list(effective_avoid)
        with Cronometro() as c:
            plan = await self.bridge.call("draft_study_plan", args)
        self.last_drafted_context_id = str(confirmed.get("id"))
        self.pending_avoid_dates = []
        self._log(
            "Analysis",
            "executou draft_study_plan com contexto confirmado",
            f"weeks={weeks}, avoidDates={effective_avoid}, near={len(plan.get('near', []))}, future={len(plan.get('future', []))}",
            c.segundos,
            0,
        )
        return plan

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
            planning_ctx = await self.bridge.call("read_planning_context", {})
            triage = await self._stage_maestro(trimmed, planning_ctx if isinstance(planning_ctx, dict) else {})

            if triage.intent == "draft_plan":
                confirmed = (planning_ctx or {}).get("confirmed")
                assert confirmed is not None
                plan = await self._execute_draft_plan(confirmed)
                md = await self._stage_communication(
                    {
                        "stage": "drafted_plan",
                        "near_blocks": len(plan.get("near") or []),
                        "future_blocks": len(plan.get("future") or []),
                        "outlook": plan.get("outlook"),
                    }
                )
                self.messages.append(SnapshotMessage(type="assistant", text=md))
                return self.snapshot()

            if not self.initial_request_text:
                self.initial_request_text = trimmed

            evidence, dossier = await self._stage_research(trimmed)

            if triage.intent == "initial_plan" and not self.operator_answers:
                # Only ask if Research detected missing info or no preferences are known yet
                if dossier.clarification_needed or dossier.missing_info:
                    pending_q = self._build_a1_clarification_question(evidence, dossier)
                    self.pending_question = pending_q
                    self.question_turns += 1
                    self.questions_asked += len(pending_q.questions)
                    md = await self._stage_communication(
                        {
                            "stage": "clarification",
                            "questions": [q.model_dump() for q in pending_q.questions],
                        }
                    )
                    self.messages.append(SnapshotMessage(type="assistant", text=md))
                    return self.snapshot()

            is_revision = triage.intent == "revise_plan"
            confirmed_record = None
            confirmed_ctx = (planning_ctx or {}).get("confirmed")
            if is_revision and confirmed_ctx and isinstance(confirmed_ctx.get("record"), dict):
                confirmed_record = PlanningContextRecord.model_validate(confirmed_ctx["record"])

            draft = await self._stage_analysis_validation_loop(
                evidence,
                dossier,
                is_revision=is_revision,
                turn_text=trimmed,
                confirmed_record=confirmed_record,
            )

            if draft.action == "draft_avoid_dates_only" and confirmed_ctx:
                plan = await self._execute_draft_plan(confirmed_ctx, avoid_dates=draft.avoid_dates)
                md = await self._stage_communication(
                    {
                        "stage": "revised_plan",
                        "avoid_dates": draft.avoid_dates,
                        "near_blocks": len(plan.get("near") or []),
                        "future_blocks": len(plan.get("future") or []),
                    }
                )
                self.messages.append(SnapshotMessage(type="assistant", text=md))
            else:
                assert draft.record is not None
                await self.bridge.call("propose_planning_context", {"record": draft.record.to_bridge_record()})
                self.pending_avoid_dates = list(draft.avoid_dates)
                md = await self._stage_communication(
                    {
                        "stage": "context_proposed",
                        "courses": [c.name for c in draft.record.courses],
                        "target_hours": draft.record.targetHours,
                        "through": draft.record.through,
                    }
                )
                self.messages.append(SnapshotMessage(type="assistant", text=md))
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

            evidence = self.evidence or await self.bridge.ingest_evidence()
            dossier = self.dossier or ResearchDossier()
            draft = await self._stage_analysis_validation_loop(
                evidence,
                dossier,
                is_revision=False,
                turn_text=self.initial_request_text,
            )
            assert draft.record is not None
            await self.bridge.call("propose_planning_context", {"record": draft.record.to_bridge_record()})
            self.pending_avoid_dates = list(draft.avoid_dates)
            md = await self._stage_communication(
                {
                    "stage": "context_proposed",
                    "courses": [c.name for c in draft.record.courses],
                    "target_hours": draft.record.targetHours,
                    "through": draft.record.through,
                }
            )
            self.messages.append(SnapshotMessage(type="assistant", text=md))
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
        self._log("Maestro", "pergunta cancelada pelo operador", f"requestId={request_id}", 0.0, 0)
        return self.snapshot()
