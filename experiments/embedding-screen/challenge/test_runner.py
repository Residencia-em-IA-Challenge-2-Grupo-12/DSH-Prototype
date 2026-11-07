import json,unittest,tempfile,subprocess,sys
from pathlib import Path
from run_models import select_rankings,document_text,formatted,MODELS
from evaluate import validate,score
HERE=Path(__file__).parent
class RunnerTests(unittest.TestCase):
 def setUp(self):self.data=json.loads((HERE/'heldout.json').read_text());validate(self.data)
 def test_language_filter_and_no_invented_abstention(self):
  # Artificially rank the opposite language higher than the correct language.
  rows=[[2 if p['language']!=q['language'] else 1 for p in self.data['passages']] for q in self.data['queries']]
  result=select_rankings(self.data,rows);docs={d['id']:d for d in self.data['passages']}
  for q in self.data['queries']:
   self.assertTrue(all(docs[i]['language']==q['language'] for i in result[q['id']]['ranked_ids']))
   self.assertNotIn('abstained',result[q['id']])
  result=score(self.data,result);self.assertEqual(result['query_coverage']['submitted'],36)
  self.assertEqual(result['summaries']['overall']['abstention_flags_supplied'],0)
 def test_source_metadata_is_supplied_to_all_models_once(self):
  d=self.data['passages'][0]; text=document_text(d); path=d['source']['path']
  for name in MODELS:
   self.assertEqual(formatted(name,text,False,'none').count(path),1)
 def test_all_missing_models_still_write_output(self):
  with tempfile.TemporaryDirectory() as folder:
   out=Path(folder)/'result.json'
   subprocess.run([sys.executable,str(HERE/'run_models.py'),'--models-dir',folder,'--output',str(out)],check=True)
   result=json.loads(out.read_text())
   self.assertEqual(len(result['models']),4)
   self.assertTrue(all(x['status']=='unavailable' for x in result['models'].values()))
 def test_invalid_score_rejected(self):
  rows=[[0]*len(self.data['passages']) for _ in self.data['queries']];rows[0][0]=float('nan')
  with self.assertRaises(ValueError):select_rankings(self.data,rows)
if __name__=='__main__':unittest.main()
