import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'experiments'))
import fixture_solver_comparison as base
import transition_sensitivity as sensitivity
from solver_comparison import candidates, validate


class TransitionSensitivityTests(unittest.TestCase):
    def test_zero_buffer_matches_existing_cases_and_larger_buffer_narrows_candidates(self):
        for name in base.NAMES:
            original,_ = base.build_fixture_scenario(name)
            zero,_ = sensitivity.buffered_scenario(name,0)
            padded,metadata = sensitivity.buffered_scenario(name,30)
            self.assertEqual(original.busy,zero.busy)
            self.assertEqual(metadata['assumed_symmetric_event_buffer_minutes'],30)
            for task in original.tasks:
                self.assertLessEqual(set(candidates(padded,task)),set(candidates(original,task)))
            for solver in (base.heuristic_independent,base.cp_sat):
                output=solver(padded)
                if output['assignments'] is not None:
                    self.assertEqual(validate(padded,output['assignments']),[])

    def test_external_week_boundary_and_transparent_events(self):
        fixture={'scenario':{'timeZone':'America/Sao_Paulo','simulationStart':'2026-11-02','studyWindows':[]},
                 'calendar':{'events':[
                     {'start':{'dateTime':'2026-11-01T23:15:00-03:00'},'end':{'dateTime':'2026-11-01T23:45:00-03:00'}},
                     {'start':{'dateTime':'2026-11-02T01:00:00-03:00'},'end':{'dateTime':'2026-11-02T02:00:00-03:00'},'transparency':'transparent'},
                     {'start':{'dateTime':'2026-11-09T00:15:00-03:00'},'end':{'dateTime':'2026-11-09T00:45:00-03:00'}},
                     {'start':{'dateTime':'2026-11-02T03:00:00-03:00'},'end':{'dateTime':'2026-11-02T04:00:00-03:00'},'status':'cancelled'}]}}
        self.assertEqual(sensitivity.padded_busy(fixture,0,0),())
        self.assertEqual(sensitivity.padded_busy(fixture,0,30),((0,1),(335,336)))
        with self.assertRaises(ValueError): sensitivity.padded_busy(fixture,0,15)

    def test_buffered_assignments_respect_original_event_times(self):
        # Check against raw fixture timestamps, independently of padded slot generation.
        for name in base.NAMES:
            fixture=base.load_fixture(name)
            _,_,monday=base.intervals(fixture,0)
            scenario,_=sensitivity.buffered_scenario(name,30)
            tasks={task.id:task for task in scenario.tasks}
            for solver in (base.heuristic_independent,base.cp_sat):
                assignments=solver(scenario)['assignments']
                if assignments is None: continue
                for task_id,start in assignments.items():
                    begin=monday+timedelta(minutes=30*start)
                    end=begin+timedelta(minutes=30*tasks[task_id].duration)
                    for event in fixture['calendar']['events']:
                        if event.get('status')=='cancelled' or event.get('transparency')=='transparent': continue
                        event_start=datetime.fromisoformat(event['start']['dateTime'])-timedelta(minutes=30)
                        event_end=datetime.fromisoformat(event['end']['dateTime'])+timedelta(minutes=30)
                        self.assertTrue(end<=event_start or event_end<=begin,(name,task_id,event))

    def test_bilingual_timing_parity_for_buffered_cases(self):
        for name in base.NAMES:
            en,_=sensitivity.buffered_scenario(name,30,language='en')
            pt,_=sensitivity.buffered_scenario(name,30,language='pt-BR')
            self.assertEqual((en.windows,en.busy,en.tasks),(pt.windows,pt.busy,pt.tasks))


if __name__=='__main__': unittest.main()
