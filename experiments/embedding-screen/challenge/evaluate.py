#!/usr/bin/env python3
"""Score supplied rankings against synthetic labels; never runs a model."""
import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent

def validate(data):
    assert data['status'] == 'synthetic-unreviewed-not-real-evidence'
    docs, queries = data['passages'], data['queries']
    assert len(docs) >= 30 and len(queries) >= 30
    by_id = {d['id']: d for d in docs}
    assert len(by_id) == len(docs) and len({q['id'] for q in queries}) == len(queries)
    assert {'exact','paraphrase','conflict','inapplicable','no-answer','multihop'} <= {q['type'] for q in queries}
    assert any(d['source']['kind']=='simulated_pdf_extraction' and d['source']['page'] for d in docs)
    for doc in docs:
        assert doc['text'] and doc['language'] in ('en','pt-BR') and doc['source']['path'].startswith('synthetic/')
    for query in queries:
        relevant, negatives = set(query['relevant_ids']), set(query['hard_negative_ids'])
        assert not relevant & negatives
        assert all(identifier in by_id and by_id[identifier]['language'] == query['language'] for identifier in relevant | negatives)
        assert bool(relevant) != (query['type'] == 'no-answer')
        as_of = date.fromisoformat(query['as_of'])
        # This static held-out corpus shares one as-of date; prevent future
        # information from entering any ranking, not just the labelled hits.
        assert all(date.fromisoformat(doc['source']['updated']) <= as_of for doc in docs)
    for kind in ('passages','queries'):
        groups=defaultdict(set)
        for item in data[kind]: groups[item['concept']].add(item['language'])
        assert all(langs=={'en','pt-BR'} for langs in groups.values())
    return by_id

def score(data, responses):
    docs = validate(data)
    q_by_id = {q['id']: q for q in data['queries']}
    unknown = set(responses)-set(q_by_id)
    if unknown: raise ValueError('unknown query IDs: '+', '.join(sorted(unknown)))
    rows=[]
    for qid, item in responses.items():
        q=q_by_id[qid]
        ranked=item['ranked_ids']
        if len(ranked)!=len(set(ranked)): raise ValueError(f'{qid}: duplicate result')
        if any(id not in docs or docs[id]['language'] != q['language'] for id in ranked):
            raise ValueError(f'{qid}: unknown or wrong-language result')
        abstain=item.get('abstained')
        if abstain is not None and not isinstance(abstain,bool): raise ValueError(f'{qid}: abstained must be boolean or null')
        relevant=set(q['relevant_ids'])
        rank=next((i for i,id in enumerate(ranked,1) if id in relevant),None)
        state=q['expected_evidence_state']
        # The boolean means declining to assert the requested fact, not whether
        # evidence was retrieved. Partial answers cannot be scored by a boolean.
        expected_abstention = None if state == 'partial-unknown-with-evidence' else state in ('no-source','unknown-with-evidence')
        rows.append({'id':qid,'language':q['language'],'type':q['type'],
          'recall_at_1':len(relevant.intersection(ranked[:1]))/len(relevant) if relevant else None,
          'recall_at_3':len(relevant.intersection(ranked[:3]))/len(relevant) if relevant else None,
          'full_set_at_1':relevant.issubset(ranked[:1]) if relevant else None,
          'full_set_at_3':relevant.issubset(ranked[:3]) if relevant else None,
          'reciprocal_rank':(1/rank if rank else 0) if relevant else None,
          'hard_negative_at_3':bool(set(q['hard_negative_ids']).intersection(ranked[:3])),
          'expected_evidence_state':state,
          'abstention_supplied':abstain is not None,
          'abstention_correct':(abstain == expected_abstention) if abstain is not None and expected_abstention is not None else None})
    def mean(field, subset):
        values=[r[field] for r in subset if r[field] is not None]
        return round(sum(values)/len(values),4) if values else None
    summaries={}
    for name,subset in [('overall',rows)]+[(language,[r for r in rows if r['language']==language]) for language in ('en','pt-BR')]:
        summaries[name]={'submitted':len(subset),'recall_at_1':mean('recall_at_1',subset),
          'recall_at_3':mean('recall_at_3',subset),'mrr':mean('reciprocal_rank',subset),
          'full_evidence_set_at_1':mean('full_set_at_1',subset),
          'full_evidence_set_at_3':mean('full_set_at_3',subset),
          'hard_negative_rate_at_3':mean('hard_negative_at_3',subset),
          'abstention_accuracy_on_supplied_flags':mean('abstention_correct',subset),
          'abstention_flags_supplied':sum(r['abstention_supplied'] for r in subset),
          'abstention_flags_scored':sum(r['abstention_correct'] is not None for r in subset)}
    return {'dataset_status':data['status'],'query_coverage':{'submitted':len(rows),'total':len(q_by_id)},
      'summaries':summaries,'rows':rows,'limitations':['Unreviewed synthetic labels are not ground truth about educational evidence.',
       'No-answer cases are excluded from retrieval recall/MRR and require a separately supplied abstention decision.',
       'Partial-answer cases cannot be scored by one abstention boolean and are excluded from that metric.',
       'Hard-negative rates are diagnostic: a correct evidence set can contain a separately labelled outdated passage.',
       'Results cover only submitted queries; report coverage before comparing systems.']}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--rankings',help='JSON object: query id -> {ranked_ids:[...], abstained: optional boolean}')
    args=parser.parse_args()
    data=json.loads((HERE/'heldout.json').read_text(encoding='utf-8'))
    validate(data)
    if args.rankings:
        response=json.loads(Path(args.rankings).read_text(encoding='utf-8'))
        print(json.dumps(score(data,response),ensure_ascii=False,indent=2))
    else:
        print(f"Validated {len(data['passages'])} passages and {len(data['queries'])} queries; no model evaluation run.")
if __name__=='__main__': main()
