# Working with stacked pull requests

A PR's base is the branch against which its own change should be reviewed. For a dependent change, use the immediate parent branch and link the parent PR; do not copy parent commits onto a new branch to make an independent-looking diff.

1. **Before work:** record the current head/base commits and preserve uncommitted or untracked work. Keep unrelated scope in a focused branch and identify the issue and acceptance test.
2. **During work:** use reviewable intermediate commits and keep incomplete deliveries draft. The PR body names its parent, dependencies, verification and remaining limitations. Experimental PRs do not select a product foundation merely by existing or merging.
3. **Before review:** compare the actual diff against the intended base and report checks against that head/base. Reuse prior evidence only when unchanged behavior and configuration justify it. A green check is not proof of live-model quality or a complete user workflow.
4. **Before a Git operation:** show the planned order and consequences. Review a child before integrating it into its parent, then review the parent's resulting diff. PR #8 still needs its explicit readiness and user merge decision. Preserve existing Project views/fields and link dependencies using the available conventions.
5. **After an approved parent integration:** inspect the child's new effective diff before retargeting. A merge commit preserves ancestry; squash/rebase may require reconstructing the child from the recorded old parent boundary. Do not merge the whole old stack again merely to fix a confusing diff. Rerun checks affected by the new base.
6. **Before supersession/closure:** map every unique implementation, regression test, fixture generator, result artifact, documentation page and CI check to its retained destination or an explicitly accepted reason for deferral. Preserve source refs until traceability is established. Matching filenames or one copied function are insufficient.

Use the [consolidation proposal](../docs/pr-consolidation-proposal.md) as the current review map. Its candidate operations remain proposals until reviewed. This guide does not enable automatic merge, change repository branch protection, or choose a final interface, planner, embedding model or sandbox.
