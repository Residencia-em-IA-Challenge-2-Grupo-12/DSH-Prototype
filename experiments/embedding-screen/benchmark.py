#!/usr/bin/env python3
"""Local-only embedding smoke screen; no automatic model or dependency downloads."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
MODELS = {
    'embeddinggemma-2': 'google/embeddinggemma-2',
    'qwen3-embedding-0.6b': 'Qwen/Qwen3-Embedding-0.6B',
    'bge-m3': 'BAAI/bge-m3',
    'multilingual-e5-small': 'intfloat/multilingual-e5-small',
}
TASK = 'Given a search query, retrieve relevant passages that answer the query'

def formatted(model, text, query, title='none'):
    if model == 'embeddinggemma-2':
        return f'task: search result | query: {text}' if query else f'title: {title} | text: {text}'
    if model == 'qwen3-embedding-0.6b':
        return f'Instruct: {TASK}\nQuery:{text}' if query else text
    if model == 'multilingual-e5-small':
        return ('query: ' if query else 'passage: ') + text
    if model == 'bge-m3':
        return text
    raise ValueError('Unknown model')

def validate_corpus(corpus):
    documents, queries = corpus['documents'], corpus['queries']
    ids = [d['id'] for d in documents]
    if not documents or not queries or len(ids) != len(set(ids)):
        raise ValueError('Corpus must have documents, queries and unique document IDs')
    if any(not q.get('relevant') or not set(q['relevant']).issubset(ids) for q in queries):
        raise ValueError('Each query needs known relevant document IDs')
    if len({q['id'] for q in queries}) != len(queries):
        raise ValueError('Query IDs must be unique')

def score(corpus, ranked):
    details=[]
    for query, ids in zip(corpus['queries'], ranked, strict=True):
        relevant=set(query['relevant'])
        first=next((i for i, doc in enumerate(ids, 1) if doc in relevant), None)
        details.append({'query_id':query['id'], 'language':query['language'],
                        'top3':ids[:3], 'first_relevant_rank':first,
                        'recall_at_3':len(relevant.intersection(ids[:3]))/len(relevant)})
    return {'hit_at_1':sum(d['first_relevant_rank']==1 for d in details)/len(details),
            'mean_reciprocal_rank':sum(1/d['first_relevant_rank'] if d['first_relevant_rank'] else 0 for d in details)/len(details),
            'recall_at_3':sum(d['recall_at_3'] for d in details)/len(details), 'queries':details}

def digest_directory(path):
    manifest=[]
    for file in sorted(path.rglob('*')):
        if file.is_file():
            digest=hashlib.sha256()
            with file.open('rb') as source:
                for chunk in iter(lambda:source.read(1024*1024), b''): digest.update(chunk)
            manifest.append({'path':str(file.relative_to(path)), 'bytes':file.stat().st_size, 'sha256':digest.hexdigest()})
    return manifest

def worker(args):
    # Offline flags and local_files_only prevent supported HF download paths;
    # OS network isolation still belongs to the caller's sandbox.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', HF_HUB_DISABLE_IMPLICIT_TOKEN='1')
    import torch
    import sentence_transformers
    import transformers
    torch.set_num_threads(args.threads)
    corpus=json.loads(Path(args.corpus).read_text(encoding='utf-8'))
    validate_corpus(corpus)
    start=time.perf_counter()
    kwargs={'device':'cpu', 'local_files_only':True, 'trust_remote_code':False}
    if args.worker_model == 'embeddinggemma-2':
        kwargs['config_kwargs']={'vision_config':None,'audio_config':None}
        kwargs['model_kwargs']={'torch_dtype':torch.float32}
    model=sentence_transformers.SentenceTransformer(args.worker_path,**kwargs)
    loaded=time.perf_counter()-start
    docs=[formatted(args.worker_model,d['text'],False,d.get('title','none')) for d in corpus['documents']]
    docs_start=time.perf_counter()
    doc_vectors=model.encode(docs, normalize_embeddings=True, convert_to_numpy=True, prompt='', show_progress_bar=False)
    document_seconds=time.perf_counter()-docs_start
    # Warm the query path before timing individual query encodes.
    first=formatted(args.worker_model,corpus['queries'][0]['text'],True)
    model.encode([first], normalize_embeddings=True, convert_to_numpy=True, prompt='', show_progress_bar=False)
    ranked=[]; latency=[]
    for query in corpus['queries']:
        start=time.perf_counter()
        vector=model.encode([formatted(args.worker_model,query['text'],True)], normalize_embeddings=True, convert_to_numpy=True, prompt='', show_progress_bar=False)[0]
        latency.append(time.perf_counter()-start)
        similarities=doc_vectors @ vector
        if len(similarities)!=len(corpus['documents']) or any(not math.isfinite(float(value)) for value in similarities):
            raise ValueError('Model produced invalid similarity values')
        order=sorted(range(len(similarities)),key=lambda i:(-float(similarities[i]), corpus['documents'][i]['id']))
        ranked.append([corpus['documents'][i]['id'] for i in order])
    p95=sorted(latency)[math.ceil(len(latency)*.95)-1]
    return {'status':'ok', 'metrics':score(corpus,ranked), 'model_load_seconds':loaded,
            'document_encode_seconds':document_seconds, 'warm_query_seconds_p50':statistics.median(latency),
            'warm_query_seconds_p95':p95, 'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'versions':{'python':sys.version.split()[0], 'torch':torch.__version__,
                        'transformers':transformers.__version__, 'sentence_transformers':sentence_transformers.__version__}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir',type=Path,default=ROOT/'models')
    parser.add_argument('--corpus',type=Path,default=ROOT/'corpus.json')
    parser.add_argument('--memory-mib',type=int,default=4096,help='Per-model address-space limit in MiB')
    parser.add_argument('--timeout-seconds',type=int,default=240)
    parser.add_argument('--threads',type=int,default=1)
    parser.add_argument('--worker-model',choices=MODELS,help=argparse.SUPPRESS)
    parser.add_argument('--worker-path',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.memory_mib<256 or args.timeout_seconds<1 or args.threads<1: parser.error('Invalid resource limit')
    if args.worker_model:
        print(json.dumps(worker(args),ensure_ascii=False)); return
    corpus_bytes=args.corpus.read_bytes(); corpus=json.loads(corpus_bytes); validate_corpus(corpus)
    output={'corpus_version':corpus['version'],'corpus_sha256':hashlib.sha256(corpus_bytes).hexdigest(),
            'limitations':corpus['status'], 'limits':{'address_space_mib':args.memory_mib,'wall_seconds':args.timeout_seconds,'cpu_threads':args.threads},'models':{}}
    for key,source in MODELS.items():
        path=(args.models_dir/key).resolve()
        result={'source':source,'local_directory':str(path)}
        if not path.is_dir() or not (path/'config.json').is_file():
            result.update(status='unavailable',reason='Local model directory or config.json missing')
        else:
            result['files']=digest_directory(path)
            command=[sys.executable,str(Path(__file__).resolve()),'--worker-model',key,'--worker-path',str(path),
                     '--corpus',str(args.corpus.resolve()),'--threads',str(args.threads)]
            env=os.environ.copy()
            env.update(OMP_NUM_THREADS=str(args.threads),MKL_NUM_THREADS=str(args.threads),OPENBLAS_NUM_THREADS=str(args.threads),
                       HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',TOKENIZERS_PARALLELISM='false')
            def limits(): resource.setrlimit(resource.RLIMIT_AS,(args.memory_mib*1024*1024,)*2)
            try:
                completed=subprocess.run(command,env=env,capture_output=True,text=True,timeout=args.timeout_seconds,preexec_fn=limits)
                if completed.returncode: result.update(status='failed',reason=completed.stderr[-3000:],exit_code=completed.returncode)
                else: result.update(json.loads(completed.stdout))
            except subprocess.TimeoutExpired: result.update(status='timeout',reason='Per-model wall-time limit exceeded')
            except (ValueError,OSError) as exc: result.update(status='failed',reason=str(exc))
        output['models'][key]=result
    print(json.dumps(output,indent=2,ensure_ascii=False))

if __name__=='__main__': main()
