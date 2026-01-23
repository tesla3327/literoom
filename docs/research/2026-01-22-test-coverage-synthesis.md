# Test Coverage Metrics Research Synthesis

**Date**: 2026-01-22
**Objective**: Add test coverage metrics for both Rust and TypeScript code

## Executive Summary

This project has 660+ tests across two languages but no coverage tracking:
- **TypeScript**: 432 unit tests (362 core + 70 web) + 28 E2E tests
- **Rust**: 228 tests (184 core + 44 wasm)

No coverage configuration exists in the project. This document outlines the recommended approach.

---

## 1. TypeScript Coverage (Vitest)

### Recommended: V8 Provider

**Why V8 over Istanbul:**
- Built into Node.js (no extra dependencies needed)
- Vitest 3.2.0+ ensures accuracy parity with Istanbul
- Faster execution (~10-15% overhead vs ~20-30% for Istanbul)
- Simpler setup and maintenance

### Configuration Requirements

**packages/core/vitest.config.ts additions:**
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'json', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    'src/**/*.d.ts',
    'src/**/types.ts',
    'src/**/index.ts',
  ],
  thresholds: {
    lines: 75,
    functions: 75,
    branches: 70,
    statements: 75,
  },
}
```

**apps/web/vitest.config.ts additions:**
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'json', 'lcov'],
  include: [
    'app/**/*.{ts,vue}',
    'composables/**/*.{ts,vue}',
    'stores/**/*.{ts,vue}',
    'plugins/**/*.{ts,vue}',
  ],
  exclude: [
    'test/**',
    'e2e/**',
    '**/*.d.ts',
    'app/app.vue',
    'app/error.vue',
  ],
  thresholds: {
    lines: 65,
    functions: 60,
    branches: 50,
    statements: 65,
  },
}
```

**Note**: Lower thresholds for web app because UI components are harder to test.

---

## 2. Rust Coverage

### Recommended: cargo-llvm-cov

**Why cargo-llvm-cov:**
1. **WASM Support**: Only mainstream tool with experimental but working WASM support via minicov
2. **Cross-Platform**: Works on Ubuntu (CI), macOS, Windows (tarpaulin is Linux-only)
3. **Accuracy**: LLVM-based instrumentation provides most accurate coverage
4. **Workspace Support**: Native `--workspace` flag with fine-grained control
5. **Active Maintenance**: Regular updates and strong community

**Why NOT tarpaulin:**
- Linux x86_64 only (problematic for macOS developers)
- No WASM support
- Known coverage accuracy issues
- Slower (full rebuild on every run)

### Installation

```bash
cargo install cargo-llvm-cov
# Or use GitHub Action: taiki-e/install-action@cargo-llvm-cov
```

### Commands

```bash
# Run coverage for workspace
cargo llvm-cov --workspace --all-features --html

# Generate LCOV for CI
cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info
```

---

## 3. CI Integration

### Recommended: Codecov

**Why Codecov:**
- Excellent multi-language support (Rust + TypeScript unified dashboard)
- Native GitHub integration with PR comments
- Coverage deltas on PRs
- Free for open source
- Supports LCOV, Cobertura, JSON formats

### GitHub Actions Workflow Additions

```yaml
# Add to existing web job
- name: Unit tests with coverage
  run: pnpm test:unit --coverage

- name: Upload TypeScript coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./packages/core/coverage/lcov.info,./apps/web/coverage/lcov.info
    flags: typescript
    fail_ci_if_error: false

# Add to existing rust job
- name: Install cargo-llvm-cov
  uses: taiki-e/install-action@cargo-llvm-cov

- name: Run tests with coverage
  run: cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info

- name: Upload Rust coverage
  uses: codecov/codecov-action@v4
  with:
    files: ./lcov.info
    flags: rust
    fail_ci_if_error: false
```

---

## 4. Coverage Badges for README

```markdown
[![codecov](https://codecov.io/gh/USERNAME/REPO/graph/badge.svg?token=TOKEN)](https://codecov.io/gh/USERNAME/REPO)
```

Or using shields.io:
```markdown
[![coverage](https://img.shields.io/codecov/c/github/USERNAME/REPO/main.svg)](https://codecov.io/gh/USERNAME/REPO)
```

---

## 5. Current Project State

### Existing Test Commands

| Package | Command | Tests |
|---------|---------|-------|
| @literoom/core | `vitest run` | 362 |
| @literoom/web | `vitest run` | 70 |
| @literoom/web | `playwright test` | 28 E2E |
| literoom-core | `cargo test --all-features` | 184 |
| literoom-wasm | `cargo test --all-features` | 44 |

### Files to Modify

1. `packages/core/vitest.config.ts` - Add coverage config
2. `apps/web/vitest.config.ts` - Add coverage config
3. `packages/core/package.json` - Add coverage script
4. `apps/web/package.json` - Add coverage script
5. `package.json` (root) - Add coverage script
6. `.github/workflows/ci.yml` - Add coverage steps
7. `README.md` (if exists) - Add coverage badge

---

## 6. Recommended Thresholds

| Metric | Core Package | Web App | Rationale |
|--------|---|---|-----------|
| Lines | 75% | 65% | Core logic easier to test; UI components harder |
| Functions | 75% | 60% | Core services vs. Vue components |
| Branches | 70% | 50% | Edge cases in logic; UI branches complex |
| Statements | 75% | 65% | Similar to lines |

Start without `perFile: true` - can enable later for stricter enforcement.

---

## 7. Implementation Phases

### Phase 1: Local Coverage Setup
1. Configure Vitest coverage in both workspaces
2. Add `pnpm coverage` scripts
3. Verify coverage reports generate locally

### Phase 2: CI Integration
1. Add Codecov GitHub Action
2. Configure coverage upload for both languages
3. Add CODECOV_TOKEN to GitHub secrets

### Phase 3: Badges & PR Comments
1. Add coverage badge to README
2. Configure PR comments (optional)
3. Set up coverage thresholds in Codecov dashboard

---

## 8. Potential Issues

1. **WASM Coverage**: cargo-llvm-cov WASM support is experimental - may need to exclude literoom-wasm initially
2. **Test Location Inconsistency**: Core uses colocated tests (`src/**/*.test.ts`), web uses separate directory (`test/**`)
3. **Coverage Report Paths**: Need to ensure paths work in CI with different working directories
4. **Threshold Enforcement**: Consider starting with warning-only thresholds, not failures

---

## 9. Tools Summary

| Tool | Language | Output | CI Integration |
|------|----------|--------|----------------|
| Vitest V8 | TypeScript | LCOV, HTML, JSON | codecov-action |
| cargo-llvm-cov | Rust | LCOV, HTML, JSON | codecov-action |
| Codecov | N/A | Dashboard | GitHub Action |

---

## Sources

- [Vitest Coverage Guide](https://vitest.dev/guide/coverage)
- [cargo-llvm-cov GitHub](https://github.com/taiki-e/cargo-llvm-cov)
- [Codecov Documentation](https://docs.codecov.com)
- [codecov-action](https://github.com/codecov/codecov-action)
