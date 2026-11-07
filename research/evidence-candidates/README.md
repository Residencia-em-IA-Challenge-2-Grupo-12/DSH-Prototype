# Candidate evidence dossiers

This bundle contains nine source-admission dossiers and ten passage identifiers for human review. **Nothing is approved or active product guidance.** `candidates.json` marks every source inactive and requires separate human approval for both source and proposed guidance. The Markdown report separates source-supported observations, limitations, possible product applications and misuse to avoid.

Reviewers must independently check the source and exact passage, population, applicability, attribution/redistribution rights, and any Brazilian Portuguese translation before admitting a source or guidance. No approved translations are included. The WHO activity guideline landing page was available to the research tool, but the linked IRIS PDF returned HTTP 403; the exact cited PDF passage remains unverified. Several studies were inspected only through abstracts. Source snapshots and content hashes have not been saved, so they must be captured where permitted before calling the resulting corpus reproducible.

The notes describe general learning and wellbeing context; they do not establish that the assistant improves grades or wellbeing, and they do not prescribe clinical advice or universal scheduling limits. The mixed/null scheduling trial is included alongside positive findings.

From this directory, regenerate the reports with `python3 build.py`. Run `python3 -m unittest -v test_dossiers` to check source/passage identifiers, inactive states, important audit corrections, and generator/report consistency. The tests run the generator in a temporary directory and leave the bundle unchanged. Generation is local, uses only Python's standard library, and does not fetch or admit sources.
