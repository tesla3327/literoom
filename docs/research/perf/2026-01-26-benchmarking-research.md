# GPU Pipeline Benchmarking Research

**Date**: 2026-01-26
**Goal**: Establish automated benchmarking approach for GPU performance optimization

---

## Executive Summary

Research into WebGPU benchmarking reveals a mature ecosystem of tools and established best practices. Key findings:

1. **GPU timestamp queries** are the gold standard for measuring GPU execution time
2. **stats-gl** library provides ready-to-use performance monitoring
3. **Statistical approaches** (warmup, percentiles, CV%) are essential for reliable results
4. **CI integration** is possible with GitHub Actions GPU runners or self-hosted options

---

## 1. WebGPU Benchmarking Tools

### stats-gl (Recommended)

Comprehensive performance monitoring for WebGL/WebGPU applications.

**Installation**:
```bash
npm install stats-gl
```

**Basic Usage**:
```javascript
import Stats from "stats-gl";

const stats = new Stats({
  trackGPU: true,        // Enable GPU monitoring via timestamp queries
  logsPerSecond: 4,
  samplesLog: 40,
  mode: 0                // 0=FPS, 1=CPU, 2=GPU
});

document.body.appendChild(stats.dom);

function animate() {
  stats.begin();
  // ... rendering code ...
  stats.end();
  stats.update();
  requestAnimationFrame(animate);
}
```

**Three.js/WebGPU Integration**:
```javascript
import * as THREE from 'three';
import Stats from 'stats-gl';

const renderer = new THREE.WebGPURenderer();
const stats = new Stats();
stats.init(renderer);  // Auto-patches render function
container.appendChild(stats.dom);
```

**Note**: GPU logging requires WebGPU Timestamp Queries feature.

### WebGPU Inspector Chrome Extension

Browser extension for debugging and profiling:
- Frame capture with all commands, buffers, and textures
- Frame time plotting and GPU object count monitoring
- Buffer/texture content inspection
- Command recording with HTML export

### webgpu-utils

Helper library by Gregg Tavares for reducing boilerplate:
- `createTextureFromSource` - Load images as textures with mip generation
- `makeShaderDataDefinitions` - Easy uniform management
- Buffer and attribute creation helpers

---

## 2. GPU Timestamp Queries Implementation

### Feature Detection and Setup

```javascript
async function initTimestampQueries() {
  const adapter = await navigator.gpu?.requestAdapter();
  const canTimestamp = adapter.features.has('timestamp-query');

  const device = await adapter?.requestDevice({
    requiredFeatures: canTimestamp ? ['timestamp-query'] : [],
  });

  if (!canTimestamp) {
    console.warn('Timestamp queries not supported');
    return null;
  }

  // Create query set (2 slots: start and end)
  const querySet = device.createQuerySet({
    type: 'timestamp',
    count: 2,
  });

  // Buffer to resolve query results (8 bytes per timestamp)
  const resolveBuffer = device.createBuffer({
    size: querySet.count * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });

  // Mappable buffer for CPU readback
  const resultBuffer = device.createBuffer({
    size: resolveBuffer.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  return { device, querySet, resolveBuffer, resultBuffer };
}
```

### Instrumenting Passes

```javascript
function createTimestampedRenderPass(encoder, descriptor, querySet, canTimestamp) {
  const passDescriptor = {
    ...descriptor,
    ...(canTimestamp && {
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    }),
  };

  return encoder.beginRenderPass(passDescriptor);
}

function resolveTimestamps(encoder, querySet, resolveBuffer, resultBuffer) {
  encoder.resolveQuerySet(querySet, 0, querySet.count, resolveBuffer, 0);

  if (resultBuffer.mapState === 'unmapped') {
    encoder.copyBufferToBuffer(resolveBuffer, 0, resultBuffer, 0, resultBuffer.size);
  }
}
```

### Reading Results

```javascript
async function readTimestampResults(resultBuffer) {
  if (resultBuffer.mapState !== 'unmapped') return null;

  await resultBuffer.mapAsync(GPUMapMode.READ);
  const times = new BigUint64Array(resultBuffer.getMappedRange());
  const gpuTimeNs = Number(times[1] - times[0]);  // nanoseconds
  resultBuffer.unmap();

  return gpuTimeNs;
}
```

### Limitations

- **Quantization**: Default 100μs quantization for security
- **Developer mode**: Enable `chrome://flags/#enable-webgpu-developer-features` for full precision
- **Platform issues**: Apple Silicon/TBDR may not support timestamp queries
- **Not comparable**: Results vary across GPUs, use for relative comparisons only

---

## 3. Statistical Best Practices

### Rolling Average

```javascript
class NonNegativeRollingAverage {
  #total = 0;
  #samples = [];
  #cursor = 0;
  #numSamples;

  constructor(numSamples = 30) {
    this.#numSamples = numSamples;
  }

  addSample(v) {
    if (!Number.isNaN(v) && Number.isFinite(v) && v >= 0) {
      this.#total += v - (this.#samples[this.#cursor] || 0);
      this.#samples[this.#cursor] = v;
      this.#cursor = (this.#cursor + 1) % this.#numSamples;
    }
  }

  get() {
    return this.#total / this.#samples.length;
  }
}
```

### Comprehensive Statistics

```javascript
class BenchmarkStats {
  constructor(options = {}) {
    this.warmupIterations = options.warmup ?? 500;
    this.sampleCount = options.samples ?? 10;
    this.samples = [];
  }

  addSample(value) {
    this.samples.push(value);
  }

  getMedian() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  getMean() {
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  getStdDev() {
    const mean = this.getMean();
    const squaredDiffs = this.samples.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / this.samples.length);
  }

  getCV() {
    // Coefficient of Variation (%)
    return (this.getStdDev() / this.getMean()) * 100;
  }

  getPercentile(p) {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getReliabilityRating() {
    const cv = this.getCV();
    if (cv < 10) return 'excellent';
    if (cv < 20) return 'good';
    if (cv < 50) return 'moderate';
    return 'poor';
  }

  getSummary() {
    return {
      median: this.getMedian(),
      mean: this.getMean(),
      stdDev: this.getStdDev(),
      cv: this.getCV(),
      min: Math.min(...this.samples),
      max: Math.max(...this.samples),
      p1: this.getPercentile(1),
      p99: this.getPercentile(99),
      reliability: this.getReliabilityRating(),
      sampleCount: this.samples.length
    };
  }
}
```

### Best Practices

1. **Warmup Phase**: Discard first 500+ iterations (JIT, cache warming)
2. **Multiple Samples**: Collect at least 10 independent samples
3. **Randomized Ordering**: Vary test order to reduce systematic bias
4. **Report Multiple Metrics**:
   - **Median**: Typical performance (resistant to outliers)
   - **Mean**: Total cost (for capacity planning)
   - **P1/P99**: Consistency indicators
5. **Include CV%**: Assess measurement reliability

---

## 4. Frame Timing vs GPU Timestamps

| Aspect | Frame Timing | GPU Timestamp Queries |
|--------|--------------|----------------------|
| **Measures** | Total frame time including JS | GPU execution only |
| **Availability** | Always available | Optional feature |
| **Precision** | ~1ms (performance.now) | Nanoseconds (quantized to 100μs) |
| **Cross-device** | Comparable | Not comparable |
| **Overhead** | Negligible | Buffer allocation/mapping |
| **Use case** | Overall performance | GPU optimization |

### When to Use Each

- **Frame timing**: Production monitoring, user-facing metrics, FPS counters
- **Timestamp queries**: Development optimization, comparing shader techniques, identifying GPU bottlenecks

---

## 5. CI/CD Integration

### GitHub Actions GPU Runners

Available since 2024 with NVIDIA Tesla T4 GPU:

```yaml
# .github/workflows/gpu-benchmark.yml
name: GPU Benchmarks

on:
  push:
    branches: [main]
  pull_request:

jobs:
  benchmark:
    runs-on: gpu-t4-4-core  # 4 vCPUs, 28GB RAM, Tesla T4 GPU
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install chromium

      - name: Run GPU benchmarks
        run: npm run benchmark:gpu

      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: benchmark-results/
```

**Cost**: $0.07/minute

### Playwright Configuration for WebGPU

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    channel: "chrome",
    launchOptions: {
      args: [
        '--enable-gpu',
        '--use-angle=vulkan',
        '--enable-features=Vulkan',
        '--disable-vulkan-surface',
        '--enable-unsafe-webgpu'
      ]
    }
  }
});
```

### Regression Detection

```javascript
// scripts/check-regression.js
const baseline = JSON.parse(fs.readFileSync('baseline.json'));
const current = JSON.parse(fs.readFileSync('current.json'));

const regressionThreshold = 1.1;  // 10% regression

for (const [testName, baselineValue] of Object.entries(baseline)) {
  const currentValue = current[testName];
  const ratio = currentValue / baselineValue;

  if (ratio > regressionThreshold) {
    console.error(`REGRESSION: ${testName} is ${((ratio - 1) * 100).toFixed(1)}% slower`);
    process.exit(1);
  }
}

console.log('No regressions detected');
```

### Self-Hosted Alternatives

- **RunsOn**: AWS-based GPU runners at ~$0.009/min (85% cheaper)
- **Self-hosted EC2**: G4dn instances from $0.526/hour

---

## 6. Image Editor Metrics

### Target Latencies

| Interaction | Target | Source |
|-------------|--------|--------|
| Slider response | <100ms | Nielsen Norman (instant feel) |
| Dragging | <33ms | Research studies |
| Touch | <25ms | Mobile guidelines |
| Animation frame | <16ms | 60fps target |

### Key Metrics to Track

| Metric | Target | Measurement |
|--------|--------|-------------|
| Draft render time | <25ms | GPU timestamps |
| Full render time | <100ms | GPU timestamps |
| Histogram update | <2ms | GPU timestamps |
| FPS during drag | >30 | Frame timing |
| Memory per frame | <50MB | Memory profiler |
| P99 frame time | <33ms | Frame distribution |

### Professional Editor Benchmarks

Industry references:
- **PugetBench for Lightroom Classic**: Tests import, develop, export operations
- **Procyon Photo Editing Benchmark**: Uses actual Adobe applications
- **PugetBench for DaVinci Resolve**: FPS calculation via API

---

## 7. Recommended Benchmark Suite

### Test Cases

```typescript
// packages/core/benchmarks/gpu-pipeline.bench.ts

describe('GPU Pipeline Benchmarks', () => {
  beforeAll(async () => {
    // Warmup: 500 frames
    for (let i = 0; i < 500; i++) {
      await renderFrame()
    }
  })

  test('draft render time', async () => {
    const stats = new BenchmarkStats({ samples: 30 })

    for (let i = 0; i < 30; i++) {
      const start = await getGPUTimestamp()
      await renderDraft()
      const end = await getGPUTimestamp()
      stats.addSample(end - start)
    }

    const summary = stats.getSummary()
    expect(summary.median).toBeLessThan(25_000_000) // 25ms in nanoseconds
    expect(summary.cv).toBeLessThan(20) // Good reliability
  })

  test('full render time', async () => {
    const stats = new BenchmarkStats({ samples: 30 })

    for (let i = 0; i < 30; i++) {
      const start = await getGPUTimestamp()
      await renderFull()
      const end = await getGPUTimestamp()
      stats.addSample(end - start)
    }

    const summary = stats.getSummary()
    expect(summary.median).toBeLessThan(100_000_000) // 100ms
  })

  test('histogram computation', async () => {
    const stats = new BenchmarkStats({ samples: 30 })

    for (let i = 0; i < 30; i++) {
      const start = await getGPUTimestamp()
      await computeHistogram()
      const end = await getGPUTimestamp()
      stats.addSample(end - start)
    }

    const summary = stats.getSummary()
    expect(summary.median).toBeLessThan(5_000_000) // 5ms
  })
})
```

### Benchmark Report Format

```json
{
  "timestamp": "2026-01-26T12:00:00Z",
  "commit": "abc123",
  "gpu": "NVIDIA Tesla T4",
  "tests": {
    "draftRender": {
      "median": 18.5,
      "mean": 19.2,
      "p99": 24.1,
      "cv": 12.3,
      "unit": "ms"
    },
    "fullRender": {
      "median": 85.2,
      "mean": 87.1,
      "p99": 102.3,
      "cv": 8.7,
      "unit": "ms"
    },
    "histogram": {
      "median": 2.1,
      "mean": 2.3,
      "p99": 3.8,
      "cv": 15.2,
      "unit": "ms"
    }
  }
}
```

---

## References

### Tools
- [stats-gl](https://github.com/RenaudRohlinger/stats-gl) - Performance monitoring
- [webgpu-utils](https://github.com/greggman/webgpu-utils) - Helper library
- [WebGPU Inspector](https://chromewebstore.google.com/detail/webgpu-inspector/holcbbnljhkpkjkhgkagjkhhpeochfal) - Chrome extension

### Documentation
- [WebGPU Fundamentals - Timing](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)
- [Toji.dev - WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)
- [GitHub Actions GPU Runners](https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available/)

### Industry Benchmarks
- [PugetBench for Lightroom Classic](https://www.pugetsystems.com/pugetbench/creators/lightroom-classic/)
- [Procyon Photo Editing Benchmark](https://benchmarks.ul.com/procyon/photo-editing-benchmark)
