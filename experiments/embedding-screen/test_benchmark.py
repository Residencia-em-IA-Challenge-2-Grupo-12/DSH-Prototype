import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('benchmark',ROOT/'benchmark.py')
bench=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

class BenchmarkTest(unittest.TestCase):
    def test_model_specific_formatting(self):
        self.assertEqual(bench.formatted('embeddinggemma-2','hello',True),'task: search result | query: hello')
        self.assertEqual(bench.formatted('embeddinggemma-2','text',False,'Syllabus'),'title: Syllabus | text: text')
        self.assertIn('\nQuery:olá',bench.formatted('qwen3-embedding-0.6b','olá',True))
        self.assertEqual(bench.formatted('qwen3-embedding-0.6b','text',False),'text')
        self.assertEqual(bench.formatted('multilingual-e5-small','olá',True),'query: olá')
        self.assertEqual(bench.formatted('multilingual-e5-small','texto',False),'passage: texto')
        self.assertEqual(bench.formatted('bge-m3','text',True),'text')

    def test_corpus_and_ranking_math(self):
        corpus=json.loads((ROOT/'corpus.json').read_text())
        bench.validate_corpus(corpus)
        self.assertEqual({q['language'] for q in corpus['queries']},{'en','pt-BR'})
        tiny={'queries':[{'id':'q','language':'en','relevant':['a','b']}]}
        scores=bench.score(tiny,[['x','a','b']])
        self.assertEqual(scores['hit_at_1'],0)
        self.assertEqual(scores['mean_reciprocal_rank'],.5)
        self.assertEqual(scores['recall_at_3'],1)

    def test_absent_models_are_reported_without_loading_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            run=subprocess.run([sys.executable,str(ROOT/'benchmark.py'),'--models-dir',directory],text=True,capture_output=True,check=True)
        result=json.loads(run.stdout)
        self.assertEqual(set(result['models']),set(bench.MODELS))
        self.assertTrue(all(item['status']=='unavailable' for item in result['models'].values()))
        self.assertIn('not evidence',result['limitations'])

if __name__=='__main__': unittest.main()
