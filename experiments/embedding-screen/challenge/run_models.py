#!/usr/bin/env python3
"""Offline synthetic retrieval probe. No generative inference or downloads."""
import argparse, hashlib, json, math, os, platform, resource, statistics, subprocess, sys, time
from pathlib import Path
from datetime import datetime, timezone
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from benchmark import formatted
from evaluate import validate, score
MODELS={
 'embeddinggemma-2':('google/embeddinggemma-2','f9972ac22e696a105c482202646979e33e4b5a1e'),
 'qwen3-embedding-0.6b':('Qwen/Qwen3-Embedding-0.6B','97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'),
 'bge-m3':('BAAI/bge-m3','5617a9f61b028005a4858fdac845db406aefb181'),
 'multilingual-e5-small':('intfloat/multilingual-e5-small','614241f622f53c4eeff9890bdc4f31cfecc418b3')}

def select_rankings(data, similarities):
    out={}
    for query, row in zip(data['queries'], similarities, strict=True):
        if len(row)!=len(data['passages']) or any(not math.isfinite(float(v)) for v in row): raise ValueError('Invalid scores')
        candidates=[i for i,p in enumerate(data['passages']) if p['language']==query['language']]
        order=sorted(candidates,key=lambda i:(-float(row[i]),data['passages'][i]['id']))
        # Rankings alone provide no answer, confidence threshold, or abstention.
        out[query['id']]={'ranked_ids':[data['passages'][i]['id'] for i in order]}
    return out

def manifest(path):
    files=[]
    for f in sorted(path.rglob('*')):
        if f.is_file() and '.cache' not in f.relative_to(path).parts:
            h=hashlib.sha256()
            with f.open('rb') as reader:
                for b in iter(lambda:reader.read(1024*1024),b''):h.update(b)
            files.append({'path':str(f.relative_to(path)),'bytes':f.stat().st_size,'sha256':h.hexdigest()})
    return files

def document_text(passage):
    return f"Source: {passage['source']['path']}\nUpdated: {passage['source']['updated']}\n{passage['text']}"

def work(args,data):
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',HF_HUB_DISABLE_TELEMETRY='1')
    import torch, transformers, sentence_transformers
    torch.set_num_threads(args.threads)
    kwargs={'device':'cpu','local_files_only':True,'trust_remote_code':False}
    if args.worker=='embeddinggemma-2':
        kwargs['config_kwargs']={'vision_config':None,'audio_config':None}
        kwargs['model_kwargs']={'torch_dtype':torch.float32}
    start=time.perf_counter();model=sentence_transformers.SentenceTransformer(str(args.path),**kwargs);load=time.perf_counter()-start
    # Put source and update date into the indexed text; this is synthetic metadata.
    docs=[formatted(args.worker,document_text(d),False,"none") for d in data['passages']]
    start=time.perf_counter();vectors=model.encode(docs,normalize_embeddings=True,convert_to_numpy=True,prompt='',show_progress_bar=False);doc_time=time.perf_counter()-start
    first=formatted(args.worker,data['queries'][0]['text'],True)
    model.encode([first],normalize_embeddings=True,convert_to_numpy=True,prompt='',show_progress_bar=False)
    similarities=[];latency=[]
    for q in data['queries']:
        start=time.perf_counter();v=model.encode([formatted(args.worker,q['text'],True)],normalize_embeddings=True,convert_to_numpy=True,prompt='',show_progress_bar=False)[0];latency.append(time.perf_counter()-start)
        similarities.append((vectors@v).tolist())
    ranks=select_rankings(data,similarities)
    return {'status':'ok','rankings':ranks,'evaluation':score(data,ranks),'model_load_seconds':load,'document_encode_seconds':doc_time,
        'warm_query_p50_seconds':statistics.median(latency),'warm_query_p95_seconds':sorted(latency)[math.ceil(len(latency)*.95)-1],
        'peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'versions':{'python':platform.python_version(),'torch':torch.__version__,'transformers':transformers.__version__,'sentence_transformers':sentence_transformers.__version__}}

def main():
    p=argparse.ArgumentParser();p.add_argument('--models-dir',type=Path,required=True);p.add_argument('--dataset',type=Path,default=HERE/'heldout.json');p.add_argument('--output',type=Path);p.add_argument('--memory-mib',type=int,default=4096);p.add_argument('--timeout',type=int,default=240);p.add_argument('--threads',type=int,default=1);p.add_argument('--worker',choices=MODELS,help=argparse.SUPPRESS);p.add_argument('--path',type=Path,help=argparse.SUPPRESS);a=p.parse_args()
    if a.memory_mib<256 or a.timeout<1 or a.threads<1:p.error('Invalid limits')
    raw=a.dataset.read_bytes();data=json.loads(raw);validate(data)
    if a.worker:
        print(json.dumps(work(a,data),ensure_ascii=False));return
    results={'run_metadata':{'started_at_utc':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),'cpu_count':os.cpu_count()},'dataset_sha256':hashlib.sha256(raw).hexdigest(),'dataset_status':data['status'],
      'limits':{'address_space_mib':a.memory_mib,'timeout_seconds':a.timeout,'cpu_threads':a.threads},
      'limitations':['Agent-reviewed synthetic labels; no human approval.','A ranking does not measure whether an agent abstains or answers correctly.','The 4 GiB limit is virtual address space, not a container RSS limit.','Dates and synthetic source paths are indexed identically in passage text.','Ranking is restricted to the query language; cross-language retrieval is not measured.','No model selection follows from this exploratory run.'], 'models':{}}
    for name,(repo,revision) in MODELS.items():
        path=(a.models_dir/name).resolve(); record={'repository':repo,'revision':revision};results['models'][name]=record
        if not path.is_dir():record.update(status='unavailable',reason='Snapshot missing');continue
        try:
            provenance=json.loads((path/'study-revision.json').read_text())
            if provenance.get('repository')!=repo or provenance.get('revision')!=revision:raise ValueError('Snapshot revision does not match frozen candidate')
            record['files']=manifest(path)
            env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'HOME':'/tmp','HF_HOME':'/tmp/study-hf-offline','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_IMPLICIT_TOKEN':'1','HF_HUB_DISABLE_TELEMETRY':'1','OMP_NUM_THREADS':str(a.threads),'OPENBLAS_NUM_THREADS':str(a.threads),'MKL_NUM_THREADS':str(a.threads),'TOKENIZERS_PARALLELISM':'false'}
            command=[sys.executable,str(Path(__file__).resolve()),'--models-dir',str(a.models_dir),'--dataset',str(a.dataset.resolve()),'--threads',str(a.threads),'--worker',name,'--path',str(path)]
            def limits():resource.setrlimit(resource.RLIMIT_AS,(a.memory_mib*1024*1024,)*2)
            start=time.perf_counter();cp=subprocess.run(command,env=env,text=True,capture_output=True,timeout=a.timeout,preexec_fn=limits);record['wall_seconds']=time.perf_counter()-start
            if cp.returncode:record.update(status='failed',exit_code=cp.returncode,reason=cp.stderr[-2000:])
            else:record.update(json.loads(cp.stdout))
        except subprocess.TimeoutExpired:record.update(status='timeout',reason='Per-model wall limit reached')
        except (ValueError,OSError,json.JSONDecodeError) as e:record.update(status='failed',reason=str(e))
        print(name,record['status'],file=sys.stderr,flush=True)
        if a.output:a.output.write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n')
    if a.output:a.output.write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n')
    else:print(json.dumps(results,indent=2,ensure_ascii=False))
if __name__=='__main__':main()
