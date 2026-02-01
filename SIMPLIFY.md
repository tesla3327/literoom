Read docs/progress/README.md

Find the single most important file that has high test coverage and hasn't been simplified yet and simplify it. DO NOT MODIFY THE TESTS YET.

- DRY out the code, but don't over abstract or over-engineer the code.
- Use the simplest possible code to achieve the desired functionality.
- If you extract functionality, look for opportunities to use that in other parts of the codebase (use subagents to do this).

ALWAYS IMPLEMENT USING LOTS OF FOREGROUND SUBAGENTS!!! You can use up to 20 subagents in parallel at a time.

Once you verify the simplified code works as expected, update the tests as needed, making sure to keep high test coverage.

Update docs/simplify.md with only the file you simplified.

Commit your changes with a concise message.
