/**
 * Benchmark tests for edit pipeline readback performance.
 *
 * This benchmark focuses on measuring the GPU readback bottleneck:
 * - readTexturePixels() time (the blocking mapAsync + getMappedRange)
 * - Full pipeline process() time
 * - Breakdown of time by stage to identify bottlenecks
 *
 * Used to capture BEFORE and AFTER data when optimizing the readback operation.
 *
 * Run with: pnpm vitest packages/core/src/gpu/benchmarks/pipeline-readback.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BenchmarkStats,
  warmup,
  collectSamples,
  createTestRgbPixels,
  createTestRgbaPixels,
  WARMUP_ITERATIONS,
  SAMPLE_COUNT,
} from '../__tests__/pipeline-benchmarks.test'

// ============================================================================
// Benchmark Configuration
// ============================================================================

/** Target image dimensions for benchmarking */
const BENCHMARK_DIMENSIONS = {
  /** Draft mode preview (typical slider interaction) */
  DRAFT: { width: 1280, height: 853 },
  /** Full resolution preview */
  FULL: { width: 2560, height: 1707 },
  /** HD reference size */
  HD: { width: 1920, height: 1080 },
  /** 4K reference size */
  '4K': { width: 3840, height: 2160 },
} as const

/** Benchmark settings */
const BENCHMARK_CONFIG = {
  /** Number of warmup iterations before measuring */
  warmupIterations: 5,
  /** Number of samples to collect for statistical analysis */
  sampleCount: 30,
  /** Vitest bench iterations */
  iterations: 20,
  /** Target readback time for draft mode (ms) - currently 5-10ms, goal is <2ms */
  targetDraftReadbackMs: 5,
  /** Target readback time for full mode (ms) */
  targetFullReadbackMs: 15,
} as const

// ============================================================================
// Timing Breakdown Interface
// ============================================================================

/**
 * Detailed timing breakdown for a single pipeline run.
 */
interface ReadbackTimingBreakdown {
  /** Total time from start to finish */
  total: number
  /** Time spent uploading pixels to GPU */
  upload: number
  /** Time spent in GPU processing stages */
  gpuProcessing: number
  /** Time spent in readTexturePixels (the blocking readback) */
  readback: number
  /** Time spent in RGB<->RGBA conversion */
  conversion: number
  /** Percentage of total time spent in readback */
  readbackPercent: number
}

// ============================================================================
// Test Data Helpers
// ============================================================================

/**
 * Standard test adjustments for benchmark consistency.
 */
const TEST_ADJUSTMENTS = {
  temperature: 10,
  tint: 5,
  exposure: 0.5,
  contrast: 20,
  highlights: -20,
  shadows: 30,
  whites: 10,
  blacks: -10,
  vibrance: 20,
  saturation: 10,
}

/**
 * Tone curve points for a realistic S-curve.
 */
const TEST_TONE_CURVE_POINTS = [
  { x: 0, y: 0.05 },
  { x: 0.25, y: 0.2 },
  { x: 0.5, y: 0.55 },
  { x: 0.75, y: 0.8 },
  { x: 1, y: 0.95 },
]

/**
 * Calculate timing breakdown from pipeline result.
 */
function calculateBreakdown(timing: {
  total: number
  upload: number
  rgbToRgba: number
  rgbaToRgb: number
  rotation: number
  adjustments: number
  toneCurve: number
  uberPipeline: number
  masks: number
  readback: number
  downsample: number
}): ReadbackTimingBreakdown {
  const gpuProcessing =
    timing.rotation +
    timing.adjustments +
    timing.toneCurve +
    timing.uberPipeline +
    timing.masks +
    timing.downsample

  const conversion = timing.rgbToRgba + timing.rgbaToRgb

  return {
    total: timing.total,
    upload: timing.upload,
    gpuProcessing,
    readback: timing.readback,
    conversion,
    readbackPercent: (timing.readback / timing.total) * 100,
  }
}

/**
 * Format a timing breakdown for console output.
 */
function formatBreakdown(breakdown: ReadbackTimingBreakdown, label: string): string {
  return [
    `\n=== ${label} Timing Breakdown ===`,
    `Total: ${breakdown.total.toFixed(2)}ms`,
    `  Upload: ${breakdown.upload.toFixed(2)}ms (${((breakdown.upload / breakdown.total) * 100).toFixed(1)}%)`,
    `  GPU Processing: ${breakdown.gpuProcessing.toFixed(2)}ms (${((breakdown.gpuProcessing / breakdown.total) * 100).toFixed(1)}%)`,
    `  Readback: ${breakdown.readback.toFixed(2)}ms (${breakdown.readbackPercent.toFixed(1)}%)`,
    `  Conversion: ${breakdown.conversion.toFixed(2)}ms (${((breakdown.conversion / breakdown.total) * 100).toFixed(1)}%)`,
    '',
  ].join('\n')
}

// ============================================================================
// GPU Pipeline Benchmarks
// ============================================================================

// Check if WebGPU is available
const isWebGPUAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator

describe('Pipeline Readback Benchmarks', () => {
  // Skip entire suite if WebGPU is not available
  const describeIfWebGPU = isWebGPUAvailable ? describe : describe.skip

  describeIfWebGPU('Draft Mode Readback (1280x853)', () => {
    const { width, height } = BENCHMARK_DIMENSIONS.DRAFT
    let testPixels: Uint8Array
    let testRgbaPixels: Uint8Array

    beforeAll(() => {
      testPixels = createTestRgbPixels(width, height)
      testRgbaPixels = createTestRgbaPixels(width, height)
    })

    it('should measure readback timing breakdown', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const params = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
      }

      const input = { pixels: testPixels, width, height }

      // Warmup
      await warmup(async () => {
        await pipeline.process(input, params)
      }, BENCHMARK_CONFIG.warmupIterations)

      // Collect samples for timing breakdown
      const breakdowns: ReadbackTimingBreakdown[] = []
      const readbackStats = new BenchmarkStats()

      for (let i = 0; i < BENCHMARK_CONFIG.sampleCount; i++) {
        const result = await pipeline.process(input, params)
        const breakdown = calculateBreakdown(result.timing)
        breakdowns.push(breakdown)
        readbackStats.add(result.timing.readback)
      }

      // Calculate average breakdown
      const avgBreakdown: ReadbackTimingBreakdown = {
        total: breakdowns.reduce((sum, b) => sum + b.total, 0) / breakdowns.length,
        upload: breakdowns.reduce((sum, b) => sum + b.upload, 0) / breakdowns.length,
        gpuProcessing: breakdowns.reduce((sum, b) => sum + b.gpuProcessing, 0) / breakdowns.length,
        readback: breakdowns.reduce((sum, b) => sum + b.readback, 0) / breakdowns.length,
        conversion: breakdowns.reduce((sum, b) => sum + b.conversion, 0) / breakdowns.length,
        readbackPercent:
          breakdowns.reduce((sum, b) => sum + b.readbackPercent, 0) / breakdowns.length,
      }

      // Report results
      console.log(formatBreakdown(avgBreakdown, `Draft Mode (${width}x${height})`))
      console.log(`Readback Stats: ${readbackStats.getSummary()}`)

      // Assert readback is the bottleneck (typically >30% of total time)
      // This documents the current state before optimization
      expect(avgBreakdown.readback).toBeGreaterThan(0)

      // Cleanup
      resetGPUEditPipeline()
    }, 120000)

    it('should measure RGBA input/output path (no conversion overhead)', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const params = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
        outputFormat: 'rgba' as const,
      }

      const input = { pixels: testRgbaPixels, width, height, format: 'rgba' as const }

      // Warmup
      await warmup(async () => {
        await pipeline.process(input, params)
      }, BENCHMARK_CONFIG.warmupIterations)

      // Collect samples
      const breakdowns: ReadbackTimingBreakdown[] = []
      const readbackStats = new BenchmarkStats()

      for (let i = 0; i < BENCHMARK_CONFIG.sampleCount; i++) {
        const result = await pipeline.process(input, params)
        const breakdown = calculateBreakdown(result.timing)
        breakdowns.push(breakdown)
        readbackStats.add(result.timing.readback)
      }

      // Calculate average breakdown
      const avgBreakdown: ReadbackTimingBreakdown = {
        total: breakdowns.reduce((sum, b) => sum + b.total, 0) / breakdowns.length,
        upload: breakdowns.reduce((sum, b) => sum + b.upload, 0) / breakdowns.length,
        gpuProcessing: breakdowns.reduce((sum, b) => sum + b.gpuProcessing, 0) / breakdowns.length,
        readback: breakdowns.reduce((sum, b) => sum + b.readback, 0) / breakdowns.length,
        conversion: breakdowns.reduce((sum, b) => sum + b.conversion, 0) / breakdowns.length,
        readbackPercent:
          breakdowns.reduce((sum, b) => sum + b.readbackPercent, 0) / breakdowns.length,
      }

      // Report results
      console.log(formatBreakdown(avgBreakdown, `Draft Mode RGBA (${width}x${height})`))
      console.log(`Readback Stats (RGBA): ${readbackStats.getSummary()}`)

      // Conversion should be near zero with RGBA input/output
      expect(avgBreakdown.conversion).toBeLessThan(1)

      // Cleanup
      resetGPUEditPipeline()
    }, 120000)
  })

  describeIfWebGPU('Full Resolution Readback (2560x1707)', () => {
    const { width, height } = BENCHMARK_DIMENSIONS.FULL
    let testPixels: Uint8Array

    beforeAll(() => {
      testPixels = createTestRgbPixels(width, height)
    })

    it('should measure full resolution readback timing', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const params = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
      }

      const input = { pixels: testPixels, width, height }

      // Warmup
      await warmup(async () => {
        await pipeline.process(input, params)
      }, BENCHMARK_CONFIG.warmupIterations)

      // Collect samples
      const breakdowns: ReadbackTimingBreakdown[] = []
      const readbackStats = new BenchmarkStats()

      for (let i = 0; i < BENCHMARK_CONFIG.sampleCount; i++) {
        const result = await pipeline.process(input, params)
        const breakdown = calculateBreakdown(result.timing)
        breakdowns.push(breakdown)
        readbackStats.add(result.timing.readback)
      }

      // Calculate average breakdown
      const avgBreakdown: ReadbackTimingBreakdown = {
        total: breakdowns.reduce((sum, b) => sum + b.total, 0) / breakdowns.length,
        upload: breakdowns.reduce((sum, b) => sum + b.upload, 0) / breakdowns.length,
        gpuProcessing: breakdowns.reduce((sum, b) => sum + b.gpuProcessing, 0) / breakdowns.length,
        readback: breakdowns.reduce((sum, b) => sum + b.readback, 0) / breakdowns.length,
        conversion: breakdowns.reduce((sum, b) => sum + b.conversion, 0) / breakdowns.length,
        readbackPercent:
          breakdowns.reduce((sum, b) => sum + b.readbackPercent, 0) / breakdowns.length,
      }

      // Report results
      console.log(formatBreakdown(avgBreakdown, `Full Resolution (${width}x${height})`))
      console.log(`Readback Stats: ${readbackStats.getSummary()}`)

      // Document current state
      expect(avgBreakdown.readback).toBeGreaterThan(0)

      // Cleanup
      resetGPUEditPipeline()
    }, 180000)
  })

  describeIfWebGPU('Readback Scaling Analysis', () => {
    it('should measure readback time across different resolutions', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const params = {
        adjustments: TEST_ADJUSTMENTS,
      }

      const sizes = [
        { width: 640, height: 427, label: 'Thumbnail' },
        { width: 1280, height: 853, label: 'Draft' },
        { width: 1920, height: 1080, label: 'HD' },
        { width: 2560, height: 1707, label: 'Full' },
        { width: 3840, height: 2160, label: '4K' },
      ]

      console.log('\n=== Readback Scaling Analysis ===')
      console.log('Resolution | Pixels (MP) | Readback (ms) | MB/s')
      console.log('-----------|-------------|---------------|------')

      const results: Array<{
        label: string
        pixels: number
        readbackMs: number
        throughput: number
      }> = []

      for (const { width, height, label } of sizes) {
        const pixels = createTestRgbPixels(width, height)
        const input = { pixels, width, height }
        const pixelCount = width * height
        const dataSize = pixelCount * 4 // RGBA bytes

        // Warmup
        await warmup(async () => {
          await pipeline.process(input, params)
        }, 3)

        // Collect samples
        const readbackStats = new BenchmarkStats()

        for (let i = 0; i < 10; i++) {
          const result = await pipeline.process(input, params)
          readbackStats.add(result.timing.readback)
        }

        const avgReadback = readbackStats.getMedian()
        const throughput = dataSize / (avgReadback / 1000) / (1024 * 1024) // MB/s

        results.push({
          label,
          pixels: pixelCount,
          readbackMs: avgReadback,
          throughput,
        })

        console.log(
          `${label.padEnd(10)} | ${(pixelCount / 1e6).toFixed(2).padStart(11)} | ${avgReadback.toFixed(2).padStart(13)} | ${throughput.toFixed(0).padStart(5)}`
        )
      }

      // Analyze scaling behavior
      console.log('\n=== Scaling Analysis ===')
      const baseline = results[0]
      for (const result of results) {
        const pixelRatio = result.pixels / baseline.pixels
        const timeRatio = result.readbackMs / baseline.readbackMs
        const efficiency = pixelRatio / timeRatio
        console.log(
          `${result.label}: ${pixelRatio.toFixed(1)}x pixels, ${timeRatio.toFixed(1)}x time, ${efficiency.toFixed(2)} efficiency`
        )
      }

      // Readback should scale roughly linearly with data size
      // Allow some overhead for smaller sizes
      expect(results.length).toBe(sizes.length)

      // Cleanup
      resetGPUEditPipeline()
    }, 300000)
  })

  describeIfWebGPU('Isolated readTexturePixels Benchmark', () => {
    it('should measure raw readTexturePixels time separately', async () => {
      const { readTexturePixels, createTextureFromPixels, TextureUsage } = await import(
        '../texture-utils'
      )
      const { getGPUCapabilityService } = await import('../capabilities')

      const gpuService = getGPUCapabilityService()
      await gpuService.initialize()

      if (!gpuService.isReady || !gpuService.device) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const device = gpuService.device

      const sizes = [
        { width: 1280, height: 853, label: 'Draft' },
        { width: 2560, height: 1707, label: 'Full' },
      ]

      console.log('\n=== Isolated readTexturePixels Benchmark ===')
      console.log('Resolution | Readback (ms) | Median | P99 | StdDev')
      console.log('-----------|---------------|--------|-----|-------')

      for (const { width, height, label } of sizes) {
        const rgbaPixels = createTestRgbaPixels(width, height)

        // Create texture with pixels
        const texture = createTextureFromPixels(
          device,
          rgbaPixels,
          width,
          height,
          TextureUsage.PINGPONG,
          `Benchmark Texture ${label}`
        )

        // Warmup reads
        for (let i = 0; i < 5; i++) {
          await readTexturePixels(device, texture, width, height)
        }

        // Benchmark reads
        const stats = new BenchmarkStats()
        for (let i = 0; i < 30; i++) {
          const start = performance.now()
          await readTexturePixels(device, texture, width, height)
          stats.add(performance.now() - start)
        }

        console.log(
          `${label.padEnd(10)} | ${stats.getMean().toFixed(2).padStart(13)} | ${stats.getMedian().toFixed(2).padStart(6)} | ${stats.getP99().toFixed(2).padStart(3)} | ${stats.getStdDev().toFixed(2).padStart(6)}`
        )

        // Cleanup
        texture.destroy()
      }
    }, 120000)
  })
})

// ============================================================================
// Comparative Benchmarks for Before/After Analysis
// ============================================================================

describe('Comparative Readback Benchmarks', () => {
  const describeIfWebGPU = isWebGPUAvailable ? describe : describe.skip

  describeIfWebGPU('before/after comparison data collection', () => {
    it('should collect timing samples for statistical comparison', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const { width, height } = BENCHMARK_DIMENSIONS.DRAFT
      const testPixels = createTestRgbPixels(width, height)

      const params = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
      }

      const input = { pixels: testPixels, width, height }

      // Warmup
      await warmup(async () => {
        await pipeline.process(input, params)
      }, 10)

      // Collect samples
      const totalStats = new BenchmarkStats()
      const readbackStats = new BenchmarkStats()
      const uploadStats = new BenchmarkStats()
      const gpuStats = new BenchmarkStats()

      for (let i = 0; i < 50; i++) {
        const result = await pipeline.process(input, params)
        totalStats.add(result.timing.total)
        readbackStats.add(result.timing.readback)
        uploadStats.add(result.timing.upload)
        gpuStats.add(
          result.timing.adjustments +
            result.timing.toneCurve +
            result.timing.uberPipeline +
            result.timing.rotation +
            result.timing.masks
        )
      }

      // Output data in JSON format for easy comparison
      const comparisonData = {
        timestamp: new Date().toISOString(),
        dimensions: { width, height },
        samples: 50,
        total: {
          median: totalStats.getMedian(),
          mean: totalStats.getMean(),
          p99: totalStats.getP99(),
          min: totalStats.getMin(),
          max: totalStats.getMax(),
          stdDev: totalStats.getStdDev(),
        },
        readback: {
          median: readbackStats.getMedian(),
          mean: readbackStats.getMean(),
          p99: readbackStats.getP99(),
          min: readbackStats.getMin(),
          max: readbackStats.getMax(),
          stdDev: readbackStats.getStdDev(),
          percentOfTotal: (readbackStats.getMedian() / totalStats.getMedian()) * 100,
        },
        upload: {
          median: uploadStats.getMedian(),
          mean: uploadStats.getMean(),
        },
        gpu: {
          median: gpuStats.getMedian(),
          mean: gpuStats.getMean(),
        },
      }

      console.log('\n=== BENCHMARK COMPARISON DATA ===')
      console.log(JSON.stringify(comparisonData, null, 2))
      console.log('\nSave this data to compare before/after optimization.\n')

      // Summary stats
      console.log('Summary:')
      console.log(`  Total: ${totalStats.getSummary()}`)
      console.log(`  Readback: ${readbackStats.getSummary()}`)
      console.log(
        `  Readback is ${comparisonData.readback.percentOfTotal.toFixed(1)}% of total time`
      )

      expect(comparisonData.readback.median).toBeGreaterThan(0)

      // Cleanup
      resetGPUEditPipeline()
    }, 180000)
  })
})

// ============================================================================
// Export utilities for use in other benchmarks
// ============================================================================

export {
  BENCHMARK_DIMENSIONS,
  BENCHMARK_CONFIG,
  TEST_ADJUSTMENTS,
  TEST_TONE_CURVE_POINTS,
  calculateBreakdown,
  formatBreakdown,
  type ReadbackTimingBreakdown,
}
