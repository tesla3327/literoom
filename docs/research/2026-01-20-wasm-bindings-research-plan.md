# Research Plan: WASM Bindings for Image Decoding Pipeline

**Date**: 2026-01-20
**Related Plan**: [Image Decoding Plan](../plans/2026-01-20-image-decoding-plan.md)
**Phase**: Phase 6 - WASM Bindings

## Objective

Research best practices and implementation approaches for exposing the Rust image decoding pipeline (JPEG decode, RAW thumbnail extraction, resize) to JavaScript via WebAssembly bindings.

---

## Research Areas

### 1. wasm-bindgen Patterns for Image Data

**Questions to answer:**
- What is the best way to return large pixel buffers from Rust to JS?
- Should we return `Vec<u8>` or provide direct memory views?
- How do we avoid unnecessary copies between Rust and JS?
- What are the memory ownership patterns for WASM image data?

**Sources:**
- wasm-bindgen documentation
- rustwasm book
- Existing image-processing WASM projects (Squoosh, etc.)

**Deliverable:** Summary of recommended patterns for pixel buffer transfer

---

### 2. Memory Management in Image WASM Modules

**Questions to answer:**
- How do we handle WASM memory limits (4GB for wasm32)?
- What's the pattern for releasing memory after JS is done with pixel data?
- Should we use manual memory management or rely on wasm-bindgen's automatic handling?
- How do we prevent memory leaks when processing multiple images?

**Sources:**
- wasm-bindgen memory documentation
- Web Workers and WASM memory considerations
- Real-world WASM image processing implementations

**Deliverable:** Memory management strategy document

---

### 3. Error Handling Across WASM Boundary

**Questions to answer:**
- How do we convert Rust `Result<T, E>` to JavaScript exceptions/values?
- What's the recommended pattern for error types in wasm-bindgen?
- Should errors be strings, error codes, or structured objects?
- How do we provide meaningful error messages to the JS side?

**Sources:**
- wasm-bindgen error handling documentation
- wasm-bindgen `Result` and `JsValue` patterns

**Deliverable:** Error handling pattern recommendation

---

### 4. TypeScript Type Generation

**Questions to answer:**
- How does wasm-bindgen generate TypeScript definitions?
- Can we customize the generated types?
- What's the best way to organize types for the WASM API?
- How do we ensure type safety between Rust and TypeScript?

**Sources:**
- wasm-bindgen typescript attribute documentation
- wasm-pack TypeScript output options

**Deliverable:** TypeScript generation configuration guide

---

### 5. WASM Module Build Configuration

**Questions to answer:**
- What are the optimal wasm-pack build flags for production?
- How do we minimize WASM bundle size for image operations?
- Should we use `wasm-opt` and what optimization level?
- How do we handle the `--target web` vs `--target bundler` choice?

**Sources:**
- wasm-pack documentation
- wasm-opt optimization guide
- Existing monorepo WASM setups

**Deliverable:** Build configuration and optimization guide

---

### 6. Existing Literoom WASM Crate Review

**Questions to answer:**
- What's the current state of `literoom-wasm` crate?
- What patterns are already established?
- What needs to be added for decode bindings?
- Are there any existing abstractions to reuse?

**Sources:**
- `crates/literoom-wasm/` code review

**Deliverable:** Current crate assessment and integration plan

---

## Research Order

1. **Area 6: Existing Literoom WASM Crate Review** - Understand what we have
2. **Area 1: wasm-bindgen Patterns for Image Data** - Core pattern for pixel buffers
3. **Area 2: Memory Management** - Critical for image processing
4. **Area 3: Error Handling** - Needed for robust API
5. **Area 4: TypeScript Type Generation** - Developer experience
6. **Area 5: WASM Module Build Configuration** - Production readiness

---

## Success Criteria

- Clear understanding of how to expose pixel buffers efficiently
- Memory management strategy that prevents leaks
- Error handling pattern that works well from JS
- TypeScript types that provide good DX
- Build configuration optimized for web deployment
