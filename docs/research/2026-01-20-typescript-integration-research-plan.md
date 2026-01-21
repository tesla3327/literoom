# Research Plan: TypeScript Integration for Image Decoding

**Date**: 2026-01-20
**Phase**: Image Decoding Plan - Phase 7 (TypeScript Integration)
**Goal**: Create Web Worker-based decode service that integrates WASM module with Nuxt app

---

## Research Areas

### Area 1: Web Worker WASM Initialization
**Questions**:
- How to properly load and initialize WASM modules in Web Workers?
- What is the best pattern for wasm-pack `--target web` output in workers?
- How to handle WASM initialization errors gracefully?
- Should the worker be created lazily or eagerly on app load?

**Research Tasks**:
- Review wasm-bindgen/wasm-pack documentation for worker usage
- Look at existing projects using WASM in workers (Squoosh, Photon, etc.)
- Check if Nuxt/Vite has special handling needed for WASM in workers

---

### Area 2: Worker Message Passing Patterns
**Questions**:
- What's the best pattern for request/response correlation in workers?
- How to handle Transferable objects (ArrayBuffer) efficiently?
- Should we use structured cloning or transfer ownership?
- How to implement cancellation for long-running decode operations?

**Research Tasks**:
- Research Comlink and other worker abstraction libraries
- Study patterns for typed message passing (TypeScript-friendly)
- Investigate Transferable patterns for image data

---

### Area 3: DecodeService API Design
**Questions**:
- What public API should DecodeService expose?
- How to handle initialization state (loading, ready, error)?
- Should decodes be queued or processed one at a time?
- How to expose progress for long operations?

**Research Tasks**:
- Review the spec.md requirements for thumbnail/preview generation
- Design the service interface
- Consider integration with Vue/Nuxt composables

---

### Area 4: Vite/Nuxt Worker Integration
**Questions**:
- How to properly configure Vite for worker bundling?
- Does vite-plugin-wasm work correctly with workers?
- How to handle WASM imports in worker context?
- What's the deployment story (static hosting)?

**Research Tasks**:
- Review current Nuxt/Vite configuration in apps/web
- Test worker creation patterns with WASM
- Check for any special considerations for production builds

---

### Area 5: Error Handling Across Boundaries
**Questions**:
- How to propagate WASM errors through worker to main thread?
- What error types should DecodeService expose?
- How to handle out-of-memory situations gracefully?

**Research Tasks**:
- Design error hierarchy for TypeScript
- Plan error propagation strategy
- Consider retry logic for recoverable errors

---

### Area 6: Memory Management
**Questions**:
- How to avoid memory leaks with worker/WASM lifecycle?
- When to transfer vs clone ArrayBuffers?
- Should decoded images be cached in the worker?
- How to handle worker termination/restart?

**Research Tasks**:
- Review WASM memory model in browser context
- Plan data flow to minimize copies
- Consider IndexedDB or Cache API for persistence

---

## Existing Code to Review

1. `packages/wasm/` - Generated WASM bindings (TypeScript API)
2. `apps/web/app/plugins/wasm.ts` - Existing WASM plugin (if any)
3. `packages/core/src/filesystem/` - Existing abstraction pattern
4. `crates/literoom-wasm/src/` - WASM API surface

---

## Expected Outputs

1. **Research synthesis document** with:
   - Recommended worker initialization pattern
   - Message passing architecture
   - DecodeService interface design
   - Error handling strategy
   - Memory management approach

2. **Implementation plan** ready for coding

---

## Research Order

1. Area 4 (Vite/Nuxt) - Understand current setup first
2. Area 1 (WASM in Workers) - Core technical challenge
3. Area 2 (Message Passing) - Communication patterns
4. Area 3 (API Design) - Based on findings
5. Area 5 & 6 (Error/Memory) - Fill in details

