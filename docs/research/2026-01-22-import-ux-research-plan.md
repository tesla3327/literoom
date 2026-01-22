# Import UX Improvements - Research Plan

**Date**: 2026-01-22
**Objective**: Understand the current import flow and identify opportunities to improve UX

## Research Areas

### Area 1: Current Import Flow Architecture
- How does folder scanning work (CatalogService, scanner)?
- What events/callbacks are emitted during scanning?
- How does the thumbnail queue work (ThumbnailService)?
- What are the priority levels and how are they used?

### Area 2: UI State Management During Import
- How does the FilterBar show scanning progress?
- What loading states exist in CatalogGrid?
- How is the "scanning" state propagated to UI?
- What happens when scanning completes?

### Area 3: ThumbnailService Queue System
- How are thumbnails prioritized?
- What is the batch size for processing?
- How does the queue interact with visibility?
- Can we prioritize first-page thumbnails?

### Area 4: First-Page Optimization Strategies
- What is the grid layout (columns, rows visible)?
- How many thumbnails fit on first screen?
- Can we delay navigation until first page ready?
- What UX pattern is best (interstitial vs inline progress)?

### Area 5: Progress Indicator Patterns
- What Nuxt UI 4 components exist for progress?
- How do similar apps (Lightroom, Photos) handle import?
- What are best practices for long-running operations?

## Expected Output
A synthesis document with:
1. Current architecture diagram
2. Identified pain points
3. Proposed solutions with trade-offs
4. Implementation recommendations
