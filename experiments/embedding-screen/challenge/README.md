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

All questions have an explicit **as-of date of 2026-11-09**, distinct from the 2026-11-02 simulation start mentioned in one question. The evaluator rejects a corpus containing a document dated after a query's as-of date. Expose source dates to the answering system when judging recency; do not infer that a later capacity statement proves the earlier study goal was revised.

The scorer reports per-language and aggregate fractional recall@1 and recall@3, complete-evidence-set success@1 and @3, reciprocal rank, hard-negative incidence, optional abstention accuracy and query coverage. Complete-set success requires all labeled passages within the cutoff; MRR measures only the first relevant hit. No-source questions are excluded from retrieval recall. A changed document can be useful context for a temporal answer even where labeled as a hard negative, so inspect such results instead of treating that diagnostic as an automatic factual error.

The optional `abstained` flag means the system declined to assert the requested fact, not that it failed to retrieve evidence. Declining a yes/no claim is appropriate both where the corpus has no source and where a relevant source explicitly says the fact is unknown. An answer can cite the latter source. A mixed question whose activity is known but time is unknown cannot be scored with a single boolean: its flag is counted as supplied but excluded from abstention accuracy. Inspect the response for both the supported fact and the uncertainty. Neither rankings nor a supplied flag verify what the generated answer actually said.

Before using these results to choose an embedding model: independently review bilingual translations and all relevance/conflict labels; freeze the queries and keep them out of prompt/model/corpus tuning; index the provided passages only; use a separate development set; retain model revisions, query formatting, chunking, normalization, hardware and peak memory, warm/cold timings and comparable resource limits; report individual failures. Follow with human review of applicability, attribution and unsupported claims. Synthetic relevance scores do not establish wellness or learning benefit. Nothing in this directory downloads packages or makes API calls.
