#!/usr/bin/env python3
"""Bounded single-week solver experiment over versioned fictional personas.

This is not a user planner: each weekly goal is broken into invented 30/60/90-minute
indivisible tasks, using illustrative daily caps/gaps and a uniform priority.
Calendar intervals are conservatively rounded outward, study windows inward.
See the adjacent README for limitations and how to interpret solver statuses.
"""
import argparse
import hashlib
import json
import math
import platform
import sys
import time
from datetime import datetime, timedelta, timezone
from importlib import metadata as import_metadata
from pathlib import Path
from zoneinfo import ZoneInfo
from solver_comparison import SLOTS_PER_DAY, Scenario, Task, candidates, cp_sat, score, validate

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
PERSONAS=ROOT/'fixtures'/'personas-v1'/'generated'
NAMES=('working-college','nonworking-college','employed-exam')
SLOT_SECONDS=1800


def source_file(path):
    data=path.read_bytes()
    return json.loads(data),hashlib.sha256(data).hexdigest()


def minute_value(value):
    parts=value.split(':')
    if len(parts)!=2:raise ValueError('Invalid fixture time')
    hour,minute=map(int,parts)
    if not (0<=hour<=24 and 0<=minute<60 and (hour<24 or minute==0)):raise ValueError('Invalid fixture time')
    return 60*hour+minute


def intervals(fixture, week_index):
    """Select busy events from the selected week without assuming missing time is free."""
    if fixture['scenario']['timeZone']!='America/Sao_Paulo':raise ValueError('Only the fixed synthetic Sao Paulo timezone is supported')
    tz=ZoneInfo(fixture['scenario']['timeZone'])
    monday=datetime.fromisoformat(fixture['scenario']['simulationStart']).replace(tzinfo=tz)+timedelta(weeks=week_index)
    if monday.weekday()!=0:raise ValueError('Simulation start must be a Monday')
    week_end=monday+timedelta(days=7)
    if any((monday+timedelta(days=d)).utcoffset()!=timedelta(hours=-3) for d in range(8)):raise ValueError('Timezone transitions are unsupported')
    windows=[]
    for window in fixture['scenario']['studyWindows']:
        start,end=minute_value(window['start']),minute_value(window['end'])
        if end<=start:raise ValueError('Invalid study window')
        lo,hi=math.ceil(start/30),math.floor(end/30)
        if hi<=lo:continue
        for day in window['days']:
            if not isinstance(day,int) or isinstance(day,bool) or not 0<=day<7:raise ValueError('Invalid window day')
            windows.append((day*SLOTS_PER_DAY+lo,day*SLOTS_PER_DAY+hi))
    busy=[]
    for event in fixture['calendar']['events']:
        if event.get('status')=='cancelled' or event.get('transparency')=='transparent':continue
        try:
            begin=datetime.fromisoformat(event['start']['dateTime']); end=datetime.fromisoformat(event['end']['dateTime'])
        except (KeyError,TypeError,ValueError) as error:
            raise ValueError('Unsupported event time; refusing to assume availability') from error
        if begin.tzinfo is None or end.tzinfo is None or end<=begin:raise ValueError('Invalid event time')
        if end<=monday or begin>=week_end:continue
        lo=max(0,math.floor((begin-monday).total_seconds()/SLOT_SECONDS))
        hi=min(7*SLOTS_PER_DAY,math.ceil((end-monday).total_seconds()/SLOT_SECONDS))
        if hi>lo:busy.append((lo,hi))
    return tuple(sorted(windows)),tuple(sorted(busy)),monday


def load_fixture(name,language='en'):
    if name not in NAMES or language not in ('en','pt-BR'):raise ValueError('Unknown persona')
    folder=PERSONAS/name/language
    scenario,scenario_hash=source_file(folder/'scenario.json')
    calendar,calendar_hash=source_file(folder/'calendar.json')
    if scenario.get('id')!=name or scenario.get('language')!=language:raise ValueError('Fixture identity mismatch')
    return {'scenario':scenario,'calendar':calendar,'hashes':{'scenario_sha256':scenario_hash,'calendar_sha256':calendar_hash}}


def build_fixture_scenario(name,week_index=0,multiplier=1,language='en',pattern='uniform'):
    if week_index not in (0,1) or multiplier not in (1,2) or pattern not in ('uniform','mixed'):raise ValueError('Unsupported comparison scenario')
    fixture=load_fixture(name,language);data=fixture['scenario']
    windows,busy,monday=intervals(fixture,week_index)
    if data['targetMinutesPerWeek']%60:raise ValueError('Goal must split into one-hour tasks')
    goal_slots=(data['targetMinutesPerWeek']//30)*multiplier
    actual_deadline=datetime.fromisoformat(data['deadline'])
    if actual_deadline.tzinfo is None:raise ValueError('Deadline requires timezone')
    deadline=max(0,min(7*SLOTS_PER_DAY,math.floor((actual_deadline-monday).total_seconds()/SLOT_SECONDS)))
    durations=[];remaining=goal_slots;pattern_slots=(2,) if pattern=='uniform' else (3,1,2)
    while remaining:
        duration=min(remaining,pattern_slots[len(durations)%len(pattern_slots)])
        durations.append(duration);remaining-=duration
    tasks=tuple(Task(f'illustrative-{i+1}',duration,deadline,2,'any') for i,duration in enumerate(durations))
    case=Scenario(f'{name}-week{week_index+1}-goal{multiplier}x-{pattern}',windows,busy,tasks,daily_cap=4,gap=1)
    return case,{'scenario':name,'language':language,'week':week_index+1,'goal_minutes':goal_slots*30,'fixture_target_minutes':data['targetMinutesPerWeek'],'task_durations_minutes':[duration*30 for duration in durations],'window_count':len(windows),'busy_count':len(busy),'assumed_daily_cap_minutes':120,'assumed_break_minutes':30,'hashes':fixture['hashes']}


def incremental_feasible(scenario,task,start,placed):
    """Incremental heuristic check; independent of post-solve validator."""
    if start not in candidates(scenario,task):return False
    lookup={item.id:item for item in scenario.tasks}
    day=start//SLOTS_PER_DAY
    daily=task.duration
    for key,old_start in placed.items():
        old=lookup[key]
        if old_start//SLOTS_PER_DAY!=day:continue
        daily+=old.duration
        if not (start+task.duration+scenario.gap<=old_start or old_start+old.duration+scenario.gap<=start):return False
    return daily<=scenario.daily_cap


def heuristic_independent(scenario):
    """Same greedy + one-eviction strategy; feasibility is not checked by validator."""
    from solver_comparison import utility
    began=time.perf_counter()
    choices={t.id:candidates(scenario,t) for t in scenario.tasks}
    order=sorted(scenario.tasks,key=lambda t:(len(choices[t.id]),t.deadline,-t.priority,t.id))
    placed={}
    for task in order:
        for start in sorted(choices[task.id],key=lambda p:(-utility(task,p),p)):
            if incremental_feasible(scenario,task,start,placed):placed[task.id]=start;break
    for task in order:
        if task.id in placed:continue
        best=placed
        for removed in list(placed):
            partial={k:v for k,v in placed.items() if k!=removed}
            for start in choices[task.id]:
                proposal={**partial,task.id:start}
                if incremental_feasible(scenario,task,start,partial) and score(scenario,proposal)>score(scenario,best):best=proposal
        placed=best
    return {'status':'FEASIBLE','assignments':placed,'duration_ms':round((time.perf_counter()-began)*1000,3)}


def hard_case():
    return Scenario('adversarial-mixed-priority',((16,24),(64,72),(112,120)),((20,21),(65,66),(113,114)),
        (Task('A',1,120,3,'morning'),Task('B',4,24,2,'evening'),Task('C',2,24,2,'evening'),Task('D',1,72,3,'evening'),Task('E',2,24,2,'morning')),4,1)


def comparison(scenario,metadata,timeout_seconds):
    outcomes={'heuristic':heuristic_independent(scenario),'cp_sat':cp_sat(scenario,timeout_seconds)}
    for outcome in outcomes.values():
        assignments=outcome['assignments']
        if assignments is None:
            outcome.update(validation_errors=None,score=None,scheduled_minutes=None,unscheduled=None)
        else:
            errors=validate(scenario,assignments)
            lookup={t.id:t for t in scenario.tasks}
            outcome.update(validation_errors=errors,score=score(scenario,assignments),scheduled_minutes=sum(lookup[k].duration*30 for k in assignments),unscheduled=sorted(t.id for t in scenario.tasks if t.id not in assignments))
    return {'scenario':scenario.name,'task_count':len(scenario.tasks),'metadata':metadata,'outcomes':outcomes}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--timeout',type=float,default=5);args=parser.parse_args()
    if not math.isfinite(args.timeout) or not 0<args.timeout<=30:parser.error('Timeout must be in (0,30] seconds')
    cases=[]
    for name in NAMES:
        for multiplier in (1,2):
            s,m=build_fixture_scenario(name,multiplier=multiplier);cases.append(comparison(s,m,args.timeout))
    for name in NAMES:
        s,m=build_fixture_scenario(name,pattern='mixed');cases.append(comparison(s,m,args.timeout))
    s,m=build_fixture_scenario('employed-exam',week_index=1);cases.append(comparison(s,m,args.timeout))
    cases.append(comparison(hard_case(),{'fixture':'independently constructed adversarial example; not a student schedule'},args.timeout))
    try: ortools_version=import_metadata.version('ortools')
    except import_metadata.PackageNotFoundError: ortools_version=None
    cpu='unknown'
    try:
        cpu=next(line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name'))
    except (OSError,StopIteration):pass
    execution={'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'python':platform.python_version(),'ortools':ortools_version,'architecture':platform.machine(),'cpu':cpu,'solver_threads':1,'solver_search_timeout_seconds':args.timeout,'comparison_source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'shared_solver_sha256':hashlib.sha256((HERE/'solver_comparison.py').read_bytes()).hexdigest()}
    print(json.dumps({'schemaVersion':1,'execution':execution,'slotMinutes':30,'limitations':['One week only; 30/60/90-minute task decompositions are illustrative, not from syllabi.','Thirty-minute slots and gap, and a two-hour daily cap are assumptions of this experiment, not user policy.','All tasks optional: OPTIMAL maximizes the illustrative utility; it does not prove all tasks can be scheduled or that any omitted goal is universally infeasible.','CP-SAT search timeout does not bound Python model construction or total wall time.','No dependencies, splitting, learning effectiveness or user outcomes are modeled.'],'cases':cases},indent=2))
if __name__=='__main__':main()
