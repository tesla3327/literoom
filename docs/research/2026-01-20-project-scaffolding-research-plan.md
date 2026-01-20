# Research Plan: Project Scaffolding

**Date**: 2026-01-20
**Status**: In Progress
**Priority**: Critical (foundational work)

## Research Objective

Research best practices and current tooling for setting up a Nuxt 4 + Nuxt UI 4 + Rust WASM monorepo project with proper CI/CD, testing infrastructure, and development tooling.

## Research Questions

### 1. Nuxt 4 Setup and Configuration
- What is the current state of Nuxt 4? (stable vs release candidate)
- How to initialize a Nuxt 4 project?
- What are the recommended project structure conventions?
- How does Nuxt 4 differ from Nuxt 3 in terms of setup?
- What are the TypeScript configuration best practices?

### 2. Nuxt UI 4 Integration
- Current state of Nuxt UI 4 (stable vs RC)
- Installation and configuration requirements
- Theming and customization setup
- Component library features relevant to our use case (sliders, modals, panels)

### 3. Rust WASM Integration
- Best approach for Rust WASM in a Nuxt/Vite project
- wasm-pack vs wasm-bindgen-cli for building
- Worker integration with WASM modules
- Monorepo structure for Rust + TypeScript
- Memory management considerations

### 4. Monorepo Structure
- pnpm workspace configuration
- Cargo workspace for Rust crates
- Shared type definitions between Rust and TypeScript
- Build orchestration

### 5. CI/CD Pipeline (GitHub Actions)
- Nuxt build and test workflow
- Rust fmt/clippy/test workflow
- WASM build verification
- Playwright E2E testing setup
- Caching strategies for both ecosystems

### 6. Development Tooling
- ESLint + Prettier configuration for Nuxt 4
- Vitest setup for unit testing
- Playwright configuration for E2E
- Hot reload with WASM
- rust-analyzer integration

### 7. File System Abstraction Layer
- Architecture for Tauri-compatible file access
- Browser File System Access API wrapper
- Interface design patterns

## Research Approach

1. Web search for current Nuxt 4 and Nuxt UI 4 documentation
2. Review official Rust WASM documentation
3. Look for example projects combining these technologies
4. Review CI/CD best practices for this stack

## Expected Outputs

- Synthesized document with concrete recommendations
- Implementation plan with step-by-step scaffolding instructions
- Configuration file templates

## Time Estimate

Research: 4-6 research queries
Synthesis: 1 comprehensive document
