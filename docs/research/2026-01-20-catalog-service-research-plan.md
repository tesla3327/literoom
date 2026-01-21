# Research Plan: Catalog Service Integration

**Date**: 2026-01-20
**Status**: Complete
**Priority**: Critical (enables primary user workflow)

## Objective

Research and design the Catalog Service - the core system that manages folder scanning, asset discovery, thumbnail generation, and persistent state. This enables the primary workflow: user selects folder → app scans → thumbnails appear → user can start culling.

---

## Context

### Dependencies (Already Complete)
- ✅ File System abstraction layer (`packages/core/src/filesystem/`)
- ✅ DecodeService for thumbnail generation (`packages/core/src/decode/`)
- ✅ WASM bindings for JPEG/RAW decoding

### What the Catalog Service Needs to Do

From the spec (section 2.2, 3.3, 5.1):
1. **Folder Selection & Persistence**: Store folder handles, persist across sessions
2. **Asset Discovery**: Scan folder recursively, detect supported file types (JPEG, ARW)
3. **Thumbnail Generation**: Generate thumbnails asynchronously, prioritize visible items
4. **State Persistence**: Store catalog metadata, asset list, flags, edit settings
5. **Incremental Rescans**: Detect new/removed files, update caches

---

## Research Areas

### Area 1: IndexedDB/OPFS Architecture for Catalog Persistence

**Questions to Answer:**
- What's the best IndexedDB schema for storing asset metadata and flags?
- Should thumbnails go in IndexedDB or OPFS?
- How to structure data for efficient queries (filtered views, sorting)?
- How to handle catalog versioning for migrations?

**Research Tasks:**
- [ ] Review existing IndexedDB patterns in photo apps (Pixlr, Squoosh, Photopea)
- [ ] Evaluate OPFS vs IndexedDB for binary blob storage (thumbnails)
- [ ] Research Dexie.js vs raw IndexedDB vs idb-keyval for our use case
- [ ] Define initial schema for Asset, Folder, and Settings tables

---

### Area 2: Folder Scanning and File Discovery

**Questions to Answer:**
- How to efficiently iterate large folders (1000s of files) without blocking?
- What's the best pattern for recursive vs non-recursive scanning?
- How to detect supported file types quickly (extension vs header check)?
- How to handle permission errors during scan?

**Research Tasks:**
- [ ] Review File System Access API directory iteration patterns
- [ ] Design async iterator pattern for file discovery
- [ ] Define supported file extensions and MIME types
- [ ] Plan error recovery for permission/access issues

---

### Area 3: Thumbnail Generation Pipeline

**Questions to Answer:**
- How to queue thumbnail generation efficiently?
- How to prioritize visible items in the grid?
- How to handle cancellation when user scrolls away?
- How to cache thumbnails persistently?

**Research Tasks:**
- [ ] Research priority queue patterns for thumbnail generation
- [ ] Design integration between Catalog and DecodeService
- [ ] Plan thumbnail caching strategy (in-memory LRU + persistent storage)
- [ ] Define thumbnail size and quality parameters

---

### Area 4: Reactive State Management (Vue/Pinia)

**Questions to Answer:**
- Should catalog state live in Pinia or a standalone service?
- How to efficiently update UI when thumbnails complete?
- How to handle large asset lists (virtual scrolling integration)?
- How to structure state for filtering (Picks/Rejects/Unflagged)?

**Research Tasks:**
- [ ] Review Pinia patterns for large collections
- [ ] Design reactive asset list structure
- [ ] Plan filter/sort implementation
- [ ] Define TypeScript interfaces for catalog state

---

### Area 5: Permission Recovery and Folder Handle Persistence

**Questions to Answer:**
- How to store and restore folder handles across sessions?
- How to detect when permission is revoked?
- What's the best UX for permission recovery flow?
- How to handle "folder moved/renamed" scenarios?

**Research Tasks:**
- [ ] Review File System Access API handle serialization
- [ ] Design permission check flow on app startup
- [ ] Plan recovery UI component structure
- [ ] Handle edge cases (offline, folder deleted)

---

### Area 6: Existing Codebase Review

**Questions to Answer:**
- What's the current state of the filesystem abstraction?
- Are there patterns we should follow from the decode service?
- What types/interfaces already exist that we should extend?

**Research Tasks:**
- [ ] Review `packages/core/src/filesystem/` implementation
- [ ] Review DecodeService patterns for service design
- [ ] Identify reusable patterns (error handling, async factories)
- [ ] Check for any catalog-related stubs or TODOs

---

## Research Approach

1. **Area 6 First**: Review existing codebase to understand current patterns
2. **Areas 1-5 in Parallel**: Use sub-agents to research each area concurrently
3. **Synthesis**: Combine findings into implementation plan

---

## Expected Outputs

1. Research documents for each area in `docs/research/`
2. Synthesis document with key decisions
3. Implementation plan in `docs/plans/2026-01-20-catalog-service-plan.md`

---

## Success Criteria

After research, we should be able to answer:
- [ ] What's the IndexedDB schema for catalog persistence?
- [ ] How does folder scanning work end-to-end?
- [ ] How does thumbnail generation integrate with the grid?
- [ ] How do we handle permission persistence and recovery?
- [ ] What Pinia stores do we need?
