# UI Components Research Plan (Phase 6)

**Date**: 2026-01-21
**Objective**: Research patterns for implementing the catalog UI components - virtual scrolling grid, thumbnail display, filtering, and permission recovery.

---

## Research Areas

### Area 1: Virtual Scrolling with @tanstack/vue-virtual
**Questions**:
- How to set up @tanstack/vue-virtual for a responsive grid layout?
- How to handle dynamic column counts based on container width?
- How to implement viewport-aware thumbnail priority updates?
- What are the performance patterns for 1000+ items?
- How to integrate with scroll containers and maintain smooth scrolling?

**Research sources**:
- @tanstack/vue-virtual documentation
- Vue 3 virtual scroll examples
- Photo gallery implementations

### Area 2: Thumbnail Component Patterns
**Questions**:
- How to show loading states (skeleton/placeholder)?
- How to handle image load errors gracefully?
- How to display selection states (single, multi-select)?
- How to show flag badges (pick/reject indicators)?
- What's the best pattern for click handling with modifiers (Ctrl, Shift)?
- How to handle intersection observer for visibility detection?

**Research sources**:
- Existing codebase patterns
- Nuxt UI component patterns
- Lightroom/Capture One UI patterns

### Area 3: Filter Bar and Sorting UI
**Questions**:
- What Nuxt UI components to use for filter buttons?
- How to show filter counts efficiently?
- Best UX patterns for sort direction toggle?
- How to handle keyboard shortcuts for filtering (if applicable)?

**Research sources**:
- Nuxt UI 4 documentation
- Similar photo management apps

### Area 4: Permission Recovery Modal
**Questions**:
- When should the permission recovery UI appear?
- What's the user flow for re-authorizing folders?
- How to handle partial permission states?
- What Nuxt UI modal/dialog components to use?

**Research sources**:
- File System Access API permission patterns
- Existing FileSystemProvider implementation

### Area 5: Keyboard Navigation
**Questions**:
- How to implement arrow key navigation in grid?
- How to handle focus management?
- What are the expected shortcuts (P, X, U for flagging)?
- How to prevent conflicts with system shortcuts?

**Research sources**:
- Spec.md keyboard requirements
- Vue keyboard event handling patterns

### Area 6: Existing Codebase Review
**Questions**:
- What components already exist in apps/web/app/components?
- What Nuxt UI patterns are established?
- How are stores already being used?
- What CSS patterns are in use?

**Research sources**:
- apps/web/app/components/*
- apps/web/app/stores/*
- apps/web/nuxt.config.ts

---

## Parallel Research Strategy

Launch 6 sub-agents in parallel to research each area:
1. Agent 1: @tanstack/vue-virtual patterns
2. Agent 2: Thumbnail component patterns
3. Agent 3: Filter bar and sorting UI
4. Agent 4: Permission recovery modal
5. Agent 5: Keyboard navigation
6. Agent 6: Existing codebase review

---

## Expected Outputs

Each research area should produce:
- Recommended implementation patterns
- Code examples where applicable
- Dependencies needed
- Potential pitfalls to avoid
- Integration points with existing code

Final synthesis should include:
- Complete component structure
- Props/emits for each component
- Store integration patterns
- CSS/styling approach
- Testing considerations
