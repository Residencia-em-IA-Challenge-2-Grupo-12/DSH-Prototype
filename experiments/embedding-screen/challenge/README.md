# Synthetic bilingual retrieval challenge — unreviewed

The bundle contains 18 aligned passage pairs and 18 aligned query pairs (36 passages and 36 queries), with hard-negative labels and source/date metadata. Five fictional PDF source entries per language have page-number references representing **simulated extraction**; no PDF files are provided. All materials, personas and fictional guide statements are invented and must not enter an approved guidance corpus as evidence.

Run without network or models:

```sh
cd experiments/embedding-screen/challenge
python3 -m unittest -v
python3 evaluate.py
```

To score an existing run, provide a JSON mapping each query ID to an object with `ranked_ids` and, optionally, a boolean `abstained`. Rank only passages with the query's language. For example:

```json
{
  "exact-deadline:en": {"ranked_ids": ["syllabus-new:en", "deadline-extra:en"]},
  "no-caffeine:en": {"ranked_ids": ["food:en"], "abstained": true}
}
```

```sh
python3 evaluate.py --rankings /path/to/rankings.json
```

The scorer reports per-language and aggregate recall@1, recall@3, reciprocal rank, hard-negative incidence, optional abstention accuracy and query coverage. No-answer cases are excluded from retrieval recall and require explicit abstention decisions; ranking itself cannot establish that a system knew evidence was absent. A changed document can be useful context for a temporal answer even where labeled as a hard negative, so inspect such results instead of treating that diagnostic as an automatic factual error. Multi-passage cases require complete evidence recall, while MRR only measures the first relevant hit.

Before using these results to choose an embedding model: independently review bilingual translations and all relevance/conflict labels; freeze the queries and keep them out of prompt/model/corpus tuning; index the provided passages only; use a separate development set; retain model revisions, query formatting, chunking, normalization, hardware and peak memory, warm/cold timings and comparable resource limits; report individual failures. Follow with human review of applicability, attribution and unsupported claims. Synthetic relevance scores do not establish wellness or learning benefit. Nothing in this directory downloads packages or makes API calls.
