# Implementation Plan: TypeScript Integration for Image Decoding

**Date**: 2026-01-20
**Status**: In Progress
**Research**: [TypeScript Integration Synthesis](../research/2026-01-20-typescript-integration-synthesis.md)
**Parent Plan**: [Image Decoding Plan](./2026-01-20-image-decoding-plan.md) (Phase 7)
**Priority**: Critical (enables thumbnail/preview display)

## Objective

Create TypeScript services and Web Worker infrastructure to expose the WASM image decoding pipeline to the Nuxt application. This enables:
1. JPEG/RAW decoding in a background thread
2. Thumbnail and preview generation
3. Non-blocking main thread during folder scanning

---

## Key Design Decisions (from research)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Worker initialization | Lazy async on first request | Faster initial page load |
| Message correlation | UUID + Map (manual) | No dependencies, sufficient for v1 |
| Input transfer | Structured Clone | Preserve for retries |
| Output transfer | Transferable | 45x faster for large buffers |
| API pattern | Interface + implementation | Testability, mock support |
| Timeout | 30 seconds | Balance slow files vs hangs |

---

## Implementation Phases

### Phase 1: Core Types and Worker Messages ⬜

**Goal**: Define all TypeScript types needed for the decode pipeline.

#### Tasks

- [ ] 1.1. Create `packages/core/src/decode/types.ts`
  - `DecodedImage` interface (width, height, pixels)
  - `ThumbnailOptions` interface (size, optional filter)
  - `PreviewOptions` interface (maxEdge, filter)
  - `DecodeError` class with error codes
  - `FileType` type ('jpeg' | 'raw' | 'unknown')
  - `DecodeServiceState` type for status tracking

- [ ] 1.2. Create `packages/core/src/decode/worker-messages.ts`
  - `DecodeRequest` discriminated union type
  - `DecodeResponse` discriminated union type
  - Request types: decode-jpeg, decode-raw-thumbnail, generate-thumbnail, generate-preview, detect-file-type
  - Response types: success (with pixels), error (with code)

#### Types Definition

```typescript
// types.ts
export interface DecodedImage {
  width: number
  height: number
  pixels: Uint8Array
}

export interface ThumbnailOptions {
  size?: number  // default: 256
}

export interface PreviewOptions {
  maxEdge: number  // e.g., 2560 for 1x, 5120 for 2x
  filter?: 'nearest' | 'bilinear' | 'lanczos3'  // default: lanczos3
}

export type FileType = 'jpeg' | 'raw' | 'unknown'

export type ErrorCode =
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'CORRUPTED_FILE'
  | 'OUT_OF_MEMORY'
  | 'WORKER_ERROR'
  | 'WASM_INIT_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN'

export class DecodeError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'DecodeError'
  }
}

export interface DecodeServiceState {
  status: 'initializing' | 'ready' | 'error'
  error?: string
}
```

```typescript
// worker-messages.ts
export type DecodeRequest =
  | { id: string; type: 'decode-jpeg'; bytes: Uint8Array }
  | { id: string; type: 'decode-raw-thumbnail'; bytes: Uint8Array }
  | { id: string; type: 'generate-thumbnail'; bytes: Uint8Array; size: number }
  | { id: string; type: 'generate-preview'; bytes: Uint8Array; maxEdge: number; filter: number }
  | { id: string; type: 'detect-file-type'; bytes: Uint8Array }

export type DecodeResponse =
  | { id: string; type: 'success'; width: number; height: number; pixels: Uint8Array }
  | { id: string; type: 'file-type'; fileType: 'jpeg' | 'raw' | 'unknown' }
  | { id: string; type: 'error'; message: string; code: string }
```

---

### Phase 2: Decode Worker ⬜

**Goal**: Create Web Worker that loads WASM and handles decode requests.

#### Tasks

- [ ] 2.1. Create `packages/core/src/decode/decode-worker.ts`
  - Import WASM module
  - Implement lazy initialization
  - Handle all message types
  - Use Transferable for output pixels

#### Worker Implementation

```typescript
// decode-worker.ts
import init, {
  decode_jpeg,
  decode_raw_thumbnail,
  generate_thumbnail,
  resize_to_fit,
  is_raw_file,
  type JsDecodedImage
} from 'literoom-wasm'
import type { DecodeRequest, DecodeResponse } from './worker-messages'

let initialized = false

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await init()
    initialized = true
  }
}

function filterToNumber(filter: string | undefined): number {
  switch (filter) {
    case 'nearest': return 0
    case 'bilinear': return 1
    case 'lanczos3': return 2
    default: return 2  // lanczos3 default
  }
}

function sendSuccess(id: string, image: JsDecodedImage): void {
  const pixels = image.pixels()
  const response: DecodeResponse = {
    id,
    type: 'success',
    width: image.width,
    height: image.height,
    pixels
  }
  self.postMessage(response, [pixels.buffer])
  image.free()
}

function sendError(id: string, error: unknown, code: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const response: DecodeResponse = { id, type: 'error', message, code }
  self.postMessage(response)
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data
  const { id, type } = request

  try {
    await ensureInitialized()

    switch (type) {
      case 'decode-jpeg': {
        const image = decode_jpeg(request.bytes)
        sendSuccess(id, image)
        break
      }
      case 'decode-raw-thumbnail': {
        const image = decode_raw_thumbnail(request.bytes)
        sendSuccess(id, image)
        break
      }
      case 'generate-thumbnail': {
        const image = decode_jpeg(request.bytes)
        const thumb = generate_thumbnail(image, request.size)
        image.free()
        sendSuccess(id, thumb)
        break
      }
      case 'generate-preview': {
        const image = decode_jpeg(request.bytes)
        const preview = resize_to_fit(image, request.maxEdge, request.filter)
        image.free()
        sendSuccess(id, preview)
        break
      }
      case 'detect-file-type': {
        const fileType = is_raw_file(request.bytes)
          ? 'raw'
          : request.bytes[0] === 0xFF && request.bytes[1] === 0xD8
            ? 'jpeg'
            : 'unknown'
        self.postMessage({ id, type: 'file-type', fileType })
        break
      }
    }
  } catch (error) {
    sendError(id, error, 'UNKNOWN')
  }
}
```

---

### Phase 3: DecodeService Class ⬜

**Goal**: Create main thread service that manages worker communication.

#### Tasks

- [ ] 3.1. Create `packages/core/src/decode/decode-service.ts`
  - Implement `IDecodeService` interface
  - Create worker and handle messages
  - Implement request/response correlation with UUID
  - Add 30-second timeout handling
  - Implement all decode methods

- [ ] 3.2. Create `IDecodeService` interface
  - Define all public methods
  - Enable mock implementations for testing

#### Service Implementation

```typescript
// decode-service.ts
import type { DecodeRequest, DecodeResponse } from './worker-messages'
import type { DecodedImage, DecodeServiceState, ThumbnailOptions, PreviewOptions, FileType } from './types'
import { DecodeError } from './types'

export interface IDecodeService {
  readonly state: DecodeServiceState
  readonly isReady: boolean

  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>
  decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage>
  generateThumbnail(bytes: Uint8Array, options?: ThumbnailOptions): Promise<DecodedImage>
  generatePreview(bytes: Uint8Array, options: PreviewOptions): Promise<DecodedImage>
  detectFileType(bytes: Uint8Array): Promise<FileType>
  destroy(): void
}

const DEFAULT_TIMEOUT = 30_000

interface PendingRequest {
  resolve: (value: DecodedImage | FileType) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export class DecodeService implements IDecodeService {
  private worker: Worker | null = null
  private pending = new Map<string, PendingRequest>()
  private _state: DecodeServiceState = { status: 'initializing' }

  private constructor() {}

  static async create(): Promise<DecodeService> {
    const service = new DecodeService()
    await service.initialize()
    return service
  }

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
      throw new DecodeError('Failed to create decode worker', 'WORKER_ERROR')
    }
  }

  get state(): DecodeServiceState {
    return this._state
  }

  get isReady(): boolean {
    return this._state.status === 'ready'
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  private handleResponse(response: DecodeResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeoutId)
    this.pending.delete(response.id)

    if (response.type === 'error') {
      pending.reject(new DecodeError(response.message, response.code as any))
    } else if (response.type === 'file-type') {
      pending.resolve(response.fileType)
    } else if (response.type === 'success') {
      pending.resolve({
        width: response.width,
        height: response.height,
        pixels: response.pixels
      })
    }
  }

  private sendRequest<T extends DecodedImage | FileType>(
    request: DecodeRequest
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this._state.status !== 'ready') {
        reject(new DecodeError('Decode service not ready', 'WORKER_ERROR'))
        return
      }

      const timeoutId = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new DecodeError('Decode operation timed out', 'TIMEOUT'))
      }, DEFAULT_TIMEOUT)

      this.pending.set(request.id, {
        resolve: resolve as any,
        reject,
        timeoutId
      })

      this.worker.postMessage(request)
    })
  }

  async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'decode-jpeg',
      bytes
    })
  }

  async decodeRawThumbnail(bytes: Uint8Array): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'decode-raw-thumbnail',
      bytes
    })
  }

  async generateThumbnail(
    bytes: Uint8Array,
    options: ThumbnailOptions = {}
  ): Promise<DecodedImage> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'generate-thumbnail',
      bytes,
      size: options.size ?? 256
    })
  }

  async generatePreview(
    bytes: Uint8Array,
    options: PreviewOptions
  ): Promise<DecodedImage> {
    const filterMap = { nearest: 0, bilinear: 1, lanczos3: 2 }
    return this.sendRequest({
      id: this.generateId(),
      type: 'generate-preview',
      bytes,
      maxEdge: options.maxEdge,
      filter: filterMap[options.filter ?? 'lanczos3']
    })
  }

  async detectFileType(bytes: Uint8Array): Promise<FileType> {
    return this.sendRequest({
      id: this.generateId(),
      type: 'detect-file-type',
      bytes
    })
  }

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
}
```

---

### Phase 4: Nuxt Integration ⬜

**Goal**: Configure Vite for workers and create Nuxt plugin/composable.

#### Tasks

- [ ] 4.1. Update `apps/web/nuxt.config.ts`
  - Add `worker.plugins` configuration
  - Ensure WASM works in workers

- [ ] 4.2. Create `apps/web/app/plugins/decode.client.ts`
  - Create DecodeService instance
  - Provide to Nuxt app
  - Handle cleanup on unload

- [ ] 4.3. Create `packages/core/src/decode/use-decode.ts` (Vue composable)
  - Expose service methods
  - Add computed `isReady` state

- [ ] 4.4. Create `packages/core/src/decode/index.ts`
  - Export all public types and classes

#### Configuration Changes

```typescript
// apps/web/nuxt.config.ts
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineNuxtConfig({
  vite: {
    plugins: [wasm(), topLevelAwait()],
    worker: {
      plugins: () => [wasm(), topLevelAwait()]
    }
  }
})
```

```typescript
// apps/web/app/plugins/decode.client.ts
import { DecodeService } from '@literoom/core'

export default defineNuxtPlugin(async () => {
  const decodeService = await DecodeService.create()

  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      decodeService.destroy()
    })
  }

  return {
    provide: {
      decodeService
    }
  }
})
```

```typescript
// packages/core/src/decode/use-decode.ts
import type { IDecodeService } from './decode-service'

export function useDecode(): IDecodeService {
  const { $decodeService } = useNuxtApp()

  if (!$decodeService) {
    throw new Error('DecodeService not available. Ensure decode plugin is loaded.')
  }

  return $decodeService as IDecodeService
}
```

---

### Phase 5: Testing ⬜

**Goal**: Ensure the decode pipeline works correctly.

#### Tasks

- [ ] 5.1. Create mock implementation for testing
  - `packages/core/src/decode/mock-decode-service.ts`
  - Returns predictable results for E2E tests

- [ ] 5.2. Add unit tests for DecodeService
  - `packages/core/src/decode/__tests__/decode-service.test.ts`
  - Test error handling
  - Test timeout behavior
  - Test message correlation

- [ ] 5.3. Add integration test
  - Test worker creates and initializes
  - Test WASM loads in worker context

---

## File Structure (Target)

```
packages/core/src/decode/
├── index.ts                 # Public exports
├── types.ts                 # Interfaces, types, DecodeError
├── worker-messages.ts       # Worker message types
├── decode-service.ts        # DecodeService implementation
├── decode-worker.ts         # Worker entry point
├── use-decode.ts            # Vue composable
├── mock-decode-service.ts   # Mock for testing
└── __tests__/
    └── decode-service.test.ts

apps/web/app/plugins/
└── decode.client.ts         # Nuxt plugin
```

---

## Verification Checklist

After implementation:

- [ ] `pnpm typecheck` passes in packages/core
- [ ] `pnpm lint` passes in packages/core
- [ ] Unit tests pass for DecodeService
- [ ] Worker can be created in Nuxt app
- [ ] WASM initializes in worker context
- [ ] Can decode a JPEG file end-to-end
- [ ] Can detect file types
- [ ] Timeout handling works
- [ ] Service cleanup works on destroy

---

## Integration Test Plan

```typescript
// Manual integration test steps
// 1. Start dev server: pnpm dev
// 2. Open browser console
// 3. Run these commands:

const { $decodeService } = useNuxtApp()

// Test file type detection
const response = await fetch('/test-image.jpg')
const bytes = new Uint8Array(await response.arrayBuffer())
const fileType = await $decodeService.detectFileType(bytes)
console.log('File type:', fileType) // Should be 'jpeg'

// Test JPEG decode
const image = await $decodeService.decodeJpeg(bytes)
console.log(`Decoded: ${image.width}x${image.height}`)

// Test thumbnail generation
const thumb = await $decodeService.generateThumbnail(bytes, { size: 256 })
console.log(`Thumbnail: ${thumb.width}x${thumb.height}`)
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Worker fails to load WASM | Error state surfaced in DecodeServiceState |
| Memory leaks | Explicit cleanup on destroy, JsDecodedImage.free() |
| Vite worker bundling issues | Test with both dev and production builds |
| Timeout too aggressive | 30 seconds is generous; can be made configurable |

---

## Next Steps (after this plan)

1. **Catalog Service Integration**
   - Use DecodeService during folder scanning
   - Generate thumbnails for discovered files
   - Cache thumbnails in IndexedDB/OPFS

2. **Preview Pipeline**
   - Generate 1x previews for loupe view
   - Generate 2x previews in background
   - Handle preview regeneration when edits change

3. **Phase 4 of Image Decoding Plan**: Full RAW Decoding
   - Implement demosaicing
   - Add color space conversion
   - Expose via WASM bindings
