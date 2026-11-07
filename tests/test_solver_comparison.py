import importlib.util
from pathlib import Path
import sys
import unittest

path = Path(__file__).resolve().parents[1] / 'experiments' / 'solver_comparison.py'
spec = importlib.util.spec_from_file_location('solver_comparison', path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class SolverComparisonTest(unittest.TestCase):
    def test_all_heuristic_scenarios_validate_and_score(self):
        for scenario in module.scenarios():
            with self.subTest(scenario=scenario.name):
                result = module.heuristic(scenario)
                self.assertFalse(module.validate(scenario, result['assignments']))
                self.assertGreater(module.score(scenario, result['assignments']), 0)

    def test_validator_rejects_overlap_busy_deadline_and_daily_cap(self):
        scenario = module.Scenario('invalid', ((0, 12),), ((4, 6),),
              (module.Task('a', 3, 10, 1), module.Task('b', 3, 8, 2)), daily_cap=4, gap=1)
        errors = module.validate(scenario, {'a': 3, 'b': 6})
        self.assertTrue(any('existing event' in error for error in errors))
        self.assertTrue(any('past deadline' in error for error in errors))
        self.assertTrue(any('daily cap' in error for error in errors))
        self.assertTrue(any('insufficient break' in error for error in errors))

    def test_cp_sat_reports_unavailable_or_checked_solution(self):
        scenario = module.scenarios()[0]
        result = module.cp_sat(scenario)
        self.assertIn(result['status'], ('UNAVAILABLE', 'OPTIMAL', 'FEASIBLE', 'UNKNOWN'))
        if result['assignments'] is not None:
            self.assertFalse(module.validate(scenario, result['assignments']))

if __name__ == '__main__':
    unittest.main()
