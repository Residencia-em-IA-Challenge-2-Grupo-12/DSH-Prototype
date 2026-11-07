import json
import unittest
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).parent / 'generated'
IDS = ('working-college', 'nonworking-college', 'employed-exam')

def load(id, lang, file):
    return json.loads((ROOT/id/lang/file).read_text(encoding='utf8'))

def minutes(value):
    hour, minute = map(int, value.split(':'))
    return hour*60+minute

def overlap(a, b, c, d):
    return a < d and c < b

class SyntheticPersonas(unittest.TestCase):
    def test_bilingual_structural_parity_and_workspace_sources(self):
        for id in IDS:
            en, pt = (load(id, lang, 'scenario.json') for lang in ('en','pt-BR'))
            for field in ('id','schemaVersion','generatorVersion','simulationStart','timeZone','horizonWeeks','deadline','targetMinutesPerWeek','studyWindows'):
                self.assertEqual(en[field],pt[field],(id,field))
            for field in ('weeklyCommitments','exceptions'):
                clean=lambda items:[{k:v for k,v in x.items() if k!='label'} for x in items]
                self.assertEqual(clean(en[field]),clean(pt[field]),(id,field))
                self.assertTrue(all(x['label'].strip() for x in en[field]+pt[field]))
            for lang, scenario in (('en',en),('pt-BR',pt)):
                root=ROOT/id/lang
                self.assertEqual(scenario['language'],lang)
                self.assertTrue(scenario['context'].strip() and scenario['course'].strip())
                self.assertIn(scenario['deadline'], (root/'workspace/courses/syllabus.md').read_text(encoding='utf8'))
                self.assertTrue((root/'workspace/context/preferences.md').read_text(encoding='utf8').strip())
            a,b=(load(id,lang,'calendar.json') for lang in ('en','pt-BR'))
            self.assertEqual([x['id'] for x in a['events']],[x['id'] for x in b['events']])
            for ea,eb in zip(a['events'],b['events']):
                self.assertEqual({k:v for k,v in ea.items() if k!='summary'}, {k:v for k,v in eb.items() if k!='summary'})

    def test_calendar_events_are_synthetic_bounded_and_do_not_overlap(self):
        start=date(2026,11,2)
        for id in IDS:
            cal=load(id,'en','calendar.json')
            scenario=load(id,'en','scenario.json')
            self.assertTrue(cal['users'][0]['email'].endswith('.test'))
            self.assertEqual(cal['clients'],[])
            events=cal['events']
            self.assertEqual(len(events),sum(len(item['days'])*6 for item in scenario['weeklyCommitments'])+len(scenario['exceptions']))
            self.assertEqual(len(events),len({event['id'] for event in events}))
            intervals=[]
            for event in events:
                self.assertEqual(event['calendarId'], cal['calendars'][0]['id'])
                a=datetime.fromisoformat(event['start']['dateTime'])
                b=datetime.fromisoformat(event['end']['dateTime'])
                self.assertLess(a,b)
                self.assertGreaterEqual(a.date(),start)
                self.assertLess(a.date(),start+timedelta(days=42))
                intervals.append((a,b,event['id']))
            intervals.sort()
            for earlier,later in zip(intervals,intervals[1:]):
                self.assertLessEqual(earlier[1],later[0],f'{id}: {earlier[2]} overlaps {later[2]}')

    def test_windows_avoid_weekly_commitments_and_exception_conflicts_are_declared(self):
        for id in IDS:
            scenario=load(id,'en','scenario.json')
            slots=scenario['weeklyCommitments']
            for window in scenario['studyWindows']:
                a,b=minutes(window['start']),minutes(window['end'])
                self.assertLess(a,b)
                for slot in slots:
                    if set(window['days']) & set(slot['days']):
                        self.assertFalse(overlap(a,b,minutes(slot['start']),minutes(slot['end'])),f"{id}: {window['id']} overlaps {slot['id']}")
            windows=scenario['studyWindows']
            for index,first in enumerate(windows):
                for second in windows[index+1:]:
                    if set(first['days']) & set(second['days']):
                        self.assertFalse(overlap(minutes(first['start']),minutes(first['end']),minutes(second['start']),minutes(second['end'])),f"{id}: study windows overlap")
            for exc in scenario['exceptions']:
                weekday=date.fromisoformat(exc['date']).weekday()
                conflicts=[w['id'] for w in scenario['studyWindows'] if weekday in w['days'] and overlap(minutes(w['start']),minutes(w['end']),minutes(exc['start']),minutes(exc['end']))]
                self.assertEqual(bool(conflicts),exc['impactsStudyWindow'],(id,exc['id'],conflicts))
            capacity=sum(len(w['days'])*(minutes(w['end'])-minutes(w['start'])) for w in scenario['studyWindows'])
            self.assertGreaterEqual(capacity,scenario['targetMinutesPerWeek'])
            start=date.fromisoformat(scenario['simulationStart'])
            for week in range(6):
                weekly_exceptions=[item for item in scenario['exceptions'] if 0 <= (date.fromisoformat(item['date'])-start).days-week*7 < 7]
                unavailable=0
                for exc in weekly_exceptions:
                    weekday=date.fromisoformat(exc['date']).weekday()
                    for w in scenario['studyWindows']:
                        if weekday in w['days']:
                            unavailable+=max(0, min(minutes(w['end']), minutes(exc['end']))-max(minutes(w['start']), minutes(exc['start'])))
                self.assertGreaterEqual(capacity-unavailable, scenario['targetMinutesPerWeek'], (id, week))

    def test_work_class_hours_and_horizons_are_realistic_explicit_scenarios(self):
        expected={'working-college':(20,12,4),'nonworking-college':(0,24,4),'employed-exam':(40,0,6)}
        for id,(work,classes,weeks) in expected.items():
            scenario=load(id,'en','scenario.json')
            totals=defaultdict(int)
            for item in scenario['weeklyCommitments']:
                totals[item['kind']]+=len(item['days'])*(minutes(item['end'])-minutes(item['start']))
            self.assertEqual(totals['work'],work*60)
            self.assertEqual(totals['class'],classes*60)
            self.assertEqual(totals['sleep'],56*60)
            self.assertLessEqual(sum(totals.values()),7*24*60)
            self.assertEqual(scenario['horizonWeeks'],weeks)
            self.assertEqual((datetime.fromisoformat(scenario['deadline']).date()-date.fromisoformat(scenario['simulationStart'])).days,weeks*7)

if __name__ == '__main__':
    unittest.main()
