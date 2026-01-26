# Advanced GPU Pipeline Optimization - Research Synthesis

**Date**: 2026-01-25
**Phase**: Deep Research into WebGPU Performance Techniques

---

## Executive Summary

This synthesis consolidates research from 10 parallel investigations into advanced WebGPU optimization techniques. The findings reveal several high-impact opportunities for achieving 60fps real-time preview in Literoom's edit pipeline.

### Key Discoveries

| Area | Technique | Expected Impact | Effort |
|------|-----------|-----------------|--------|
| Async Readback | Triple-buffered staging pool | Eliminate 2-5ms stalls | Medium |
| Half-Precision | f16 for color operations | 25-50% faster, 50% memory | Medium |
| Subgroup Operations | subgroupAdd for histogram | 2-4x faster reduction | Low |
| GPU-Direct Histogram | Render without CPU readback | Zero-latency updates | High |
| Draft Mode | 1/4 resolution + skip operations | 4-16x faster drafts | Low |
| Single-Pass Effects | Combine adjustments | Reduce memory bandwidth | Medium |

---

## 1. Async Readback Patterns (Priority: HIGH)

### Current Problem
`mapAsync()` blocks JavaScript for 2-5ms per histogram update.

### Recommended Solution: Staging Buffer Pool

```javascript
class StagingBufferPool {
  constructor(device, bufferSize, poolSize = 3) {
    this.device = device;
    this.bufferSize = bufferSize;
    this.available = [];

    for (let i = 0; i < poolSize; i++) {
      this.available.push(this.createStagingBuffer());
    }
  }

  createStagingBuffer() {
    return this.device.createBuffer({
      size: this.bufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  acquire() {
    return this.available.length > 0
      ? this.available.pop()
      : this.createStagingBuffer();
  }

  async readback(gpuBuffer, callback) {
    const staging = this.acquire();
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, this.bufferSize);
    this.device.queue.submit([encoder.finish()]);

    staging.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Float32Array(staging.getMappedRange());
      callback(data);
      staging.unmap();
      this.available.push(staging);
    });
  }
}
```

### Key Insights
- Check `buffer.mapState` before operations (`'unmapped'`, `'pending'`, `'mapped'`)
- Accept 1-3 frame latency for consistent 60fps
- Fire-and-forget pattern acceptable for histogram display (skip when busy)

---

## 2. Half-Precision (f16) Processing (Priority: MEDIUM)

### Browser Support Status
- **Chrome 120+**: Full `shader-f16` support
- **Edge**: Follows Chrome
- **Safari**: Supported on Apple devices
- **30-40% of devices** may lack f16 support (check at runtime)

### Performance Benefits
| Workload | Improvement |
|----------|-------------|
| ALU-bound | Up to 25% faster |
| Memory-bound | Up to 50% faster |
| LLM inference | 28-41% improvement |

### Safe Operations for f16
- Color blending (0-1 range)
- Saturation/vibrance adjustment
- Multiplicative operations in safe range

### Operations That Must Stay f32
- **Histogram accumulation** (overflow risk with >65,504 values)
- Large exposure boosts (values exceed f16 max)
- Coordinate calculations requiring sub-pixel accuracy

### Implementation Pattern

```wgsl
enable f16;

fn processColor(input: vec4h) -> vec4h {
  // Safe f16 operations
  let saturated = input * 1.2h;
  return saturated;
}

// Accumulation stays in f32
fn computeHistogram(values: array<vec4h>) -> array<f32, 256> {
  var histogram: array<f32, 256>;
  for (var i = 0u; i < arrayLength(&values); i++) {
    let lum = f32(dot(vec3f(values[i].rgb), vec3f(0.299, 0.587, 0.114)));
    histogram[u32(lum * 255.0)] += 1.0;
  }
  return histogram;
}
```

### Feature Detection

```javascript
const hasF16 = adapter.features.has("shader-f16");
const device = await adapter.requestDevice({
  requiredFeatures: hasF16 ? ["shader-f16"] : [],
});
```

---

## 3. Subgroup Operations (Priority: MEDIUM)

### Browser Support
- **Chrome 134+**: `"subgroups"` feature shipped
- Performance: **2.3-2.9x faster** for reduction operations

### Histogram Reduction with Subgroups

```wgsl
enable subgroups;

@compute @workgroup_size(256)
fn reduceSum(
    @builtin(local_invocation_index) lid: u32,
    @builtin(subgroup_size) subgroupSize: u32,
    @builtin(subgroup_invocation_id) subgroupInvocationId: u32
) {
    let value = inputData[lid];

    // Step 1: Reduce within subgroup
    let subgroupSum = subgroupAdd(value);

    // Step 2: First thread stores to shared memory
    let subgroupIndex = lid / subgroupSize;
    if (subgroupInvocationId == 0u) {
        partialSums[subgroupIndex] = subgroupSum;
    }

    workgroupBarrier();

    // Step 3: First subgroup reduces partials
    if (lid < 256u / subgroupSize) {
        let finalSum = subgroupAdd(partialSums[lid]);
        if (lid == 0u) { output[0] = finalSum; }
    }
}
```

### Fallback Strategy
Build non-subgroup version first (using atomics), swap shader modules at runtime.

---

## 4. GPU-Direct Histogram Rendering (Priority: HIGH)

### Core Technique
Render histogram directly from storage buffer without CPU readback.

```wgsl
@group(0) @binding(0) var<storage, read> bins: array<vec4u>;
@group(0) @binding(1) var<uniform> uni: Uniforms;

@fragment
fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let numBins = arrayLength(&bins);
    let bin = clamp(u32(uv.x * f32(numBins)), 0u, numBins - 1u);
    let heights = vec4f(bins[bin]) * uni.scale;

    // Branchless color selection
    let bits = heights > vec4f(uv.y);
    let ndx = dot(select(vec4u(0), uni.channelMult, bits), vec4u(1));
    return uni.colors[ndx];
}
```

### GPU-Side Smoothing

```wgsl
const gaussWeights = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);

@compute @workgroup_size(64, 1, 1)
fn blurHistogram(@builtin(global_invocation_id) gid: vec3u) {
    let binIndex = gid.x;
    var sum: f32 = 0.0;
    for (var i = -2; i <= 2; i++) {
        let idx = clamp(i32(binIndex) + i, 0, 255);
        sum += f32(inputBins[idx]) * gaussWeights[i + 2];
    }
    outputBins[binIndex] = u32(sum);
}
```

### Animated Transitions
Use double-buffer ping-pong with interpolation:

```wgsl
fn getInterpolatedBin(index: u32) -> f32 {
    let prev = f32(previousBins[index]);
    let curr = f32(currentBins[index]);
    let t = smoothstep(0.0, 1.0, interpolation);
    return mix(prev, curr, t);
}
```

---

## 5. Texture Pool Integration (Priority: HIGH)

### Best Practices
- Use `writeBuffer()` for most uniform updates
- Use `mappedAtCreation: true` for static buffers
- Pool staging buffers for high-frequency updates

### Implementation

```javascript
class RenderTargetPool {
  constructor(device) {
    this.device = device;
    this.pools = new Map(); // "width:height:format" -> [GPUTexture]
  }

  acquire(width, height, format) {
    const key = `${width}:${height}:${format}`;
    const pool = this.pools.get(key) || [];

    if (pool.length > 0) return pool.pop();

    return this.device.createTexture({
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }

  release(texture) {
    const key = `${texture.width}:${texture.height}:${texture.format}`;
    if (!this.pools.has(key)) this.pools.set(key, []);
    this.pools.get(key).push(texture);
  }
}
```

### Memory Budget
- Track usage with `webgpu-memory` during development
- Query `adapter.limits` for device capabilities
- Implement LRU eviction for texture cache

---

## 6. Workgroup Size Optimization (Priority: LOW)

### Recommendations by Hardware

| GPU | SIMD Size | Recommended Workgroup |
|-----|-----------|----------------------|
| NVIDIA | 32 (warp) | 64-256 |
| AMD | 64 (wavefront) | 64-256 |
| Intel | 8-32 | 64 |
| Apple | 32 | 64-256 |
| ARM Mali | Variable | 64 (multiples of 4) |

### Default Recommendation
**Start with 64 threads (8x8 for 2D work)** - safe across all hardware.

### Use Overridable Constants

```wgsl
override WORKGROUP_SIZE_X: u32 = 8;
override WORKGROUP_SIZE_Y: u32 = 8;

@compute @workgroup_size(WORKGROUP_SIZE_X, WORKGROUP_SIZE_Y, 1)
fn main(...) { }
```

```javascript
const pipeline = device.createComputePipeline({
  compute: {
    module: shaderModule,
    entryPoint: "main",
    constants: { WORKGROUP_SIZE_X: 16, WORKGROUP_SIZE_Y: 16 }
  }
});
```

---

## 7. Single-Pass Uber-Shaders (Priority: MEDIUM)

### When to Use Single-Pass
- Per-pixel color operations (exposure, contrast, saturation, curves)
- Final composite passes
- Memory bandwidth-constrained scenarios

### When to Keep Separate Passes
- Spatially-dependent operations (blur, sharpen)
- High register pressure (>64 VGPRs)
- Operations requiring histograms/reductions

### LYGIA-Style Composable Pattern

```wgsl
fn processColor(color: vec3f, adj: Adjustments) -> vec3f {
    // All in one pass - no intermediate writes
    color = exposure(color, adj.exposureValue);
    color = brightnessContrast(color, adj.brightness, adj.contrast);
    color = saturation(color, adj.saturation);
    color = vibrance(color, adj.vibrance);
    color = tonemap(color);
    return color;
}
```

### Matrix Composition for Minimal Registers

```wgsl
fn buildColorMatrix(brightness: f32, contrast: f32, saturation: f32) -> mat4x4<f32> {
    return brightnessMatrix * contrastMatrix * saturationMatrix;
}

// Single matrix multiply replaces multiple operations
color = (colorMatrix * vec4(color, 1.0)).rgb;
```

---

## 8. Progressive Rendering (Priority: MEDIUM)

### Draft Mode Implementation

```javascript
const THROTTLE_MS = 100;   // Preview updates during drag
const DEBOUNCE_MS = 300;   // Final full-quality render

const throttledPreview = throttle((value) => {
  renderLowResPreview(value);  // 1/4 resolution
}, THROTTLE_MS);

const debouncedFullRender = debounce((value) => {
  renderFullQuality(value);
}, DEBOUNCE_MS);

slider.onInput = (value) => {
  throttledPreview(value);
  debouncedFullRender(value);
};
```

### Mipmap-Based Refinement
- During interaction: sample higher mipmap levels (lower res)
- On idle: progressively move to level 0 (full res)
- Use `requestIdleCallback` for refinement passes

---

## 9. GPU Timestamp Queries (Priority: LOW)

### Implementation

```javascript
const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });

const pass = encoder.beginComputePass({
  timestampWrites: {
    querySet,
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  },
});
```

### Key Notes
- Requires `timestamp-query` feature
- Results quantized to 100µs for security
- Use rolling averages to filter noise

---

## 10. Professional Editor Techniques

### Photopea
- Pure JavaScript + WebAssembly
- WebGL for blend modes and adjustments
- Local file processing (no server round-trips)

### Figma
- C++ compiled to WebAssembly
- Custom tile-based WebGL rendering
- Pre-allocated typed arrays to avoid GC
- WebGPU transition for compute shaders

### DaVinci Resolve
- Timeline Proxy Mode: on-the-fly resolution reduction
- Render Cache: background rendering during idle
- Proxy Media: external lower-res files

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
1. Implement draft mode (skip histogram/clipping during drag)
2. Integrate existing TexturePool in edit-pipeline.ts
3. Add throttle/debounce to slider interactions

### Phase 2: Async Architecture (3-5 days)
1. Triple-buffered histogram readback
2. GPU-direct histogram rendering
3. Fire-and-forget pattern for non-critical readbacks

### Phase 3: Shader Optimizations (1 week)
1. f16 processing with fallback
2. Subgroup operations with fallback
3. Single-pass adjustment uber-shader

### Phase 4: Advanced (2 weeks)
1. Mipmap-based progressive refinement
2. Tile-based rendering with priority
3. GPU timestamp profiling infrastructure

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Draft render time | ~65-165ms | <16ms |
| Histogram update | 10-50ms | <2ms |
| Slider responsiveness | 150ms throttle | <100ms |
| Memory per frame | 1.5-4ms allocation | <0.5ms |
| Full render | ~50-100ms | <50ms |

---

## References

### WebGPU Fundamentals
- [Buffer Uploads Best Practices](https://toji.dev/webgpu-best-practices/buffer-uploads.html)
- [Compute Shaders Histogram](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html)
- [Speed and Optimization](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)
- [Timing Performance](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)

### Chrome WebGPU Updates
- [Chrome 120: f16 support](https://developer.chrome.com/blog/new-in-webgpu-120)
- [Chrome 134: Subgroups shipped](https://developer.chrome.com/blog/new-in-webgpu-134)

### Advanced Techniques
- [AMD GPUOpen: Occupancy Explained](https://gpuopen.com/learn/occupancy-explained/)
- [LYGIA Shader Library](https://lygia.xyz/)
- [Figma WebGPU Rendering](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
