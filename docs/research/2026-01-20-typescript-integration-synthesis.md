# Research Synthesis: TypeScript Integration for Image Decoding

**Date**: 2026-01-20
**Research Plan**: [TypeScript Integration Research Plan](./2026-01-20-typescript-integration-research-plan.md)
**Phase**: Image Decoding Plan - Phase 7 (TypeScript Integration)

## Overview

This document synthesizes findings from research into TypeScript integration for the Literoom image decoding pipeline. The research covered Vite/Nuxt configuration, WASM worker initialization, message passing patterns, and DecodeService API design.

---

## Key Decisions

### 1. Vite/Nuxt Configuration

**Decision: Add worker.plugins to nuxt.config.ts**

| Setting | Current | Required |
|---------|---------|----------|
| Main plugins | `wasm()`, `topLevelAwait()` | No change |
| Worker plugins | Not configured | Add same plugins |

**Configuration Change**:
```typescript
// apps/web/nuxt.config.ts
export default defineNuxtConfig({
  vite: {
    plugins: [wasm(), topLevelAwait()],
    worker: {
      plugins: () => [wasm(), topLevelAwait()]
    }
  }
})
```

**Source**: [Area 4 Research](./2026-01-20-ts-integration-area-4-vite-nuxt.md)

---

### 2. Worker Initialization Pattern

**Decision: Lazy async initialization with default URL resolution**

| Approach | Choice | Rationale |
|----------|--------|-----------|
| Initialization | Lazy (on first request) | Faster initial page load |
| WASM loading | Default `init()` | Automatic URL resolution |
| Worker creation | `import.meta.url` pattern | Vite handles bundling |

**Implementation**:
```typescript
// Worker file
import init, { decode_jpeg } from 'literoom-wasm'

let initialized = false

async function ensureInitialized() {
  if (!initialized) {
    await init()
    initialized = true
  }
}

self.onmessage = async (event) => {
  await ensureInitialized()
  // Process request
}
```

**Source**: [Area 1 Research](./2026-01-20-ts-integration-area-1-wasm-workers.md)

---

### 3. Message Passing Architecture

**Decision: Manual request/response correlation for v1**

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Library | None (manual) | No dependencies, sufficient for v1 |
| Correlation | UUID + Map | Handles concurrent requests |
| Type safety | Discriminated unions | TypeScript-native |
| Timeout | 30 seconds | Balance slow files vs hangs |

**Message Types**:
```typescript
type WorkerMessage =
  | { id: string; type: 'decode'; bytes: Uint8Array }
  | { id: string; type: 'success'; width: number; height: number; pixels: Uint8Array }
  | { id: string; type: 'error'; message: string; code: string }
```

**Source**: [Area 2 Research](./2026-01-20-ts-integration-area-2-message-passing.md)

---

### 4. Data Transfer Strategy

**Decision: Structured clone for input, Transferable for output**

| Direction | Strategy | Reason |
|-----------|----------|--------|
| Input (main → worker) | Structured Clone | Preserve for retries |
| Output (worker → main) | Transferable | 45x faster (6.6ms vs 302ms for 32MB) |

**Implementation**:
```typescript
// Worker sends result with transfer
const pixels = image.pixels()
self.postMessage({
  id,
  type: 'success',
  width: image.width,
  height: image.height,
  pixels
}, [pixels.buffer]) // Transfer ownership
```

**Source**: [Area 2 Research](./2026-01-20-ts-integration-area-2-message-passing.md)

---

### 5. DecodeService API

**Decision: Interface-based design with Vue composable**

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Pattern | Interface + implementation | Testability, mock support |
| State | Simple property | Core package doesn't need reactivity |
| Queue | Batch method | Efficient for folder scanning |
| Lifecycle | Persistent worker | Avoid WASM reinit |

**Key Methods**:
- `decodeJpeg(bytes)` - JPEG decoding
- `decodeRawThumbnail(bytes)` - Fast RAW thumbnail extraction
- `generateThumbnail(bytes, options)` - Grid thumbnail generation
- `generatePreview(bytes, options)` - Preview generation (1x/2x)
- `detectFileType(bytes)` - Quick format detection
- `queueOperations(requests, onProgress)` - Batch processing

**Source**: [Area 3 Research](./2026-01-20-ts-integration-area-3-api-design.md)

---

## Implementation Architecture

### File Structure

```
packages/core/src/decode/
├── index.ts              # Public exports
├── types.ts              # Interfaces and types
├── decode-service.ts     # DecodeService implementation
├── decode-worker.ts      # Worker entry point
├── worker-messages.ts    # Message type definitions
└── use-decode.ts         # Vue composable
```

### Data Flow

```
Main Thread                    Web Worker                    WASM
     │                              │                          │
     │ postMessage(bytes)           │                          │
     ├─────────────────────────────►│                          │
     │                              │ init() (lazy)            │
     │                              ├─────────────────────────►│
     │                              │                          │
     │                              │ decode_jpeg(bytes)       │
     │                              ├─────────────────────────►│
     │                              │◄─────────────────────────┤
     │                              │ JsDecodedImage           │
     │                              │                          │
     │ postMessage(pixels, [buffer])│                          │
     │◄─────────────────────────────┤ (transferable)           │
     │                              │                          │
```

---

## Performance Expectations

| Operation | Target Time | Notes |
|-----------|-------------|-------|
| RAW thumbnail extraction | <50ms | Embedded JPEG only |
| JPEG decode (4000x3000) | <150ms | Single-threaded WASM |
| Resize 6000→2560 | <300ms | Lanczos3 filter |
| Resize 6000→256 | <50ms | Bilinear filter |
| Data transfer (32MB) | ~6.6ms | Using Transferable |

---

## Integration Points

### 1. Nuxt Plugin

```typescript
// apps/web/plugins/decode.ts
export default defineNuxtPlugin(async () => {
  const decodeService = await DecodeService.create()

  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      decodeService.destroy()
    })
  }

  return { provide: { decodeService } }
})
```

### 2. Vue Composable

```typescript
// packages/core/src/decode/use-decode.ts
export function useDecode() {
  const { $decodeService } = useNuxtApp()

  return {
    isReady: computed(() => $decodeService.isReady),
    generateThumbnail: $decodeService.generateThumbnail.bind($decodeService),
    generatePreview: $decodeService.generatePreview.bind($decodeService),
    // ...
  }
}
```

### 3. Catalog Integration

```typescript
// During folder scanning
const fileType = decodeService.detectFileType(bytes)

if (fileType === 'raw') {
  // Fast path: ~50ms
  const thumb = await decodeService.decodeRawThumbnail(bytes)
} else if (fileType === 'jpeg') {
  // Generate thumbnail: ~100ms
  const thumb = await decodeService.generateThumbnail(bytes)
}
```

---

## Error Handling

### Error Types

```typescript
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
```

### Error Propagation

1. WASM throws → string error in JsValue
2. Worker catches → creates error message with code
3. Main thread receives → DecodeError instance
4. UI can show specific messages based on code

---

## Testing Strategy

### Unit Tests (Vitest)

- DecodeService initialization states
- Message correlation logic
- Error handling and timeouts
- File type detection

### Integration Tests

- Worker creates and initializes
- WASM functions callable from worker
- Pixel data transfers correctly
- Memory cleanup on destroy

### Mock Implementation

```typescript
export class MockDecodeService implements IDecodeService {
  state = { status: 'ready' as const }
  isReady = true

  async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage> {
    return {
      width: 4000,
      height: 3000,
      pixels: new Uint8Array(4000 * 3000 * 3)
    }
  }
  // ...
}
```

---

## Implementation Phases

### Phase 1: Core Types and Worker Messages
- Define `DecodedImage`, `DecodeError`, options interfaces
- Define worker message types
- Create `worker-messages.ts`

### Phase 2: Decode Worker
- Create `decode-worker.ts`
- Implement WASM lazy initialization
- Implement message handling for all operations
- Add error handling and response formatting

### Phase 3: DecodeService Class
- Create `decode-service.ts`
- Implement request/response correlation
- Add timeout handling
- Implement all interface methods

### Phase 4: Nuxt Integration
- Update `nuxt.config.ts` for worker plugins
- Create decode plugin
- Create Vue composable

### Phase 5: Testing
- Write unit tests for service logic
- Write integration tests for worker communication
- Create mock implementation for E2E tests

---

## Future Considerations

### v2 Enhancements
- **Comlink migration**: If concurrent operations increase complexity
- **Worker pool**: For parallel thumbnail generation
- **Streaming results**: Thumbnail → preview progressive loading
- **Edit pipeline**: Integrate with adjustment rendering

### Tauri Compatibility
- IDecodeService interface allows alternative implementations
- Can create TauriDecodeService that uses native Rust
- Core types remain the same

---

## Summary

The TypeScript integration approach prioritizes:
1. **Safety**: Structured clone for inputs, proper error handling
2. **Performance**: Transferable for outputs, lazy initialization
3. **Simplicity**: Manual patterns over libraries for v1
4. **Testability**: Interface-based design with mock support
5. **Integration**: Clean Nuxt plugin and Vue composable patterns

The implementation can proceed with confidence that:
- Vite/Nuxt configuration is straightforward
- WASM initialization patterns are well-understood
- Message passing architecture handles all requirements
- API design aligns with project patterns
