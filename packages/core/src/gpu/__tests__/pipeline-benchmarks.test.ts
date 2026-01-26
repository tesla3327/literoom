/**
 * Benchmark tests for GPU pipelines.
 *
 * Tests performance characteristics of:
 * - Edit pipeline frame timing (draft and full render)
 * - Histogram computation timing
 * - Texture pool performance
 *
 * These tests measure actual GPU performance and may vary
 * based on hardware capabilities.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// ============================================================================
// BenchmarkStats Utility Class
// ============================================================================

/**
 * Utility class for collecting and analyzing benchmark samples.
 *
 * Provides statistical analysis including:
 * - Central tendency: mean, median
 * - Extremes: min, max
 * - Variability: P99, standard deviation, coefficient of variation
 */
export class BenchmarkStats {
  private samples: number[] = []

  /**
   * Add a timing sample in milliseconds.
   */
  add(sample: number): void {
    this.samples.push(sample)
  }

  /**
   * Get the median value of all samples.
   * Returns 0 if no samples.
   */
  getMedian(): number {
    if (this.samples.length === 0) return 0

    const sorted = [...this.samples].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2
    }
    return sorted[mid]!
  }

  /**
   * Get the arithmetic mean of all samples.
   * Returns 0 if no samples.
   */
  getMean(): number {
    if (this.samples.length === 0) return 0
    return this.samples.reduce((sum, s) => sum + s, 0) / this.samples.length
  }

  /**
   * Get the 99th percentile value.
   * Returns 0 if no samples.
   */
  getP99(): number {
    if (this.samples.length === 0) return 0

    const sorted = [...this.samples].sort((a, b) => a - b)
    const index = Math.ceil(0.99 * sorted.length) - 1
    return sorted[Math.max(0, index)]!
  }

  /**
   * Get the minimum sample value.
   * Returns 0 if no samples.
   */
  getMin(): number {
    if (this.samples.length === 0) return 0
    return Math.min(...this.samples)
  }

  /**
   * Get the maximum sample value.
   * Returns 0 if no samples.
   */
  getMax(): number {
    if (this.samples.length === 0) return 0
    return Math.max(...this.samples)
  }

  /**
   * Get the standard deviation of all samples.
   * Returns 0 if no samples.
   */
  getStdDev(): number {
    if (this.samples.length === 0) return 0

    const mean = this.getMean()
    const squaredDiffs = this.samples.map((s) => Math.pow(s - mean, 2))
    const avgSquaredDiff =
      squaredDiffs.reduce((sum, d) => sum + d, 0) / this.samples.length
    return Math.sqrt(avgSquaredDiff)
  }

  /**
   * Get the coefficient of variation (CV).
   * CV = stdDev / mean, expressed as a ratio.
   * Returns 0 if mean is 0.
   */
  getCV(): number {
    const mean = this.getMean()
    if (mean === 0) return 0
    return this.getStdDev() / mean
  }

  /**
   * Get the number of samples collected.
   */
  getSampleCount(): number {
    return this.samples.length
  }

  /**
   * Clear all collected samples.
   */
  clear(): void {
    this.samples = []
  }

  /**
   * Get a formatted summary of the statistics.
   */
  getSummary(): string {
    return [
      `Samples: ${this.getSampleCount()}`,
      `Median: ${this.getMedian().toFixed(2)}ms`,
      `Mean: ${this.getMean().toFixed(2)}ms`,
      `P99: ${this.getP99().toFixed(2)}ms`,
      `Min: ${this.getMin().toFixed(2)}ms`,
      `Max: ${this.getMax().toFixed(2)}ms`,
      `StdDev: ${this.getStdDev().toFixed(2)}ms`,
      `CV: ${(this.getCV() * 100).toFixed(1)}%`,
    ].join(' | ')
  }
}

// ============================================================================
// Benchmark Configuration
// ============================================================================

/** Number of warmup iterations before measuring */
const WARMUP_ITERATIONS = 10

/** Number of samples to collect for each benchmark */
const SAMPLE_COUNT = 30

/** Target times in milliseconds */
const TARGETS = {
  /** Draft render should complete in under 25ms */
  DRAFT_RENDER_MS: 25,
  /** Full render should complete in under 100ms */
  FULL_RENDER_MS: 100,
  /** Histogram computation should complete in under 2ms */
  HISTOGRAM_MS: 2,
  /** Texture pool acquire should complete in under 1ms */
  TEXTURE_POOL_ACQUIRE_MS: 1,
} as const

// ============================================================================
// Test Data Helpers
// ============================================================================

/**
 * Create test RGB pixels with a gradient pattern.
 */
function createTestRgbPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      pixels[idx] = (x * 255) / width // R: horizontal gradient
      pixels[idx + 1] = (y * 255) / height // G: vertical gradient
      pixels[idx + 2] = 128 // B: constant
    }
  }
  return pixels
}

/**
 * Create test RGBA pixels with a gradient pattern.
 */
function createTestRgbaPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      pixels[idx] = (x * 255) / width // R: horizontal gradient
      pixels[idx + 1] = (y * 255) / height // G: vertical gradient
      pixels[idx + 2] = 128 // B: constant
      pixels[idx + 3] = 255 // A: fully opaque
    }
  }
  return pixels
}

/**
 * Run warmup iterations for a function.
 */
async function warmup(
  fn: () => Promise<void>,
  iterations: number = WARMUP_ITERATIONS
): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await fn()
  }
}

/**
 * Collect benchmark samples for a function.
 */
async function collectSamples(
  fn: () => Promise<number>,
  sampleCount: number = SAMPLE_COUNT
): Promise<BenchmarkStats> {
  const stats = new BenchmarkStats()
  for (let i = 0; i < sampleCount; i++) {
    const time = await fn()
    stats.add(time)
  }
  return stats
}

// ============================================================================
// BenchmarkStats Unit Tests
// ============================================================================

describe('BenchmarkStats', () => {
  it('should handle empty samples', () => {
    const stats = new BenchmarkStats()
    expect(stats.getMedian()).toBe(0)
    expect(stats.getMean()).toBe(0)
    expect(stats.getP99()).toBe(0)
    expect(stats.getMin()).toBe(0)
    expect(stats.getMax()).toBe(0)
    expect(stats.getStdDev()).toBe(0)
    expect(stats.getCV()).toBe(0)
    expect(stats.getSampleCount()).toBe(0)
  })

  it('should calculate median correctly for odd count', () => {
    const stats = new BenchmarkStats()
    stats.add(1)
    stats.add(3)
    stats.add(2)
    expect(stats.getMedian()).toBe(2)
  })

  it('should calculate median correctly for even count', () => {
    const stats = new BenchmarkStats()
    stats.add(1)
    stats.add(2)
    stats.add(3)
    stats.add(4)
    expect(stats.getMedian()).toBe(2.5)
  })

  it('should calculate mean correctly', () => {
    const stats = new BenchmarkStats()
    stats.add(10)
    stats.add(20)
    stats.add(30)
    expect(stats.getMean()).toBe(20)
  })

  it('should calculate P99 correctly', () => {
    const stats = new BenchmarkStats()
    // Add 100 samples from 1 to 100
    for (let i = 1; i <= 100; i++) {
      stats.add(i)
    }
    expect(stats.getP99()).toBe(99)
  })

  it('should calculate min and max correctly', () => {
    const stats = new BenchmarkStats()
    stats.add(50)
    stats.add(10)
    stats.add(90)
    stats.add(30)
    expect(stats.getMin()).toBe(10)
    expect(stats.getMax()).toBe(90)
  })

  it('should calculate standard deviation correctly', () => {
    const stats = new BenchmarkStats()
    // Use samples where we know the standard deviation
    // [2, 4, 4, 4, 5, 5, 7, 9] has stddev = 2
    ;[2, 4, 4, 4, 5, 5, 7, 9].forEach((v) => stats.add(v))
    expect(stats.getStdDev()).toBeCloseTo(2, 0)
  })

  it('should calculate coefficient of variation correctly', () => {
    const stats = new BenchmarkStats()
    stats.add(10)
    stats.add(10)
    stats.add(10)
    // With no variation, CV should be 0
    expect(stats.getCV()).toBe(0)
  })

  it('should clear samples correctly', () => {
    const stats = new BenchmarkStats()
    stats.add(1)
    stats.add(2)
    stats.add(3)
    expect(stats.getSampleCount()).toBe(3)

    stats.clear()
    expect(stats.getSampleCount()).toBe(0)
    expect(stats.getMean()).toBe(0)
  })

  it('should generate a summary string', () => {
    const stats = new BenchmarkStats()
    stats.add(10)
    stats.add(20)
    stats.add(30)

    const summary = stats.getSummary()
    expect(summary).toContain('Samples: 3')
    expect(summary).toContain('Median:')
    expect(summary).toContain('Mean:')
    expect(summary).toContain('P99:')
  })
})

// ============================================================================
// GPU Pipeline Benchmarks
// ============================================================================

// Check if WebGPU is available
const isWebGPUAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator

describe('GPU Pipeline Benchmarks', () => {
  // Skip entire suite if WebGPU is not available
  const describeIfWebGPU = isWebGPUAvailable ? describe : describe.skip

  describeIfWebGPU('Edit Pipeline', () => {
    // Standard test image size (1920x1080 HD)
    const TEST_WIDTH = 1920
    const TEST_HEIGHT = 1080

    let testPixels: Uint8Array

    beforeAll(async () => {
      testPixels = createTestRgbPixels(TEST_WIDTH, TEST_HEIGHT)
    })

    it('should complete draft render under target time', async () => {
      // Dynamic import to avoid issues when WebGPU is not available
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      // Get and initialize pipeline
      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Warmup phase
      await warmup(async () => {
        await pipeline.process(
          { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT },
          { adjustments: { temperature: 0, tint: 0, exposure: 0.5, contrast: 10, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 } }
        )
      })

      // Collect samples
      const stats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.process(
          { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT },
          { adjustments: { temperature: 0, tint: 0, exposure: 0.5, contrast: 10, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 } }
        )
        return performance.now() - start
      })

      // Report results
      console.log(`Draft Render Benchmark: ${stats.getSummary()}`)

      // Assert median is under target
      expect(stats.getMedian()).toBeLessThan(TARGETS.DRAFT_RENDER_MS)

      // Cleanup
      resetGPUEditPipeline()
    }, 60000) // 60 second timeout for warmup + samples

    it('should complete full render under target time', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Full render parameters (all operations enabled)
      const fullParams = {
        rotation: 5,
        adjustments: {
          temperature: 10,
          tint: 5,
          exposure: 0.5,
          contrast: 20,
          highlights: -30,
          shadows: 40,
          whites: 10,
          blacks: -10,
          vibrance: 25,
          saturation: 15,
        },
        toneCurvePoints: [
          { x: 0, y: 0.05 },
          { x: 0.25, y: 0.2 },
          { x: 0.5, y: 0.55 },
          { x: 0.75, y: 0.8 },
          { x: 1, y: 0.95 },
        ],
      }

      // Warmup phase
      await warmup(async () => {
        await pipeline.process(
          { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT },
          fullParams
        )
      })

      // Collect samples
      const stats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.process(
          { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT },
          fullParams
        )
        return performance.now() - start
      })

      // Report results
      console.log(`Full Render Benchmark: ${stats.getSummary()}`)

      // Assert median is under target
      expect(stats.getMedian()).toBeLessThan(TARGETS.FULL_RENDER_MS)

      // Cleanup
      resetGPUEditPipeline()
    }, 120000) // 120 second timeout for warmup + samples

    it('should report timing breakdown accurately', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Process with all stages enabled
      const result = await pipeline.process(
        { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT },
        {
          rotation: 5,
          adjustments: { temperature: 0, tint: 0, exposure: 0.5, contrast: 10, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 },
          toneCurvePoints: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        }
      )

      // Verify timing breakdown exists
      expect(result.timing).toBeDefined()
      expect(result.timing.total).toBeGreaterThan(0)
      expect(result.timing.upload).toBeGreaterThanOrEqual(0)
      expect(result.timing.rotation).toBeGreaterThanOrEqual(0)
      expect(result.timing.adjustments).toBeGreaterThanOrEqual(0)
      expect(result.timing.toneCurve).toBeGreaterThanOrEqual(0)
      expect(result.timing.readback).toBeGreaterThanOrEqual(0)

      // Sum of parts should be close to total (allowing for some overhead)
      const sumOfParts =
        result.timing.upload +
        result.timing.rotation +
        result.timing.adjustments +
        result.timing.toneCurve +
        result.timing.masks +
        result.timing.readback

      // Total should be >= sum (there may be overhead not captured)
      expect(result.timing.total).toBeGreaterThanOrEqual(sumOfParts * 0.9)

      console.log('Timing Breakdown:', {
        total: `${result.timing.total.toFixed(2)}ms`,
        upload: `${result.timing.upload.toFixed(2)}ms`,
        rotation: `${result.timing.rotation.toFixed(2)}ms`,
        adjustments: `${result.timing.adjustments.toFixed(2)}ms`,
        toneCurve: `${result.timing.toneCurve.toFixed(2)}ms`,
        masks: `${result.timing.masks.toFixed(2)}ms`,
        readback: `${result.timing.readback.toFixed(2)}ms`,
      })

      // Cleanup
      resetGPUEditPipeline()
    })
  })

  describeIfWebGPU('Histogram Pipeline', () => {
    const TEST_WIDTH = 1920
    const TEST_HEIGHT = 1080

    let testPixels: Uint8Array

    beforeAll(async () => {
      testPixels = createTestRgbaPixels(TEST_WIDTH, TEST_HEIGHT)
    })

    it('should compute histogram under target time', async () => {
      const { getHistogramPipeline, resetHistogramPipeline } = await import(
        '../pipelines/histogram-pipeline'
      )

      const pipeline = await getHistogramPipeline()

      if (!pipeline) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Warmup phase
      await warmup(async () => {
        await pipeline.computeFromPixels(testPixels, TEST_WIDTH, TEST_HEIGHT)
      })

      // Collect samples
      const stats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.computeFromPixels(testPixels, TEST_WIDTH, TEST_HEIGHT)
        return performance.now() - start
      })

      // Report results
      console.log(`Histogram Computation Benchmark: ${stats.getSummary()}`)

      // Assert median is under target
      expect(stats.getMedian()).toBeLessThan(TARGETS.HISTOGRAM_MS)

      // Cleanup
      resetHistogramPipeline()
    }, 60000)

    it('should handle various image sizes efficiently', async () => {
      const { getHistogramPipeline, resetHistogramPipeline } = await import(
        '../pipelines/histogram-pipeline'
      )

      const pipeline = await getHistogramPipeline()

      if (!pipeline) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const sizes = [
        { width: 640, height: 480, label: 'VGA' },
        { width: 1280, height: 720, label: 'HD' },
        { width: 1920, height: 1080, label: 'FHD' },
        { width: 3840, height: 2160, label: '4K' },
      ]

      for (const { width, height, label } of sizes) {
        const pixels = createTestRgbaPixels(width, height)

        // Warmup
        await warmup(async () => {
          await pipeline.computeFromPixels(pixels, width, height)
        }, 5)

        // Collect samples (fewer for this test)
        const stats = await collectSamples(async () => {
          const start = performance.now()
          await pipeline.computeFromPixels(pixels, width, height)
          return performance.now() - start
        }, 10)

        console.log(`Histogram ${label} (${width}x${height}): ${stats.getSummary()}`)

        // All sizes should complete reasonably quickly
        expect(stats.getMedian()).toBeLessThan(TARGETS.HISTOGRAM_MS * 10) // Allow 20ms for 4K
      }

      // Cleanup
      resetHistogramPipeline()
    }, 120000)
  })

  describeIfWebGPU('Texture Pool Performance', () => {
    it('should acquire textures efficiently', async () => {
      const { TexturePool } = await import('../texture-utils')
      const { getGPUCapabilityService } = await import('../capabilities')

      const gpuService = getGPUCapabilityService()
      await gpuService.initialize()

      if (!gpuService.isReady || !gpuService.device) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const pool = new TexturePool(gpuService.device, 8)
      const TEST_WIDTH = 1920
      const TEST_HEIGHT = 1080
      const usage = 0x0f // PINGPONG usage

      // Warmup: acquire and release textures
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const texture = pool.acquire(TEST_WIDTH, TEST_HEIGHT, usage, 'Warmup')
        pool.release(texture, TEST_WIDTH, TEST_HEIGHT, usage)
      }

      // Benchmark: acquire (should be fast from pool)
      const stats = await collectSamples(async () => {
        const start = performance.now()
        const texture = pool.acquire(TEST_WIDTH, TEST_HEIGHT, usage, 'Benchmark')
        const elapsed = performance.now() - start
        pool.release(texture, TEST_WIDTH, TEST_HEIGHT, usage)
        return elapsed
      })

      console.log(`Texture Pool Acquire Benchmark: ${stats.getSummary()}`)

      // Assert pooled acquire is fast
      expect(stats.getMedian()).toBeLessThan(TARGETS.TEXTURE_POOL_ACQUIRE_MS)

      // Cleanup
      pool.clear()
    })

    it('should show improvement over direct texture creation', async () => {
      const { TexturePool } = await import('../texture-utils')
      const { getGPUCapabilityService } = await import('../capabilities')

      const gpuService = getGPUCapabilityService()
      await gpuService.initialize()

      if (!gpuService.isReady || !gpuService.device) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const device = gpuService.device
      const pool = new TexturePool(device, 8)
      const TEST_WIDTH = 1920
      const TEST_HEIGHT = 1080
      const usage = 0x0f // PINGPONG usage

      // Prime the pool
      const primeTexture = pool.acquire(TEST_WIDTH, TEST_HEIGHT, usage, 'Prime')
      pool.release(primeTexture, TEST_WIDTH, TEST_HEIGHT, usage)

      // Benchmark: direct texture creation (no pool)
      const directStats = await collectSamples(async () => {
        const start = performance.now()
        const texture = device.createTexture({
          label: 'Direct Texture',
          size: { width: TEST_WIDTH, height: TEST_HEIGHT, depthOrArrayLayers: 1 },
          format: 'rgba8unorm',
          usage,
        })
        const elapsed = performance.now() - start
        texture.destroy()
        return elapsed
      }, 20)

      // Benchmark: pooled texture acquisition
      const poolStats = await collectSamples(async () => {
        const start = performance.now()
        const texture = pool.acquire(TEST_WIDTH, TEST_HEIGHT, usage, 'Pooled')
        const elapsed = performance.now() - start
        pool.release(texture, TEST_WIDTH, TEST_HEIGHT, usage)
        return elapsed
      }, 20)

      console.log(`Direct Texture Creation: ${directStats.getSummary()}`)
      console.log(`Pooled Texture Acquire: ${poolStats.getSummary()}`)

      // Pooled should be faster (or at worst comparable)
      // Note: On first acquire, pooled creates a texture, so we compare medians
      const speedup = directStats.getMedian() / Math.max(poolStats.getMedian(), 0.001)
      console.log(`Speedup factor: ${speedup.toFixed(2)}x`)

      // Pooled should not be significantly slower
      expect(poolStats.getMedian()).toBeLessThanOrEqual(directStats.getMedian() * 2)

      // Cleanup
      pool.clear()
    })
  })

  describeIfWebGPU('Draft vs Full Render Comparison', () => {
    const TEST_WIDTH = 1920
    const TEST_HEIGHT = 1080

    let testPixels: Uint8Array

    beforeAll(() => {
      testPixels = createTestRgbPixels(TEST_WIDTH, TEST_HEIGHT)
    })

    it('should show performance difference between draft and full render', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Draft params (single adjustment)
      const draftParams = {
        adjustments: { temperature: 0, tint: 0, exposure: 0.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 },
      }

      // Full params (all operations)
      const fullParams = {
        rotation: 5,
        adjustments: {
          temperature: 10,
          tint: 5,
          exposure: 0.5,
          contrast: 20,
          highlights: -30,
          shadows: 40,
          whites: 10,
          blacks: -10,
          vibrance: 25,
          saturation: 15,
        },
        toneCurvePoints: [
          { x: 0, y: 0.05 },
          { x: 0.25, y: 0.2 },
          { x: 0.5, y: 0.55 },
          { x: 0.75, y: 0.8 },
          { x: 1, y: 0.95 },
        ],
      }

      const input = { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT }

      // Warmup both
      await warmup(async () => {
        await pipeline.process(input, draftParams)
      }, 5)
      await warmup(async () => {
        await pipeline.process(input, fullParams)
      }, 5)

      // Benchmark draft
      const draftStats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.process(input, draftParams)
        return performance.now() - start
      }, 20)

      // Benchmark full
      const fullStats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.process(input, fullParams)
        return performance.now() - start
      }, 20)

      console.log(`Draft Render: ${draftStats.getSummary()}`)
      console.log(`Full Render: ${fullStats.getSummary()}`)

      const ratio = fullStats.getMedian() / Math.max(draftStats.getMedian(), 0.001)
      console.log(`Full/Draft ratio: ${ratio.toFixed(2)}x`)

      // Full render should be slower than draft
      expect(fullStats.getMedian()).toBeGreaterThan(draftStats.getMedian())

      // Draft should meet target
      expect(draftStats.getMedian()).toBeLessThan(TARGETS.DRAFT_RENDER_MS)

      // Full should meet target
      expect(fullStats.getMedian()).toBeLessThan(TARGETS.FULL_RENDER_MS)

      // Cleanup
      resetGPUEditPipeline()
    }, 120000)
  })
})

// ============================================================================
// Export for use in other tests
// ============================================================================

export {
  WARMUP_ITERATIONS,
  SAMPLE_COUNT,
  TARGETS,
  createTestRgbPixels,
  createTestRgbaPixels,
  warmup,
  collectSamples,
}
