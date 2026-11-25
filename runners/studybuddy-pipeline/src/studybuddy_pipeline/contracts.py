"""Pydantic v2 contracts for http-runner-v1, StudyBuddy Evento rastro, and pipeline stages."""

from __future__ import annotations

import re
import time
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class Evento(BaseModel):
    """Mirrors StudyBuddy's rastro Evento(agente, acao, detalhe, segundos)."""

    model_config = ConfigDict(extra="forbid")

    agente: str
    acao: str
    detalhe: str = ""
    segundos: float = 0.0
    llm_calls: int = 0


class Cronometro:
    """Context manager matching StudyBuddy's Cronometro."""

    def __init__(self) -> None:
        self._t: float = 0.0
        self.segundos: float = 0.0

    def __enter__(self) -> Cronometro:
        self._t = time.perf_counter()
        self.segundos = 0.0
        return self

    def __exit__(self, *exc: object) -> None:
        self.segundos = round(time.perf_counter() - self._t, 3)


# ---------------------------------------------------------------------------
# http-runner-v1 wire models
# ---------------------------------------------------------------------------


class ClockInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str
    timezone: str


class ToolBridgeConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str
    token: str
    methods: list[str] = Field(default_factory=list)


class SessionStartRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    version: int = 1
    runId: str
    caseId: str
    student: str
    locale: str = "en"
    clock: ClockInfo
    sources: list[dict[str, Any]] = Field(default_factory=list)
    toolBridge: ToolBridgeConfig


class EngineMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    revision: str
    mode: Literal["scripted", "live"]
    model: str | None = None
    harness: str


class UsageInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    availability: Literal["unknown", "not_applicable", "available"]
    inputTokens: int | None = None
    outputTokens: int | None = None

    def to_wire(self) -> dict[str, Any]:
        if self.availability != "available":
            return {"availability": self.availability}
        return {
            "availability": "available",
            "inputTokens": self.inputTokens or 0,
            "outputTokens": self.outputTokens or 0,
        }


class SessionStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionId: str
    engine: EngineMetadata
    usage: dict[str, Any]


class PromptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str


class AnswerItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    custom: str = ""
    selected: list[str] = Field(default_factory=list)


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str
    answers: list[AnswerItem]


class CancelQuestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str


class QuestionOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str | None = None


class QuestionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    groupId: str | None = None
    question: str
    options: list[QuestionOption] = Field(default_factory=list)


class PendingQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str
    questions: list[QuestionItem] = Field(min_length=1)


class SnapshotMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["user", "assistant", "system"]
    text: str


class SnapshotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[SnapshotMessage]
    question: PendingQuestion | None = None
    busy: bool = False
    error: str | None = None
    usage: dict[str, Any] | None = None


class RunTraceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runId: str
    pipeline: Literal["a1", "a2"]
    model: str | None = None
    llmCalls: int = 0
    toolCalls: int = 0
    toolErrors: list[dict[str, Any]] = Field(default_factory=list)
    validationRetries: int = 0
    questionsAsked: int = 0
    questionTurns: int = 0
    rastro: list[Evento] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# PlanningContextRecord (matches src/cold-start-context.mjs Zod schema)
# ---------------------------------------------------------------------------


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=180)
    page: int | None = Field(default=None, ge=1, le=100)
    quote: str = Field(min_length=8, max_length=450)

    @field_validator("path", "quote", mode="before")
    @classmethod
    def _strip_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class CourseDeadline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    date: str
    time: str
    citation: Citation
    resolution: str | None = Field(default=None, max_length=450)

    @field_validator("name", "date", "time", mode="before")
    @classmethod
    def _strip_fields(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("resolution", mode="before")
    @classmethod
    def _normalize_resolution(cls, value: Any) -> Any:
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed if trimmed else None
        return value

    @field_validator("date")
    @classmethod
    def _check_date(cls, value: str) -> str:
        if not DATE_RE.match(value):
            raise ValueError(f"Invalid ISO date '{value}' (expected YYYY-MM-DD)")
        return value

    @field_validator("time")
    @classmethod
    def _check_time(cls, value: str) -> str:
        if not TIME_RE.match(value):
            raise ValueError(f"Invalid 24h time '{value}' (expected HH:MM)")
        return value


class StudyWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekday: int = Field(ge=0, le=6)
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def _check_hhmm(cls, value: str) -> str:
        if not TIME_RE.match(value):
            raise ValueError(f"Invalid study window time '{value}' (expected HH:MM)")
        return value

    @model_validator(mode="after")
    def _check_order(self) -> StudyWindow:
        if self.start >= self.end:
            raise ValueError(f"Study window end '{self.end}' must be after start '{self.start}'")
        return self


class PlanningContextRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    courses: list[CourseDeadline] = Field(min_length=1, max_length=8)
    studyWindows: list[StudyWindow] = Field(min_length=1, max_length=14)
    targetHours: int = Field(ge=1, le=20)
    maxDailyStudyHours: int = Field(ge=1, le=8)
    studyBreakMinutes: int = Field(ge=0, le=120)
    through: str
    assumption: str = Field(min_length=1, max_length=600)

    @field_validator("through", "assumption", mode="before")
    @classmethod
    def _strip_top(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("through")
    @classmethod
    def _check_through(cls, value: str) -> str:
        if not DATE_RE.match(value):
            raise ValueError(f"Invalid through date '{value}' (expected YYYY-MM-DD)")
        return value

    def to_bridge_record(self) -> dict[str, Any]:
        """Serialize strictly for Zod z.strictObject (omit None optional keys)."""
        courses_out: list[dict[str, Any]] = []
        for course in self.courses:
            cit: dict[str, Any] = {
                "path": course.citation.path,
                "quote": course.citation.quote,
            }
            if course.citation.path.lower().endswith(".pdf") and course.citation.page is not None:
                cit["page"] = course.citation.page
            entry: dict[str, Any] = {
                "name": course.name,
                "date": course.date,
                "time": course.time,
                "citation": cit,
            }
            if course.resolution:
                entry["resolution"] = course.resolution
            courses_out.append(entry)
        return {
            "courses": courses_out,
            "studyWindows": [w.model_dump() for w in self.studyWindows],
            "targetHours": self.targetHours,
            "maxDailyStudyHours": self.maxDailyStudyHours,
            "studyBreakMinutes": self.studyBreakMinutes,
            "through": self.through,
            "assumption": self.assumption,
        }


# ---------------------------------------------------------------------------
# Approach A2 stage models
# ---------------------------------------------------------------------------


class ExtractedDeadline(BaseModel):
    model_config = ConfigDict(extra="ignore")

    course: str = Field(min_length=1)
    date: str
    time: str
    source_path: str = Field(min_length=1)
    page: int | None = None
    quote: str = Field(min_length=8)
    is_optional: bool = False
    supersedes_earlier: bool = False
    resolution_note: str | None = None


class DeadlineConflict(BaseModel):
    model_config = ConfigDict(extra="ignore")

    course: str
    description: str
    resolved: bool = True
    resolution_note: str | None = None


class MissingPreferences(BaseModel):
    model_config = ConfigDict(extra="ignore")

    studyWindows: bool = True
    targetHours: bool = True
    maxDailyStudyHours: bool = True
    studyBreakMinutes: bool = True
    through: bool = True


class ExtractionBundle(BaseModel):
    model_config = ConfigDict(extra="ignore")

    deadlines: list[ExtractedDeadline] = Field(default_factory=list)
    conflicts: list[DeadlineConflict] = Field(default_factory=list)
    missing_preferences: MissingPreferences = Field(default_factory=MissingPreferences)
    calendar_summary: str = ""


class RevisionDecision(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mode: Literal["avoid_dates_only", "context_update"]
    avoid_dates: list[str] = Field(default_factory=list)
    updated_record: PlanningContextRecord | None = None
    rationale: str = ""


# ---------------------------------------------------------------------------
# Approach A1 (StudyBuddy 5-Stage Role Baseline) models
# ---------------------------------------------------------------------------


class MaestroTriage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    intent: Literal["initial_plan", "draft_plan", "revise_plan"]
    student_goal: str = ""
    stated_constraints: dict[str, str] = Field(default_factory=dict)
    routing_note: str = ""


class DraftQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    question: str
    choices: list[str] = Field(default_factory=list)


class ResearchDossier(BaseModel):
    model_config = ConfigDict(extra="ignore")

    authoritative_courses: list[ExtractedDeadline] = Field(default_factory=list)
    optional_milestones: list[str] = Field(default_factory=list)
    conflicts: list[DeadlineConflict] = Field(default_factory=list)
    missing_info: list[str] = Field(default_factory=list)
    clarification_needed: bool = False
    questions: list[DraftQuestion] = Field(default_factory=list)
    calendar_notes: str = ""


class AnalysisDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")

    action: Literal["propose_context", "draft_avoid_dates_only"] = "propose_context"
    record: PlanningContextRecord | None = None
    avoid_dates: list[str] = Field(default_factory=list)
    rationale: str = ""


class ViolationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    field: str
    message: str
    severity: Literal["error", "warning"] = "error"


class ValidationReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    approved: bool
    overload_risk: bool = False
    violations: list[ViolationItem] = Field(default_factory=list)
    summary: str = ""


class CommunicationMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    markdown: str = Field(min_length=1)
