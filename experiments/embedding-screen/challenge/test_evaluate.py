import unittest
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
        self.assertEqual(result['summaries']['overall']['abstention_accuracy_on_supplied_flags'],1)
        self.assertEqual(result['summaries']['overall']['abstention_flags_supplied'],1)
    def test_reject_wrong_language_unknown_and_duplicate(self):
        for ranked in [['syllabus-new:pt-BR'],['missing:en'],['syllabus-new:en','syllabus-new:en']]:
            with self.subTest(ranked=ranked), self.assertRaises(ValueError):
                score(self.data,{'exact-deadline:en': {'ranked_ids':ranked}})

if __name__=='__main__': unittest.main()
