Read docs/spec.md
Read docs/progress/README.md
Read docs/research/*
Read docs/plans/*
Read docs/issues.md for any open issues
Check any outstanding Tasks using your tool.

Process:

- Pick the most important next thing to work on
  - Immediately update `docs/progress/*` with your chosen task
- When you're finished, update the `docs/progress/*` with a concise summary of what you did
- Create a research plan for your task, then use lots of sub-agents to research the plan in parallel. Save the resulting document to `docs/research`
- Use the research document to create a plan for the next thing to work on in `docs/plans`
- Once you have a plan, implement the next part of the plan, updating the plan and `docs/progress/*` as you go
- Add tests and update existing tests to ensure the new functionality is working as expected and to keep high test coverage.
- If you ever get stuck, update the `docs/progress/*` with a concise summary of what you did and what you're stuck on
- You can ALWAYS go back and do more research and create a new plan if needed
- Commit your changes with a concise message

NOTE: ONLY DO ONE OF THESE THINGS PER ITERATION!!!

Notes:

- When updating `docs/progress/*`:
  - use bash command to get the current time in EST
  - create a new file if the most recent shard file already has 10 iterations
  - update `docs/progress/README.md` with new iteration
- Focus on doing "vertical" pieces of functionality (eg a "tracer bullet"), so we complete one piece of app functionality at a time
- ALWAYS IMPLEMENT USING LOTS OF FOREGROUND SUBAGENTS!!! You can use up to 20 subagents in parallel at a time.
