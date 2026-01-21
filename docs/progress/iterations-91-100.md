# Iterations 91-100

## 91: 2026-01-21 16:46 EST: Copy/Paste Settings - Implementation Plan Created

**Objective**: Create an implementation plan for the copy/paste settings feature.

**Background**: Research was completed in iteration #90. The feature allows users to copy edit settings from one photo and paste them selectively to one or many other photos. Research found that 90% of the infrastructure already exists.

**Plan Created**: `docs/plans/2026-01-21-copy-paste-settings-plan.md`

**6-Phase Implementation**:

1. **Phase 1**: Create editClipboard store
   - Track copied settings data and source asset
   - Track which groups are selected for copy
   - Provide clear() method

2. **Phase 2**: Create useCopyPasteSettings composable
   - Implement copySettings() with modal display
   - Implement pasteSettings() with selection store integration
   - Use VueUse useClipboard() for browser API

3. **Phase 3**: Create EditCopySettingsModal component
   - Checkbox groups: Basic Adjustments, Tone Curve, Crop, Rotation
   - Preset buttons: All, Modified, None
   - Crop/Rotation excluded by default (safety)

4. **Phase 4**: Implement paste logic
   - Single paste in Edit view (current asset)
   - Batch paste in Grid view (all selected assets)
   - Use edit store setAdjustments() for partial updates

5. **Phase 5**: Add keyboard shortcuts
   - Cmd+Shift+C: Open copy dialog
   - Cmd+Shift+V: Paste settings
   - Ignore when in input fields

6. **Phase 6**: UI integration
   - Add Copy/Paste buttons to EditControlsPanel
   - Add toast notifications for success/error
   - Show clipboard state indicator

**Files to Create** (4 files):
- `apps/web/app/stores/editClipboard.ts`
- `apps/web/app/composables/useCopyPasteSettings.ts`
- `apps/web/app/components/edit/EditCopySettingsModal.vue`
- `apps/web/app/components/edit/EditPasteToast.vue`

**Files to Modify** (3 files):
- `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
- `apps/web/app/components/edit/EditControlsPanel.vue` - Copy/Paste buttons
- `apps/web/app/components/catalog/CatalogGrid.vue` - Grid paste support

**Status**: Plan created. Ready for implementation.

---
