# Permission Recovery Research Plan

**Date**: 2026-01-21
**Phase**: 6.5 - PermissionRecovery Component
**Goal**: Research patterns and best practices for implementing permission recovery UI for folder re-authorization.

---

## Research Areas

### Area 1: File System Access API Permission States
**Questions**:
- What permission states does the File System Access API return?
- How do we detect when permission is lost vs never granted?
- How do we prompt for re-authorization?
- What's the proper flow for querying and requesting permissions?

### Area 2: Existing FileSystemProvider Integration
**Questions**:
- How does our existing `FileSystemProvider` handle permission state?
- What methods are available for checking and requesting permissions?
- How do we restore persisted folder handles?
- What's the current error handling approach?

### Area 3: Nuxt UI Modal Patterns
**Questions**:
- What's the correct UModal API in Nuxt UI 4?
- How to handle modal open state with Pinia?
- What props are available for title, dismissible, etc.?
- How to structure modal content and footer slots?

### Area 4: Similar App Permission Recovery UX
**Questions**:
- How do other File System Access API apps handle permission loss?
- What are common patterns for re-authorization flows?
- How should we communicate folder status to users?
- What actions should be available (retry, choose different, continue)?

### Area 5: Store Integration Patterns
**Questions**:
- How do existing Pinia stores in the project handle async operations?
- What's the pattern for stores that need to interact with browser APIs?
- How should the permission recovery store integrate with catalogStore?
- When should the modal be shown vs hidden?

---

## Research Outputs

Each area should produce:
1. Key findings relevant to our implementation
2. Code patterns or examples
3. Recommendations for Phase 6.5 implementation

## Synthesis Document

After all research is complete, create a synthesis document that:
1. Summarizes key decisions
2. Defines the exact implementation approach
3. Lists files to create/modify
4. Provides code templates where helpful
