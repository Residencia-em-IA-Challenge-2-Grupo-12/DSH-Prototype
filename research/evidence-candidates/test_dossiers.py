import json
import subprocess
import shutil
import tempfile
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent

class DossierConsistency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory(prefix='evidence-dossier-test-') as directory:
            scratch = Path(directory)
            shutil.copyfile(ROOT / 'build.py', scratch / 'build.py')
            subprocess.run([sys.executable, str(scratch / 'build.py')], check=True, capture_output=True, text=True)
            generated_json = (scratch / 'candidates.json').read_text()
            generated_markdown = (scratch / 'dossiers.md').read_text()
        if generated_json != (ROOT / 'candidates.json').read_text() or generated_markdown != (ROOT / 'dossiers.md').read_text():
            raise AssertionError('Checked-in dossiers differ from the portable generator')
        cls.data = json.loads(generated_json)
        cls.markdown = generated_markdown

    def test_candidates_remain_inactive_and_require_human_review(self):
        self.assertEqual(self.data['status'], 'candidate_dossier_not_approved')
        self.assertIn('Human must approve each source', self.data['admission_policy'])
        self.assertIn('No entry is active product guidance', self.markdown)
        self.assertIn('PT-BR', self.markdown)
        self.assertEqual(len(self.data['sources']), 9)
        for source in self.data['sources']:
            self.assertIs(source['active'], False)
            self.assertEqual(source['approval_status'], 'pending_human_review')
            self.assertEqual(source['guidance_status'], 'not_approved')

    def test_identifiers_and_source_links_are_consistent(self):
        sources = self.data['sources']
        ids = [source['id'] for source in sources]
        passage_ids = [p['id'] for source in sources for p in source['passages']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(passage_ids), 10)
        self.assertEqual(len(passage_ids), len(set(passage_ids)))
        for source in sources:
            self.assertTrue(source['url'].startswith('https://'))
            self.assertIn(source['id'], self.markdown)
            for passage in source['passages']:
                self.assertIn(passage['id'], self.markdown)
                self.assertIn(passage['paraphrase'], self.markdown)

    def test_audited_claims_and_precise_source_locators(self):
        sources = {s['id']: s for s in self.data['sources']}
        ies = sources['S01-IES-2007']
        self.assertIn('public domain', ies['rights'])
        self.assertIn('printed page 21 (PDF page 32)', ies['passages'][1]['locator'])
        self.assertIn('corrective feedback', ies['passages'][1]['paraphrase'])
        baker = sources['S04-BAKER-2019']
        self.assertIn('main analytic sample contained 145', baker['population'])
        self.assertIn('all 157', baker['population'])
        self.assertIn('procrastination, cramming or the timing', baker['passages'][0]['paraphrase'])
        self.assertIn('did not measure total time engaged', baker['passages'][0]['paraphrase'])
        self.assertIn('https://ies.ed.gov/ncee/wwc/Study/89702', baker['limits'])
        activity = sources['S08-WHO-ACTIVITY-2020']
        self.assertIn('HTTP 403', activity['limits'])
        self.assertIn('verification of the cited PDF passage remains pending', activity['limits'])
        rest = sources['S09-NIOSH-SLEEP']
        self.assertNotIn('protecting', rest['passages'][0]['paraphrase'])
        self.assertIn('user-protected rest', rest['candidate'])

if __name__ == '__main__':
    unittest.main()
