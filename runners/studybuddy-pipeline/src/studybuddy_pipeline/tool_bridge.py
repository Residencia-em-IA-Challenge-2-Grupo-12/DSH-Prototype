"""Loopback Trusted Tool Bridge client and deterministic evidence ingestion."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from .contracts import ClockInfo, ToolBridgeConfig

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
WEEKDAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
WEEKDAY_NAMES_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]


def assert_loopback_http_url(raw_url: str, label: str = "URL") -> str:
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "http" or host not in LOOPBACK_HOSTS:
        raise ValueError(f"{label} must be a loopback http:// URL")
    return raw_url


@dataclass
class EvidenceBundle:
    file_paths: list[str]
    files: dict[str, str]
    calendar_events: list[dict[str, Any]]
    planning_context: dict[str, Any]
    clock: ClockInfo
    calendar_digest: str
    busy_windows_summary: str

    def format_files_for_prompt(self) -> str:
        sections: list[str] = []
        for path in self.file_paths:
            body = self.files[path]
            if path.lower().endswith(".pdf"):
                pages = body.split("\f")
                rendered_pages = [
                    f"[Page {idx}]\n{page_text.strip()}"
                    for idx, page_text in enumerate(pages, start=1)
                    if page_text.strip()
                ]
                rendered = "\n\n".join(rendered_pages)
            else:
                rendered = body.strip()
            sections.append(f"=== FILE: {path} ===\n{rendered}")
        return "\n\n".join(sections)


def _js_weekday(d: date) -> int:
    # Python weekday: Mon=0..Sun=6 -> JS weekday: Sun=0..Sat=6
    return (d.weekday() + 1) % 7


def _event_day_and_hhmm(raw: str | dict[str, Any] | None) -> tuple[str, str] | None:
    if isinstance(raw, dict):
        raw = raw.get("dateTime") or raw.get("date")
    if not isinstance(raw, str) or len(raw) < 10:
        return None
    day_str = raw[:10]
    if len(raw) >= 16 and "T" in raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.date().isoformat(), dt.strftime("%H:%M")
        except ValueError:
            return day_str, raw[11:16]
    return day_str, "ALLDAY"


def format_calendar_digest(
    events: list[dict[str, Any]],
    clock: ClockInfo,
    horizon_days: int = 21,
) -> tuple[str, str]:
    start_day = date.fromisoformat(clock.date)
    end_day = start_day + timedelta(days=horizon_days - 1)
    by_day: dict[str, list[str]] = {}
    busy_days: list[str] = []

    for event in events:
        if event.get("status") == "cancelled" or event.get("transparency") == "transparent":
            continue
        start_parsed = _event_day_and_hhmm(event.get("start"))
        end_parsed = _event_day_and_hhmm(event.get("end"))
        if not start_parsed:
            continue
        s_day, s_hm = start_parsed
        if s_day < clock.date or s_day > end_day.isoformat():
            continue
        e_hm = end_parsed[1] if end_parsed else ""
        summary = str(event.get("summary") or "Busy")
        slot = f"{s_hm}-{e_hm} {summary}" if s_hm != "ALLDAY" else f"All-day: {summary}"
        by_day.setdefault(s_day, []).append(slot)

    lines: list[str] = []
    for offset in range(horizon_days):
        cur = start_day + timedelta(days=offset)
        iso = cur.isoformat()
        js_wd = _js_weekday(cur)
        day_label = f"{iso} ({WEEKDAY_NAMES_EN[js_wd]}/{WEEKDAY_NAMES_PT[js_wd]}, weekday={js_wd})"
        items = by_day.get(iso, [])
        if items:
            lines.append(f"- {day_label}: " + "; ".join(items))
            if offset < 14:
                busy_days.append(f"{WEEKDAY_NAMES_EN[js_wd]} {iso}: " + ", ".join(items[:4]))
        else:
            lines.append(f"- {day_label}: [no busy events]")

    summary = "; ".join(busy_days[:5]) if busy_days else "no busy events in the next 14 days"
    return "\n".join(lines), summary


@dataclass
class ToolBridgeClient:
    config: ToolBridgeConfig
    student: str
    clock: ClockInfo
    _client: httpx.AsyncClient = field(init=False, repr=False)
    tool_calls: int = 0
    tool_errors: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        assert_loopback_http_url(self.config.url, "toolBridge.url")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def call(self, method: str, args: dict[str, Any] | None = None) -> Any:
        self.tool_calls += 1
        response = await self._client.post(
            self.config.url,
            headers={
                "content-type": "application/json",
                "x-study-run-token": self.config.token,
            },
            json={"method": method, "args": args or {}},
        )
        try:
            payload = response.json()
        except Exception as exc:  # pragma: no cover - defensive
            err = f"Non-JSON toolBridge response ({response.status_code}): {exc}"
            self.tool_errors.append({"method": method, "error": err})
            raise RuntimeError(err) from exc

        if response.status_code >= 400 or not payload.get("ok"):
            err = str(payload.get("error") or f"toolBridge HTTP {response.status_code}")
            self.tool_errors.append({"method": method, "error": err})
            raise RuntimeError(f"Tool '{method}' failed ({response.status_code}): {err}")
        return payload.get("result")

    async def list_all_files(self) -> list[str]:
        discovered: list[str] = []
        queue: deque[str] = deque([""])
        visited: set[str] = set()

        while queue:
            folder = queue.popleft()
            if folder in visited:
                continue
            visited.add(folder)
            args = {"path": folder} if folder else {}
            entries = await self.call("list_synthetic_files", args)
            for entry in entries or []:
                name = str(entry.get("name") or "")
                if not name:
                    continue
                rel = f"{folder}/{name}" if folder else name
                if entry.get("type") == "directory":
                    queue.append(rel)
                else:
                    discovered.append(rel)

        return sorted(discovered)

    async def ingest_evidence(self) -> EvidenceBundle:
        planning_context = await self.call("read_planning_context", {})
        file_paths = await self.list_all_files()
        files: dict[str, str] = {}
        for path in file_paths:
            content = await self.call("read_synthetic_file", {"path": path})
            files[path] = content if isinstance(content, str) else str(content)

        calendar_payload = await self.call("list_calendar", {})
        events = list(calendar_payload.get("events") or []) if isinstance(calendar_payload, dict) else []
        digest, busy_summary = format_calendar_digest(events, self.clock)
        return EvidenceBundle(
            file_paths=file_paths,
            files=files,
            calendar_events=events,
            planning_context=planning_context if isinstance(planning_context, dict) else {},
            clock=self.clock,
            calendar_digest=digest,
            busy_windows_summary=busy_summary,
        )
