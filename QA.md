Read docs/progress/README.md
Read docs/qa-plan.md

Pick the next task in the plan.

Use agent-browser skill to manually verify it. If you find an issue, document it in docs/issues.md. Keep this issues doc organized with a TOC at the top and sub-sections for each issue, with solved issues at the bottom.

Take screenshots and save them in docs/screenshots/*

Be very thorough. Think like a user would. Try to find all the edge cases and bugs you can.

Update docs/qa-plan.md with your findings.

Commit your changes with a concise message.

---

## Demo Mode

Demo Mode uses mock services with synthetic images instead of real file system access. Use it when:
- You don't have access to real image files (JPEG/ARW)
- You want to test app functionality without file system permissions
- Running automated E2E tests

**To start in Demo Mode:**
```bash
cd apps/web
LITEROOM_DEMO_MODE=true pnpm dev
```

The app will auto-load a demo catalog with sample images on startup. A "Demo Mode" badge appears in the welcome screen to confirm it's active.
