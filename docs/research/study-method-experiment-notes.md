# Study-method evidence and small experiments

Research checked: 2026-11-13. Planning notes only; no guidance activated and no models run.

## Starting point

The supplied project context describes course-level one-hour scheduling through a heuristic and two synthetic Luna API runs. These are prototype observations, not evidence of learning or retention in real users. Future subject/task, method, retention goals, stated preferences, place/resources and optional self-reported tiredness remain design candidates.

## Empirical evidence: three original studies

| Source and tested conditions | Empirical result | Scope and limitation |
| --- | --- | --- |
| Roediger & Karpicke (2006), *Test-enhanced learning: Taking memory tests improves long-term retention*. Students studied prose passages, then restudied or attempted free recall without feedback; final recall was assessed after 5 minutes, 2 days or 1 week. [Author-hosted original paper](https://learninglab.psych.purdue.edu/downloads/2006/2006_Roediger_Karpicke_PsychSci.pdf), [DOI](https://doi.org/10.1111/j.1467-9280.2006.01693.x). | Repeated study gave better immediate recall; prior testing gave better delayed recall. Outcome timing changes the interpretation of “better.” | Prose recall under these experimental conditions is not evidence that every task in a science course should use retrieval practice. It does not establish performance on practical projects, individual fit or this assistant's efficacy. |
| Cepeda et al. (2008), *Spacing effects in learning: A temporal ridgeline of optimal retention*. More than 1,350 participants learned facts, reviewed after different gaps and completed later tests, with retention intervals extending to approximately a year. [University repository and original manuscript](https://escholarship.org/uc/item/0kp5q19x), [DOI](https://doi.org/10.1111/j.1467-9280.2008.02209.x). | At a given retention interval, increasing the review gap initially improved and later reduced performance; the best observed gap increased with the retention interval. | This factual-learning experiment supports treating retention horizon as relevant. It does not supply an individualized formula for arbitrary coursework; longer-delay conditions also had more non-completion. Exact percentages should not become universal scheduling rules. |
| Massa & Mayer (2006), *Testing the ATI hypothesis: Should multimedia instruction accommodate verbalizer-visualizer cognitive style?* Three experiments used an electronics lesson and textual/pictorial help, with measures of preferences and cognitive characteristics. [Original paper, university-hosted copy](https://people.cs.vt.edu/~shaffer/CS6604/Papers/Validity_2006.pdf), [DOI](https://doi.org/10.1016/j.lindif.2006.10.001). | Almost all tested verbalizer/visualizer measures failed to produce significant attribute-by-treatment interactions; results gave no strong support for the tested matching hypothesis. | The authors explicitly limit the experiments to one lesson and one implementation of verbal/pictorial instruction. This is not proof that all personalization is ineffective. Stated preference can guide a user's choice without being labeled an established learning advantage. |

## Planning inferences, not empirical findings

- Describe a candidate method using **task + method/procedure + comparison + measured outcome + retention horizon + population/context + limitation**. A subject name alone is insufficient to select a scientifically “best” method.
- Keep user preference and resource feasibility separate from learning-effect evidence. A preferred medium or available quiet room can make a plan acceptable or feasible without proving superior retention.
- None of these studies evaluates an LLM scheduler, automatic personalization, place-based adaptation, or adaptation from self-reported tiredness. Preserve optional self-report as user input, with omission allowed; infer no health state, capacity score or universal session limit from it.
- Admission into approved guidance remains **human-reviewed**. Recording these sources is not approval. A reviewer should inspect applicability, provenance and wording before a bounded recommendation becomes eligible.

## Proposed synthetic tests, in order

These are small, inspectable behavior tests to discuss before committing the specification. They measure representation, constraint handling and explanation quality; they cannot measure learning, retention or educational efficacy.

1. **Represent one task before scheduling it.** Compare otherwise identical fixtures: “Biology” versus “recall these definitions” versus “explain a process” versus “finish a lab report.” Check that task and intended outcome remain distinguishable; no automatic subject-to-method mapping or claim that one method wins all three tasks.
2. **Vary only the retention goal.** Give the same factual-recall task an imminent assessment and a later retention target. Check that the proposal exposes the target and review tradeoff, respects calendar feasibility and avoids an invented personal optimum or guaranteed retention percentage. Do not hard-code the experimental gap ratios as universal rules.
3. **Test explicit user control and missing information.** Change one fixture field at a time: chosen method, preference, place/resource availability, or optional tiredness self-report. Check that explicit choices are preserved or conflicts explained, unavailable resources are flagged, missing self-report works, and no hidden ability or health inference appears. Recommendations, if considered later, must carry human-approved evidence scope and remain reviewable by the user.

For each fixture, keep the input, expected observable behavior and failure reason in plain text. Passing these checks would support further prototype investigation, not a real-user learning claim or a committed product specification.
