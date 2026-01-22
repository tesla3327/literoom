# Iterations 131-140

## 131: 2026-01-22 10:05 EST: Import UX Improvements - Research Started

**Objective**: Address the medium-severity issue "Import UX feels slow" to improve the first-impression experience when users open a folder.

**Problem Statement** (from issues.md):
The import experience feels slow and lacks feedback. Users are dropped into a gallery with loading placeholders without knowing the import progress.

**Suggested Improvements** (from issues.md):
1. Show scanning progress in the toolbar (currently only shows for scanning files, then disappears)
2. Show progress for the entire import process: scanning → processing thumbnails → processing preview images
3. Add a progress bar where it says "scanning" in the toolbar
4. Consider showing an interstitial/modal with "loading" instead of immediately showing the gallery with placeholders
5. Process the first page of thumbnails before showing the gallery
6. Ensure thumbnails are loaded when users are dropped into the gallery
7. Continue processing other thumbnails and previews in the background

**Goal**: When users enter the gallery, it should feel like they can immediately start using the app.

**Research Areas**:
1. Current import flow architecture (scanning, thumbnail queue, catalog store)
2. UI state management during import (toolbar, FilterBar, loading states)
3. ThumbnailService queue priority system
4. First-page thumbnail optimization strategies
5. Progress indicator patterns in Nuxt UI 4

**Status**: Complete - Research synthesis document created.

**Research Completed**:

Launched 4 parallel research agents to investigate:
1. Import flow architecture (CatalogService, ThumbnailService, scanning flow)
2. UI state management during import (FilterBar, CatalogGrid, loading states)
3. Thumbnail queue and priority system (ThumbnailQueue, ThumbnailPriority enum)
4. Nuxt UI progress components (UProgress, modal patterns)

**Key Findings**:

1. **Priority System Underutilized**
   - `ThumbnailPriority` enum exists (VISIBLE=0, NEAR_VISIBLE=1, PRELOAD=2, BACKGROUND=3)
   - Current code passes array index instead of enum values
   - `updateThumbnailPriority()` method exists but is never called
   - IntersectionObserver composable exists but isn't integrated

2. **Gallery Shows Too Early**
   - Gallery view appears as soon as scanning completes
   - Most thumbnails are still `pending` at this point
   - No indication of thumbnail generation progress

3. **No Feedback During Thumbnail Generation**
   - Scanning progress disappears when scan ends
   - Thumbnail generation (the longer phase) has no visible progress

**Proposed Solutions** (in order of recommended implementation):

| Solution | Effort | Impact |
|----------|--------|--------|
| Add thumbnail progress to FilterBar | Low (1-2h) | Medium |
| Wait for first-page thumbnails before showing gallery | Medium (4-6h) | High |
| Fix priority system to use ThumbnailPriority enum | Medium (3-4h) | Medium |
| Create import interstitial modal | High (6-8h) | High |

**Documents Created**:
- `docs/research/2026-01-22-import-ux-research-plan.md`
- `docs/research/2026-01-22-import-ux-synthesis.md`

---

