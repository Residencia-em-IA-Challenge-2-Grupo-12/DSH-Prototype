# Offline embedding screening smoke test

This experiment exercises bilingual dense retrieval using four named candidates. It never downloads model weights, calls an external API or uses a generative model. Its eight synthetic queries and eight short synthetic passages are **unreviewed smoke fixtures**, not approved study guidance, a representative benchmark or grounds for selecting a model. Expand and independently review the corpus, relevance labels and query coverage before drawing quality conclusions. Include extracted PDF passages with page references in a later corpus; none are included here.

Stage each complete, locally acquired Sentence Transformers model snapshot in these directories:

```
models/embeddinggemma-2/        # google/embeddinggemma-2
models/qwen3-embedding-0.6b/    # Qwen/Qwen3-Embedding-0.6B
models/bge-m3/                  # BAAI/bge-m3
models/multilingual-e5-small/   # intfloat/multilingual-e5-small
```

Use a dedicated CPU Python environment with compatible, pinned versions of PyTorch, Transformers and Sentence Transformers (the EmbeddingGemma 2 card requires Sentence Transformers 6.1.0 or later). Stage dependencies separately; the script does not install them. Model snapshots must include their pooling/tokenizer configuration. Record the upstream revision when staging a snapshot: the output also hashes all staged model files and the corpus. Local symlinks are followed while hashing.

```
PYTHONDONTWRITEBYTECODE=1 python3 experiments/embedding-screen/test_benchmark.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/embedding-screen/benchmark.py \
  --models-dir /path/to/local/models --memory-mib 4096 --timeout-seconds 240 --threads 1 > /tmp/embedding-screen.json
```

Every candidate receives an `ok`, `unavailable`, `failed` or `timeout` result. The report records corpus/model hashes, dependency versions for successful runs, per-query rankings, recall@3, reciprocal rank, warm query timing, load time and peak resident memory. Missing files or libraries are failures to run, never zero retrieval scores. Each model runs in a fresh subprocess, one at a time. Python's Linux `RLIMIT_AS` caps **virtual address space**, not resident memory; it may fail while physical memory is available, and is not a substitute for a container memory limit. The wall-time limit includes model loading and encoding, but not the preceding file hashing. Offline library flags and local-only loading prevent supported Hugging Face download paths; use a network-disabled container when network isolation is required.

The runner uses native dense embeddings, normalized cosine ranking and model-specific query/document formatting. EmbeddingGemma 2 uses its text-only configuration and float32. Qwen uses the English retrieval instruction and unprefixed passages; E5 uses `query:` and `passage:`; BGE-M3 uses dense vectors without prefixes. Model compatibility and numerical output are unverified until the exact snapshots and dependencies are staged and run. Timings on the tiny corpus do not characterize production workload.

Model documentation: [EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2), [Qwen3-Embedding 0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [BGE-M3](https://huggingface.co/BAAI/bge-m3), [multilingual-E5-small](https://huggingface.co/intfloat/multilingual-e5-small).
