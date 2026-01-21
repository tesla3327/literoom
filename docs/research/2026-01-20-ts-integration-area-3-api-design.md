# Research: DecodeService API Design (Area 3)

**Date**: 2026-01-20
**Focus Area**: Public API design for the DecodeService
**Related**: TypeScript Integration Research Plan - Area 3

---

## Executive Summary

The DecodeService provides a worker-based interface for image decoding operations. The design follows the project's established abstraction patterns (from `FileSystemProvider`) and aligns with spec requirements for thumbnail/preview generation.

---

## 1. Requirements Analysis

### From spec.md Section 2.3 (Thumbnail vs Preview)
- **Thumbnail**: small, fast, for grid/filmstrip browsing. Must not block scrolling.
- **Preview 1x**: medium-large (default 2560 long edge) for loupe/edit view.
- **Preview 2x**: larger (default 5120 long edge) generated after 1x.

### From spec.md Section 4.3 (Preview Generation Strategy)
- Generation order: thumbnail ASAP → preview 1x → preview 2x (idle)
- Previews regenerated when edits change with debounce
- "Latest render wins" policy

### From Phase 7 Requirements
- Create `DecodeService` class
- Implement worker-based architecture
- Handle WASM initialization
- Handle message passing for decode requests

---

## 2. Core Types

```typescript
// packages/core/src/decode/types.ts

/**
 * Decoded image in RGB format
 */
export interface DecodedImage {
  /** Image width in pixels */
  width: number
  /** Image height in pixels */
  height: number
  /** RGB pixel data (width * height * 3 bytes) */
  pixels: Uint8Array
}

/**
 * Initialization state of the decode service
 */
export type DecodeServiceState =
  | { status: 'uninitialized' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: DecodeError }

/**
 * Error thrown during decode operations
 */
export class DecodeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_FORMAT'
      | 'UNSUPPORTED_FILE_TYPE'
      | 'CORRUPTED_FILE'
      | 'OUT_OF_MEMORY'
      | 'WORKER_ERROR'
      | 'WASM_INIT_FAILED'
      | 'TIMEOUT'
      | 'UNKNOWN',
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'DecodeError'
  }
}

/**
 * Options for thumbnail generation
 */
export interface ThumbnailOptions {
  /** Target size in pixels (default: 256) */
  size?: number
  /** Resize filter: 0=Nearest, 1=Bilinear, 2=Lanczos3 (default: 1) */
  filter?: number
}

/**
 * Options for preview generation
 */
export interface PreviewOptions {
  /** Maximum edge size in pixels */
  maxEdge: number
  /** Resize filter: 0=Nearest, 1=Bilinear, 2=Lanczos3 (default: 2) */
  filter?: number
}

/**
 * Priority level for queued operations
 */
export type DecodePriority = 'high' | 'normal' | 'low'
```

---

## 3. Service Interface

```typescript
/**
 * Service for decoding images and generating thumbnails/previews
 */
export interface IDecodeService {
  /**
   * Current initialization state
   */
  readonly state: DecodeServiceState

  /**
   * Whether the service is ready to accept requests
   */
  readonly isReady: boolean

  /**
   * Decode a JPEG file from raw bytes
   */
  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>

  /**
   * Decode a RAW file's embedded thumbnail (fast path)
   */
  decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage>

  /**
   * Generate a small thumbnail for grid display
   */
  generateThumbnail(
    bytes: Uint8Array,
    options?: ThumbnailOptions
  ): Promise<DecodedImage>

  /**
   * Generate a preview at specified max edge size
   */
  generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage>

  /**
   * Queue multiple operations with priority
   */
  queueOperations(
    requests: Array<{
      id: string
      type: 'thumbnail' | 'preview'
      bytes: Uint8Array
      options?: ThumbnailOptions | PreviewOptions
      priority?: DecodePriority
    }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, DecodedImage | DecodeError>>

  /**
   * Cancel pending operations
   */
  cancel(id?: string): boolean

  /**
   * Check file type without decoding
   */
  detectFileType(bytes: Uint8Array): 'jpeg' | 'raw' | null

  /**
   * Free resources and terminate worker
   */
  destroy(): void
}
```

---

## 4. Implementation Class

```typescript
/**
 * Default implementation using Web Worker
 */
export class DecodeService implements IDecodeService {
  private worker: Worker | null = null
  private _state: DecodeServiceState = { status: 'uninitialized' }
  private requestMap = new Map<string, {
    resolve: (image: DecodedImage) => void
    reject: (error: DecodeError) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  get state(): DecodeServiceState {
    return this._state
  }

  get isReady(): boolean {
    return this._state.status === 'ready'
  }

  /**
   * Create and initialize the decode service
   */
  static async create(): Promise<DecodeService> {
    const service = new DecodeService()
    await service.initialize()
    return service
  }

  private async initialize(): Promise<void> {
    this._state = { status: 'loading' }

    try {
      this.worker = new Worker(
        new URL('./decode-worker.ts', import.meta.url),
        { type: 'module' }
      )

      this.worker.onmessage = this.handleMessage.bind(this)
      this.worker.onerror = this.handleError.bind(this)

      // Wait for worker to report ready
      await this.waitForReady()
      this._state = { status: 'ready' }
    } catch (error) {
      this._state = {
        status: 'error',
        error: new DecodeError(
          'Failed to initialize decode worker',
          'WASM_INIT_FAILED',
          error instanceof Error ? error : undefined
        )
      }
      throw this._state.error
    }
  }

  async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest('decode_jpeg', { bytes })
  }

  async decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest('decode_raw_thumbnail', { bytes })
  }

  async generateThumbnail(
    bytes: Uint8Array,
    options: ThumbnailOptions = {}
  ): Promise<DecodedImage> {
    return this.sendRequest('thumbnail', {
      bytes,
      size: options.size ?? 256,
      filter: options.filter ?? 1
    })
  }

  async generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage> {
    return this.sendRequest('preview', {
      bytes,
      maxEdge: options.maxEdge,
      filter: options.filter ?? 2
    })
  }

  detectFileType(bytes: Uint8Array): 'jpeg' | 'raw' | null {
    // JPEG magic bytes: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'jpeg'
    }
    // TIFF (RAW) magic bytes: 49 49 2A 00 (LE) or 4D 4D 00 2A (BE)
    if (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A) ||
      (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[3] === 0x2A)
    ) {
      return 'raw'
    }
    return null
  }

  private async sendRequest(
    type: string,
    data: Record<string, unknown>
  ): Promise<DecodedImage> {
    if (!this.isReady || !this.worker) {
      throw new DecodeError('Service not initialized', 'WORKER_ERROR')
    }

    const id = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestMap.delete(id)
        reject(new DecodeError('Operation timed out', 'TIMEOUT'))
      }, 30000)

      this.requestMap.set(id, { resolve, reject, timeout })

      this.worker!.postMessage({ id, type, ...data })
    })
  }

  private handleMessage(event: MessageEvent): void {
    const { id, type, ...data } = event.data

    if (type === 'ready') {
      // Worker initialization complete
      return
    }

    const pending = this.requestMap.get(id)
    if (!pending) return

    this.requestMap.delete(id)
    clearTimeout(pending.timeout)

    if (type === 'error') {
      pending.reject(new DecodeError(data.message, data.code || 'UNKNOWN'))
    } else {
      pending.resolve({
        width: data.width,
        height: data.height,
        pixels: data.pixels
      })
    }
  }

  private handleError(error: ErrorEvent): void {
    console.error('Worker error:', error)
    this._state = {
      status: 'error',
      error: new DecodeError('Worker error', 'WORKER_ERROR')
    }
  }

  destroy(): void {
    for (const { reject, timeout } of this.requestMap.values()) {
      clearTimeout(timeout)
      reject(new DecodeError('Service destroyed', 'WORKER_ERROR'))
    }
    this.requestMap.clear()
    this.worker?.terminate()
    this.worker = null
    this._state = { status: 'uninitialized' }
  }
}
```

---

## 5. Usage Examples

### Basic Thumbnail Generation

```typescript
const decodeService = await DecodeService.create()

const file = await fileHandle.getFile()
const bytes = new Uint8Array(await file.arrayBuffer())

const thumbnail = await decodeService.generateThumbnail(bytes, { size: 256 })
console.log(`Thumbnail: ${thumbnail.width}x${thumbnail.height}`)
```

### File Type Detection and Routing

```typescript
const fileType = decodeService.detectFileType(bytes)

if (fileType === 'raw') {
  // Fast path: extract embedded thumbnail
  const thumbnail = await decodeService.decodeRawThumbnail(bytes)
} else if (fileType === 'jpeg') {
  const thumbnail = await decodeService.generateThumbnail(bytes)
}
```

### Progressive Preview Loading

```typescript
// Show thumbnail immediately
const thumb = await decodeService.generateThumbnail(bytes)
displayImage(thumb, 'thumbnail')

// Then load 1x preview
const preview1x = await decodeService.generatePreview(bytes, { maxEdge: 2560 })
displayImage(preview1x, '1x')

// Finally load 2x preview
const preview2x = await decodeService.generatePreview(bytes, { maxEdge: 5120 })
displayImage(preview2x, '2x')
```

### Batch Processing with Progress

```typescript
const requests = files.map((file, i) => ({
  id: `thumb-${i}`,
  type: 'thumbnail' as const,
  bytes: fileBytes[i],
  options: { size: 256 },
  priority: 'high' as const
}))

const results = await decodeService.queueOperations(
  requests,
  (completed, total) => {
    console.log(`Progress: ${completed}/${total}`)
  }
)

for (const [id, result] of results) {
  if (result instanceof DecodeError) {
    console.error(`Failed ${id}: ${result.message}`)
  } else {
    cacheThumbnail(id, result)
  }
}
```

---

## 6. Vue Composable Integration

```typescript
// packages/core/src/decode/use-decode.ts

export function useDecode() {
  const { $decodeService } = useNuxtApp()

  const isReady = computed(() => $decodeService.isReady)
  const state = computed(() => $decodeService.state)

  return {
    isReady,
    state,
    decodeJpeg: $decodeService.decodeJpeg.bind($decodeService),
    decodeRawThumbnail: $decodeService.decodeRawThumbnail.bind($decodeService),
    generateThumbnail: $decodeService.generateThumbnail.bind($decodeService),
    generatePreview: $decodeService.generatePreview.bind($decodeService),
    detectFileType: $decodeService.detectFileType.bind($decodeService)
  }
}

// Usage in component
const { isReady, generateThumbnail } = useDecode()

if (isReady.value) {
  const thumb = await generateThumbnail(bytes)
}
```

---

## 7. Nuxt Plugin Registration

```typescript
// apps/web/plugins/decode.ts

export default defineNuxtPlugin(async () => {
  try {
    const decodeService = await DecodeService.create()

    if (import.meta.client) {
      window.addEventListener('beforeunload', () => {
        decodeService.destroy()
      })
    }

    return { provide: { decodeService } }
  } catch (error) {
    console.error('Failed to initialize decode service:', error)
    return { provide: { decodeService: null } }
  }
})
```

---

## 8. File Structure

```
packages/core/src/decode/
├── index.ts              # Public exports
├── types.ts              # Interfaces and types
├── decode-service.ts     # DecodeService implementation
├── decode-worker.ts      # Worker entry point
├── worker-messages.ts    # Message type definitions
└── use-decode.ts         # Vue composable
```

---

## 9. Performance Targets

| Operation | Target Time | Implementation |
|-----------|-------------|----------------|
| RAW thumbnail extraction | <50ms | `decodeRawThumbnail()` |
| JPEG decode (4000x3000) | <150ms | `decodeJpeg()` |
| Resize 6000→2560 | <300ms | `generatePreview({ maxEdge: 2560 })` |
| Resize 6000→256 | <50ms | `generateThumbnail({ size: 256 })` |

---

## 10. Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interface-based | Yes | Testability, mock support |
| State management | Simple property | No need for reactive signals in core |
| Queue support | Batch method | Efficient for folder scanning |
| Error handling | Typed codes | UI can show specific messages |
| Timeout | 30 seconds | Balance between slow files and hangs |
| Worker lifecycle | Persistent | Avoid WASM reinit overhead |
