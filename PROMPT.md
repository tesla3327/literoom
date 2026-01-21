Read docs/spec.md
Read docs/research/*
Read docs/plans/*

Process:

- Pick the most important next thing to work on
- When you're finished, update the `progress.md` with a concise summary of what you did
- Create a research plan for your task, then use lots of sub-agents to research the plan in parallel. Save the resulting document to `docs/research`
- Use the research document to create a plan for the next thing to work on in `docs/plans`
- Once you have a plan, implement the next part of the plan, updating the plan and `progress.md` as you go
- If you ever get stuck, update the `progress.md` with a concise summary of what you did and what you're stuck on
- You can ALWAYS go back and do more research and create a new plan if needed
- Commit your changes with a concise message

NOTE: ONLY DO ONE OF THESE THINGS PER ITERATION!!!

Notes:

- When updating `progress.md`:
  - use bash command to get the current time in EST
- Focus on doing "vertical" pieces of functionality, so we complete one piece of app functionality at a time
- Rust tooling best practices [thoughts/shared/research/2026-01-20-rust-tooling-best-practices.md]
