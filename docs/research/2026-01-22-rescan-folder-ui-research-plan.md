# Rescan Folder UI - Research Plan

## Problem Statement

The spec requires (section 3.3):
> Provide a "Rescan folder" action that:
> - finds new files
> - detects removed files
> - updates cache validity if file modified

The rescan functionality is fully implemented at the service level (`catalogService.rescanFolder()`), but there is **no UI button** to trigger it.

## Research Areas

### Area 1: UI Placement and Design
- Where should the Rescan button be placed? (FilterBar, Header, Context menu)
- What icon and label should be used?
- Should it be a primary or secondary action?
- How does Lightroom handle this?

### Area 2: Existing Codebase Review
- How does the current `rescanFolder()` method work?
- What events/callbacks does it trigger?
- How does the UI update when new assets are found?
- What happens to removed files in the current implementation?

### Area 3: User Feedback
- What feedback should users get during rescan?
- Should there be a progress indicator?
- What should happen after rescan completes? (toast, badge update)
- How should removed files be communicated?

## Research Sub-agents

1. **UI Placement Agent**: Research Lightroom's approach, Nuxt UI button patterns, FilterBar implementation
2. **Codebase Agent**: Review rescanFolder implementation, catalog store updates, asset management
3. **UX Agent**: Research feedback patterns for background operations in photo apps

## Expected Output

A synthesis document that provides:
1. Recommended UI placement (FilterBar vs Header)
2. Button design (icon, label, tooltip)
3. Feedback mechanism during/after rescan
4. Handling of removed files in UI
