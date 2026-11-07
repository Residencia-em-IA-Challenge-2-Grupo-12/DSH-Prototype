#!/usr/bin/env python3
"""Bounded synthetic scheduling spike; no external services or model calls.

Slots represent 30 minutes; each task is one indivisible study session. Both
solvers receive identical windows, existing events, deadlines, daily caps and
inter-session gap. This spike intentionally omits dependencies, timezone/DST,
multiple weeks and flexible splitting; it is not the product planner.

Run: python3 experiments/solver_comparison.py
CP-SAT is optional. Without an installed ortools, the result is UNAVAILABLE.
"""
import json
import time
from dataclasses import dataclass

SLOTS_PER_DAY = 48

@dataclass(frozen=True)
class Task:
    id: str
    duration: int
    deadline: int
    priority: int  # 1-3: illustrative only, not user-facing weights
    preferred: str = 'any'

@dataclass(frozen=True)
class Scenario:
    name: str
    windows: tuple  # half-open absolute intervals
    busy: tuple
    tasks: tuple
    daily_cap: int  # slots per day
    gap: int = 1


def overlaps(a, b):
    return a[0] < b[1] and b[0] < a[1]


def utility(task, start):
    hour_slot = start % SLOTS_PER_DAY
    preferred = task.preferred == 'any' or (task.preferred == 'morning' and hour_slot < 24) or (task.preferred == 'evening' and hour_slot >= 34)
    return task.priority * 10_000 + (200 if preferred else 0) - (start // SLOTS_PER_DAY) * 5 - hour_slot


def candidates(scenario, task):
    found = set()
    for lo, hi in scenario.windows:
        for start in range(lo, hi - task.duration + 1):
            end = start + task.duration
            if end <= task.deadline and start // SLOTS_PER_DAY == (end - 1) // SLOTS_PER_DAY and not any(overlaps((start, end), busy) for busy in scenario.busy):
                found.add(start)
    return sorted(found)


def validate(scenario, assignments):
    """Independent check of proposed assignments against original input."""
    errors = []
    by_id = {task.id: task for task in scenario.tasks}
    totals = {}
    intervals = []
    for task_id, start in assignments.items():
        task = by_id.get(task_id)
        if task is None:
            errors.append(f'unknown task {task_id}')
            continue
        if not isinstance(start, int) or isinstance(start, bool):
            errors.append(f'{task_id}: invalid start')
            continue
        end = start + task.duration
        if not any(lo <= start and end <= hi for lo, hi in scenario.windows):
            errors.append(f'{task_id}: outside window')
        if end > task.deadline:
            errors.append(f'{task_id}: past deadline')
        if start // SLOTS_PER_DAY != (end - 1) // SLOTS_PER_DAY:
            errors.append(f'{task_id}: spans days')
        if any(overlaps((start, end), busy) for busy in scenario.busy):
            errors.append(f'{task_id}: conflicts with existing event')
        day = start // SLOTS_PER_DAY
        totals[day] = totals.get(day, 0) + task.duration
        intervals.append((task_id, start, end))
    for day, total in totals.items():
        if total > scenario.daily_cap:
            errors.append(f'day {day}: daily cap exceeded')
    for index, (left_id, left_start, left_end) in enumerate(intervals):
        for right_id, right_start, right_end in intervals[index + 1:]:
            if left_start // SLOTS_PER_DAY == right_start // SLOTS_PER_DAY and not (left_end + scenario.gap <= right_start or right_end + scenario.gap <= left_start):
                errors.append(f'{left_id}, {right_id}: overlap or insufficient break')
    return errors


def score(scenario, assignments):
    lookup = {task.id: task for task in scenario.tasks}
    return sum(utility(lookup[task_id], start) for task_id, start in assignments.items())


def heuristic(scenario):
    start_time = time.perf_counter()
    choices = {task.id: candidates(scenario, task) for task in scenario.tasks}
    ordered = sorted(scenario.tasks, key=lambda task: (len(choices[task.id]), task.deadline, -task.priority, task.id))
    result = {}
    for task in ordered:
        for start in sorted(choices[task.id], key=lambda value: (-utility(task, value), value)):
            proposal = {**result, task.id: start}
            if not validate(scenario, proposal):
                result = proposal
                break
    # Bounded one-task eviction and repair; never accept a lower objective.
    for task in ordered:
        if task.id in result:
            continue
        best = result
        for removed in list(result):
            partial = {key: value for key, value in result.items() if key != removed}
            for start in choices[task.id]:
                proposal = {**partial, task.id: start}
                if not validate(scenario, proposal) and score(scenario, proposal) > score(scenario, best):
                    best = proposal
        result = best
    return {'status': 'FEASIBLE', 'assignments': result, 'duration_ms': round((time.perf_counter() - start_time) * 1000, 3)}


def cp_sat(scenario, timeout_seconds=5):
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return {'status': 'UNAVAILABLE', 'reason': 'Install OR-Tools explicitly to run CP-SAT.', 'assignments': None, 'duration_ms': None}
    started = time.perf_counter()
    model = cp_model.CpModel()
    choices = [(task, start, model.NewBoolVar(f'{task.id}:{start}')) for task in scenario.tasks for start in candidates(scenario, task)]
    for task in scenario.tasks:
        model.Add(sum(var for choice, _, var in choices if choice.id == task.id) <= 1)
    for day in range(7):
        model.Add(sum(task.duration * var for task, start, var in choices if start // SLOTS_PER_DAY == day) <= scenario.daily_cap)
    for index, (left, left_start, left_var) in enumerate(choices):
        for right, right_start, right_var in choices[index + 1:]:
            if left.id == right.id or left_start // SLOTS_PER_DAY != right_start // SLOTS_PER_DAY:
                continue
            if not (left_start + left.duration + scenario.gap <= right_start or right_start + right.duration + scenario.gap <= left_start):
                model.Add(left_var + right_var <= 1)
    model.Maximize(sum(utility(task, start) * var for task, start, var in choices))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = timeout_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)
    assignments = None if status_name not in ('OPTIMAL', 'FEASIBLE') else {task.id: start for task, start, var in choices if solver.Value(var)}
    return {'status': status_name, 'assignments': assignments, 'duration_ms': round((time.perf_counter() - started) * 1000, 3)}


def scenarios():
    def window(day, lo, hi): return (day * SLOTS_PER_DAY + lo, day * SLOTS_PER_DAY + hi)
    end = 7 * SLOTS_PER_DAY
    return (
        Scenario('working-college', (window(0, 36, 42), window(2, 36, 42), window(5, 18, 26)),
                 (window(0, 38, 40),), (Task('reading', 2, end, 3, 'evening'), Task('problem-set', 3, end, 3), Task('review', 2, 3*SLOTS_PER_DAY, 2)), 4),
        Scenario('nonworking-college', (window(0, 16, 24), window(1, 16, 24), window(3, 32, 40)),
                 (window(1, 18, 20),), (Task('assignment', 3, 2*SLOTS_PER_DAY, 3), Task('quiz', 2, end, 2, 'morning'), Task('revision', 2, end, 2)), 4),
        Scenario('employed-exam-prep', (window(1, 36, 42), window(3, 36, 42), window(6, 18, 24)),
                 (window(3, 38, 40),), (Task('practice', 3, end, 3), Task('theory', 2, end, 2, 'evening'), Task('mock', 3, end, 3)), 4),
    )


def report():
    output = {'schemaVersion': 1, 'slotMinutes': 30, 'objective': 'Sum priority*10000 + preferred-period bonus 200 - 5*day - start-slot; omission scores zero.',
              'limitations': ['Synthetic single-week indivisible tasks; no dependencies, splitting, timezone transitions, evidence or conversational workflow.', 'Score weights are illustrative test inputs, not product policy.', 'Unknown or timeout is not a proof of infeasibility.'], 'cases': []}
    for scenario in scenarios():
        solvers = {'heuristic': heuristic(scenario), 'cp_sat': cp_sat(scenario)}
        for result in solvers.values():
            assignments = result['assignments']
            result['validation_errors'] = None if assignments is None else validate(scenario, assignments)
            result['score'] = None if assignments is None else score(scenario, assignments)
            result['unscheduled'] = None if assignments is None else sorted(task.id for task in scenario.tasks if task.id not in assignments)
        output['cases'].append({'scenario': scenario.name, 'task_count': len(scenario.tasks), 'solvers': solvers})
    return output

if __name__ == '__main__':
    print(json.dumps(report(), indent=2))
