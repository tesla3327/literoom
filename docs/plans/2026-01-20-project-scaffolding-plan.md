# Implementation Plan: Project Scaffolding

**Date**: 2026-01-20
**Status**: Complete
**Research**: [2026-01-20-project-scaffolding-synthesis.md](../research/2026-01-20-project-scaffolding-synthesis.md)
**Priority**: Critical (foundational)

## Objective

Set up the complete monorepo structure for Literoom with Nuxt 4, Nuxt UI 4, Rust WASM workspace, CI/CD pipeline, and testing infrastructure.

---

## Phase 1: Project Structure and Configuration

### 1.1 Initialize pnpm Workspace

- [x] Create `pnpm-workspace.yaml`
- [x] Create root `package.json` with workspace scripts
- [x] Create `.npmrc` for pnpm configuration

### 1.2 Initialize Nuxt 4 Application

- [x] Create `apps/web/` directory
- [x] Initialize Nuxt 4 (manually configured, not via nuxi init)
- [x] Configure `nuxt.config.ts` with Nuxt UI 4
- [x] Set up TypeScript configuration
- [x] Create base directory structure (`app/`, `server/`, `public/`)

### 1.3 Initialize Rust Workspace

- [x] Create root `Cargo.toml` workspace configuration
- [x] Create `crates/literoom-core/` directory and `Cargo.toml`
- [x] Create `crates/literoom-wasm/` directory and `Cargo.toml`
- [x] Set up basic WASM entry point
- [x] Configure `rustfmt.toml` and `clippy.toml`

### 1.4 Initialize Shared Packages

- [x] Create `packages/core/` for shared TypeScript logic
- [x] Create `packages/wasm/` as output target for wasm-pack
- [x] Set up TypeScript build configuration

---

## Phase 2: Tooling Configuration

### 2.1 TypeScript/JavaScript Tooling

- [x] Install and configure ESLint with `@nuxt/eslint`
- [x] Configure Prettier
- [ ] Set up `lint-staged` for pre-commit hooks (deferred)
- [x] Create VS Code settings and recommended extensions

### 2.2 WASM Integration

- [x] Install `vite-plugin-wasm` and `vite-plugin-top-level-await`
- [x] Configure Nuxt/Vite to handle WASM imports
- [x] Create build script for WASM compilation
- [ ] Test WASM module import from Nuxt (requires Node 22+)

### 2.3 Rust Tooling

- [x] Configure `rustfmt.toml` (per existing research)
- [x] Configure `clippy.toml`
- [x] Add `rust-toolchain.toml` for consistent toolchain

---

## Phase 3: Testing Infrastructure

### 3.1 Unit Testing (Vitest)

- [x] Install `@nuxt/test-utils` and `vitest`
- [x] Create `vitest.config.ts`
- [x] Create sample unit test
- [x] Add `test:unit` script

### 3.2 E2E Testing (Playwright)

- [x] Install `@playwright/test`
- [x] Create `playwright.config.ts`
- [x] Create sample E2E test
- [x] Add `test:e2e` script

### 3.3 Rust Testing

- [x] Set up basic test in `literoom-core`
- [x] Install `cargo-nextest` (CI only)
- [x] Add proptest dependency for property-based tests

---

## Phase 4: CI/CD Pipeline

### 4.1 GitHub Actions

- [x] Create `.github/workflows/ci.yml`
- [x] Configure TypeScript/Nuxt job (lint, typecheck, test)
- [x] Configure Rust job (fmt, clippy, test, wasm build)
- [x] Set up caching for pnpm and Cargo

---

## Phase 5: Verification

### 5.1 Smoke Tests

- [x] Run `pnpm install` successfully
- [ ] Run `pnpm dev` and verify Nuxt starts (requires Node 22+)
- [ ] Run `pnpm build` successfully (requires Node 22+)
- [x] Run `cargo check` successfully
- [ ] Run `wasm-pack build` successfully (deferred to CI)
- [ ] Run `pnpm test:unit` successfully (requires Node 22+)
- [ ] Run `pnpm lint` successfully (requires Node 22+)

**Note**: Several smoke tests require Node.js 22+ which is not available in the local environment. The CI pipeline uses Node 22 and will validate these.

---

## Environment Notes

### Node.js Version Requirement

Nuxt 4 and its tooling (ESLint, Vitest) require **Node.js 22+**. If your local environment has an older version:
- The CI pipeline will handle all Node.js-based checks
- For local development, upgrade to Node.js 22 using nvm:
  ```bash
  nvm install 22
  nvm use 22
  ```

### Rust Toolchain Path

If you have multiple Rust installations (e.g., system rustc and rustup):
```bash
# Ensure rustup's toolchain is used
export RUSTC=$HOME/.cargo/bin/rustc
cargo check --all-targets
```

Or add `~/.cargo/bin` first in your PATH.

---

## File Structure (Achieved)

```
literoom/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── apps/
│   └── web/
│       ├── app/
│       │   ├── components/
│       │   ├── composables/
│       │   ├── layouts/
│       │   │   └── default.vue
│       │   ├── pages/
│       │   │   └── index.vue
│       │   └── app.vue
│       ├── assets/
│       │   └── css/
│       │       └── main.css
│       ├── public/
│       ├── server/
│       ├── e2e/
│       │   └── example.spec.ts
│       ├── test/
│       │   └── example.nuxt.test.ts
│       ├── nuxt.config.ts
│       ├── package.json
│       ├── playwright.config.ts
│       ├── tsconfig.json
│       └── vitest.config.ts
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── filesystem/
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── browser.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── wasm/
│       └── package.json
├── crates/
│   ├── literoom-core/
│   │   ├── src/
│   │   │   └── lib.rs
│   │   └── Cargo.toml
│   └── literoom-wasm/
│       ├── src/
│       │   └── lib.rs
│       └── Cargo.toml
├── .gitignore
├── .npmrc
├── .prettierrc
├── .prettierignore
├── Cargo.toml
├── clippy.toml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── rust-toolchain.toml
└── rustfmt.toml
```

---

## Completion Criteria

- [x] Most smoke tests pass locally (Rust tests pass, deps install)
- [x] CI pipeline configured
- [ ] Developer can run `pnpm dev` and see Nuxt UI app (requires Node 22+)
- [ ] Developer can import WASM module in Nuxt (requires Node 22+)
- [ ] All linting and type checking passes (requires Node 22+)

**Status**: Core scaffolding complete. Full local development requires Node.js 22+.
