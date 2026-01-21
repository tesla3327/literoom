# Research: Worker Message Passing Patterns (Area 2)

**Date**: 2026-01-20
**Focus Area**: Type-safe message passing between main thread and Web Workers
**Related**: TypeScript Integration Research Plan - Area 2

---

## Executive Summary

For the Literoom project, I recommend a **manual request/response correlation pattern** for v1, using:
- UUID-based request IDs
- Discriminated union types for type safety
- Transferable objects for output pixel data
- Structured clone for input (retain for retries)

This approach avoids external dependencies while providing robust, type-safe communication.

---

## 1. Request/Response Correlation Patterns

### Pattern 1: Request ID Correlation (Recommended for v1)

```typescript
// shared/worker-messages.ts
export interface DecodeRequest {
  id: string
  type: 'decode'
  bytes: Uint8Array
}

export interface DecodeResponse {
  id: string
  type: 'success'
  width: number
  height: number
  pixels: Uint8Array
}

export interface DecodeError {
  id: string
  type: 'error'
  message: string
  code: string
}

type WorkerMessage = DecodeRequest | DecodeResponse | DecodeError
```

**Main Thread Implementation**:
```typescript
class DecodeService {
  private pendingRequests = new Map<string, {
    resolve: (value: DecodeResponse) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    const id = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Decode timeout for request ${id}`))
      }, 30000)

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.worker.postMessage({ id, type: 'decode', bytes })
    })
  }

  private handleWorkerMessage(msg: WorkerMessage) {
    const pending = this.pendingRequests.get(msg.id)
    if (!pending) return

    this.pendingRequests.delete(msg.id)
    clearTimeout(pending.timeout)

    if (msg.type === 'error') {
      pending.reject(new Error(msg.message))
    } else {
      pending.resolve(msg)
    }
  }
}
```

**Pros:**
- No external dependencies
- Full control over message format
- Type-safe with discriminated unions
- Easy timeout handling

### Pattern 2: Comlink Library (Consider for v2+)

```typescript
// worker.ts
import * as Comlink from 'comlink'

export class ImageDecoder {
  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    const result = decode_wasm(bytes)
    return { width: result.width, height: result.height, pixels: result.pixels }
  }
}

Comlink.expose(new ImageDecoder())

// main.ts
const decoder = Comlink.wrap<ImageDecoder>(
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
)

const result = await decoder.decode(bytes) // Type-safe!
```

**Pros:**
- Automatic request/response correlation
- Full TypeScript support
- Battle-tested (1.1kB gzipped)

**Cons:**
- External dependency
- Learning curve for transferables

---

## 2. Type Safety Approaches

### Discriminated Unions (Recommended)

```typescript
type WorkerMessage =
  | { id: string; type: 'decode'; bytes: Uint8Array }
  | { id: string; type: 'resize'; width: number; height: number }
  | { id: string; type: 'success'; result: DecodedImage }
  | { id: string; type: 'error'; message: string }

// Worker can narrow types
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'decode') {
    // TypeScript knows msg.bytes exists
    const result = decode_jpeg(msg.bytes)
  }
}
```

### Type Guards

```typescript
function isDecodeRequest(msg: WorkerMessage): msg is DecodeRequest {
  return msg.type === 'decode'
}

// Use in handler
if (isDecodeRequest(msg)) {
  // msg is narrowed to DecodeRequest
}
```

---

## 3. Transferable vs Structured Clone

### Performance Comparison
| Approach | 32MB Buffer | Notes |
|----------|-------------|-------|
| Structured Clone | ~302ms | Creates copy |
| Transferable | ~6.6ms | Zero-copy, 45x faster |

### Decision Matrix

| Scenario | Recommendation | Reason |
|----------|----------------|--------|
| Input bytes to worker | Structured Clone | Keep for retry/logging |
| Output pixels | Transferable | Large data, not needed after |
| Small metadata | Structured Clone | Overhead negligible |

### Implementation

```typescript
// Transfer pixel buffer (zero-copy)
const pixels = image.pixels()
self.postMessage({
  id,
  type: 'success',
  width: image.width,
  height: image.height,
  pixels
}, [pixels.buffer]) // Transfer ownership

// IMPORTANT: pixels.buffer is detached after this!
```

---

## 4. Cancellation Patterns

### AbortController Pattern (Recommended)

```typescript
class DecodeService {
  private abortControllers = new Map<string, AbortController>()

  async decode(bytes: Uint8Array, signal?: AbortSignal): Promise<DecodedImage> {
    const id = crypto.randomUUID()
    const controller = new AbortController()
    this.abortControllers.set(id, controller)

    if (signal) {
      signal.addEventListener('abort', () => {
        controller.abort()
        this.worker.postMessage({ id, type: 'cancel' })
      })
    }

    try {
      return await this.sendRequest(id, bytes)
    } finally {
      this.abortControllers.delete(id)
    }
  }
}

// Usage
const controller = new AbortController()
const promise = decodeService.decode(bytes, controller.signal)

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000)
```

### Worker-Side Handling

```typescript
const activeRequests = new Set<string>()

self.onmessage = async (event) => {
  if (event.data.type === 'cancel') {
    activeRequests.delete(event.data.id)
    return
  }

  const { id } = event.data
  activeRequests.add(id)

  // Check if cancelled before expensive operation
  if (!activeRequests.has(id)) return

  const result = decode_jpeg(event.data.bytes)

  if (activeRequests.has(id)) {
    self.postMessage({ id, type: 'success', result })
  }

  activeRequests.delete(id)
}
```

---

## 5. Image-Specific Patterns

### Efficient Large Buffer Transfer

```typescript
// Input: Don't transfer (keep for retries)
worker.postMessage({
  id,
  type: 'decode',
  bytes: jpegBytes // Cloned
})

// Output: Transfer (zero-copy)
const pixels = image.pixels()
self.postMessage({
  id,
  type: 'success',
  pixels
}, [pixels.buffer])
```

### Streaming Results (Thumbnail → Preview)

```typescript
interface ProgressMessage {
  id: string
  type: 'progress'
  stage: 'thumbnail' | 'full'
  image: DecodedImage
}

// Worker sends multiple messages
self.onmessage = async (event) => {
  const { id, bytes } = event.data
  const decoded = decode_jpeg(bytes)

  // Send thumbnail immediately
  const thumb = generate_thumbnail(decoded, 256)
  self.postMessage({
    id,
    type: 'progress',
    stage: 'thumbnail',
    image: { width: thumb.width, height: thumb.height, pixels: thumb.pixels() }
  }, [thumb.pixels().buffer])

  // Then send full preview
  const preview = resize_to_fit(decoded, 2560, 2)
  self.postMessage({
    id,
    type: 'progress',
    stage: 'full',
    image: { width: preview.width, height: preview.height, pixels: preview.pixels() }
  }, [preview.pixels().buffer])
}
```

---

## 6. Library Comparison

| Feature | Manual | Comlink |
|---------|--------|---------|
| Bundle size | 0 | 1.1kB gzipped |
| TypeScript | With union types | Built-in |
| Transferables | Manual | `Comlink.transfer()` |
| Learning curve | Low | Medium |
| Maturity | - | Production-proven |

**Recommendation**: Use manual pattern for v1 (sufficient for image decoding). Evaluate Comlink for v2+ if:
- Multiple concurrent operations needed
- Complex object passing required
- Team prefers RPC pattern

---

## 7. Recommended Implementation for Literoom

### Message Types

```typescript
// packages/core/src/decode/worker-messages.ts

export interface ImageDecodeRequest {
  id: string
  type: 'decode'
  bytes: Uint8Array
}

export interface ImageDecodeResponse {
  id: string
  type: 'success'
  width: number
  height: number
  pixels: Uint8Array
}

export interface WorkerError {
  id: string
  type: 'error'
  message: string
  code: string
}

export type WorkerMessage = ImageDecodeRequest | ImageDecodeResponse | WorkerError
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Library | Manual | No deps, sufficient for v1 |
| Type safety | Discriminated union | TypeScript-native |
| Correlation | UUID + Map | Handles concurrent requests |
| Transferable | Output only | 45x faster, safe pattern |
| Cancellation | AbortController | Standard API |
| Streaming | v2 feature | Not needed initially |
