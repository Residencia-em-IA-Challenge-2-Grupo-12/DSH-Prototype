import unittest
from copy import deepcopy
from generate_dataset import build
from evaluate import validate, score

class DataTest(unittest.TestCase):
    def setUp(self): self.data=build()
    def test_fixture_and_cross_language_labels(self):
        validate(self.data)
        self.assertEqual(len(self.data['passages']),36)
        self.assertEqual(len(self.data['queries']),36)
    def test_multi_evidence_recall_missing_and_coverage(self):
        result=score(self.data,{'deadline-conflict:en': {'ranked_ids':['syllabus-new:en']},
          'no-caffeine:en': {'ranked_ids':['food:en'], 'abstained':True}})
        self.assertEqual(result['query_coverage'],{'submitted':2,'total':36})
        self.assertEqual(result['summaries']['overall']['recall_at_3'],0.5)
        self.assertEqual(result['summaries']['overall']['full_evidence_set_at_3'],0)
        self.assertEqual(result['summaries']['overall']['abstention_accuracy_on_supplied_flags'],1)
        self.assertEqual(result['summaries']['overall']['abstention_flags_supplied'],1)
    def test_distinguishes_retrieval_of_unknown_partial_and_no_source(self):
        results=score(self.data,{
          'missing-feedback:en': {'ranked_ids':['feedback:en'], 'abstained':True},
          'no-caffeine:en': {'ranked_ids':[], 'abstained':True},
          'desired-activity:en': {'ranked_ids':['exercise:en'], 'abstained':False},
          'exact-deadline:en': {'ranked_ids':['syllabus-new:en'], 'abstained':False},
        })
        rows={row['id']:row for row in results['rows']}
        self.assertTrue(rows['missing-feedback:en']['abstention_correct'])
        self.assertEqual(rows['missing-feedback:en']['full_set_at_3'],True)
        self.assertTrue(rows['no-caffeine:en']['abstention_correct'])
        self.assertIsNone(rows['no-caffeine:en']['full_set_at_3'])
        self.assertIsNone(rows['desired-activity:en']['abstention_correct'])
        self.assertEqual(results['summaries']['overall']['abstention_flags_supplied'],4)
        self.assertEqual(results['summaries']['overall']['abstention_flags_scored'],3)
        self.assertEqual(results['summaries']['overall']['abstention_accuracy_on_supplied_flags'],1)
    def test_full_set_metric_requires_both_passages(self):
        results=score(self.data,{'two-contexts:en':{'ranked_ids':['class:en','ana-work:en','window:en']}})
        row=results['rows'][0]
        self.assertEqual(row['recall_at_1'],0.5)
        self.assertFalse(row['full_set_at_1'])
        self.assertEqual(row['recall_at_3'],1)
        self.assertTrue(row['full_set_at_3'])
    def test_as_of_rejects_future_passages(self):
        bad=deepcopy(self.data)
        bad['passages'][0]['source']['updated']='2026-11-10'
        with self.assertRaises(AssertionError): validate(bad)
    def test_temporal_and_language_case_contracts(self):
        by_concept={}
        for q in self.data['queries']:
            by_concept.setdefault(q['concept'],{})[q['language']]=q
            self.assertEqual(q['as_of'],'2026-11-09')
        for variants in by_concept.values():
            en,pt=variants['en'],variants['pt-BR']
            for key in ('type','as_of','expected_evidence_state'):
                self.assertEqual(en[key],pt[key])
            for key in ('relevant_ids','hard_negative_ids'):
                self.assertEqual([x.rsplit(':',1)[0] for x in en[key]], [x.rsplit(':',1)[0] for x in pt[key]])
        self.assertEqual(by_concept['hours-conflict']['en']['expected_evidence_state'],'goal-vs-capacity')
        self.assertEqual(by_concept['missing-feedback']['en']['expected_evidence_state'],'unknown-with-evidence')
        self.assertEqual(by_concept['desired-activity']['en']['expected_evidence_state'],'partial-unknown-with-evidence')
    def test_reject_wrong_language_unknown_and_duplicate(self):
        for ranked in [['syllabus-new:pt-BR'],['missing:en'],['syllabus-new:en','syllabus-new:en']]:
            with self.subTest(ranked=ranked), self.assertRaises(ValueError):
                score(self.data,{'exact-deadline:en': {'ranked_ids':ranked}})

if __name__=='__main__': unittest.main()
