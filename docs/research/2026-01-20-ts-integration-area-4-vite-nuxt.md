# Research: Vite/Nuxt Worker Integration for WASM (Area 4)

**Date**: 2026-01-20
**Focus Area**: Vite/Nuxt Configuration for WASM in Web Workers
**Related**: TypeScript Integration Research Plan - Area 4

---

## Executive Summary

The Literoom project has excellent WASM infrastructure already in place:
- `vite-plugin-wasm` v3.5.0 and `vite-plugin-top-level-await` v1.6.0 installed
- Both plugins configured in main Vite config
- WASM bindings generated with proper TypeScript support
- Build pipeline working correctly with `wasm-pack --target web`

**Key Finding**: To support WASM in Web Workers, only minor configuration additions are needed.

---

## 1. Current Configuration Analysis

### Vite/Nuxt Setup
**File**: `apps/web/nuxt.config.ts`

Current configuration:
```typescript
vite: {
  plugins: [wasm(), topLevelAwait()],
}
```

Status: Plugins installed and working for main thread

### Plugin Versions
- `vite-plugin-wasm@3.5.0` - Supports worker plugins
- `vite-plugin-top-level-await@1.6.0` - Supports worker format handling

### WASM Build Configuration
**File**: Root `package.json`

```json
"wasm:build": "cd crates/literoom-wasm && wasm-pack build --target web --out-dir ../../packages/wasm",
"wasm:build:dev": "cd crates/literoom-wasm && wasm-pack build --target web --dev --out-dir ../../packages/wasm"
```

Status: Correct `--target web` for browser/worker use

### WASM Module Location
**Path**: `packages/wasm/`

Files:
- `literoom_wasm.js` - Main entry point (ES module)
- `literoom_wasm.d.ts` - TypeScript definitions
- `literoom_wasm_bg.wasm` - Binary module
- `literoom_wasm_bg.wasm.d.ts` - Binary types
- `package.json` - Module metadata

---

## 2. Worker Support Requirements

### Plugin Documentation Analysis

**vite-plugin-wasm Worker Support**:
> To use this plugin in Web Workers. Add it (and `vite-plugin-top-level-await` if necessary) to `worker.plugins`.

Configuration pattern:
```typescript
worker: {
  plugins: [
    wasm(),
    topLevelAwait()
  ]
}
```

### Current Setup Gap

**Missing**: `worker.plugins` configuration in `nuxt.config.ts`

This is needed to:
1. Transform WASM imports in worker context
2. Handle top-level await in workers
3. Enable worker bundling for production

---

## 3. WASM Module Loading in Workers

### How wasm-pack Generated Code Works

The generated `literoom_wasm.js` exports:
```typescript
export default function __wbg_init(module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>
export async function init(): Promise<InitOutput>
```

**InitInput Types**:
- `RequestInfo` - URL for fetch
- `URL` - URL object
- `Response` - Response object
- `BufferSource` - Direct bytes
- `WebAssembly.Module` - Pre-instantiated module

### Worker Loading Strategy

**Option 1: Default loading (recommended)**
```typescript
import init from 'literoom-wasm'

await init() // Automatically finds and loads WASM binary
```

Works because:
- Vite plugin adds the WASM import transformation
- Relative URL resolution works in worker context
- Binary is bundled with worker in production

**Option 2: Explicit binary path**
```typescript
import init from 'literoom-wasm'

const wasmUrl = new URL('literoom-wasm_bg.wasm', import.meta.url)
await init(wasmUrl)
```

For production scenarios with separate WASM hosting.

---

## 4. Integration Architecture

### Recommended Worker Setup

**File**: `apps/web/app/utils/decode.worker.ts`

```typescript
import init, {
  decode_jpeg,
  decode_raw_thumbnail,
  resize_to_fit,
} from 'literoom-wasm'

// Initialize on first message
let initialized = false

async function ensureInitialized() {
  if (!initialized) {
    await init()
    initialized = true
  }
}

export interface DecodeMessage {
  id: number
  type: 'decode_jpeg' | 'decode_raw_thumbnail'
  bytes: Uint8Array
}

export interface DecodeResult {
  id: number
  width: number
  height: number
  pixels: Uint8Array
}

self.onmessage = async (event: MessageEvent<DecodeMessage>) => {
  try {
    await ensureInitialized()

    const { id, type, bytes } = event.data

    const image = type === 'decode_jpeg'
      ? decode_jpeg(bytes)
      : decode_raw_thumbnail(bytes)

    self.postMessage({
      id,
      width: image.width,
      height: image.height,
      pixels: image.pixels(),
    } as DecodeResult, [image.pixels().buffer])

  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: String(error),
    })
  }
}
```

**Main Thread Usage**:
```typescript
const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' })

function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const id = Math.random()

    const handler = (event: MessageEvent) => {
      if (event.data.id === id) {
        worker.removeEventListener('message', handler)
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data)
      }
    }

    worker.addEventListener('message', handler)
    worker.postMessage({ id, type: 'decode_jpeg', bytes }, [bytes.buffer])
  })
}
```

---

## 5. Build and Deployment

### Development Mode
- Vite serves WASM file with correct MIME type (application/wasm)
- Worker uses ES module format with dynamic imports
- WASM binary resolved relative to worker JS

### Production Build
- WASM binary included in output
- Worker bundled as single file (if using IIFE format)
- Static hosting compatibility maintained

### Static Hosting Requirements
1. Ensure `.wasm` files are served with `Content-Type: application/wasm`
2. WASM binary must be accessible at the same origin
3. For CDN hosting, ensure CORS headers if needed

---

## 6. Required Configuration Changes

### Update `apps/web/nuxt.config.ts`

```typescript
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

### Ensure WASM Package Accessible

May need to add explicit dependency in `apps/web/package.json`:
```json
{
  "dependencies": {
    "literoom-wasm": "workspace:*"
  }
}
```

---

## 7. Key Technical Insights

1. **Plugin Architecture is Ready**: Both required Vite plugins are already installed - just need worker extension

2. **WASM-pack Output is Compatible**: The `--target web` output works seamlessly with both main thread and workers

3. **No Special WASM Setup Needed**: The build process and type generation are already correct

4. **Vite Handles Worker Details**: The dynamic import patterns in workers work automatically with proper plugin setup

5. **Memory Model is Favorable**: Each worker gets isolated WASM memory, enabling true parallelism for image processing

---

## Recommendations

1. Add `worker.plugins` to nuxt.config.ts
2. Create worker using `new URL('./worker.ts', import.meta.url)` pattern
3. Initialize WASM lazily in worker (on first message)
4. Use Transferable objects for pixel data to avoid copies
5. Consider worker pooling for parallel thumbnail generation
