#!/usr/bin/env python3
"""Compare an illustrative transition buffer using the same fictional cases.

This does not infer how much time any person needs between commitments. All
opaque, non-cancelled events receive the same symmetric test buffer; events
just outside the week are included when their buffer crosses the boundary.
"""
import argparse
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import platform
from importlib import metadata as import_metadata
from pathlib import Path

import fixture_solver_comparison as base


def padded_busy(fixture, week_index, buffer_minutes):
    if buffer_minutes not in (0, 30):
        raise ValueError('This experiment supports zero or 30 minutes')
    # The base adapter checks the timezone, week and event formats. Its returned
    # week origin has the fixed offset used by the synthetic fixture.
    _, _, monday = base.intervals(fixture, week_index)
    end = monday + timedelta(days=7)
    padding = timedelta(minutes=buffer_minutes)
    intervals = []
    for event in fixture['calendar']['events']:
        if event.get('status') == 'cancelled' or event.get('transparency') == 'transparent':
            continue
        begin = datetime.fromisoformat(event['start']['dateTime']) - padding
        finish = datetime.fromisoformat(event['end']['dateTime']) + padding
        if finish <= monday or begin >= end:
            continue
        lo = max(0, math.floor((begin-monday).total_seconds()/base.SLOT_SECONDS))
        hi = min(7*base.SLOTS_PER_DAY, math.ceil((finish-monday).total_seconds()/base.SLOT_SECONDS))
        if hi > lo:
            intervals.append((lo, hi))
    return tuple(sorted(intervals))


def buffered_scenario(name, buffer_minutes, week_index=0, pattern='uniform', language='en'):
    scenario, metadata = base.build_fixture_scenario(name, week_index=week_index, pattern=pattern, language=language)
    fixture = base.load_fixture(name, language)
    busy = padded_busy(fixture, week_index, buffer_minutes)
    constrained = replace(scenario, busy=busy)
    metadata = {**metadata, 'candidate_task_start_pairs': sum(len(base.candidates(constrained, task)) for task in constrained.tasks),
                'assumed_symmetric_event_buffer_minutes': buffer_minutes,
                'buffer_policy': 'all opaque non-cancelled events, including events just outside the week'}
    return replace(scenario, name=f'{scenario.name}-event-buffer-{buffer_minutes}m', busy=busy), metadata


def run(timeout):
    if not math.isfinite(timeout) or not 0 < timeout <= 30:
        raise ValueError('Timeout must be in (0,30] seconds')
    cases = []
    for name in base.NAMES:
        for buffer_minutes in (0, 30):
            scenario, metadata = buffered_scenario(name, buffer_minutes)
            cases.append(base.comparison(scenario, metadata, timeout))
    try:
        ortools_version = import_metadata.version('ortools')
    except import_metadata.PackageNotFoundError:
        ortools_version = None
    return {'schemaVersion': 1, 'slotMinutes': 30,
            'execution': {'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
                          'python': platform.python_version(), 'ortools': ortools_version,
                          'architecture': platform.machine(), 'solver_threads': 1},
            'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'shared_comparison_sha256': hashlib.sha256(Path(base.__file__).read_bytes()).hexdigest(),
            'solver_sha256': hashlib.sha256((Path(base.__file__).parent/'solver_comparison.py').read_bytes()).hexdigest(),
            'solver_search_timeout_seconds': timeout,
            'limitations': ['The uniform symmetric buffer is a sensitivity assumption, not a personal recommendation.',
                            'This is a single-week discretized model with illustrative optional study tasks, daily cap, and inter-study break.',
                            'Objective score is not scheduled minutes; a different assignment or timeout can affect reported minutes.',
                            'The buffer is conservatively rounded outward and applied to all opaque events, including protected time and travel.',
                            'Solver search timeout does not bound model construction or total runtime.'],
            'cases': cases}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--timeout', type=float, default=5)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.timeout), indent=2))
    except ValueError as error:
        parser.error(str(error))
