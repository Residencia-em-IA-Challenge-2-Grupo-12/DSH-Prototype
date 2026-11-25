import hashlib
import json
import sys
import unittest
from pathlib import Path

COMPARISON_DIR = Path(__file__).resolve().parent.parent
if str(COMPARISON_DIR) not in sys.path:
    sys.path.insert(0, str(COMPARISON_DIR))

import cpsat_planner  # noqa: E402

try:
    import ortools  # noqa: F401

    HAS_ORTOOLS = True
except ImportError:
    HAS_ORTOOLS = False


def make_student(**overrides):
    base = {
        "student": "test-student",
        "timezone": "America/Sao_Paulo",
        "targetHours": 4,
        "maxDailyStudyHours": 2,
        "studyBreakMinutes": 15,
        "availabilityThrough": "2026-11-15",
        "courses": [
            {
                "name": "Algorithms",
                "deadline": "2026-12-14T09:00:00-03:00",
                "source": "synthetic:Algorithms",
            },
            {
                "name": "Databases",
                "deadline": "2026-12-14T18:00:00-03:00",
                "source": "synthetic:Databases",
            },
        ],
        "studyWindows": [
            {"weekday": 1, "start": "19:00", "end": "21:15"},
            {"weekday": 3, "start": "19:00", "end": "21:15"},
            {"weekday": 6, "start": "14:00", "end": "16:15"},
        ],
    }
    base.update(overrides)
    return base


class TestCpSatValidationAndAvailability(unittest.TestCase):
    def test_input_validation_parity(self):
        student = make_student()
        with self.assertRaises(ValueError):
            cpsat_planner.solve_plan(student, [], {"weeks": 0})
        with self.assertRaises(ValueError):
            cpsat_planner.solve_plan(student, [], {"hours": 21})
        with self.assertRaises(ValueError):
            cpsat_planner.solve_plan(
                student, [], {"allocation": "course-coverage", "focusCourse": "Algorithms"}
            )
        with self.assertRaises(ValueError):
            cpsat_planner.solve_plan(student, [], {"focusCourse": "Nonexistent"})
        with self.assertRaises(ValueError):
            cpsat_planner.solve_plan(student, [], {"avoidDates": ["invalid-date"]})

    def test_unavailable_response_contract(self):
        resp = cpsat_planner._unavailable_response("simulated missing ortools")
        self.assertIsNone(resp["plan"])
        self.assertEqual(resp["solver"]["status"], "UNAVAILABLE")
        self.assertEqual(resp["solver"]["targetFeasibility"], "unavailable")


@unittest.skipUnless(HAS_ORTOOLS, "ortools is required for CP-SAT solver unit tests")
class TestCpSatSolver(unittest.TestCase):
    def test_ignores_transparent_and_cancelled_but_blocks_opaque_and_allday(self):
        student = make_student(
            targetHours=1,
            availabilityThrough="2026-11-08",
            studyWindows=[
                {"weekday": 1, "start": "19:00", "end": "20:00"},
                {"weekday": 2, "start": "19:00", "end": "20:00"},
                {"weekday": 3, "start": "19:00", "end": "20:00"},
            ],
        )
        events = [
            {
                "id": "free-mon",
                "summary": "Free",
                "transparency": "transparent",
                "start": {"dateTime": "2026-11-02T19:00:00-03:00"},
                "end": {"dateTime": "2026-11-02T20:00:00-03:00"},
            },
            {
                "id": "cancelled-mon",
                "summary": "Cancelled",
                "status": "cancelled",
                "start": {"dateTime": "2026-11-02T19:00:00-03:00"},
                "end": {"dateTime": "2026-11-02T20:00:00-03:00"},
            },
            {
                "id": "all-day-tue",
                "summary": "All Day",
                "start": {"date": "2026-11-03"},
                "end": {"date": "2026-11-04"},
            },
        ]
        # Avoid Monday so Tuesday (blocked by all-day) vs Wednesday (open) is tested.
        res = cpsat_planner.solve_plan(student, events, {"weeks": 1, "avoidDates": ["2026-11-02"]})
        self.assertEqual(res["solver"]["status"], "OPTIMAL")
        self.assertEqual(len(res["plan"]["near"]), 1)
        self.assertTrue(res["plan"]["near"][0]["start"]["dateTime"].startswith("2026-11-04T19:00:00-03:00"))

        # Without avoiding Monday, transparent/cancelled events do not block Monday 19:00.
        res_mon = cpsat_planner.solve_plan(student, events, {"weeks": 1, "avoidDates": ["2026-11-04"]})
        self.assertEqual(len(res_mon["plan"]["near"]), 1)
        self.assertTrue(res_mon["plan"]["near"][0]["start"]["dateTime"].startswith("2026-11-02T19:00:00-03:00"))

    def test_break_and_daily_cap_and_near_future_sections(self):
        student = make_student(targetHours=3, maxDailyStudyHours=2, studyBreakMinutes=15)
        res = cpsat_planner.solve_plan(student, [], {"weeks": 2})
        self.assertEqual(res["solver"]["status"], "OPTIMAL")
        self.assertEqual(res["solver"]["targetFeasibility"], "target_met")
        plan = res["plan"]
        self.assertEqual(len(plan["near"]), 3)
        self.assertEqual(len(plan["future"]), 3)
        self.assertTrue(all(b["status"] == "confirmed" for b in plan["near"]))
        self.assertTrue(all(b["status"] == "tentative" for b in plan["future"]))
        self.assertEqual(
            plan["outlook"],
            [
                {"week": 1, "targetHours": 3, "scheduledHours": 3, "shortfall": 0},
                {"week": 2, "targetHours": 3, "scheduledHours": 3, "shortfall": 0},
            ],
        )

    def test_determinism_and_course_order_invariance(self):
        courses = [
            {"name": "Banco de Dados", "deadline": "2026-12-14T18:00:00-03:00", "source": "s:bd"},
            {"name": "Algoritmos", "deadline": "2026-12-14T18:00:00-03:00", "source": "s:alg"},
        ]
        s1 = make_student(courses=courses, targetHours=5, availabilityThrough="2026-12-13")
        s2 = make_student(courses=list(reversed(courses)), targetHours=5, availabilityThrough="2026-12-13")
        r1a = cpsat_planner.solve_plan(s1, [], {"weeks": 6})
        r1b = cpsat_planner.solve_plan(s1, [], {"weeks": 6})
        r2 = cpsat_planner.solve_plan(s2, [], {"weeks": 6})

        self.assertEqual(r1a["plan"]["id"], r1b["plan"]["id"])
        self.assertEqual(r1a["plan"]["id"], r2["plan"]["id"])
        sig = lambda p: [
            (b["start"]["dateTime"], b["end"]["dateTime"], b["extendedProperties"]["private"]["course"])
            for b in p["near"] + p["future"]
        ]
        self.assertEqual(sig(r1a["plan"]), sig(r2["plan"]))

    def test_preferred_period_boundary_packing_avoids_greedy_shortfall(self):
        student = make_student(
            targetHours=2,
            maxDailyStudyHours=2,
            studyBreakMinutes=15,
            availabilityThrough="2026-11-08",
            courses=[{"name": "Calculus", "deadline": "2026-12-01T18:00:00-03:00", "source": "s:calc"}],
            studyWindows=[{"weekday": 3, "start": "11:00", "end": "13:15"}],
        )
        res = cpsat_planner.solve_plan(student, [], {"weeks": 1, "preferredPeriod": "afternoon"})
        self.assertEqual(res["solver"]["status"], "OPTIMAL")
        self.assertEqual(res["solver"]["targetFeasibility"], "target_met")
        starts = [b["start"]["dateTime"] for b in res["plan"]["near"]]
        self.assertEqual(starts, ["2026-11-04T11:00:00-03:00", "2026-11-04T12:15:00-03:00"])

    def test_strict_target_proves_infeasibility_separately_from_shortfall(self):
        student = make_student(
            targetHours=2,
            availabilityThrough="2026-11-08",
            studyWindows=[{"weekday": 3, "start": "19:00", "end": "21:15"}],
        )
        events = [
            {
                "id": "busy-wed",
                "summary": "Evening lab",
                "start": {"dateTime": "2026-11-04T18:30:00-03:00"},
                "end": {"dateTime": "2026-11-04T21:30:00-03:00"},
            }
        ]
        soft = cpsat_planner.solve_plan(student, events, {"weeks": 1, "strictTarget": False})
        self.assertEqual(soft["solver"]["status"], "OPTIMAL")
        self.assertEqual(soft["solver"]["targetFeasibility"], "proved_shortfall")
        self.assertEqual(soft["plan"]["near"], [])

        strict = cpsat_planner.solve_plan(student, events, {"weeks": 1, "strictTarget": True})
        self.assertEqual(strict["solver"]["status"], "INFEASIBLE")
        self.assertEqual(strict["solver"]["targetFeasibility"], "proved_infeasible")
        self.assertIsNone(strict["plan"])

    def test_replaceable_events_and_protected_ids(self):
        student = make_student(student="bruno", targetHours=1, availabilityThrough="2026-11-08")
        events = [
            {
                "id": "old-demo-1",
                "summary": "Study: Algorithms",
                "start": {"dateTime": "2026-11-02T19:00:00-03:00"},
                "end": {"dateTime": "2026-11-02T20:00:00-03:00"},
                "extendedProperties": {"private": {"studyDemo": "true", "student": "bruno"}},
            },
            {
                "id": "protected-demo-2",
                "summary": "Custom edited",
                "start": {"dateTime": "2026-11-04T19:00:00-03:00"},
                "end": {"dateTime": "2026-11-04T20:00:00-03:00"},
                "extendedProperties": {"private": {"studyDemo": "true", "student": "bruno"}},
            },
        ]
        res = cpsat_planner.solve_plan(student, events, {"weeks": 1, "protectedIds": ["protected-demo-2"]})
        plan = res["plan"]
        self.assertEqual([ev["id"] for ev in plan["remove"]["near"]], ["old-demo-1"])
        self.assertEqual(plan["remove"]["future"], [])
        self.assertTrue(plan["near"][0]["start"]["dateTime"].startswith("2026-11-02"))
        expected_hash = hashlib.sha256(
            json.dumps(
                sorted((cpsat_planner._significant(e) for e in events), key=lambda x: x["id"]),
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()
        self.assertEqual(plan["baseHash"], expected_hash)


if __name__ == "__main__":
    unittest.main()
