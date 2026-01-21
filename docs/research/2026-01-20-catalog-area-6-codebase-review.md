# Catalog Service - Codebase Review & Architecture Analysis

**Date:** 2026-01-20
**Purpose:** Understanding existing patterns for implementing the Catalog Service

## 1. FileSystemProvider Interface

### Current Design
Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/filesystem/types.ts`

The `FileSystemProvider` interface is a **platform-agnostic abstraction** that enables file system operations across different environments (browser, Tauri, etc.). Key characteristics:

**Interface Properties:**
- `name: string` - Provider identifier (e.g., 'browser', 'tauri')
- `supportsPersistence: boolean` - Whether handles can be persisted across sessions

**Core Methods:**
1. **Directory Operations:**
   - `selectDirectory(): Promise<DirectoryHandle>` - Show directory picker
   - `listDirectory(handle, recursive?): Promise<FileEntry[]>` - List directory contents
   - `createDirectory(parent, name): Promise<DirectoryHandle>` - Create subdirectory

2. **File Operations:**
   - `readFile(handle): Promise<ArrayBuffer>` - Read as binary
   - `readFileAsBlob(handle): Promise<Blob>` - Read as Blob
   - `getFileMetadata(handle): Promise<FileMetadata>` - Get file info
   - `writeFile(handle, data): Promise<void>` - Write data (requires permission)
   - `createFile(directory, name): Promise<FileHandle>` - Create new file

3. **Permission Management:**
   - `queryPermission(handle, mode): Promise<PermissionState>` - Check current state
   - `requestPermission(handle, mode): Promise<PermissionState>` - Request 'read' or 'readwrite'

4. **Persistence (Handle Storage):**
   - `saveHandle(key, handle): Promise<void>` - Store for later retrieval
   - `loadHandle(key): Promise<DirectoryHandle | null>` - Restore saved handle
   - `removeHandle(key): Promise<void>` - Delete saved handle
   - `listSavedHandles(): Promise<string[]>` - List all saved keys

### Error Handling Pattern
```typescript
export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'PERMISSION_DENIED'
      | 'NOT_SUPPORTED'
      | 'ABORTED'
      | 'INVALID_STATE'
      | 'UNKNOWN',
    override readonly cause?: Error
  )
}
```

This pattern enables:
- Specific error classification (not just generic messages)
- Root cause tracking via `cause` parameter
- Downstream error handling based on specific codes

### Factory Pattern
```typescript
export function createFileSystemProvider(): FileSystemProvider {
  const env = detectEnvironment()
  switch (env) {
    case 'browser': return new BrowserFileSystemProvider()
    case 'tauri': throw new FileSystemError(...) // TODO: Not yet implemented
    default: throw new FileSystemError(...)
  }
}
```

**Pattern Insight:** Environment detection happens at provider creation time, not at module load. This allows lazy initialization.

## 2. Browser FileSystemProvider Implementation

Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/filesystem/browser.ts`

### Key Implementation Patterns

**Abstraction Wrapping:**
- Uses internal `Symbol('nativeHandle')` to store native `FileSystemDirectoryHandle` and `FileSystemFileHandle`
- Provides type-safe wrapper/unwrapper functions to maintain abstraction boundary
- Custom interfaces extend the public types with private handle storage

```typescript
const NATIVE_HANDLE = Symbol('nativeHandle')

interface BrowserDirectoryHandle extends DirectoryHandle {
  [NATIVE_HANDLE]: FileSystemDirectoryHandle
}

function wrapDirectoryHandle(native: FileSystemDirectoryHandle): BrowserDirectoryHandle
function unwrapDirectoryHandle(handle: DirectoryHandle): FileSystemDirectoryHandle
```

**IndexedDB Persistence:**
- Manages handle persistence via IndexedDB (database: 'literoom-fs', store: 'handles')
- Lazy initialization of DB connection
- Error handling converts IndexedDB errors to `FileSystemError`
- Supports key-based storage for multiple workspace roots

**Error Classification:**
- Maps DOMException types to specific error codes
  - `AbortError` → `ABORTED` (user cancelled)
  - `SecurityError` → `PERMISSION_DENIED`
  - `NotAllowedError` → `PERMISSION_DENIED` (for writes)
- All other errors mapped to `UNKNOWN` with cause preserved

**Recursive Directory Listing:**
- Implements recursive via `listDirectory(handle, recursive=true)`
- Flattens nested structure into single array with path-like names
- Efficient: doesn't load entire tree into memory at once

### Supporting Types
Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/filesystem/index.ts`:

**Utility Functions:**
```typescript
isImageFile(name: string): boolean
isRawFile(name: string): boolean
isSupportedFile(name: string): boolean  // Combines above two
```

Supported formats:
- Images: jpg, jpeg, png, gif, webp, bmp, tiff, tif
- RAW: arw, cr2, cr3, nef, orf, rw2, dng, raf

## 3. DecodeService Patterns

Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/decode/`

### Architecture: Async Factory Pattern

**Private Constructor + Static Factory Method:**
```typescript
export class DecodeService implements IDecodeService {
  private constructor() {}

  static async create(): Promise<DecodeService> {
    const service = new DecodeService()
    await service.initialize()
    return service
  }
}
```

**Benefits:**
- Ensures service is fully initialized before returning
- Prevents accidentally using uninitialized service
- Consistent with Tauri plugin pattern (factory method)

### State Management

**Service State Interface:**
```typescript
export interface DecodeServiceState {
  status: 'initializing' | 'ready' | 'error'
  error?: string  // Only populated if status === 'error'
}
```

**State Tracking:**
- Public getter: `get state(): DecodeServiceState`
- Convenience getter: `get isReady(): boolean` (checks status === 'ready')
- State transitions: initializing → ready OR initializing → error

### Request/Response Correlation

**Async Request Pattern with Timeout:**
```typescript
private sendRequest<T>(request: DecodeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!this.worker || this._state.status !== 'ready') {
      reject(new DecodeError('Service not ready', 'WORKER_ERROR'))
      return
    }

    const timeoutId = setTimeout(() => {
      this.pending.delete(request.id)
      reject(new DecodeError('Operation timed out', 'TIMEOUT'))
    }, DEFAULT_TIMEOUT)  // 30 seconds

    this.pending.set(request.id, { resolve, reject, timeoutId })
    this.worker.postMessage(request)
  })
}
```

**Pending Request Tracking:**
```typescript
interface PendingRequest {
  resolve: (value: DecodedImage | FileType) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

private pending = new Map<string, PendingRequest>()
```

**Message Handling:**
```typescript
private handleResponse(response: DecodeResponse): void {
  const pending = this.pending.get(response.id)
  if (!pending) return  // Ignore orphaned responses

  clearTimeout(pending.timeoutId)
  this.pending.delete(response.id)

  // Handle discriminated union response types
  switch (response.type) {
    case 'error':
      pending.reject(new DecodeError(response.message, response.code))
      break
    case 'file-type':
      pending.resolve(response.fileType)
      break
    case 'success':
      pending.resolve({ width, height, pixels })
      break
  }
}
```

### Error Handling Pattern

**Structured Error Type:**
```typescript
export class DecodeError extends Error {
  override readonly name = 'DecodeError'

  constructor(
    message: string,
    public readonly code: ErrorCode,
    override readonly cause?: Error
  )
}
```

**Error Codes:**
- `INVALID_FORMAT` - File not valid format
- `UNSUPPORTED_FILE_TYPE` - Format not supported
- `CORRUPTED_FILE` - File appears damaged
- `OUT_OF_MEMORY` - WASM allocation failed
- `WORKER_ERROR` - Worker communication issue
- `WASM_INIT_FAILED` - WASM module load failed
- `TIMEOUT` - Operation exceeded timeout
- `UNKNOWN` - Unclassifiable error

### Worker Lifecycle

**Worker Initialization:**
```typescript
private async initialize(): Promise<void> {
  try {
    this.worker = new Worker(
      new URL('./decode-worker.ts', import.meta.url),
      { type: 'module' }
    )

    this.worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      this.handleResponse(event.data)
    }

    this.worker.onerror = (error) => {
      this._state = { status: 'error', error: error.message }
    }

    this._state = { status: 'ready' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    this._state = { status: 'error', error: message }
    throw new DecodeError('Failed to create worker', 'WORKER_ERROR')
  }
}
```

**Cleanup:**
```typescript
destroy(): void {
  if (this.worker) {
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutId)
      pending.reject(new DecodeError('Service destroyed', 'WORKER_ERROR'))
    }
    this.pending.clear()

    this.worker.terminate()
    this.worker = null
    this._state = { status: 'error', error: 'Service destroyed' }
  }
}
```

### Request Message Types (Discriminated Union)

Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/decode/worker-messages.ts`

```typescript
export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest

// Each includes:
// - id: string (for correlation)
// - type: 'decode-jpeg' | 'decode-raw-thumbnail' | 'generate-thumbnail' | 'generate-preview' | 'detect-file-type'
// - bytes: Uint8Array
// - Additional options (size, maxEdge, filter) as needed
```

### Response Message Types (Discriminated Union)

```typescript
export type DecodeResponse =
  | DecodeSuccessResponse
  | FileTypeResponse
  | DecodeErrorResponse

// DecodeSuccessResponse: { id, type: 'success', width, height, pixels }
// FileTypeResponse: { id, type: 'file-type', fileType }
// DecodeErrorResponse: { id, type: 'error', message, code }
```

**Transfer Protocol:** Pixel data is transferred (not copied) using `postMessage(response, [pixels.buffer])` to avoid expensive copying.

### Mock Service for Testing

Located in `/Users/michaelthiessen/Developer/literoom/packages/core/src/decode/mock-decode-service.ts`

**Interface-based Testing:**
- Implements `IDecodeService` interface (same as DecodeService)
- Can be swapped in tests without code changes

**Configuration Options:**
```typescript
export interface MockDecodeServiceOptions {
  initDelay?: number               // Simulate initialization time
  decodeDelay?: number             // Simulate processing time
  failInit?: boolean               // Simulate init failure
  onDecodeJpeg?: (...) => Promise<DecodedImage>
  onDecodeRawThumbnail?: (...) => Promise<DecodedImage>
  onGenerateThumbnail?: (...) => Promise<DecodedImage>
  onGeneratePreview?: (...) => Promise<DecodedImage>
  onDetectFileType?: (...) => Promise<FileType>
}
```

**Defaults:**
- decodeJpeg: 100x100 red image (255, 0, 0)
- decodeRawThumbnail: 160x120 green image (0, 255, 0)
- generateThumbnail: square at requested size, blue (0, 0, 255)
- generatePreview: 16:9 at maxEdge, yellow (255, 255, 0)
- detectFileType: actual magic byte detection

**Factory Pattern (same as real service):**
```typescript
static async create(options = {}): Promise<MockDecodeService> {
  const service = new MockDecodeService(options)
  await service.initialize()
  return service
}
```

**Helper Utility:**
```typescript
export function createTestImage(
  width = 1,
  height = 1,
  color: [number, number, number] = [255, 0, 0]
): DecodedImage
```

## 4. Testing Patterns

Located in test files (`.test.ts`)

**Framework:** Vitest (similar to Jest)

**Service Initialization Testing:**
```typescript
it('creates service in ready state', async () => {
  const service = await MockDecodeService.create()
  expect(service.state.status).toBe('ready')
  expect(service.isReady).toBe(true)
})

it('can fail initialization', async () => {
  await expect(
    MockDecodeService.create({ failInit: true })
  ).rejects.toThrow(DecodeError)
})
```

**Simulation Testing:**
```typescript
it('simulates init delay', async () => {
  const start = Date.now()
  const service = await MockDecodeService.create({ initDelay: 50 })
  const elapsed = Date.now() - start
  expect(elapsed).toBeGreaterThanOrEqual(45)
})
```

**Custom Handler Testing:**
```typescript
it('uses custom handler when provided', async () => {
  const customImage = { width: 50, height: 50, pixels: new Uint8Array(...) }
  const service = await MockDecodeService.create({
    onDecodeJpeg: async () => customImage
  })
  const result = await service.decodeJpeg(new Uint8Array(0))
  expect(result).toBe(customImage)
})
```

## 5. Catalog-Related Stubs and TODOs

**Current Status:** No catalog service or stubs currently exist in the codebase.

**Single TODO Found:**
```typescript
// In packages/core/src/filesystem/index.ts:46
// TODO: Implement TauriFileSystemProvider when needed
```

This indicates the architecture anticipates multiple filesystem providers but currently only implements browser-based.

## 6. Existing Types and Interfaces for Catalog Service

### From FileSystem Module

**Type Hierarchy:**
```typescript
type PermissionState = 'granted' | 'denied' | 'prompt'

interface DirectoryHandle {
  readonly name: string
  readonly kind: 'directory'
}

interface FileHandle {
  readonly name: string
  readonly kind: 'file'
}

interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileHandle | DirectoryHandle
}

interface FileMetadata {
  name: string
  size: number
  type?: string
  lastModified: number
}
```

### From Decode Module

**Image Data Types:**
```typescript
interface DecodedImage {
  width: number
  height: number
  pixels: Uint8Array  // RGB, 3 bytes per pixel
}

interface ThumbnailOptions {
  size?: number  // Default: 256
}

interface PreviewOptions {
  maxEdge: number
  filter?: FilterType  // 'nearest' | 'bilinear' | 'lanczos3'
}

type FileType = 'jpeg' | 'raw' | 'unknown'
```

### From Index Module

**File Classification Utilities:**
```typescript
function isImageFile(name: string): boolean
function isRawFile(name: string): boolean
function isSupportedFile(name: string): boolean
```

## 7. Module Organization & Exports

**Core Package Structure:**
```
packages/core/src/
├── filesystem/
│   ├── types.ts         (FileSystemProvider interface, error types)
│   ├── browser.ts       (BrowserFileSystemProvider implementation)
│   └── index.ts         (createFileSystemProvider factory, utilities)
├── decode/
│   ├── types.ts         (DecodedImage, DecodeError, error codes)
│   ├── worker-messages.ts (Request/Response message types)
│   ├── decode-service.ts   (DecodeService class, IDecodeService interface)
│   ├── mock-decode-service.ts (Testing mock)
│   ├── decode-worker.ts     (Worker implementation)
│   └── index.ts         (Re-exports all public types and classes)
└── index.ts             (Re-exports filesystem and decode modules)
```

**Export Pattern:** Each module has an `index.ts` that:
1. Re-exports all public types and classes
2. Hides internal implementation details
3. Provides factory functions at module boundary

## 8. Design Principles Identified

### 1. Platform Abstraction
- Define interfaces first (e.g., FileSystemProvider)
- Implement per-platform (e.g., BrowserFileSystemProvider)
- Factory function selects appropriate implementation
- Enables Tauri implementation in future without API changes

### 2. Async Factories
- Private constructors prevent incomplete initialization
- Static `create()` methods ensure full initialization
- Consumers guaranteed valid state after creation
- Example: `const service = await DecodeService.create()`

### 3. Error Classification
- Custom error classes with specific code enums
- Error codes enable downstream classification (not just message parsing)
- Preserve root cause via `cause` parameter for debugging
- Examples: FileSystemError, DecodeError

### 4. Service State
- Explicit state machine (initializing → ready/error)
- Public state getter for consumer awareness
- Convenience `isReady` getter for boolean checks
- Services remain valid after destroy (state becomes error)

### 5. Request/Response Correlation
- UUID for each request
- Map to track pending requests
- Timeout handling to prevent memory leaks
- Discriminated unions for type-safe responses

### 6. Testing via Interface Implementation
- Define service interface (IDecodeService)
- Real implementation (DecodeService)
- Mock implementation (MockDecodeService)
- Both satisfy same interface
- Tests can use mocks for isolation

### 7. Type-Safe Message Passing
- Discriminated union types for worker messages
- Exhaustiveness checking via `const _exhaustive: never = type`
- Each message type has unique `type` discriminator
- Response handling via switch on type

### 8. Resource Cleanup
- `destroy()` method for cleanup
- Rejects pending operations
- Terminates workers
- Transitions to error state (safe for re-check)

## 9. Recommendations for Catalog Service

Based on these patterns, the Catalog Service should:

1. **Define Interface First**
   ```typescript
   export interface ICatalogService {
     readonly state: CatalogServiceState
     readonly isReady: boolean
     listCatalogs(): Promise<CatalogMetadata[]>
     loadCatalog(path: string): Promise<Catalog>
     // ... other methods
   }
   ```

2. **Use Async Factory Pattern**
   ```typescript
   export class CatalogService implements ICatalogService {
     private constructor() {}
     static async create(fsProvider: FileSystemProvider): Promise<CatalogService> {
       // Initialize and return
     }
   }
   ```

3. **Implement State Machine**
   ```typescript
   interface CatalogServiceState {
     status: 'initializing' | 'ready' | 'error'
     error?: string
   }
   ```

4. **Create Custom Error Type**
   ```typescript
   export class CatalogError extends Error {
     constructor(message: string, public readonly code: CatalogErrorCode, cause?: Error)
   }
   ```

5. **Provide Mock for Testing**
   ```typescript
   export class MockCatalogService implements ICatalogService {
     // ... mock implementation
   }
   ```

6. **Reuse Existing Abstractions**
   - Use FileSystemProvider for file operations
   - Use IDecodeService for image processing
   - Compose these services rather than duplicate functionality

7. **Follow Module Structure**
   ```
   packages/core/src/catalog/
   ├── types.ts
   ├── catalog-service.ts
   ├── mock-catalog-service.ts
   └── index.ts
   ```
