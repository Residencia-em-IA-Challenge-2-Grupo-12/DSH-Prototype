# Offline four-model challenge probe

`run_models.py` runs the four locally staged snapshots from the initial smoke test on the synthetic 36-query challenge. This is exploratory infrastructure evidence; relevance labels and translations are **not human-approved**, and no claim of real educational validity or agent-level performance is supported. The initial agent review led to fixes, but the final corrected dataset has not been independently human-reviewed.

The runner loads exactly the four hard-coded upstream revision identifiers from `study-revision.json`, hashes local files and the dataset, uses model-specific query/document formatting, normalizes embeddings, and restricts results to passages in the query's language. Each passage's synthetic source path and update date are included in indexed text. Each model runs in a fresh offline subprocess with a CPU-thread setting, timeout and an address-space cap. That cap is not an RSS/container-memory boundary; HF offline flags are not an OS network sandbox. No generative model or remote API is used.

It emits the full rankings and applies the challenge scorer. Ranking is not answering: it supplies **no abstention flags**, so abstention accuracy remains unmeasured even on missing-answer examples. Query coverage, per-language scores, full-evidence-set success, hard-negative diagnostics, model failures, warm query timings, process RSS and hashes are recorded. Source pages labeled `simulated_pdf_extraction` are invented references; no PDFs were processed.

Run with the four previously staged snapshots and an isolated compatible local Python environment:

```sh
python -m unittest discover -s experiments/embedding-screen/challenge -p 'test*.py'
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 python experiments/embedding-screen/challenge/run_models.py \
  --models-dir /path/to/model-snapshots --memory-mib 4096 --timeout 240 --threads 1 --output /tmp/retrieval-probe.json
```

Each snapshot must include `study-revision.json` with the pinned `repository` and `revision` values in `MODELS`; missing or mismatched snapshots are reported as failures. This checks a local metadata claim, not upstream authenticity; the per-file hashes document what was actually loaded. The earlier smoke environment used Python 3.13.16, CPU PyTorch 2.15.0, Transformers 5.22.2 and Sentence Transformers 6.2.0; EmbeddingGemma also needed Pillow, torchvision and `chat_template.jinja`. The model snapshots themselves are not redistributed here. A timeout includes model load and encoding, not file hashing. Run in a network-disabled container and with OS-enforced resident memory limits before treating resource figures as controlled comparisons.

## Exploratory run on 2026-11-07

After an independent agent identified uneven source-path metadata in an initial run, the runner was corrected to include the same source path and update date in every candidate's indexed passage text. The earlier numbers are invalid for comparison. All four models then completed all 36 queries under the same nominal settings. The query language was supplied to the ranker and only passages in that language were considered; this is not a cross-language retrieval test.

Fractional recall@3 was Gemma 0.9688, Qwen 0.9219, BGE 1.0000 and E5 1.0000. Complete-evidence-set@3 was 0.9375, 0.9062, 1.0000 and 1.0000 respectively. The scorer excludes no-source cases from recall and no abstention decisions were supplied. Hard-negative incidence is diagnostic, because an outdated passage may still be useful context. These numbers must not determine model choice: the small synthetic dataset and applicability labels lack human review, and inspection plus the correction means this is not a pristine held-out evaluation. Use a newly frozen independent set for the decision.

Peak RSS was roughly 2053, 1468, 2097 and 937 MiB; warm median query time was roughly 0.083, 1.210, 0.140 and 0.014 seconds, respectively. The CPU was an i7-13700T with one thread per model. The small corpus, warm OS cache, variable contention and differing architectures prevent robust latency or quality conclusions. The adjacent machine-readable artifact records all rankings, versions and file hashes. Run start was not captured; file creation and completion times and the verified host details were added afterward and are identified as such. The recorded revisions are local metadata claims, not independent proof of upstream authenticity.
