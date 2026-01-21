# Research: Folder Scanning and File Discovery

**Date**: 2026-01-20
**Area**: Catalog Service - Area 2
**Status**: Complete

---

## Overview

This document covers patterns and strategies for efficiently scanning photo folders using the File System Access API. The goal is to scan folders containing 100s to 1000s of images (JPEG and Sony ARW files) while keeping the UI responsive, supporting cancellation, and reporting progress.

---

## 1. Directory Iteration

### The File System Access API Iterator

The `FileSystemDirectoryHandle` is an **async iterable**, providing several methods for iterating over directory contents:

```typescript
// All equivalent ways to iterate:
for await (const [name, handle] of directoryHandle) { }
for await (const [name, handle] of directoryHandle.entries()) { }
for await (const handle of directoryHandle.values()) { }
for await (const name of directoryHandle.keys()) { }
```

**Key characteristics:**

1. **No Guaranteed Order**: The iteration order is intentionally vague to allow efficient implementation across platforms. Don't rely on alphabetical or creation-date ordering.

2. **Live Iteration**: Entries created or deleted during iteration might or might not appear. No guarantees are given.

3. **Async by Nature**: Each iteration step is an async operation, giving natural yielding points.

### References
- [MDN: FileSystemDirectoryHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle)
- [WHATWG File System Standard](https://fs.spec.whatwg.org/)

---

## 2. Async Iteration Patterns

### Pattern A: Basic Async Generator (Recommended)

The simplest and most flexible pattern uses async generators to stream file discovery:

```typescript
interface ScanResult {
  handle: FileSystemFileHandle;
  name: string;
  path: string;
}

async function* scanDirectory(
  directory: FileSystemDirectoryHandle,
  basePath: string = ''
): AsyncGenerator<ScanResult> {
  for await (const entry of directory.values()) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      yield {
        handle: entry as FileSystemFileHandle,
        name: entry.name,
        path: entryPath,
      };
    } else if (entry.kind === 'directory') {
      // Recursive scan
      yield* scanDirectory(
        entry as FileSystemDirectoryHandle,
        entryPath
      );
    }
  }
}

// Usage:
const dirHandle = await window.showDirectoryPicker();
for await (const file of scanDirectory(dirHandle)) {
  console.log(`Found: ${file.path}`);
}
```

**Why this pattern?**

- Natural async flow with `for await...of`
- Memory efficient - only one file in memory at a time
- Easy to compose with other async operations
- Built-in backpressure - consumer controls the pace

### Pattern B: Batched Yielding for Performance

Processing items one-by-one creates overhead from Promise resolution on each iteration. Batching improves performance:

```typescript
interface BatchedScanOptions {
  batchSize?: number;
  signal?: AbortSignal;
}

async function* scanDirectoryBatched(
  directory: FileSystemDirectoryHandle,
  options: BatchedScanOptions = {}
): AsyncGenerator<ScanResult[]> {
  const { batchSize = 50, signal } = options;
  let batch: ScanResult[] = [];

  async function* walkDirectory(
    dir: FileSystemDirectoryHandle,
    basePath: string
  ): AsyncGenerator<ScanResult> {
    for await (const entry of dir.values()) {
      if (signal?.aborted) return;

      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.kind === 'file') {
        yield {
          handle: entry as FileSystemFileHandle,
          name: entry.name,
          path: entryPath,
        };
      } else if (entry.kind === 'directory') {
        yield* walkDirectory(entry as FileSystemDirectoryHandle, entryPath);
      }
    }
  }

  for await (const result of walkDirectory(directory, '')) {
    batch.push(result);

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  // Yield remaining items
  if (batch.length > 0) {
    yield batch;
  }
}

// Usage:
for await (const batch of scanDirectoryBatched(dirHandle, { batchSize: 100 })) {
  console.log(`Found ${batch.length} files`);
  // Process batch...
}
```

**Performance insight**: Yielding in batches reduces the number of event loop turns, significantly improving throughput for large directories.

### Pattern C: Observable Stream (RxJS)

For complex scenarios requiring filtering, throttling, or combining streams:

```typescript
import { from, Observable } from 'rxjs';
import { bufferTime, filter, takeUntil } from 'rxjs/operators';

function scanDirectoryObservable(
  directory: FileSystemDirectoryHandle
): Observable<ScanResult> {
  return from(scanDirectory(directory));
}

// Usage with RxJS operators:
const cancel$ = new Subject<void>();

scanDirectoryObservable(dirHandle).pipe(
  filter(file => isSupportedFile(file.name)),
  bufferTime(100), // Batch by time
  takeUntil(cancel$)
).subscribe({
  next: (batch) => updateUI(batch),
  complete: () => console.log('Scan complete'),
  error: (err) => console.error('Scan failed', err)
});

// To cancel:
cancel$.next();
```

**Note**: RxJS `from()` can consume async generators directly. However, there's a known issue where async generators may not be properly finalized when the observable is unsubscribed early.

### References
- [Async Iterators and Generators - Jake Archibald](https://jakearchibald.com/2017/async-iterators-and-generators/)
- [JavaScript Async Iterators](https://nodejsdesignpatterns.com/blog/javascript-async-iterators/)
- [RxJS from() with AsyncIterable Issue #5998](https://github.com/ReactiveX/rxjs/issues/5998)

---

## 3. Recursive Scanning Patterns

### Approach 1: Recursive Generator (Depth-First)

The `yield*` syntax delegates to another generator, creating natural depth-first traversal:

```typescript
async function* scanRecursive(
  directory: FileSystemDirectoryHandle,
  path: string = ''
): AsyncGenerator<ScanResult> {
  for await (const entry of directory.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      yield { handle: entry as FileSystemFileHandle, name: entry.name, path: entryPath };
    } else {
      // Depth-first: descend immediately
      yield* scanRecursive(entry as FileSystemDirectoryHandle, entryPath);
    }
  }
}
```

**Pros**: Simple, memory efficient
**Cons**: Deep recursion could hit stack limits (unlikely in practice)

### Approach 2: Iterative with Queue (Breadth-First)

For very deep or wide directory trees, an iterative approach avoids stack limits:

```typescript
async function* scanIterative(
  rootDirectory: FileSystemDirectoryHandle
): AsyncGenerator<ScanResult> {
  const queue: Array<{ dir: FileSystemDirectoryHandle; path: string }> = [
    { dir: rootDirectory, path: '' }
  ];

  while (queue.length > 0) {
    const { dir, path } = queue.shift()!;

    for await (const entry of dir.values()) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;

      if (entry.kind === 'file') {
        yield { handle: entry as FileSystemFileHandle, name: entry.name, path: entryPath };
      } else {
        // Breadth-first: queue subdirectory for later
        queue.push({
          dir: entry as FileSystemDirectoryHandle,
          path: entryPath
        });
      }
    }
  }
}
```

**Pros**: No stack limits, can easily switch between BFS/DFS
**Cons**: Slightly more complex, holds directory handles in memory

### Approach 3: Configurable Depth

For user-facing "include subfolders" option:

```typescript
interface ScanOptions {
  maxDepth?: number; // 0 = root only, Infinity = unlimited
}

async function* scanWithDepth(
  directory: FileSystemDirectoryHandle,
  options: ScanOptions = {},
  currentPath: string = '',
  currentDepth: number = 0
): AsyncGenerator<ScanResult> {
  const maxDepth = options.maxDepth ?? Infinity;

  for await (const entry of directory.values()) {
    const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      yield { handle: entry as FileSystemFileHandle, name: entry.name, path: entryPath };
    } else if (currentDepth < maxDepth) {
      yield* scanWithDepth(
        entry as FileSystemDirectoryHandle,
        options,
        entryPath,
        currentDepth + 1
      );
    }
  }
}
```

---

## 4. File Type Detection

### Extension-Based Detection (Recommended for Scanning)

For initial scanning, extension-based detection is fast and sufficient:

```typescript
const SUPPORTED_EXTENSIONS = new Set([
  // JPEG
  '.jpg', '.jpeg', '.jpe', '.jif', '.jfif',
  // Sony RAW
  '.arw',
  // Other RAW formats (future)
  // '.cr2', '.cr3', '.nef', '.dng', '.orf', '.raf'
]);

function isSupportedFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

// Filter during scan:
async function* scanSupportedFiles(
  directory: FileSystemDirectoryHandle
): AsyncGenerator<ScanResult> {
  for await (const result of scanDirectory(directory)) {
    if (isSupportedFile(result.name)) {
      yield result;
    }
  }
}
```

**Performance**: Extension checking is O(1) with no file I/O required.

### Magic Bytes Detection (Header-Based)

For validation or when extension is unreliable, check file headers:

```typescript
// Magic byte signatures
const FILE_SIGNATURES = {
  jpeg: [
    [0xFF, 0xD8, 0xFF, 0xE0], // JFIF
    [0xFF, 0xD8, 0xFF, 0xE1], // EXIF
    [0xFF, 0xD8, 0xFF, 0xE8], // SPIFF
  ],
  // ARW is TIFF-based with Intel byte order
  arw: [
    [0x49, 0x49, 0x2A, 0x00], // Little-endian TIFF (II + 0x002A)
  ],
};

async function detectFileType(
  handle: FileSystemFileHandle
): Promise<'jpeg' | 'arw' | 'unknown'> {
  const file = await handle.getFile();
  const header = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(header);

  // Check JPEG signatures
  for (const sig of FILE_SIGNATURES.jpeg) {
    if (sig.every((byte, i) => bytes[i] === byte)) {
      return 'jpeg';
    }
  }

  // Check ARW/TIFF signature
  // ARW files are TIFF-based, need additional checks for Sony-specific markers
  if (bytes[0] === 0x49 && bytes[1] === 0x49 &&
      bytes[2] === 0x2A && bytes[3] === 0x00) {
    // This is a TIFF file - could be ARW, DNG, or other TIFF-based RAW
    // For now, trust the extension for ARW identification
    return 'arw';
  }

  return 'unknown';
}
```

**When to use magic bytes:**

1. Validating files before heavy processing (decoding)
2. Detecting misnamed files
3. Security validation for untrusted sources

**Note**: ARW files use the standard TIFF header (`49 49 2A 00` for little-endian). Distinguishing ARW from other TIFF-based formats requires parsing TIFF tags for Sony-specific markers, which is complex. Trust the `.arw` extension for initial detection.

### References
- [Magic Bytes Library](https://github.com/LarsKoelpin/magic-bytes)
- [Sony RAW Format Description](https://github.com/lclevy/sony_raw)
- [List of File Signatures - Wikipedia](https://en.wikipedia.org/wiki/List_of_file_signatures)

---

## 5. Error Handling

### Common Errors During Scanning

The File System Access API can throw several `DOMException` types:

| Error Name | Code | Cause |
|------------|------|-------|
| `NotAllowedError` | PERMISSION_DENIED | User denied permission or permission revoked |
| `NotFoundError` | NOT_FOUND | File/directory no longer exists |
| `SecurityError` | SECURITY | Cross-origin access attempt |
| `TypeMismatchError` | TYPE_ERROR | Expected file, got directory (or vice versa) |
| `AbortError` | ABORTED | User cancelled the operation |

### Resilient Scanning Pattern

```typescript
interface ScanError {
  path: string;
  error: Error;
  recoverable: boolean;
}

interface ResilientScanResult {
  files: ScanResult[];
  errors: ScanError[];
}

async function* scanWithErrorRecovery(
  directory: FileSystemDirectoryHandle,
  path: string = ''
): AsyncGenerator<ScanResult | ScanError> {
  let entries: AsyncIterable<FileSystemHandle>;

  try {
    entries = directory.values();
  } catch (error) {
    yield {
      path,
      error: error as Error,
      recoverable: false,
    };
    return;
  }

  for await (const entry of entries) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    try {
      if (entry.kind === 'file') {
        yield {
          handle: entry as FileSystemFileHandle,
          name: entry.name,
          path: entryPath,
        };
      } else {
        yield* scanWithErrorRecovery(
          entry as FileSystemDirectoryHandle,
          entryPath
        );
      }
    } catch (error) {
      const domError = error as DOMException;

      // Determine if we should continue scanning
      const recoverable =
        domError.name !== 'NotAllowedError' &&
        domError.name !== 'SecurityError';

      yield {
        path: entryPath,
        error: error as Error,
        recoverable,
      };

      // If permission was denied at root level, stop entirely
      if (!recoverable && path === '') {
        return;
      }
    }
  }
}

// Type guard for filtering results
function isFile(result: ScanResult | ScanError): result is ScanResult {
  return 'handle' in result;
}

// Usage:
const results: ScanResult[] = [];
const errors: ScanError[] = [];

for await (const result of scanWithErrorRecovery(dirHandle)) {
  if (isFile(result)) {
    results.push(result);
  } else {
    errors.push(result);
    console.warn(`Scan error at ${result.path}: ${result.error.message}`);
  }
}
```

### Permission Checking Before Scan

```typescript
async function ensureReadPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const permission = await handle.queryPermission({ mode: 'read' });

  if (permission === 'granted') {
    return true;
  }

  if (permission === 'prompt') {
    const requested = await handle.requestPermission({ mode: 'read' });
    return requested === 'granted';
  }

  return false; // 'denied'
}
```

### Symlink Handling

The File System Access API does not expose symlink information directly. Symlinks are followed transparently. Potential issues:

1. **Circular symlinks**: Could cause infinite loops in recursive scanning
2. **Permission differences**: Symlink target might have different permissions
3. **Broken symlinks**: Target no longer exists

**Mitigation strategy:**

```typescript
async function* scanWithLoopDetection(
  directory: FileSystemDirectoryHandle,
  path: string = '',
  visited: Set<string> = new Set()
): AsyncGenerator<ScanResult> {
  // Use directory name as a proxy for identity
  // (File System Access API doesn't expose inode or unique ID)
  const dirKey = path || directory.name;

  if (visited.has(dirKey)) {
    console.warn(`Skipping already visited directory: ${dirKey}`);
    return;
  }

  visited.add(dirKey);

  for await (const entry of directory.values()) {
    // ... rest of scanning logic
  }
}
```

**Note**: True loop detection is difficult without inode access. The above is a best-effort approach using paths.

### References
- [MDN: FileSystemDirectoryHandle.getFileHandle()](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getFileHandle)
- [File System Access API Error Handling](https://fsjs.dev/understanding-file-system-access-api/)

---

## 6. Progress Reporting

### Progress Callback Pattern

```typescript
interface ScanProgress {
  filesFound: number;
  directoriesScanned: number;
  currentDirectory: string;
  isComplete: boolean;
}

type ProgressCallback = (progress: ScanProgress) => void;

async function* scanWithProgress(
  directory: FileSystemDirectoryHandle,
  onProgress: ProgressCallback,
  state: ScanProgress = {
    filesFound: 0,
    directoriesScanned: 0,
    currentDirectory: '',
    isComplete: false,
  },
  path: string = ''
): AsyncGenerator<ScanResult> {
  state.currentDirectory = path || directory.name;
  state.directoriesScanned++;
  onProgress({ ...state });

  for await (const entry of directory.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      if (isSupportedFile(entry.name)) {
        state.filesFound++;
        // Report progress every N files to avoid too many updates
        if (state.filesFound % 10 === 0) {
          onProgress({ ...state });
        }

        yield {
          handle: entry as FileSystemFileHandle,
          name: entry.name,
          path: entryPath,
        };
      }
    } else {
      yield* scanWithProgress(
        entry as FileSystemDirectoryHandle,
        onProgress,
        state,
        entryPath
      );
    }
  }

  // Final progress update at root level
  if (path === '') {
    state.isComplete = true;
    onProgress({ ...state });
  }
}
```

### Throttled Progress Updates

To avoid overwhelming the UI with updates:

```typescript
function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): T {
  let lastCall = 0;
  let scheduled = false;
  let lastArgs: Parameters<T> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    lastArgs = args;

    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        lastCall = Date.now();
        if (lastArgs) fn(...lastArgs);
      }, ms - (now - lastCall));
    }
  }) as T;
}

// Usage:
const throttledProgress = throttle((progress: ScanProgress) => {
  updateProgressUI(progress);
}, 100); // Max 10 updates per second

for await (const file of scanWithProgress(dirHandle, throttledProgress)) {
  // Process file...
}
```

### Vue Composable for Reactive Progress

```typescript
import { ref, readonly } from 'vue';

interface UseFolderScanReturn {
  progress: Readonly<Ref<ScanProgress>>;
  files: Readonly<Ref<ScanResult[]>>;
  errors: Readonly<Ref<ScanError[]>>;
  isScanning: Readonly<Ref<boolean>>;
  scan: (directory: FileSystemDirectoryHandle) => Promise<void>;
  cancel: () => void;
}

export function useFolderScan(): UseFolderScanReturn {
  const progress = ref<ScanProgress>({
    filesFound: 0,
    directoriesScanned: 0,
    currentDirectory: '',
    isComplete: false,
  });

  const files = ref<ScanResult[]>([]);
  const errors = ref<ScanError[]>([]);
  const isScanning = ref(false);

  let abortController: AbortController | null = null;

  async function scan(directory: FileSystemDirectoryHandle) {
    // Cancel any existing scan
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();
    isScanning.value = true;
    files.value = [];
    errors.value = [];
    progress.value = {
      filesFound: 0,
      directoriesScanned: 0,
      currentDirectory: '',
      isComplete: false,
    };

    try {
      for await (const result of scanWithCancellation(
        directory,
        abortController.signal,
        (p) => { progress.value = p; }
      )) {
        if (isFile(result)) {
          files.value.push(result);
        } else {
          errors.value.push(result);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Scan failed:', error);
      }
    } finally {
      isScanning.value = false;
    }
  }

  function cancel() {
    abortController?.abort();
  }

  return {
    progress: readonly(progress),
    files: readonly(files),
    errors: readonly(errors),
    isScanning: readonly(isScanning),
    scan,
    cancel,
  };
}
```

---

## 7. Keeping the UI Responsive

### The Problem

Even async iteration can block the main thread if processing is fast. The `for await...of` loop yields only during actual I/O waits. If the browser has cached directory contents, the loop may run synchronously for many iterations, causing UI jank.

### Solution 1: `scheduler.yield()` (Modern, Preferred)

The new Prioritized Task Scheduling API provides a clean way to yield:

```typescript
// Polyfill for scheduler.yield
function yieldToMain(): Promise<void> {
  if ('scheduler' in globalThis && 'yield' in (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler!) {
    return (globalThis as { scheduler: { yield: () => Promise<void> } }).scheduler.yield();
  }
  // Fallback
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function* scanResponsive(
  directory: FileSystemDirectoryHandle,
  path: string = ''
): AsyncGenerator<ScanResult> {
  let count = 0;

  for await (const entry of directory.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      yield { handle: entry as FileSystemFileHandle, name: entry.name, path: entryPath };

      // Yield to main thread every 50 files
      count++;
      if (count % 50 === 0) {
        await yieldToMain();
      }
    } else {
      yield* scanResponsive(entry as FileSystemDirectoryHandle, entryPath);
    }
  }
}
```

**Browser support (as of January 2026)**:
- Chrome 129+
- Edge 129+
- Firefox 142+
- Safari: Not yet supported (use fallback)

### Solution 2: `requestAnimationFrame` + `setTimeout`

For maximum compatibility, wait for both next frame and next task:

```typescript
function yieldForPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
```

This ensures:
1. Browser has a chance to paint
2. Any pending high-priority tasks run first

### Solution 3: Web Worker for Heavy Processing

For very large folders, offload scanning to a Web Worker:

```typescript
// Main thread
const worker = new Worker('./scan-worker.ts', { type: 'module' });

async function scanInWorker(
  directoryHandle: FileSystemDirectoryHandle
): Promise<ScanResult[]> {
  return new Promise((resolve, reject) => {
    // Directory handles can be posted to workers
    worker.postMessage({ type: 'scan', directory: directoryHandle });

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        updateProgress(e.data.progress);
      } else if (e.data.type === 'complete') {
        resolve(e.data.files);
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.message));
      }
    };
  });
}

// Worker (scan-worker.ts)
self.onmessage = async (e) => {
  if (e.data.type === 'scan') {
    const directory = e.data.directory as FileSystemDirectoryHandle;
    const files: ScanResult[] = [];

    for await (const file of scanDirectory(directory)) {
      files.push(file);

      if (files.length % 100 === 0) {
        self.postMessage({ type: 'progress', count: files.length });
      }
    }

    self.postMessage({ type: 'complete', files });
  }
};
```

**Key insight**: `FileSystemDirectoryHandle` and `FileSystemFileHandle` can be transferred via `postMessage()` to workers on the same origin.

### References
- [Chrome: scheduler.yield()](https://developer.chrome.com/blog/use-scheduler-yield)
- [MDN: Prioritized Task Scheduling API](https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API)
- [web.dev: Optimize Long Tasks](https://web.dev/articles/optimize-long-tasks)
- [Chrome: File System Access in Workers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

---

## 8. Cancellation with AbortController

### Basic Cancellation

```typescript
async function* scanWithCancellation(
  directory: FileSystemDirectoryHandle,
  signal: AbortSignal,
  path: string = ''
): AsyncGenerator<ScanResult> {
  for await (const entry of directory.values()) {
    // Check for cancellation at each iteration
    if (signal.aborted) {
      return;
    }

    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      yield { handle: entry as FileSystemFileHandle, name: entry.name, path: entryPath };
    } else {
      yield* scanWithCancellation(
        entry as FileSystemDirectoryHandle,
        signal,
        entryPath
      );
    }
  }
}

// Usage:
const controller = new AbortController();

// Start scan
const scanPromise = (async () => {
  const files: ScanResult[] = [];
  for await (const file of scanWithCancellation(dirHandle, controller.signal)) {
    files.push(file);
  }
  return files;
})();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

// Or cancel on user action
cancelButton.onclick = () => controller.abort();
```

### Throwing AbortError

For compatibility with standard patterns, throw on abort:

```typescript
async function* scanWithAbortError(
  directory: FileSystemDirectoryHandle,
  signal: AbortSignal,
  path: string = ''
): AsyncGenerator<ScanResult> {
  // Listen for abort and throw
  signal.throwIfAborted(); // Throws DOMException with name 'AbortError'

  for await (const entry of directory.values()) {
    signal.throwIfAborted();

    // ... rest of logic
  }
}

// Usage with try/catch:
try {
  for await (const file of scanWithAbortError(dirHandle, signal)) {
    files.push(file);
  }
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    console.log('Scan was cancelled');
  } else {
    throw error;
  }
}
```

### Combining Multiple Signals

Use `AbortSignal.any()` to cancel from multiple sources:

```typescript
const userCancelController = new AbortController();
const timeoutSignal = AbortSignal.timeout(30000); // 30 second timeout

const combinedSignal = AbortSignal.any([
  userCancelController.signal,
  timeoutSignal,
]);

for await (const file of scanWithCancellation(dirHandle, combinedSignal)) {
  // Cancelled by either user action or timeout
}
```

### References
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [AppSignal: Managing Async Operations with AbortController](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html)

---

## 9. Recommended Implementation

Based on all research, here is the recommended implementation for Literoom's folder scanning:

```typescript
// packages/core/src/catalog/scan-service.ts

import type { FileHandle, DirectoryHandle } from '../filesystem/types';

export interface ScannedFile {
  handle: FileHandle;
  name: string;
  path: string;
  extension: string;
}

export interface ScanProgress {
  filesFound: number;
  directoriesScanned: number;
  currentPath: string;
  isComplete: boolean;
  isCancelled: boolean;
}

export interface ScanOptions {
  /** Maximum depth to scan (0 = root only, Infinity = unlimited) */
  maxDepth?: number;
  /** Supported file extensions (lowercase, with dot) */
  extensions?: Set<string>;
  /** Batch size for yielding results */
  batchSize?: number;
  /** Interval (in items) for yielding to main thread */
  yieldInterval?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: (progress: ScanProgress) => void;
}

const DEFAULT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.arw']);
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_YIELD_INTERVAL = 100;

/**
 * Yield to main thread using best available method
 */
async function yieldToMain(): Promise<void> {
  if ('scheduler' in globalThis &&
      typeof (globalThis as { scheduler?: { yield?: unknown } }).scheduler?.yield === 'function') {
    return (globalThis as { scheduler: { yield: () => Promise<void> } }).scheduler.yield();
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Check if file has a supported extension
 */
function isSupportedExtension(filename: string, extensions: Set<string>): boolean {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filename.slice(dotIndex).toLowerCase();
  return extensions.has(ext);
}

/**
 * Scan a directory for supported image files
 *
 * Features:
 * - Async generator for streaming results
 * - Batched yielding for performance
 * - Cancellation support via AbortSignal
 * - Progress reporting
 * - Main thread yielding for responsiveness
 * - Configurable depth and file type filtering
 */
export async function* scanDirectory(
  directory: DirectoryHandle,
  options: ScanOptions = {}
): AsyncGenerator<ScannedFile[], void, unknown> {
  const {
    maxDepth = Infinity,
    extensions = DEFAULT_EXTENSIONS,
    batchSize = DEFAULT_BATCH_SIZE,
    yieldInterval = DEFAULT_YIELD_INTERVAL,
    signal,
    onProgress,
  } = options;

  const progress: ScanProgress = {
    filesFound: 0,
    directoriesScanned: 0,
    currentPath: '',
    isComplete: false,
    isCancelled: false,
  };

  let batch: ScannedFile[] = [];
  let itemsSinceYield = 0;

  // Internal recursive scanner
  async function* scan(
    dir: DirectoryHandle,
    nativeDir: FileSystemDirectoryHandle,
    currentPath: string,
    depth: number
  ): AsyncGenerator<ScannedFile> {
    // Check cancellation
    if (signal?.aborted) {
      progress.isCancelled = true;
      return;
    }

    // Update progress
    progress.directoriesScanned++;
    progress.currentPath = currentPath || dir.name;
    onProgress?.({ ...progress });

    try {
      for await (const entry of nativeDir.values()) {
        if (signal?.aborted) {
          progress.isCancelled = true;
          return;
        }

        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

        if (entry.kind === 'file') {
          if (isSupportedExtension(entry.name, extensions)) {
            const dotIndex = entry.name.lastIndexOf('.');

            yield {
              handle: { name: entry.name, kind: 'file' } as FileHandle,
              name: entry.name,
              path: entryPath,
              extension: entry.name.slice(dotIndex).toLowerCase(),
            };

            progress.filesFound++;
            itemsSinceYield++;

            // Yield to main thread periodically
            if (itemsSinceYield >= yieldInterval) {
              await yieldToMain();
              itemsSinceYield = 0;
            }
          }
        } else if (depth < maxDepth) {
          // Recurse into subdirectory
          yield* scan(
            { name: entry.name, kind: 'directory' } as DirectoryHandle,
            entry as FileSystemDirectoryHandle,
            entryPath,
            depth + 1
          );
        }
      }
    } catch (error) {
      // Log but continue on permission errors for subdirectories
      const domError = error as DOMException;
      if (domError.name === 'NotAllowedError' || domError.name === 'NotFoundError') {
        console.warn(`Skipping inaccessible directory: ${currentPath}`, error);
      } else {
        throw error;
      }
    }
  }

  // Get native handle (implementation detail)
  const nativeDir = (directory as { [key: symbol]: FileSystemDirectoryHandle })[
    Symbol.for('nativeHandle')
  ] || directory;

  // Run the scan and batch results
  for await (const file of scan(directory, nativeDir as FileSystemDirectoryHandle, '', 0)) {
    batch.push(file);

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  // Yield remaining files
  if (batch.length > 0) {
    yield batch;
  }

  // Mark complete
  progress.isComplete = true;
  onProgress?.({ ...progress });
}

/**
 * Convenience function to collect all files from a scan
 */
export async function collectScanResults(
  directory: DirectoryHandle,
  options: ScanOptions = {}
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];

  for await (const batch of scanDirectory(directory, options)) {
    results.push(...batch);
  }

  return results;
}
```

---

## Summary

| Aspect | Recommendation |
|--------|----------------|
| **Iteration Pattern** | Async generator with batched yielding |
| **Recursive Strategy** | Recursive `yield*` (depth-first), with configurable max depth |
| **File Detection** | Extension-based for speed; magic bytes only for validation |
| **Error Handling** | Continue on subdirectory errors, stop on root permission denied |
| **Progress Reporting** | Throttled callbacks with structured progress object |
| **UI Responsiveness** | `scheduler.yield()` with `setTimeout` fallback every ~100 items |
| **Cancellation** | `AbortController` / `AbortSignal` checked at each iteration |
| **Batching** | Yield arrays of 50 items for efficient UI updates |

This architecture enables:
- Scanning 1000s of files without blocking the UI
- Immediate cancellation on user request
- Real-time progress feedback
- Resilience to permission errors
- Future extensibility (Web Worker offloading, RxJS integration)
