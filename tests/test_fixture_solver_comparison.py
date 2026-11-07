import math
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'experiments'))
import fixture_solver_comparison as fixture
from solver_comparison import Scenario,Task,cp_sat,score,validate


class FixtureComparisonTests(unittest.TestCase):
    def test_bilingual_fixture_timing_and_goals_match(self):
        for name in fixture.NAMES:
            for week in (0,1):
                with self.subTest(name=name,week=week):
                    english,e=fixture.build_fixture_scenario(name,week_index=week,language='en')
                    portuguese,p=fixture.build_fixture_scenario(name,week_index=week,language='pt-BR')
                    self.assertEqual((english.windows,english.busy,english.tasks),(portuguese.windows,portuguese.busy,portuguese.tasks))
                    self.assertEqual(e['goal_minutes'],p['goal_minutes'])
                    self.assertTrue(e['busy_count'])
                    self.assertEqual(sum(t.duration*30 for t in english.tasks),e['fixture_target_minutes'])

    def test_non_aligned_rounding_preserves_busy_time(self):
        fake={'scenario':{'timeZone':'America/Sao_Paulo','simulationStart':'2026-11-02','studyWindows':[{'days':[1],'start':'19:15','end':'20:15'}]},
              'calendar':{'events':[{'start':{'dateTime':'2026-11-03T19:42:00-03:00'},'end':{'dateTime':'2026-11-03T19:47:00-03:00'}}]}}
        windows,busy,_=fixture.intervals(fake,0)
        self.assertEqual(windows,((87,88),)) # only 19:30–20:00 fully inside window
        self.assertEqual(busy,((87,88),)) # touched slot is unavailable
        bad={'scenario':fake['scenario'],'calendar':{'events':[{'start':{'date':'2026-11-03'},'end':{'date':'2026-11-04'}}]}}
        with self.assertRaisesRegex(ValueError,'refusing to assume availability'):fixture.intervals(bad,0)
        fake['scenario']['timeZone']='America/New_York'
        with self.assertRaisesRegex(ValueError,'timezone'):fixture.intervals(fake,0)

    def test_exam_checkpoint_conflict_is_in_busy_intervals(self):
        first,_=fixture.build_fixture_scenario('employed-exam')
        second,_=fixture.build_fixture_scenario('employed-exam',week_index=1)
        self.assertNotIn((87,89),first.busy)
        self.assertIn((87,89),second.busy) # Tuesday 19:30–20:30 appointment
        for solver in (fixture.heuristic_independent,cp_sat):
            result=solver(second)
            if result['assignments'] is not None:self.assertFalse(validate(second,result['assignments']))

    def test_every_solver_output_is_independently_valid(self):
        for name in fixture.NAMES:
            for pattern in ('uniform','mixed'):
                scenario,_=fixture.build_fixture_scenario(name,pattern=pattern)
                for method in (fixture.heuristic_independent,cp_sat):
                    with self.subTest(name=name,pattern=pattern,method=method.__name__):
                        result=method(scenario)
                        if result['status']=='UNAVAILABLE':continue
                        if result['assignments'] is not None:self.assertEqual(validate(scenario,result['assignments']),[])

    def test_priority_score_is_not_scheduled_minutes(self):
        # Both choices fit alone; the cap excludes combining them. The explicit
        # priority policy prefers 60 minutes at priority 3 over 120 at priority 1.
        scenario=Scenario('priority-v-duration',((16,24),),(),(Task('long',4,24,1),Task('short',2,24,3)),4,0)
        self.assertFalse(validate(scenario,{'long':16}));self.assertFalse(validate(scenario,{'short':16}))
        self.assertGreater(score(scenario,{'short':16}),score(scenario,{'long':16}))
        solved=cp_sat(scenario)
        if solved['status']=='UNAVAILABLE':self.skipTest('OR-Tools not installed')
        self.assertEqual(solved['status'],'OPTIMAL');self.assertEqual(set(solved['assignments']),{'short'})

    def test_synthetic_packing_gap_is_visible(self):
        scenario=fixture.hard_case();heuristic=fixture.heuristic_independent(scenario);solved=cp_sat(scenario)
        if solved['status']=='UNAVAILABLE':self.skipTest('OR-Tools not installed')
        self.assertEqual(solved['status'],'OPTIMAL')
        self.assertFalse(validate(scenario,heuristic['assignments']));self.assertFalse(validate(scenario,solved['assignments']))
        self.assertGreater(score(scenario,solved['assignments']),score(scenario,heuristic['assignments']))
        self.assertLess(len(heuristic['assignments']),len(solved['assignments']))

    def test_omission_is_not_reported_as_unsatisfiable(self):
        s=Scenario('one-window',((0,2),),(),(Task('a',2,2,2),Task('b',2,2,2)),4,0)
        report=fixture.comparison(s,{},5)
        self.assertTrue(report['outcomes']['heuristic']['unscheduled'])
        cp=report['outcomes']['cp_sat']
        if cp['status']!='UNAVAILABLE':
            self.assertEqual(cp['status'],'OPTIMAL')
            self.assertEqual(len(cp['unscheduled']),1)
        self.assertNotEqual(cp['status'],'INFEASIBLE') # omission is allowed by the model

if __name__=='__main__':unittest.main()
