# Edit View Preview Fix Research Plan

**Date**: 2026-01-21
**Issue**: Edit view preview not loading (Critical)

## Problem Statement

When entering edit view by double-clicking a thumbnail:
- Preview shows "Loading preview..." indefinitely
- Header shows "0 / 0" instead of current asset position
- Filename is missing
- Format/Size show "-"
- Filmstrip is not rendered
- Adjustment sliders render correctly but cannot affect preview

This appears to be a state management issue where the edit view cannot access asset data from the catalog store.

## Research Areas

### Area 1: Edit Page State Management
- How does the edit page (`/edit/[id].vue`) retrieve asset data?
- What stores does it depend on?
- Is `assetId` being properly extracted from the route?
- Is the catalogStore being properly accessed?

### Area 2: Catalog Store Integration
- How does the catalog store manage assets?
- Is `currentAsset` or similar being populated?
- What is the flow when navigating to edit view?

### Area 3: Edit Store Initialization
- How does the edit store initialize when entering edit view?
- Is `setCurrentAsset` or equivalent being called?
- What state needs to be set for preview to work?

### Area 4: Preview Loading Flow
- How does `useEditPreview` load the preview?
- What conditions must be met for preview to load?
- Are there any null checks or guards that might be blocking?

### Area 5: Navigation Flow
- How does the user get to edit view (from catalog grid)?
- What happens on double-click of a thumbnail?
- Is routing working correctly?

## Expected Outputs

- Root cause identification
- Fix strategy
- Specific files and lines to modify
