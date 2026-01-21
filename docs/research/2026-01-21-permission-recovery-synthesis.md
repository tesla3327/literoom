# Permission Recovery Research Synthesis

**Date**: 2026-01-21
**Phase**: 6.5 - PermissionRecovery Component
**Research Plan**: [Permission Recovery Research Plan](./2026-01-21-permission-recovery-research-plan.md)

---

## Executive Summary

This document synthesizes research from 5 parallel investigations to guide the implementation of Phase 6.5: Permission Recovery. The goal is to create a smooth experience for users when folder access is lost and needs re-authorization.

---

## Key Findings

### 1. File System Access API Permission States

The API provides exactly **three permission states**:

| State | Meaning | Action Needed |
|-------|---------|---------------|
| `'granted'` | Full access available | Proceed normally |
| `'prompt'` | Need to request permission (or handle from storage) | Show re-auth button |
| `'denied'` | User explicitly denied | Show denied message, offer retry |

**Critical insight**: Handles loaded from IndexedDB typically return `'prompt'` even if previously granted, because permissions are session-specific. This is expected browser behavior.

### 2. Existing FileSystemProvider Capabilities

The `BrowserFileSystemProvider` already implements everything we need:

- `queryPermission(handle, mode)` - Check state WITHOUT prompting (safe to call anytime)
- `requestPermission(handle, mode)` - Check/request WITH prompting (requires user gesture)
- `saveHandle(key, handle)` - Persist to IndexedDB
- `loadHandle(key)` - Retrieve from IndexedDB
- `listSavedHandles()` - List all stored handle keys

**Important**: `requestPermission()` **MUST be called from a user gesture** (button click). It will fail silently if called automatically.

### 3. Nuxt UI Modal API

UModal component (Nuxt UI 4) supports:

```vue
<UModal
  v-model:open="showModal"
  :dismissible="false"
  title="Folder Access Required"
>
  <template #body>...</template>
  <template #footer>...</template>
</UModal>
```

Key props:
- `v-model:open` - Two-way binding for visibility
- `:dismissible="false"` - Prevent clicking outside to close
- Slots: `header`, `body`, `footer`

### 4. Pinia Store Patterns (from existing stores)

Follow the established pattern:
- **Composition API setup function** with section headers
- **shallowRef** for large collections (performance)
- **Dedicated error ref** for tracking errors
- **Clear action naming**: `setX()`, `updateX()`, `clearX()`
- **Delegate async work** to services, stores manage state

### 5. UX Best Practices for Permission Recovery

**Recommended flow**:
1. Check permission on app load with `queryPermission()`
2. If `'prompt'`, show recovery modal with folder name
3. Provide clear actions: "Re-authorize", "Choose Different", "Continue"
4. Button click triggers `requestPermission()` (user gesture)

**Modal behavior**: Use **blocking modal** for permission recovery since editing requires folder access. Non-dismissible ensures users must make a decision.

---

## Architecture Decisions

### Decision 1: Permission Check on Load

When the app initializes with a stored catalog:
1. Load folder handle from IndexedDB
2. Call `queryPermission(handle, 'read')` - non-blocking
3. If not `'granted'`, add to `folderIssues` array
4. Show modal if `folderIssues.length > 0`

### Decision 2: Store Structure

Create `permissionRecovery.ts` Pinia store:

```typescript
const showModal = ref(false)
const folderIssues = shallowRef<FolderIssue[]>([])
const isRechecking = ref(false)
const error = ref<string | null>(null)
```

### Decision 3: Re-authorization Flow

1. User clicks "Re-authorize" button (user gesture)
2. Load handle from IndexedDB
3. Call `requestPermission(handle, 'read')`
4. If `'granted'`, remove from issues, update UI
5. If `'denied'`, show "Access denied" message, offer retry

### Decision 4: Modal Design

Non-dismissible modal showing:
- Folder name and path
- Permission state badge (yellow "Needs permission" or red "Denied")
- Actions: "Re-authorize", "Choose Different Folder", "Continue"
- "Continue" enabled only if some folders accessible

---

## Implementation Plan

### Files to Create

1. **`apps/web/app/stores/permissionRecovery.ts`**
   - State: `showModal`, `folderIssues`, `isRechecking`, `error`
   - Computed: `hasIssues`, `accessibleCount`
   - Actions: `checkFolderPermissions`, `reauthorizeFolder`, `retryAll`, `clearIssues`

2. **`apps/web/app/components/catalog/PermissionRecovery.vue`**
   - UModal with folder list
   - Re-authorize button per folder
   - Footer actions: "Choose Different", "Retry All", "Continue"

### Integration Points

- Call `checkFolderPermissions()` in catalog page `onMounted`
- Modal subscribes to `permissionRecoveryStore.showModal`
- After successful re-auth, resume catalog loading

---

## FolderIssue Type Definition

```typescript
interface FolderIssue {
  folderId: string           // Key used in IndexedDB
  folderName: string         // Display name
  folderPath: string         // Display path (may be partial)
  permissionState: 'prompt' | 'denied'
  error?: string             // Optional error message
}
```

---

## Component Template Structure

```vue
<template>
  <UModal
    v-model:open="showModal"
    :dismissible="false"
  >
    <template #header>
      <h2>Folder Access Required</h2>
      <p class="text-gray-400">
        Re-authorize the following folders to continue.
      </p>
    </template>

    <template #body>
      <div class="space-y-2">
        <div
          v-for="issue in folderIssues"
          :key="issue.folderId"
          class="flex items-center justify-between p-3 bg-gray-900 rounded-lg"
        >
          <div>
            <p class="font-medium">{{ issue.folderName }}</p>
            <p class="text-sm text-gray-500">{{ issue.folderPath }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :color="issue.permissionState === 'prompt' ? 'yellow' : 'red'"
              :label="issue.permissionState === 'prompt' ? 'Needs permission' : 'Denied'"
            />
            <UButton size="sm" @click="reauthorizeFolder(issue.folderId)">
              Re-authorize
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2 justify-between">
        <UButton variant="ghost" @click="selectNewFolder">
          Choose Different Folder
        </UButton>
        <div class="flex gap-2">
          <UButton variant="ghost" @click="retryAll">
            Retry All
          </UButton>
          <UButton
            @click="continueWithAccessible"
            :disabled="accessibleCount === 0"
          >
            Continue ({{ accessibleCount }} accessible)
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
```

---

## Error Handling

### DOMException Types

| Error Name | Meaning | Recovery |
|------------|---------|----------|
| `AbortError` | User cancelled dialog | Keep modal open, user can retry |
| `NotAllowedError` | Permission denied | Show "Denied" badge, offer retry |
| `SecurityError` | Not from user gesture | Log error (shouldn't happen) |
| `NotFoundError` | Folder moved/deleted | Show "Folder not found" message |

### Error State Display

When `permissionState === 'denied'`:
- Show red badge
- Keep "Re-authorize" button available (user can retry)
- Optionally show "This folder was moved or deleted" if NotFoundError

---

## Testing Considerations

### Manual Testing Scenarios

1. **Normal re-auth**: Close browser, reopen app, click re-authorize
2. **User denies**: Click "Block" in permission dialog
3. **Folder moved**: Move folder on disk, reopen app
4. **Multiple folders**: Have multiple catalogs with different permission states

### Unit Test Cases

- Store correctly identifies permission issues
- `reauthorizeFolder` updates state on success
- `continueWithAccessible` closes modal and proceeds
- Error states are correctly set

---

## Summary

The implementation should:
1. Create a **lightweight Pinia store** tracking folder permission issues
2. Build a **non-dismissible UModal** with clear folder status
3. Ensure **all permission requests happen from user gestures** (button clicks)
4. Use existing **FileSystemProvider** methods (queryPermission, requestPermission)
5. Follow **existing codebase patterns** (store structure, error handling)

The UI should be clear about:
- Which folders need attention
- What the current permission state is
- What actions the user can take
- What happens if they continue with limited access
