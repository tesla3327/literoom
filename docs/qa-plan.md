# Literoom QA Plan - Comprehensive Manual Testing

## Overview
This document provides a complete manual testing checklist for the Literoom photo editing application. Test all functionality systematically to catch bugs.

---

## 1. Application Startup & Initialization

### 1.1 Initial Load
- [ ] App loads without errors in console
- [ ] Welcome screen displays when no folder selected
- [ ] Literoom logo and description visible
- [ ] "Choose Folder" button is visible and clickable
- [ ] Recent folders list displays (if previously used)
- [ ] GPU status indicator shows in header

### 1.2 GPU Detection
- [ ] GPU status badge appears (green = WebGPU, gray = WASM fallback)
- [ ] Tooltip shows detailed GPU status on hover
- [ ] App functions correctly with GPU disabled (test in Firefox or Safari)
- [ ] Graceful fallback to WASM when GPU unavailable

---

## 2. Folder Selection & Management

### 2.1 Choose Folder
- [ ] Clicking "Choose Folder" opens system folder picker
- [ ] Selecting a folder initiates scanning
- [ ] Cancelling folder picker returns to previous state without error
- [ ] Only supported formats detected (.jpg, .jpeg, .arw)
- [ ] Unsupported files ignored silently
- [ ] Empty folder shows appropriate message

### 2.2 Folder Scanning
- [ ] Scan progress indicator shows during scan
- [ ] File count updates during scanning
- [ ] Thumbnail generation progress bar appears
- [ ] "Preparing gallery..." message with ready/total counts
- [ ] Large folders (1000+ images) scan without timeout
- [ ] Scan can be interrupted by selecting new folder

### 2.3 Recent Folders
- [ ] Recent folders dropdown shows previous folders
- [ ] Each folder shows last scan date (e.g., "2 minutes ago")
- [ ] Inaccessible folders show lock icon
- [ ] Clicking recent folder opens it
- [ ] "Choose New Folder" option at bottom works
- [ ] Loading indicator shows when opening folder

### 2.4 Permission Recovery
- [ ] Modal appears when folder permissions expire
- [ ] Per-folder "Re-authorize" button works
- [ ] "Retry All" attempts all re-authorizations
- [ ] "Choose Different Folder" option works
- [ ] "Continue" proceeds with accessible folders
- [ ] Error messages display for failed re-auth

### 2.5 Rescan
- [ ] "Rescan" button triggers folder rescan
- [ ] Spinning icon shows during rescan
- [ ] New files detected and added
- [ ] Modified files detected and updated
- [ ] Deleted files handled appropriately
- [ ] Rescan disabled during export

---

## 3. Catalog Grid View

**Tested**: 2026-01-25 | **Status**: PASS

### 3.1 Thumbnail Display
- [x] Grid displays with responsive columns (2-5 based on width) - verified at 800px and 1920px viewports
- [ ] Thumbnails show loading skeleton during generation - not observed (demo mode loads instantly)
- [x] Thumbnails display correctly when ready
- [x] Filename visible below thumbnails (not tooltip - design shows filename directly)
- [ ] Error state shows failed icon for broken images - not tested
- [x] Virtual scrolling works for large libraries - verified with 50 images

### 3.2 Thumbnail States
- [ ] Pending: shimmer skeleton animation - not observed in demo mode
- [ ] Loading: reduced opacity indicator - not observed in demo mode
- [x] Ready: full image displayed
- [ ] Error: error icon with "Failed" label - not tested
- [ ] Regenerating: reduced opacity on existing image - not tested

### 3.3 Grid Navigation (Keyboard)
- [x] Arrow Left: move to previous photo
- [x] Arrow Right: move to next photo
- [x] Arrow Up: move to photo above
- [x] Arrow Down: move to photo below
- [ ] Navigation wraps at row ends appropriately - not tested
- [x] Focus ring visible on current photo
- [x] Scrolling follows keyboard navigation

### 3.4 Selection
- [x] Single click selects photo (cyan ring)
- [x] Current/focused photo has blue ring with offset
- [x] Ctrl/Cmd+Click toggles selection
- [x] Shift+Click selects range - verified 6 items selected
- [x] Selection count shows in header ("X selected")
- [x] Selected gridcells have [selected] attribute
- [ ] Delete key deletes selected photos (with confirmation) - not tested

### 3.5 Double-Click to Edit
- [x] Double-clicking thumbnail opens edit view
- [x] Preview generation starts before navigation
- [x] Smooth transition to edit view
- [x] G key returns to grid from edit view

---

## 4. Photo Flagging (Culling)

**Tested**: 2026-01-25 | **Status**: PARTIAL PASS (1 bug found)

### 4.1 Flag Status Display
- [x] Green checkmark badge for "Pick" (top-left) - verified, badge present in DOM with green icon
- [x] Red X badge for "Reject" (top-left) - verified, visible as small red circle
- [x] No badge for unflagged photos - verified
- [x] Badges update in real-time - verified, counts update immediately

### 4.2 Keyboard Flagging
- [x] P key marks as Pick - verified
- [x] X key marks as Reject - verified
- [x] U key removes flag (unflag) - verified
- [ ] Flag changes persist after page refresh - NOT IN DEMO MODE (resets to mock data)
- [ ] Flagging works on multiple selected photos - **BUG**: Only flags current photo, not all selected (see issues.md)

### 4.3 Flag Filters
- [x] "All" filter shows all photos with count - verified (50 photos)
- [x] "Picks" filter shows only picks with count - verified (shows only green-badged photos)
- [x] "Rejects" filter shows only rejects with count - verified (shows only red-badged photos)
- [x] "Unflagged" filter shows unflagged with count - verified (shows photos without badges)
- [x] Badge counts are accurate - verified (23 picks + 10 rejects + 17 unflagged = 50 total)
- [ ] Zero counts hide the badge - not tested (would require unflagging all)

---

## 5. Filter Bar & Sorting

**Tested**: 2026-01-25 | **Status**: PARTIAL PASS (sorting broken)

### 5.1 Filter Modes
- [x] All photos displayed by default - verified (50 photos)
- [x] Switching filters updates grid immediately - verified (Picks=23, Rejects=10, Unflagged=17)
- [x] Filter persists during session - verified (Unflagged filter persisted after edit view round-trip)
- [ ] "No photos to display" message when filter empty - not tested (would require unflagging all photos)

### 5.2 Sort Options
- [ ] Date (newest) - default, appears to work
- [ ] Date (oldest) - **BUG**: Does not reorder grid (see issues.md)
- [ ] Name (A-Z) - **BUG**: Does not reorder grid
- [ ] Name (Z-A) - **BUG**: Does not reorder grid
- [ ] Size (largest) - **BUG**: Does not reorder grid
- [ ] Size (smallest) - **BUG**: Does not reorder grid
- [ ] Current sort shown in dropdown button - **BUG**: Always shows "Date (newest)"
- [ ] Sort persists during session - not testable due to above bugs

### 5.3 Progress Indicators
- [ ] Thumbnail progress bar shows during generation - not observed (demo mode loads instantly)
- [x] Rescan progress indicator appears - button clicked, operation completed
- [x] Export progress with file count and percentage - export modal opens with count (23 Images)

---

## 6. Edit View Navigation

**Tested**: 2026-01-25 | **Status**: PASS

### 6.1 Entering Edit View
- [x] Double-click from grid enters edit view - verified, navigates to /edit/[id]
- [x] E key enters edit view - verified (requires focus on gridcell first)
- [x] Enter key enters edit view - verified
- [x] D key enters edit view - verified
- [x] URL updates to /edit/[id] - verified, shows /edit/demo-asset-X

### 6.2 Edit View Header
- [x] Back button returns to grid - verified, arrow-left icon navigates to /
- [x] Filename displayed correctly - verified, shows "IMG_0008.arw"
- [x] Navigation arrows work (previous/next) - verified, chevron icons
- [x] Position indicator shows "X / Y" - verified, shows "8 / 50"
- [x] Arrows disabled at first/last photo - verified (prev disabled at 1/50, next disabled at 50/50)
- [x] GPU status badge visible - verified in FilterBar (shows "GPU: Unknown" status with bolt icon)

### 6.3 Keyboard Navigation (Edit View)
- [x] Arrow Left: previous photo - verified (9/50 → 8/50)
- [x] Arrow Right: next photo - verified (8/50 → 9/50)
- [x] Escape: return to grid (unless crop active) - verified
- [x] G: return to grid - verified
- [x] Navigation respects current filter - verified (shows "19 / 23" when Picks filter active)

### 6.4 Filmstrip (Bottom)
- [x] Horizontal filmstrip shows thumbnails - verified (data-testid="edit-filmstrip")
- [x] Current photo has blue ring - verified (ring-primary class)
- [x] Other photos have reduced opacity - verified (opacity-60 class)
- [x] Click thumbnail navigates to that photo - verified
- [x] Filmstrip scrolls to keep current centered - verified (current photo always visible)
- [x] "..." indicators for hidden items - verified (shows position indicators)

### Edge Cases Tested
- [x] Rapid navigation (5 arrow presses in quick succession) - works correctly
- [x] Filter + navigation combination - works correctly

---

## 7. Basic Adjustments

**Tested**: 2026-01-25 | **Status**: PARTIAL PASS (1 bug found)

### 7.1 White Balance
- [x] Temperature slider: -100 to +100 - verified via aria-valuemin/max
- [x] Temperature negative = warmer (orange) - visual effect observed
- [x] Temperature positive = cooler (blue) - visual effect observed
- [x] Tint slider: -100 to +100 - verified via aria-valuemin/max
- [x] Tint negative = green - visual effect observed
- [x] Tint positive = magenta - visual effect observed

### 7.2 Tone Adjustments
- [x] Exposure slider: -5 to +5 (0.01 step) - verified, 10 arrow presses = 0.10
- [x] Exposure affects overall brightness - max exposure (+5) visibly brightens image
- [x] Contrast slider: -100 to +100 - verified
- [x] Highlights slider: -100 to +100 - verified
- [x] Shadows slider: -100 to +100 - verified
- [x] Whites slider: -100 to +100 - verified
- [x] Blacks slider: -100 to +100 - verified

### 7.3 Presence Adjustments
- [x] Vibrance slider: -100 to +100 - verified
- [ ] Vibrance protects skin tones - not tested (requires skin tone image analysis)
- [x] Saturation slider: -100 to +100 - verified
- [ ] Saturation affects all colors equally - not quantitatively tested

### 7.4 Slider Interactions
- [x] Values display with +/- prefix - verified (shows "+10" for positive values)
- [x] Double-click label resets to 0 - verified
- [x] Alt+click label resets to 0 - verified
- [x] Preview updates in real-time - verified (histogram and preview update)
- [x] Decimal places based on step size - Exposure shows 2 decimals (+0.10), others show integers
- [x] Values clamped to min/max - verified (Exposure cannot exceed +5.00)

### 7.5 Adjustments Persistence
- [ ] Changes persist when navigating away - **BUG**: Adjustments lost when navigating to another photo and back (see issues.md)
- [ ] Changes persist after page refresh - not tested (blocked by above bug)
- [ ] Changes reflected in thumbnail - not tested (blocked by above bug)

### Additional Findings
- [x] Reset button works - resets all adjustments to defaults
- [x] Reset button disabled when no changes
- [x] Reset button enabled when changes present

---

## 8. Tone Curve

**Tested**: 2026-01-25 | **Status**: PARTIAL PASS (persistence bug - same as Section 7)

### 8.1 Canvas Interaction
- [x] Click adds control point - verified, clicking on curve adds new point
- [x] Drag adjusts point position - verified, dragging moves point and curves updates
- [x] Double-click deletes point - verified, dispatched dblclick event deletes non-anchor points
- [x] Cannot delete anchor points (first/last) - verified, double-click on corners has no effect
- [x] Minimum 2 points maintained - verified, always at least 2 anchor points present

### 8.2 Visual Feedback
- [x] Grid lines visible - verified, gray grid lines in background
- [x] Diagonal reference line (dashed) - visible as light reference line
- [x] Curve line renders smoothly - verified, smooth bezier-like curves
- [x] Control points visible with outlines - verified, white circles with outlines
- [x] Hovered point changes color (blue) - verified, point turns blue on hover
- [x] Dragging point changes color (light blue) - verified, blue indicates active state
- [x] Cursor changes to grab/grabbing - verified (cursor-grab class on canvas)

### 8.3 Curve Behavior
- [x] Curve is monotonic (no crossing) - verified, multiple points maintain smooth S-curve
- [x] Preview updates during drag - verified, histogram and image update in real-time
- [x] "Adjusting..." status during drag - verified, status text appears during drag
- [x] Reset button appears when modified - verified, appears next to "Tone Curve" label
- [x] Reset restores linear curve - verified, resets to straight diagonal line
- [ ] Changes persist when navigating - **BUG**: Tone curve resets to linear when navigating away and back (same as Section 7 persistence bug)

### Additional Notes
- Instructions text at bottom: "Click to add point | Drag to adjust | Double-click to delete"
- Curve supports multiple control points (tested with 4+ points)
- S-curves and inverse curves render correctly

---

## 9. Crop & Transform

### 9.1 Rotation Controls
- [ ] "↺ 90°" rotates counter-clockwise
- [ ] "↻ 90°" rotates clockwise
- [ ] Angle slider: -180° to +180° (0.1° step)
- [ ] Straighten slider: -45° to +45° (0.1° step)
- [ ] Total rotation display shows combined angle
- [ ] Reset button clears rotation

### 9.2 Crop Aspect Ratios
- [ ] Free (unconstrained) works
- [ ] 1:1 (square) constrains correctly
- [ ] 16:9 constrains correctly
- [ ] 3:2 constrains correctly
- [ ] 4:5 constrains correctly
- [ ] 5:7 constrains correctly
- [ ] Aspect ratio maintained during resize

### 9.3 Crop Canvas Interaction
- [ ] Crop overlay visible when tool active
- [ ] 8 handles visible (corners + edges)
- [ ] Drag corners to resize
- [ ] Drag edges to resize single dimension
- [ ] Drag inside to move crop region
- [ ] Rule of thirds grid visible
- [ ] Dark overlay outside crop area

### 9.4 Crop Confirmation Workflow
- [ ] Action bar appears when crop active
- [ ] "Apply" button commits crop
- [ ] "Cancel" button reverts changes
- [ ] "Reset" button clears crop
- [ ] Enter key applies crop
- [ ] Escape key cancels crop
- [ ] Changes not applied until confirmed

### 9.5 Crop Values
- [ ] X (left) shows as percentage
- [ ] Y (top) shows as percentage
- [ ] W (width) shows as percentage
- [ ] H (height) shows as percentage
- [ ] "Adjusting..." shows during drag

---

## 10. Masks (Local Adjustments)

### 10.1 Mask List
- [ ] Empty state message when no masks
- [ ] Mask items show visibility toggle
- [ ] Mask type icon (linear vs radial)
- [ ] Delete button for each mask
- [ ] Selected mask highlighted
- [ ] Click to select mask

### 10.2 Creating Linear Mask
- [ ] "Linear" button starts drawing mode
- [ ] Indicator shows "Click and drag..."
- [ ] Click and drag creates gradient line
- [ ] Cancel button exits drawing mode
- [ ] Minimum distance enforced
- [ ] New mask appears in list

### 10.3 Creating Radial Mask
- [ ] "Radial" button starts drawing mode
- [ ] Indicator shows "Click and drag..."
- [ ] Click sets center, drag sets radius
- [ ] Cancel button exits drawing mode
- [ ] Minimum radius enforced
- [ ] New mask appears in list

### 10.4 Mask Editing
- [ ] Select mask to edit adjustments
- [ ] Same 10 adjustment sliders available
- [ ] Adjustments apply only within mask
- [ ] Feathering creates smooth transitions
- [ ] Visibility toggle hides/shows mask effect
- [ ] Delete removes mask

### 10.5 Mask Overlay Visualization
- [ ] Selected mask shows handles
- [ ] Linear: start and end handles
- [ ] Radial: center and radius handles
- [ ] Handles draggable to adjust
- [ ] Cursor changes for different operations
- [ ] Mask preview updates in real-time

### 10.6 Mask Keyboard Shortcuts
- [ ] Escape cancels drawing mode
- [ ] Delete removes selected mask

---

## 11. Copy/Paste Settings

### 11.1 Copy Settings Modal
- [ ] Opens with Cmd/Ctrl+Shift+C
- [ ] "All" button selects all groups
- [ ] "None" button deselects all
- [ ] Basic Adjustments checkbox (default: checked)
- [ ] Tone Curve checkbox (default: checked)
- [ ] Crop checkbox (default: unchecked)
- [ ] Rotation checkbox (default: unchecked)
- [ ] Copy button disabled if nothing selected
- [ ] Cancel button closes modal

### 11.2 Paste Settings
- [ ] Paste with Cmd/Ctrl+Shift+V
- [ ] Paste button in controls header
- [ ] Paste disabled if nothing copied
- [ ] Summary shows what was copied
- [ ] Settings applied to current photo
- [ ] Preview updates after paste

### 11.3 Copy/Paste Across Photos
- [ ] Copy from one photo
- [ ] Navigate to another photo
- [ ] Paste applies correctly
- [ ] Multiple pastes work

---

## 12. Histogram Display

### 12.1 Histogram Rendering
- [ ] Canvas/SVG toggle works
- [ ] RGB channels displayed (overlapping)
- [ ] Luminance distribution visible
- [ ] Updates in real-time during adjustments
- [ ] "Computing..." shows during calculation

### 12.2 Clipping Indicators
- [ ] Blue triangle for shadow clipping (top-left)
- [ ] Red triangle for highlight clipping (top-right)
- [ ] J key toggles clipping overlay
- [ ] Clipping preview shows on image
- [ ] Per-channel clipping detection

### 12.3 File Info
- [ ] Format shows file extension
- [ ] Size shows human-readable format

---

## 13. Zoom & Pan

### 13.1 Zoom Controls
- [ ] Z key toggles fit/100%
- [ ] Cmd/Ctrl+0: fit to view
- [ ] Cmd/Ctrl+1: 100% zoom
- [ ] Cmd/Ctrl++: zoom in
- [ ] Cmd/Ctrl+-: zoom out
- [ ] +/- buttons work
- [ ] Percentage display updates

### 13.2 Mouse Wheel Zoom
- [ ] Scroll up zooms in
- [ ] Scroll down zooms out
- [ ] Zooms toward cursor position
- [ ] Trackpad pinch zoom works
- [ ] Zoom sensitivity appropriate

### 13.3 Pan
- [ ] Space+drag pans image
- [ ] Pan only when zoomed in
- [ ] Cursor changes to grab/grabbing
- [ ] Pan bounded to image edges
- [ ] Double-click toggles fit/100%

### 13.4 Zoom State
- [ ] Zoom persists per-image
- [ ] Zoom restored when returning to image
- [ ] Fit preset centers image
- [ ] 100% shows native resolution

---

## 14. Export

### 14.1 Export Modal
- [ ] Opens via Export button
- [ ] Opens via Cmd/Ctrl+E
- [ ] Destination folder selection works
- [ ] Selected folder name displayed

### 14.2 Export Scope
- [ ] "Picks" exports flagged picks only
- [ ] "Selected" exports selected photos
- [ ] "All" exports entire library
- [ ] Count shows images to export
- [ ] Include rejected checkbox works

### 14.3 Filename Template
- [ ] Template input accepts text
- [ ] {orig} token works
- [ ] {seq:4} token works (padded sequence)
- [ ] {date} token works
- [ ] Invalid templates show error
- [ ] Empty template rejected

### 14.4 Export Settings
- [ ] Quality slider: 50-100
- [ ] Quality affects file size
- [ ] Resize presets work:
  - [ ] Original (no resize)
  - [ ] 2000px
  - [ ] 1920px
  - [ ] 1440px
  - [ ] 1024px
  - [ ] 800px

### 14.5 Export Progress
- [ ] Progress bar shows percentage
- [ ] Current file counter updates
- [ ] Filename being processed shown
- [ ] Modal not dismissible during export
- [ ] Cancel button aborts export

### 14.6 Export Results
- [ ] Success message on completion
- [ ] File collision handling (suffix added)
- [ ] Edits applied to exported files
- [ ] Rotation applied correctly
- [ ] Crop applied correctly
- [ ] Adjustments applied correctly

---

## 15. Keyboard Shortcuts (Global)

### 15.1 Grid View
- [ ] Arrow keys navigate grid
- [ ] P/X/U for flagging
- [ ] E/Enter/D enter edit view
- [ ] G goes to grid
- [ ] Delete deletes photo
- [ ] Cmd/Ctrl+E opens export
- [ ] ? opens help modal

### 15.2 Edit View
- [ ] Left/Right arrow navigate photos
- [ ] Escape/G returns to grid
- [ ] Cmd/Ctrl+Shift+C copies settings
- [ ] Cmd/Ctrl+Shift+V pastes settings
- [ ] J toggles clipping overlay
- [ ] Z toggles zoom
- [ ] Cmd/Ctrl+0/1/+/- zoom controls
- [ ] Space+drag pans
- [ ] Delete removes selected mask
- [ ] Enter applies crop
- [ ] Escape cancels crop/mask

### 15.3 Help Modal
- [ ] ? key opens modal
- [ ] Cmd/Ctrl+/ opens modal
- [ ] All shortcuts listed correctly
- [ ] Platform-specific modifiers shown
- [ ] Close button works

---

## 16. Preview Rendering

### 16.1 Quality Modes
- [ ] Draft quality during adjustments
- [ ] Full quality after settling
- [ ] Quality indicator visible
- [ ] Smooth transition between qualities

### 16.2 Rendering Performance
- [ ] Preview updates within 500ms
- [ ] No visible lag during slider drag
- [ ] GPU acceleration improves speed
- [ ] WASM fallback still functional

### 16.3 Rendering Errors
- [ ] Error message displays on failure
- [ ] Can retry after error
- [ ] Graceful degradation

---

## 17. File Format Support

### 17.1 JPEG Files
- [ ] .jpg files load correctly
- [ ] .jpeg files load correctly
- [ ] EXIF orientation applied
- [ ] Thumbnails generated correctly

### 17.2 RAW Files (Sony ARW)
- [ ] .arw files detected
- [ ] Thumbnail extraction fast (<50ms)
- [ ] Full decode works for editing
- [ ] Previews generate correctly

### 17.3 Invalid Files
- [ ] Corrupted JPEG shows error
- [ ] Empty files handled
- [ ] Wrong extension handled
- [ ] Truncated files handled

---

## 18. Error Handling

### 18.1 File System Errors
- [ ] Permission denied shows message
- [ ] Folder not found handled
- [ ] Disk full during export handled
- [ ] Network errors handled gracefully

### 18.2 GPU Errors
- [ ] GPU failure falls back to WASM
- [ ] Error count tracked
- [ ] Recovery after 3 errors
- [ ] User notified of fallback

### 18.3 Decode Errors
- [ ] Invalid format shows error
- [ ] Corrupted file shows error
- [ ] Timeout after 30 seconds
- [ ] Error thumbnail displayed

---

## 19. Browser Compatibility

### 19.1 Chrome/Edge (Primary)
- [ ] WebGPU acceleration works
- [ ] File System Access API works
- [ ] All features functional

### 19.2 Firefox
- [ ] WASM fallback used
- [ ] File System Access limited
- [ ] Core features work

### 19.3 Safari
- [ ] WASM fallback used
- [ ] File System Access limited
- [ ] Core features work

---

## 20. Performance Testing

### 20.1 Large Libraries
- [ ] 100 photos: smooth operation
- [ ] 500 photos: acceptable performance
- [ ] 1000+ photos: no crashes
- [ ] Virtual scrolling working

### 20.2 Large Files
- [ ] 50MB+ RAW files load
- [ ] High-res JPEG (6000x4000) works
- [ ] Memory usage reasonable

### 20.3 Rapid Operations
- [ ] Fast slider movement smooth
- [ ] Rapid navigation stable
- [ ] Multiple mask creation works
- [ ] No memory leaks after extended use

---

## 21. Data Persistence

### 21.1 Edit State
- [ ] Adjustments persist across navigation
- [ ] Adjustments persist across refresh
- [ ] Adjustments persist across sessions
- [ ] Multiple photos save independently

### 21.2 Catalog State
- [ ] Flag status persists
- [ ] Folder selection remembered
- [ ] Recent folders list maintained

### 21.3 UI State
- [ ] Filter mode persists in session
- [ ] Sort mode persists in session
- [ ] Zoom states cached per-image

---

## 22. Edge Cases

### 22.1 Empty States
- [ ] No folder selected: welcome screen
- [ ] Empty folder: appropriate message
- [ ] No picks for export: disabled button
- [ ] No masks: empty state message

### 22.2 Boundary Values
- [ ] All sliders at minimum
- [ ] All sliders at maximum
- [ ] Extreme tone curves
- [ ] Maximum zoom level
- [ ] Minimum zoom level

### 22.3 Rapid User Actions
- [ ] Double-click during loading
- [ ] Navigate during export
- [ ] Multiple mask draws quickly
- [ ] Rapid undo attempts (no undo system)

### 22.4 Concurrent Operations
- [ ] Scan while generating thumbnails
- [ ] Edit while export running
- [ ] Navigate during preview render

---

## Test Environment Notes

**Primary Test Browser**: Chrome/Edge (WebGPU support)
**Fallback Test Browser**: Firefox (WASM only)
**Test Images**: Mix of JPEG and Sony ARW files
**Test Library Sizes**: 10, 100, 500, 1000+ images

**Key File Locations**:
- Web app: `apps/web/`
- Core processing: `packages/core/`
- Rust engine: `crates/literoom-core/`
- E2E tests: `apps/web/e2e/`

---

## Bug Reporting Template

```
**Summary**: [One-line description]
**Steps to Reproduce**:
1.
2.
3.

**Expected Result**:
**Actual Result**:
**Browser/Platform**:
**GPU Status**: WebGPU / WASM fallback
**Screenshots**: [if applicable]
**Console Errors**: [if applicable]
```
