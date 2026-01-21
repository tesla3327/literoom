# Phase 7: Integration and Testing Research Plan

**Date**: 2026-01-21
**Objective**: Research patterns and best practices for demo mode, E2E testing, and mock services.

---

## Research Areas

### Area 1: Demo Mode Architecture
**Goal**: Understand how to implement a deterministic demo mode for E2E tests and local development.

Questions:
1. How should demo images be bundled (static assets vs generated)?
2. How to mock File System Access API for demo mode?
3. How to structure mock responses for thumbnail generation?
4. How to enable/disable demo mode (env var, query param, config)?

Key files to examine:
- `packages/core/src/filesystem/browser.ts` - Existing FS implementation
- `apps/web/nuxt.config.ts` - Runtime config patterns
- `apps/web/app/plugins/decode.client.ts` - Existing plugin pattern

### Area 2: Mock Services
**Goal**: Design mock implementations for CatalogService and supporting services.

Questions:
1. What interface points need mocking (DecodeService, FileSystemProvider)?
2. How to create MockCatalogService with deterministic behavior?
3. How to simulate scan progress for UI testing?
4. How to provide pre-generated thumbnails?

Key files to examine:
- `packages/core/src/decode/mock-decode-service.ts` - Existing mock pattern
- `packages/core/src/catalog/catalog-service.ts` - Service interface

### Area 3: Playwright E2E Testing
**Goal**: Understand Playwright setup for Nuxt 4 with mock services.

Questions:
1. How to inject mock services before page load?
2. How to test keyboard navigation (P/X/U shortcuts)?
3. How to test virtual scrolling performance?
4. How to capture and verify thumbnail loading states?

Key files to examine:
- `apps/web/e2e/` - Existing E2E structure
- `apps/web/playwright.config.ts` - Current configuration
- `apps/web/test/` - Unit test patterns

### Area 4: Nuxt Plugin Integration
**Goal**: Wire CatalogService with Pinia stores in Nuxt plugin.

Questions:
1. How to connect CatalogService callbacks to Pinia store actions?
2. How to handle service initialization errors?
3. How to expose service to both plugin and composable?
4. When to call loadFromDatabase() for session restoration?

Key files to examine:
- `apps/web/app/plugins/decode.client.ts` - Existing plugin
- `apps/web/app/stores/catalog.ts` - Store implementation
- `apps/web/app/pages/index.vue` - Current page integration

### Area 5: Test Fixtures and Demo Assets
**Goal**: Determine how to provide test images for demo mode.

Questions:
1. What image dimensions for demo thumbnails (150x150)?
2. How many demo assets (10-50 for testing)?
3. Should we use generated solid color images or real photos?
4. How to vary flag states for testing filter functionality?

### Area 6: Codebase Review
**Goal**: Review existing patterns for integration points.

Questions:
1. What's the current state of the index.vue page integration?
2. How are stores currently connected to services?
3. What E2E tests already exist?
4. What patterns should we follow for consistency?

---

## Research Tasks

1. **Area 1**: Demo Mode Architecture - Examine existing code, research Nuxt runtime config
2. **Area 2**: Mock Services - Review MockDecodeService, design MockCatalogService
3. **Area 3**: Playwright E2E - Check existing tests, research mock injection
4. **Area 4**: Nuxt Plugin - Review existing plugins, plan CatalogService integration
5. **Area 5**: Test Fixtures - Determine demo asset strategy
6. **Area 6**: Codebase Review - Check current integration state

---

## Expected Outputs

1. Synthesis document with implementation recommendations
2. Demo mode architecture diagram
3. Mock service interface specifications
4. E2E test scenarios list
