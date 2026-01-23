# Test Coverage Metrics Implementation Plan

**Date**: 2026-01-22
**Research**: [2026-01-22-test-coverage-synthesis.md](../research/2026-01-22-test-coverage-synthesis.md)

## Objective

Add test coverage metrics for both Rust and TypeScript code to track progress.

---

## Phase 1: TypeScript Coverage Configuration

### 1.1 Update packages/core/vitest.config.ts

Add coverage configuration with V8 provider:
- Reporter formats: text, html, json, lcov
- Include source files, exclude test/type files
- Thresholds: 75% lines/functions/statements, 70% branches

### 1.2 Update apps/web/vitest.config.ts

Add coverage configuration for Nuxt app:
- Reporter formats: text, html, json, lcov
- Include app code (app/, composables/, stores/, plugins/, utils/)
- Exclude test code and type definitions
- Lower thresholds: 65% lines/statements, 60% functions, 50% branches

### 1.3 Add coverage scripts to package.json files

**packages/core/package.json**:
```json
"scripts": {
  "coverage": "vitest run --coverage"
}
```

**apps/web/package.json**:
```json
"scripts": {
  "coverage": "vitest run --coverage"
}
```

**Root package.json**:
```json
"scripts": {
  "coverage": "pnpm --filter @literoom/core coverage && pnpm --filter @literoom/web coverage",
  "coverage:core": "pnpm --filter @literoom/core coverage",
  "coverage:web": "pnpm --filter @literoom/web coverage"
}
```

---

## Phase 2: Rust Coverage Configuration

### 2.1 Install cargo-llvm-cov

Developers install locally:
```bash
cargo install cargo-llvm-cov
```

CI uses GitHub Action:
```yaml
- uses: taiki-e/install-action@cargo-llvm-cov
```

### 2.2 Test coverage locally

Run coverage for workspace:
```bash
cargo llvm-cov --workspace --all-features --html
open target/llvm-cov/html/index.html
```

Generate LCOV for CI:
```bash
cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info
```

---

## Phase 3: CI Integration

### 3.1 Update .github/workflows/ci.yml

**Web job additions**:
```yaml
- name: Unit tests with coverage
  run: pnpm test:unit --coverage

- name: Upload TypeScript coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./packages/core/coverage/lcov.info,./apps/web/coverage/lcov.info
    flags: typescript
    name: typescript-coverage
    fail_ci_if_error: false
```

**Rust job additions**:
```yaml
- name: Install cargo-llvm-cov
  uses: taiki-e/install-action@cargo-llvm-cov

- name: Run tests with coverage
  run: cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info

- name: Upload Rust coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./lcov.info
    flags: rust
    name: rust-coverage
    fail_ci_if_error: false
```

### 3.2 Add CODECOV_TOKEN to GitHub secrets

1. Sign up at codecov.io with GitHub
2. Get repository token from Codecov settings
3. Add `CODECOV_TOKEN` secret in GitHub repo settings

---

## Phase 4: Verification & Documentation

### 4.1 Verify coverage locally

```bash
# TypeScript
pnpm coverage

# Rust
cargo llvm-cov --workspace --all-features --html
```

### 4.2 Update progress/README.md

Update test status table with coverage metrics once available.

### 4.3 Mark issue as solved in issues.md

Move "Add in test coverage metrics" from Open Issues to Solved Issues.

---

## Implementation Checklist

### Phase 1: TypeScript
- [ ] Update packages/core/vitest.config.ts with coverage config
- [ ] Update apps/web/vitest.config.ts with coverage config
- [ ] Add coverage script to packages/core/package.json
- [ ] Add coverage script to apps/web/package.json
- [ ] Add coverage scripts to root package.json
- [ ] Verify `pnpm coverage` works locally

### Phase 2: Rust
- [ ] Document cargo-llvm-cov installation in README or contributing guide
- [ ] Verify `cargo llvm-cov` works locally

### Phase 3: CI
- [ ] Update .github/workflows/ci.yml with coverage steps
- [ ] Add CODECOV_TOKEN to GitHub secrets
- [ ] Verify coverage uploads on next CI run

### Phase 4: Documentation
- [ ] Update issues.md to mark as solved
- [ ] Update progress/README.md with coverage metrics

---

## Notes

- **WASM Coverage**: cargo-llvm-cov's WASM support is experimental. Initially exclude literoom-wasm from coverage using `--exclude literoom-wasm` if issues arise.

- **Threshold Enforcement**: Starting with `fail_ci_if_error: false` for Codecov to avoid blocking PRs until thresholds are validated.

- **E2E Tests**: Playwright E2E tests don't contribute to code coverage metrics - this is expected and normal.
