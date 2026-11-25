#!/usr/bin/env python3
"""Self-contained OR-Tools CP-SAT prototype behind the src/domain/planner.mjs contract.

Reads a JSON payload from stdin (or --input PATH) matching `makePlan(student, events, options)`
and writes JSON `{ "plan": ..., "solver": ... }` to stdout.

If `ortools` is not installed, returns `plan: null` and `solver.status: "UNAVAILABLE"`
without falling back to a heuristic.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import resource
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

DAY_MS = 86_400_000
WEEK_MS = 7 * DAY_MS
SESSION_MINUTES = 60
SLOT_STEP_MINUTES = 15

# Frozen lexicographic integer objective weights (explicitly disclosed in evidence docs).
# W_BLOCK strictly dominates the worst-case marginal penalty of Tiers 2-6 (~111,671),
# ensuring the solver NEVER omits a feasible study block to improve balance, spread, or timing.
W_BLOCK = 10_000_000
W_PREF_PERIOD = 200_000
W_COVERAGE_DEFAULT = 50_000
W_COVERAGE_OPTION = 500_000
W_COVERAGE_FOCUS = 10_000
W_BALANCE = 20_000
W_DAILY_SPREAD = 1_000
W_TIME = 1
W_COURSE_RANK = 1

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
OFFSET_RE = re.compile(r"^([+-])(?:([01]\d|2[0-3]):([0-5]\d))$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(frozen=True)
class CandidateSlot:
    index: int
    week: int
    day_in_week: int
    day_key: str
    minute: int
    rel_start_min: int
    start_ms: int
    end_ms: int
    start_iso: str
    end_iso: str
    period: str
    eligible_courses: tuple[int, ...]


def _parse_offset(offset_str: str) -> timezone:
    if not isinstance(offset_str, str):
        raise ValueError("Invalid timezone offset")
    match = OFFSET_RE.match(offset_str)
    if not match:
        raise ValueError("Invalid timezone offset")
    sign = 1 if match.group(1) == "+" else -1
    hours = int(match.group(2))
    minutes = int(match.group(3))
    return timezone(sign * timedelta(hours=hours, minutes=minutes))


def _parse_iso_date(value: str, message: str) -> date:
    if not isinstance(value, str) or not ISO_DATE_RE.match(value):
        raise ValueError(message)
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(message) from exc


def _parse_hhmm(value: str) -> int:
    if not isinstance(value, str):
        raise ValueError("Invalid study window time")
    match = HHMM_RE.match(value)
    if not match:
        raise ValueError("Invalid study window time")
    return int(match.group(1)) * 60 + int(match.group(2))


def _parse_iso_ms(value: str) -> int:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Invalid ISO timestamp: {value!r}")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(round(dt.timestamp() * 1000))


def _local_midnight_ms(day_val: date, tz: timezone) -> int:
    dt = datetime(day_val.year, day_val.month, day_val.day, 0, 0, 0, tzinfo=tz)
    return int(round(dt.timestamp() * 1000))


def _event_boundary_ms(event: dict[str, Any], side: str, all_day_offset: str = "-03:00") -> int:
    boundary = event.get(side) or {}
    if isinstance(boundary, dict):
        if boundary.get("dateTime"):
            return _parse_iso_ms(boundary["dateTime"])
        if boundary.get("date"):
            return _parse_iso_ms(f"{boundary['date']}T00:00:00{all_day_offset}")
    raise ValueError(f"Calendar event {event.get('id')!r} missing {side} boundary")


def _significant(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event["id"],
        "summary": event.get("summary"),
        "description": event.get("description") or "",
        "start": event["start"],
        "end": event["end"],
        "location": event.get("location") or "",
        "attendees": event.get("attendees") or [],
        "status": event.get("status") or "confirmed",
        "transparency": event.get("transparency") or "opaque",
        "extendedProperties": event.get("extendedProperties") or {},
    }


def _digest_events(events: list[dict[str, Any]]) -> str:
    snapped = sorted((_significant(ev) for ev in events), key=lambda item: item["id"])
    payload = json.dumps(snapped, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _is_busy(event: dict[str, Any]) -> bool:
    return event.get("status") != "cancelled" and event.get("transparency") != "transparent"


def _overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def _peak_rss_kb() -> int:
    # On Linux, ru_maxrss is in kilobytes.
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def _unavailable_response(reason: str) -> dict[str, Any]:
    return {
        "plan": None,
        "solver": {
            "engine": "cp-sat",
            "ortoolsVersion": None,
            "pythonVersion": sys.version.split()[0],
            "status": "UNAVAILABLE",
            "targetFeasibility": "unavailable",
            "reason": reason,
            "objectiveValue": None,
            "bestObjectiveBound": None,
            "wallMs": 0.0,
            "cpSatSearchMs": None,
            "peakRssKb": _peak_rss_kb(),
            "seed": None,
            "workers": None,
            "maxTimeSeconds": None,
            "numVariables": 0,
            "numSlots": 0,
            "strictTarget": False,
        },
    }


def solve_plan(
    student: dict[str, Any],
    events: list[dict[str, Any]],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Solve the study planning problem using OR-Tools CP-SAT under the planner.mjs contract."""
    opts = dict(options or {})
    clock_date_str = opts.get("today") or "2026-11-02"
    timezone_offset = opts.get("timezoneOffset") or "-03:00"
    today_date = _parse_iso_date(clock_date_str, "Invalid planning clock date")
    tz = _parse_offset(timezone_offset)

    raw_hours = opts.get("hours")
    target = student.get("targetHours") if raw_hours is None else raw_hours
    if isinstance(target, bool) or not isinstance(target, int) or target < 0 or target > 20:
        raise ValueError("Hours must be a whole number between 0 and 20")

    requested = opts.get("weeks", 4)
    if isinstance(requested, bool) or not isinstance(requested, int) or requested < 1 or requested > 16:
        raise ValueError("Weeks must be between 1 and 16")

    avoid_dates_raw = opts.get("avoidDates")
    avoid_dates_list = [] if avoid_dates_raw is None else avoid_dates_raw
    if (
        not isinstance(avoid_dates_list, list)
        or len(avoid_dates_list) > 112
        or any(not isinstance(d, str) or not ISO_DATE_RE.match(d) for d in avoid_dates_list)
    ):
        raise ValueError("Avoid dates must be ISO dates")
    avoid_dates = set(avoid_dates_list)

    preferred_period = opts.get("preferredPeriod")
    if preferred_period is not None and preferred_period not in ("morning", "afternoon", "evening"):
        raise ValueError("Unknown preferred period")

    allocation = opts.get("allocation")
    if allocation is not None and allocation != "course-coverage":
        raise ValueError("Unknown allocation strategy")

    focus_course_name = opts.get("focusCourse")
    if allocation is not None and focus_course_name:
        raise ValueError("Choose course coverage or a single-course focus for this proposal")

    courses = list(student.get("courses") or [])
    focus_idx: int | None = None
    if focus_course_name:
        target_lc = str(focus_course_name).lower()
        for idx, course in enumerate(courses):
            if str(course.get("name", "")).lower() == target_lc:
                focus_idx = idx
                break
        if focus_idx is None:
            raise ValueError("Focus course is not in the student course index")

    windows = list(student.get("studyWindows") or [])
    max_daily = student.get("maxDailyStudyHours", 2)
    break_minutes = student.get("studyBreakMinutes", 15)
    if (
        len(windows) > 30
        or isinstance(max_daily, bool)
        or not isinstance(max_daily, int)
        or max_daily < 1
        or max_daily > 12
        or isinstance(break_minutes, bool)
        or not isinstance(break_minutes, int)
        or break_minutes < 0
        or break_minutes > 120
    ):
        raise ValueError("Invalid study availability")

    parsed_windows: list[tuple[int, int, int]] = []
    for win in windows:
        weekday = win.get("weekday")
        if isinstance(weekday, bool) or not isinstance(weekday, int) or weekday < 0 or weekday > 6:
            raise ValueError("Invalid study window")
        w_start = _parse_hhmm(win.get("start"))
        w_end = _parse_hhmm(win.get("end"))
        if w_end <= w_start:
            raise ValueError("Invalid study window")
        parsed_windows.append((weekday, w_start, w_end))

    strict_target = bool(opts.get("strictTarget", False))
    max_time_seconds = float(opts.get("maxTimeSeconds", 5.0))
    seed = int(opts.get("seed", 0))
    workers = int(opts.get("workers", 1))
    protected_ids = set(opts.get("protectedIds") or [])

    try:
        import ortools
        from ortools.sat.python import cp_model
    except ImportError as exc:
        return _unavailable_response(f"OR-Tools not available: {exc}")

    wall_started = time.perf_counter()

    today_ms = _local_midnight_ms(today_date, tz)
    next_week_start_ms = today_ms + WEEK_MS

    course_deadlines_ms = [_parse_iso_ms(c["deadline"]) for c in courses]
    upcoming_deadlines = [dl for dl in course_deadlines_ms if dl > today_ms]
    earliest_deadline = min(upcoming_deadlines) if upcoming_deadlines else today_ms
    max_weeks = max(1, math.ceil((earliest_deadline - today_ms) / WEEK_MS))

    availability_through = student.get("availabilityThrough")
    if availability_through:
        through_date = _parse_iso_date(availability_through, "Invalid availabilityThrough date")
        scoped_end_ms: float = float(_local_midnight_ms(through_date, tz) + DAY_MS)
        scoped_weeks = math.ceil((scoped_end_ms - today_ms) / WEEK_MS)
        count = max(0, min(requested, max_weeks, 16, scoped_weeks))
    else:
        scoped_end_ms = math.inf
        count = max(0, min(requested, max_weeks, 16))

    horizon_end_ms = min(float(today_ms + count * WEEK_MS), scoped_end_ms)

    replaceable: list[dict[str, Any]] = []
    replace_ids: set[str] = set()
    for ev in events:
        priv = (ev.get("extendedProperties") or {}).get("private") or {}
        if (
            priv.get("studyDemo") == "true"
            and priv.get("student") == student.get("student")
            and ev.get("id") not in protected_ids
        ):
            ev_start = _event_boundary_ms(ev, "start")
            if today_ms <= ev_start < horizon_end_ms:
                replaceable.append(ev)
                replace_ids.add(ev["id"])

    busy_intervals: list[tuple[int, int]] = []
    for ev in events:
        if ev.get("id") not in replace_ids and _is_busy(ev):
            busy_intervals.append((_event_boundary_ms(ev, "start"), _event_boundary_ms(ev, "end")))

    # Canonical rank is determined purely by (deadline, course name) so input course array order
    # never perturbs tie-breaking.
    canonical_order = sorted(range(len(courses)), key=lambda idx: (course_deadlines_ms[idx], courses[idx]["name"]))
    canonical_rank = {course_idx: rank for rank, course_idx in enumerate(canonical_order)}

    slots: list[CandidateSlot] = []
    for w in range(count):
        for d in range(7):
            day_date = today_date + timedelta(days=w * 7 + d)
            day_key = day_date.isoformat()
            if day_key in avoid_dates or (availability_through and day_key > availability_through):
                continue
            js_weekday = (day_date.weekday() + 1) % 7
            day_midnight_ms = _local_midnight_ms(day_date, tz)
            seen_minutes: set[int] = set()
            day_minutes: list[int] = []
            for win_weekday, w_start, w_end in parsed_windows:
                if win_weekday != js_weekday:
                    continue
                for minute in range(w_start, w_end - SESSION_MINUTES + 1, SLOT_STEP_MINUTES):
                    if minute not in seen_minutes:
                        seen_minutes.add(minute)
                        day_minutes.append(minute)
            day_minutes.sort()
            for minute in day_minutes:
                start_ms = day_midnight_ms + minute * 60_000
                end_ms = start_ms + SESSION_MINUTES * 60_000
                if any(_overlaps(start_ms, end_ms, b_start, b_end) for b_start, b_end in busy_intervals):
                    continue
                eligible = tuple(
                    ci for ci in canonical_order if end_ms <= course_deadlines_ms[ci]
                )
                if not eligible:
                    continue
                dt_local = datetime(day_date.year, day_date.month, day_date.day, minute // 60, minute % 60, 0, tzinfo=tz)
                end_local = dt_local + timedelta(minutes=SESSION_MINUTES)
                period = "morning" if minute < 720 else ("afternoon" if minute < 1080 else "evening")
                slots.append(
                    CandidateSlot(
                        index=len(slots),
                        week=w,
                        day_in_week=d,
                        day_key=day_key,
                        minute=minute,
                        rel_start_min=(start_ms - today_ms) // 60_000,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        start_iso=dt_local.strftime("%Y-%m-%dT%H:%M:%S") + timezone_offset,
                        end_iso=end_local.strftime("%Y-%m-%dT%H:%M:%S") + timezone_offset,
                        period=period,
                        eligible_courses=eligible,
                    )
                )

    model = cp_model.CpModel()
    x_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    y_vars: list[cp_model.IntVar] = []

    slots_by_week: dict[int, list[CandidateSlot]] = {w: [] for w in range(count)}
    slots_by_day: dict[str, list[CandidateSlot]] = {}

    for slot in slots:
        y = model.NewBoolVar(f"y_{slot.index}")
        y_vars.append(y)
        slot_course_vars = []
        for ci in slot.eligible_courses:
            x = model.NewBoolVar(f"x_{slot.index}_r{canonical_rank[ci]}")
            x_vars[(slot.index, ci)] = x
            slot_course_vars.append(x)
        model.Add(sum(slot_course_vars) == y)
        slots_by_week[slot.week].append(slot)
        slots_by_day.setdefault(slot.day_key, []).append(slot)

    # Hard constraint 1: no overlap + configured break within each week (matches planner.mjs line 167).
    interval_len = SESSION_MINUTES + break_minutes
    for w, week_slots in slots_by_week.items():
        if len(week_slots) > 1:
            intervals = [
                model.NewOptionalFixedSizeIntervalVar(
                    slot.rel_start_min, interval_len, y_vars[slot.index], f"iv_{slot.index}"
                )
                for slot in week_slots
            ]
            model.AddNoOverlap(intervals)

    # Hard constraint 2: daily cap.
    for day_key, day_slots in slots_by_day.items():
        model.Add(sum(y_vars[slot.index] for slot in day_slots) <= max_daily)

    # Hard constraint 3: weekly target (upper bound normally, equality when strict_target=True).
    for w in range(count):
        week_sum = sum(y_vars[slot.index] for slot in slots_by_week[w]) if slots_by_week[w] else 0
        if strict_target:
            model.Add(week_sum == target)
        else:
            model.Add(week_sum <= target)

    # Objective construction.
    objective_terms: list[Any] = []

    # Tier 1: maximize total scheduled 1-hour blocks.
    for slot in slots:
        objective_terms.append(W_BLOCK * y_vars[slot.index])

    # Tier 2: preferred period bonus.
    if preferred_period:
        for slot in slots:
            if slot.period == preferred_period:
                objective_terms.append(W_PREF_PERIOD * y_vars[slot.index])

    # Eligible courses globally and per week.
    eligible_global = sorted(
        {ci for slot in slots for ci in slot.eligible_courses},
        key=lambda ci: canonical_rank[ci],
    )
    course_total_vars: dict[int, list[cp_model.IntVar]] = {ci: [] for ci in eligible_global}
    for slot in slots:
        for ci in slot.eligible_courses:
            course_total_vars[ci].append(x_vars[(slot.index, ci)])

    max_horizon_blocks = max(1, count * target)

    # Tier 3: distinct course coverage across the horizon.
    if allocation == "course-coverage":
        w_coverage = W_COVERAGE_OPTION
    elif focus_idx is not None:
        w_coverage = W_COVERAGE_FOCUS
    else:
        w_coverage = W_COVERAGE_DEFAULT

    for ci in eligible_global:
        cov = model.NewBoolVar(f"cov_r{canonical_rank[ci]}")
        c_sum = sum(course_total_vars[ci])
        model.Add(cov <= c_sum)
        objective_terms.append(w_coverage * cov)

    # Tier 4: course balance / focus target ratio.
    if focus_idx is not None and focus_idx in course_total_vars:
        total_blocks_expr = sum(y_vars)
        focus_total_expr = sum(course_total_vars[focus_idx])
        horizon_dev = model.NewIntVar(0, 3 * max_horizon_blocks, "focus_horizon_dev")
        model.Add(horizon_dev >= 3 * focus_total_expr - 2 * total_blocks_expr)
        model.Add(horizon_dev >= 2 * total_blocks_expr - 3 * focus_total_expr)
        objective_terms.append(-W_BALANCE * horizon_dev)

        for w, week_slots in slots_by_week.items():
            week_focus_vars = [x_vars[(slot.index, focus_idx)] for slot in week_slots if (slot.index, focus_idx) in x_vars]
            if week_focus_vars:
                w_total_expr = sum(y_vars[slot.index] for slot in week_slots)
                w_focus_expr = sum(week_focus_vars)
                w_dev = model.NewIntVar(0, 3 * max(1, target), f"focus_w_{w}_dev")
                model.Add(w_dev >= 3 * w_focus_expr - 2 * w_total_expr)
                model.Add(w_dev >= 2 * w_total_expr - 3 * w_focus_expr)
                objective_terms.append(-W_BALANCE * w_dev)

        other_courses = [ci for ci in eligible_global if ci != focus_idx]
        if len(other_courses) >= 2:
            o_min = model.NewIntVar(0, max_horizon_blocks, "other_min")
            o_max = model.NewIntVar(0, max_horizon_blocks, "other_max")
            for ci in other_courses:
                c_sum = sum(course_total_vars[ci])
                model.Add(o_min <= c_sum)
                model.Add(o_max >= c_sum)
            objective_terms.append(-W_BALANCE * (o_max - o_min))
    elif len(eligible_global) >= 2:
        h_min = model.NewIntVar(0, max_horizon_blocks, "horizon_min")
        h_max = model.NewIntVar(0, max_horizon_blocks, "horizon_max")
        for ci in eligible_global:
            c_sum = sum(course_total_vars[ci])
            model.Add(h_min <= c_sum)
            model.Add(h_max >= c_sum)
        objective_terms.append(-2 * W_BALANCE * (h_max - h_min))

        for w, week_slots in slots_by_week.items():
            w_eligible = sorted(
                {ci for slot in week_slots for ci in slot.eligible_courses},
                key=lambda ci: canonical_rank[ci],
            )
            if len(w_eligible) >= 2:
                w_min = model.NewIntVar(0, max(1, target), f"w_{w}_min")
                w_max = model.NewIntVar(0, max(1, target), f"w_{w}_max")
                for ci in w_eligible:
                    wc_vars = [x_vars[(slot.index, ci)] for slot in week_slots if (slot.index, ci) in x_vars]
                    wc_sum = sum(wc_vars) if wc_vars else 0
                    model.Add(w_min <= wc_sum)
                    model.Add(w_max >= wc_sum)
                objective_terms.append(-W_BALANCE * (w_max - w_min))

    # Tier 5: spread blocks across distinct days before stacking multiple blocks on one day.
    for day_key, day_slots in slots_by_day.items():
        cap = min(max_daily, len(day_slots))
        if cap >= 2:
            day_sum = sum(y_vars[slot.index] for slot in day_slots)
            extra_vars: list[cp_model.IntVar] = []
            for k in range(2, cap + 1):
                gk = model.NewBoolVar(f"day_ge_{day_key}_{k}")
                extra_vars.append(gk)
                objective_terms.append(-W_DAILY_SPREAD * gk)
            model.Add(day_sum <= 1 + sum(extra_vars))
            for idx in range(len(extra_vars) - 1):
                model.Add(extra_vars[idx] >= extra_vars[idx + 1])

    # Tier 6: deterministic chronological & canonical-course tie-breakers.
    num_courses = len(courses)
    for slot in slots:
        time_penalty = slot.day_in_week * 96 + (slot.minute // 15)
        objective_terms.append(-W_TIME * time_penalty * y_vars[slot.index])
        for ci in slot.eligible_courses:
            rank_bonus = num_courses - 1 - canonical_rank[ci]
            if rank_bonus > 0:
                objective_terms.append(W_COURSE_RANK * rank_bonus * x_vars[(slot.index, ci)])

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = workers
    solver.parameters.random_seed = seed
    solver.parameters.max_time_in_seconds = max_time_seconds

    status = solver.Solve(model)
    status_name = solver.StatusName(status)
    wall_ms = round((time.perf_counter() - wall_started) * 1000.0, 3)
    cpsat_search_ms = round(float(solver.WallTime()) * 1000.0, 3)

    is_feasible = status_name in ("OPTIMAL", "FEASIBLE")
    total_target = count * target

    if not is_feasible:
        feasibility_label = "proved_infeasible" if status_name == "INFEASIBLE" else "timeout_or_unknown"
        return {
            "plan": None,
            "solver": {
                "engine": "cp-sat",
                "ortoolsVersion": getattr(ortools, "__version__", "unknown"),
                "pythonVersion": sys.version.split()[0],
                "status": status_name,
                "targetFeasibility": feasibility_label,
                "objectiveValue": None,
                "bestObjectiveBound": None,
                "wallMs": wall_ms,
                "cpSatSearchMs": cpsat_search_ms,
                "peakRssKb": _peak_rss_kb(),
                "seed": seed,
                "workers": workers,
                "maxTimeSeconds": max_time_seconds,
                "numVariables": len(x_vars) + len(y_vars),
                "numSlots": len(slots),
                "strictTarget": strict_target,
            },
        }

    chosen: list[tuple[CandidateSlot, int]] = []
    for slot in slots:
        if solver.Value(y_vars[slot.index]) == 1:
            for ci in slot.eligible_courses:
                if solver.Value(x_vars[(slot.index, ci)]) == 1:
                    chosen.append((slot, ci))
                    break

    chosen.sort(key=lambda pair: (pair[0].start_ms, pair[0].end_ms, courses[pair[1]]["name"]))

    blocks: list[dict[str, Any]] = []
    weekly_counts = [0 for _ in range(count)]
    student_id = student.get("student")
    tz_name = student.get("timezone")

    for slot, ci in chosen:
        course = courses[ci]
        weekly_counts[slot.week] += 1
        is_near = slot.week == 0
        block_seed = f"{student_id}:{slot.start_iso}:{slot.end_iso}:{course['name']}".encode("utf-8")
        block_id = hashlib.sha256(block_seed).hexdigest()[:32]
        blocks.append(
            {
                "id": block_id,
                "summary": f"Study: {course['name']}",
                "start": {"dateTime": slot.start_iso, "timeZone": tz_name},
                "end": {"dateTime": slot.end_iso, "timeZone": tz_name},
                "status": "confirmed" if is_near else "tentative",
                "description": (
                    f"Study planning demo. "
                    f"{'Near-term study block.' if is_near else 'Tentative; review at the next checkpoint.'} "
                    f"Source: {course['source']}"
                ),
                "extendedProperties": {
                    "private": {
                        "studyDemo": "true",
                        "student": student_id,
                        "course": course["name"],
                    }
                },
            }
        )

    outlook = [
        {
            "week": w + 1,
            "targetHours": target,
            "scheduledHours": weekly_counts[w],
            "shortfall": max(0, target - weekly_counts[w]),
        }
        for w in range(count)
    ]

    near_blocks = [b for b in blocks if b["status"] == "confirmed"]
    future_blocks = [b for b in blocks if b["status"] == "tentative"]

    plan_digest_payload = json.dumps(
        {
            "student": student_id,
            "fixedToday": clock_date_str,
            "blocks": [(b["id"], b["start"]["dateTime"], b["extendedProperties"]["private"]["course"]) for b in blocks],
            "outlook": outlook,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    plan_id = hashlib.sha256(plan_digest_payload).hexdigest()[:32]

    assumptions = [
        "Study blocks are suggestions; ask before writing.",
        "Hours are goals, not evidence of actual study.",
        (
            "Study windows are stated possibilities; confirm they still suit the student."
            if windows
            else "No study availability supplied; empty calendar time is not assumed available."
        ),
    ]
    if availability_through:
        assumptions.append(f"Confirmed availability applies through {availability_through}.")
    if focus_idx is not None:
        assumptions.append(f"Course focus: {courses[focus_idx]['name']}; other courses may still receive blocks.")

    plan: dict[str, Any] = {
        "id": plan_id,
        "student": student_id,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "fixedToday": clock_date_str,
        "sources": courses,
        "assumptions": assumptions,
    }
    if allocation:
        plan["allocation"] = allocation
    plan["outlook"] = outlook
    plan["near"] = near_blocks
    plan["future"] = future_blocks
    plan["remove"] = {
        "near": [_significant(ev) for ev in replaceable if _event_boundary_ms(ev, "start") < next_week_start_ms],
        "future": [_significant(ev) for ev in replaceable if _event_boundary_ms(ev, "start") >= next_week_start_ms],
    }
    plan["baseHash"] = _digest_events(events)
    plan["status"] = {"near": "pending", "future": "pending"}

    total_scheduled = sum(weekly_counts)
    if all(w_cnt == target for w_cnt in weekly_counts):
        feasibility_label = "target_met"
    elif status_name == "OPTIMAL" and total_scheduled < total_target:
        feasibility_label = "proved_shortfall"
    else:
        feasibility_label = "unproved_shortfall"

    return {
        "plan": plan,
        "solver": {
            "engine": "cp-sat",
            "ortoolsVersion": getattr(ortools, "__version__", "unknown"),
            "pythonVersion": sys.version.split()[0],
            "status": status_name,
            "targetFeasibility": feasibility_label,
            "objectiveValue": int(round(solver.ObjectiveValue())),
            "bestObjectiveBound": int(round(solver.BestObjectiveBound())),
            "wallMs": wall_ms,
            "cpSatSearchMs": cpsat_search_ms,
            "peakRssKb": _peak_rss_kb(),
            "seed": seed,
            "workers": workers,
            "maxTimeSeconds": max_time_seconds,
            "numVariables": len(x_vars) + len(y_vars),
            "numSlots": len(slots),
            "strictTarget": strict_target,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OR-Tools CP-SAT study planner prototype.")
    parser.add_argument("--input", type=Path, help="Optional JSON input file; reads stdin when omitted.")
    parser.add_argument("--check-available", action="store_true", help="Check whether OR-Tools is importable.")
    args = parser.parse_args(argv)

    if args.check_available:
        try:
            import ortools
            print(json.dumps({"available": True, "ortoolsVersion": getattr(ortools, "__version__", "unknown")}))
            return 0
        except ImportError as exc:
            print(json.dumps({"available": False, "ortoolsVersion": None, "reason": str(exc)}))
            return 0

    raw = args.input.read_text(encoding="utf-8") if args.input else sys.stdin.read()
    payload = json.loads(raw)
    result = solve_plan(payload["student"], payload["events"], payload.get("options"))
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
