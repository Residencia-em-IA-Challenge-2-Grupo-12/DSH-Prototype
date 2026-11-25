"""Deterministic Python verifier matching Foundation schema & planner rules."""

from __future__ import annotations

import math
import re
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from .contracts import ClockInfo, PlanningContextRecord, ViolationItem
from .tool_bridge import EvidenceBundle

ISO_OFFSET_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b"
)
TASK_SUFFIX_RE = re.compile(
    r"\b(?:case\s+memo|memo|exam|prova(?:\s+escrita)?|projeto(?:\s+final|\s+de\s+\w+)?|"
    r"assignment|lista(?:\s+de)?|clinic|plant[aã]o|oficina|homework|quiz|trabalho|feedback)\b",
    re.IGNORECASE,
)
OPTIONAL_CUE_RE = re.compile(
    r"\b(?:optional|opcional|feedback\s+session|plant[aã]o|oficina|vista\s+de\s+prova|indicativa)\b",
    re.IGNORECASE,
)


def normalize_quote(text: str) -> str:
    cleaned = re.sub(r"\*\*|__", "", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def compute_horizon_weeks(clock_date: str, through_date: str) -> int:
    start = date.fromisoformat(clock_date)
    end = date.fromisoformat(through_date)
    days = max(1, (end - start).days + 1)
    return max(1, min(16, math.ceil(days / 7)))


def candidate_quote_lines(content: str, limit: int = 5) -> list[str]:
    candidates: list[str] = []
    for raw in content.splitlines():
        line = normalize_quote(raw)
        if len(line) < 8:
            continue
        if re.search(r"(?:\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}|dueAt|às\s+\d{2}:\d{2}|\d{2}:\d{2})", line, re.IGNORECASE):
            candidates.append(line[:220])
            if len(candidates) >= limit:
                break
    return candidates


def verify_quote_in_evidence(
    path: str,
    quote: str,
    page: int | None,
    evidence: EvidenceBundle,
) -> list[ViolationItem]:
    violations: list[ViolationItem] = []
    if path not in evidence.files:
        violations.append(
            ViolationItem(
                code="unknown_source_path",
                field="courses.citation.path",
                message=f"Cited path '{path}' is not in workspace files: {evidence.file_paths}",
            )
        )
        return violations

    body = evidence.files[path]
    is_pdf = path.lower().endswith(".pdf")
    if is_pdf != (page is not None):
        violations.append(
            ViolationItem(
                code="pdf_page_mismatch",
                field="courses.citation.page",
                message="Provide a 1-based 'page' integer for PDF citations and omit 'page' for non-PDF citations.",
            )
        )
        return violations

    if is_pdf:
        pages = body.split("\f")
        if page is None or page < 1 or page > len(pages):
            violations.append(
                ViolationItem(
                    code="pdf_page_out_of_range",
                    field="courses.citation.page",
                    message=f"PDF page {page} out of range (1..{len(pages)}) for '{path}'.",
                )
            )
            return violations
        excerpt = pages[page - 1]
    else:
        excerpt = body

    if normalize_quote(quote) not in normalize_quote(excerpt):
        hints = candidate_quote_lines(excerpt)
        hint_txt = f" Candidate lines: {hints}" if hints else ""
        violations.append(
            ViolationItem(
                code="quote_not_found",
                field="courses.citation.quote",
                message=(
                    f"Verbatim quote was not found in '{path}'"
                    f"{f' page {page}' if is_pdf else ''}.{hint_txt}"
                ),
            )
        )
    return violations


def verify_utc_timezone_conversion(
    course_name: str,
    course_date: str,
    course_time: str,
    quote: str,
    tz_name: str,
) -> list[ViolationItem]:
    matches = ISO_OFFSET_RE.findall(quote)
    if len(matches) != 1:
        return []
    raw_ts = matches[0]
    try:
        dt = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
        local_dt = dt.astimezone(ZoneInfo(tz_name))
    except Exception:
        return []

    expected_date = local_dt.date().isoformat()
    expected_time = local_dt.strftime("%H:%M")
    if course_date != expected_date or course_time != expected_time:
        return [
            ViolationItem(
                code="timezone_conversion_mismatch",
                field="courses.time",
                message=(
                    f"Course '{course_name}' cites timestamp '{raw_ts}', which converts to "
                    f"{expected_date} {expected_time} in {tz_name} (got {course_date} {course_time})."
                ),
            )
        ]
    return []


def verify_course_name(name: str) -> list[ViolationItem]:
    if TASK_SUFFIX_RE.search(name):
        return [
            ViolationItem(
                code="course_name_has_task_suffix",
                field="courses.name",
                message=(
                    f"Course name '{name}' appears to include an assessment/task suffix or optional clinic. "
                    "Use the clean academic course title only (e.g. 'Applied Data Ethics', 'Algoritmos', 'Banco de Dados')."
                ),
            )
        ]
    return []


def _parse_hhmm(value: str) -> int:
    hh, mm = value.split(":")
    return int(hh) * 60 + int(mm)


def _js_weekday(d: date) -> int:
    return (d.weekday() + 1) % 7


def _parse_event_interval(raw: dict[str, Any], tz: ZoneInfo) -> tuple[datetime, datetime] | None:
    if raw.get("status") == "cancelled" or raw.get("transparency") == "transparent":
        return None
    s_val = raw.get("start")
    e_val = raw.get("end")
    if isinstance(s_val, dict):
        s_val = s_val.get("dateTime") or s_val.get("date")
    if isinstance(e_val, dict):
        e_val = e_val.get("dateTime") or e_val.get("date")
    if not isinstance(s_val, str) or not isinstance(e_val, str):
        return None
    try:
        if "T" in s_val:
            s_dt = datetime.fromisoformat(s_val.replace("Z", "+00:00")).astimezone(tz)
        else:
            s_dt = datetime.combine(date.fromisoformat(s_val[:10]), time(0, 0), tzinfo=tz)
        if "T" in e_val:
            e_dt = datetime.fromisoformat(e_val.replace("Z", "+00:00")).astimezone(tz)
        else:
            e_dt = datetime.combine(date.fromisoformat(e_val[:10]), time(0, 0), tzinfo=tz)
    except ValueError:
        return None
    return (s_dt, e_dt) if e_dt > s_dt else None


def simulate_weekly_feasibility(
    record: PlanningContextRecord,
    calendar_events: list[dict[str, Any]],
    clock: ClockInfo,
    avoid_dates: Iterable[str] = (),
) -> list[ViolationItem]:
    """Mirror src/domain/planner.mjs greedy placement at 15-min steps."""
    tz = ZoneInfo(clock.timezone)
    today_date = date.fromisoformat(clock.date)
    through_date = date.fromisoformat(record.through)
    if through_date < today_date:
        return [
            ViolationItem(
                code="expired_through",
                field="through",
                message=f"'through' ({record.through}) precedes clock date ({clock.date}).",
            )
        ]

    avoid = set(avoid_dates)
    busy: list[tuple[datetime, datetime]] = []
    for ev in calendar_events:
        priv = (ev.get("extendedProperties") or {}).get("private") or {}
        if ev.get("studyBlock") is True or priv.get("studyDemo") == "true":
            continue
        interval = _parse_event_interval(ev, tz)
        if interval:
            busy.append(interval)

    deadlines = [
        datetime.fromisoformat(f"{c.date}T{c.time}:00").replace(tzinfo=tz)
        for c in record.courses
    ]
    max_deadline = max(deadlines)
    weeks = compute_horizon_weeks(clock.date, record.through)
    gap = timedelta(minutes=record.studyBreakMinutes)
    one_hour = timedelta(hours=1)
    violations: list[ViolationItem] = []

    for w in range(weeks):
        candidates: list[tuple[str, datetime, datetime]] = []
        for d_off in range(7):
            cur_day = today_date + timedelta(days=w * 7 + d_off)
            day_iso = cur_day.isoformat()
            if cur_day > through_date or day_iso in avoid:
                continue
            js_wd = _js_weekday(cur_day)
            for win in record.studyWindows:
                if win.weekday != js_wd:
                    continue
                s_min = _parse_hhmm(win.start)
                e_min = _parse_hhmm(win.end)
                cur_m = s_min
                while cur_m + 60 <= e_min:
                    c_start = datetime.combine(cur_day, time(cur_m // 60, cur_m % 60), tzinfo=tz)
                    c_end = c_start + one_hour
                    candidates.append((day_iso, c_start, c_end))
                    cur_m += 15

        placed = 0
        daily_counts: dict[str, int] = {}
        week_blocks: list[tuple[datetime, datetime]] = []

        while placed < record.targetHours and candidates:
            candidates.sort(key=lambda item: (daily_counts.get(item[0], 0), item[1]))
            day_iso, c_start, c_end = candidates.pop(0)
            if daily_counts.get(day_iso, 0) >= record.maxDailyStudyHours:
                continue
            if c_end > max_deadline:
                continue
            if any(b_s < c_end and c_start < b_e for b_s, b_e in busy):
                continue
            if any(c_start < wb_e + gap and wb_s < c_end + gap for wb_s, wb_e in week_blocks):
                continue
            week_blocks.append((c_start, c_end))
            busy.append((c_start, c_end))
            daily_counts[day_iso] = daily_counts.get(day_iso, 0) + 1
            placed += 1

        if placed < record.targetHours:
            horizon_hint = (
                " Check whether 'through' mistakenly used a course deadline instead of the student's shorter study-window horizon."
                if weeks > 4
                else ""
            )
            violations.append(
                ViolationItem(
                    code="weekly_target_infeasible",
                    field="through" if weeks > 4 else "studyWindows",
                    message=(
                        f"Week {w + 1} of {weeks} (through={record.through}) only fits {placed}h of {record.targetHours}h target "
                        f"under current windows, maxDailyStudyHours={record.maxDailyStudyHours}, "
                        f"studyBreakMinutes={record.studyBreakMinutes}, avoidDates={sorted(avoid)}, and calendar busy slots."
                        f"{horizon_hint}"
                    ),
                )
            )

    return violations


def verify_planning_context(
    record: PlanningContextRecord,
    evidence: EvidenceBundle,
    clock: ClockInfo,
    avoid_dates: Iterable[str] = (),
) -> list[ViolationItem]:
    violations: list[ViolationItem] = []

    if record.through < clock.date:
        violations.append(
            ViolationItem(
                code="expired_through",
                field="through",
                message=f"'through' ({record.through}) must be >= clock date ({clock.date}).",
            )
        )

    if len(record.assumption) > 600:
        violations.append(
            ViolationItem(
                code="assumption_too_long",
                field="assumption",
                message=f"'assumption' is {len(record.assumption)} chars (max 600).",
            )
        )

    seen_names: set[str] = set()
    for course in record.courses:
        lowered = course.name.lower()
        if lowered in seen_names:
            violations.append(
                ViolationItem(
                    code="duplicate_course",
                    field="courses.name",
                    message=f"Course '{course.name}' is listed more than once; each course must be listed once.",
                )
            )
        seen_names.add(lowered)
        violations.extend(verify_course_name(course.name))
        if OPTIONAL_CUE_RE.search(course.citation.quote) and not course.resolution:
            violations.append(
                ViolationItem(
                    code="optional_milestone_cited",
                    field="courses",
                    message=(
                        f"Course '{course.name}' cites an optional milestone ('{course.citation.quote[:80]}...'). "
                        "Keep optional clinics/sessions in 'assumption' and only list graded course deadlines in 'courses'."
                    ),
                )
            )
        violations.extend(
            verify_quote_in_evidence(
                course.citation.path,
                course.citation.quote,
                course.citation.page,
                evidence,
            )
        )
        violations.extend(
            verify_utc_timezone_conversion(
                course.name,
                course.date,
                course.time,
                course.citation.quote,
                clock.timezone,
            )
        )

    violations.extend(
        simulate_weekly_feasibility(record, evidence.calendar_events, clock, avoid_dates=avoid_dates)
    )
    return violations
