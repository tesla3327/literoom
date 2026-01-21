# Research: Web Worker WASM Initialization Patterns (Area 1)

**Date**: 2026-01-20
**Focus Area**: Loading and initializing WASM modules in Web Workers
**Related**: TypeScript Integration Research Plan - Area 1

---

## Executive Summary

Research into WASM initialization patterns for Web Workers reveals that the wasm-pack `--target web` output is well-suited for worker usage. The key patterns involve:
- Lazy initialization on first message
- Using the default `init()` function for automatic URL resolution
- Transferable objects for efficient data transfer

---

## 1. WASM-pack Output Structure

### Generated Files (packages/wasm/)
- `literoom_wasm.js` - JavaScript glue code with wasm-bindgen exports
- `literoom_wasm.d.ts` - TypeScript type definitions
- `literoom_wasm_bg.wasm` - Compiled WebAssembly binary
- `literoom_wasm_bg.wasm.d.ts` - Type definitions for WASM imports

### init() Function Signature
```typescript
export default function __wbg_init(
  module_or_path?: InitInput | Promise<InitInput>
): Promise<InitOutput>

export function initSync(module: SyncInitInput): InitOutput

type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module
```

---

## 2. Worker Initialization Patterns

### Pattern A: Async Initialization (Recommended)
```typescript
// decode.worker.ts
import init, { decode_jpeg } from 'literoom-wasm'

let initialized = false

async function ensureInitialized() {
  if (!initialized) {
    await init() // Auto-resolves WASM URL
    initialized = true
  }
}

self.onmessage = async (event) => {
  await ensureInitialized()
  const result = decode_jpeg(event.data.bytes)
  self.postMessage(result)
}
```

**Pros:**
- Simple, relies on default behavior
- WASM URL resolved automatically
- Works with Vite's WASM plugin

### Pattern B: Binary Transfer from Main Thread
```typescript
// main.ts
const wasmBinary = await fetch('/path/to/literoom_wasm_bg.wasm')
  .then(r => r.arrayBuffer())

worker.postMessage({ type: 'init', wasmBinary }, [wasmBinary])

// worker.ts
import { initSync } from 'literoom-wasm'

self.onmessage = (event) => {
  if (event.data.type === 'init') {
    initSync(event.data.wasmBinary)
  }
}
```

**Pros:**
- Control over WASM loading
- Useful if hosting WASM separately

**Cons:**
- More complex
- Requires manual URL management

---

## 3. Lazy vs Eager Initialization

### Lazy (Recommended)
- Worker created immediately
- WASM loaded on first decode request
- Faster initial page load
- WASM only loaded if needed

### Eager
- Worker created and WASM loaded on app init
- First decode is faster
- Uses bandwidth/memory even if decode never needed

**Recommendation**: Use lazy initialization for this project. Users won't decode images until they select a folder.

---

## 4. Memory Management

### WASM Memory Model in Workers
- Each worker instance has isolated linear memory
- No shared state between workers (unless SharedArrayBuffer)
- Memory freed when worker terminates

### Image Data Transfer

**Input (JS → Worker → WASM)**:
```typescript
// wasm-bindgen accepts &[u8] as zero-copy view
// Just pass Uint8Array directly
worker.postMessage({ bytes: jpegBytes })
```

**Output (WASM → Worker → JS)**:
```typescript
// JsDecodedImage.pixels() returns Vec<u8> → Uint8Array (copy)
const pixels = image.pixels()

// Transfer ownership to main thread
self.postMessage({ pixels }, [pixels.buffer])
```

---

## 5. Error Handling

### WASM Errors
```typescript
// WASM functions return Result<T, JsValue>
// JsValue contains error string

try {
  const image = decode_jpeg(bytes)
} catch (error) {
  // error is JsValue with string message
  console.error('Decode failed:', error)
}
```

### Worker Error Propagation
```typescript
self.onmessage = async (event) => {
  try {
    await ensureInitialized()
    const result = decode_jpeg(event.data.bytes)
    self.postMessage({ success: true, result })
  } catch (error) {
    self.postMessage({
      success: false,
      error: String(error)
    })
  }
}
```

---

## 6. Best Practices from Real-World Projects

### Squoosh Pattern
- One worker per codec operation
- ArrayBuffer transfer for pixel data
- Separate entrypoint for worker initialization

### jSquash Pattern
- Web Worker-focused WASM codec bundles
- Uses wasm-bindgen with `--target web`
- Lazy loading of WASM modules

### Common Patterns
1. Initialize once per worker lifetime
2. Transfer large buffers (avoid copies)
3. Keep worker alive (don't recreate per operation)
4. Use message IDs for request correlation

---

## 7. TypeScript Considerations

### Worker Type Definitions
```typescript
// shared/worker-types.ts
export interface DecodeRequest {
  id: string
  type: 'decode_jpeg' | 'decode_raw_thumbnail'
  bytes: Uint8Array
}

export interface DecodeResponse {
  id: string
  success: boolean
  width?: number
  height?: number
  pixels?: Uint8Array
  error?: string
}
```

### Worker Typing
```typescript
// decode.worker.ts
declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  // event.data is typed
}
```

---

## 8. Critical Constraints

1. **No `--split-linked-modules`**: This wasm-pack option doesn't support workers
2. **Module Workers**: Use `{ type: 'module' }` in dev, may need IIFE in Firefox
3. **WASM URL**: Must be resolvable from worker context
4. **Memory**: Each worker has separate WASM memory space

---

## Recommendations for Literoom

1. **Use Pattern A** (async init with default URL resolution)
2. **Initialize lazily** on first decode request
3. **Single worker instance** for simplicity in v1
4. **Transfer pixel buffers** on output for zero-copy
5. **Keep input cloned** (don't transfer) for retry safety
6. **Add timeout handling** for long decodes
