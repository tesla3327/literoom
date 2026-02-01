Read docs/research/perf/2026-01-26-pipeline-bottleneck-investigation.md

Investigate the bottleneck.

Take the next most important task in the plan. Make sure to implement benchmarking, then run tests to capture BEFORE benchmarking data before making any changes.

Use foreground subagents for tasks that do not overlap and will not reuse much of the current context window. You can use up to 20 subagents in parallel at a time.

Once changes are done, re run the same benchmarking tests to capture the difference and verify the optimization.

Update the doc when finished.

Commit your changes with a concise message.

REMEMBER to use subagents for implementation.