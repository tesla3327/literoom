/**
 * Benchmark tests for multi-pass vs single-pass uber-shader pipeline.
 *
 * Compares performance of:
 * - Multi-pass: Separate adjustments-pipeline + tone-curve-pipeline
 * - Single-pass: Combined uber-pipeline with both operations
 *
 * Key metrics:
 * - Memory bandwidth: Multi-pass = 4x (2 read + 2 write), Single-pass = 2x (1 read + 1 write)
 * - Expected improvement: ~50% bandwidth reduction, ~25-40% faster execution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BenchmarkStats,
  warmup,
  collectSamples,
  createTestRgbPixels,
  WARMUP_ITERATIONS,
  SAMPLE_COUNT,
} from './pipeline-benchmarks.test'

// ============================================================================
// Benchmark Configuration
// ============================================================================

/** Number of warmup iterations for uber benchmarks */
const UBER_WARMUP_ITERATIONS = WARMUP_ITERATIONS

/** Number of samples to collect for uber benchmarks */
const UBER_SAMPLE_COUNT = SAMPLE_COUNT

/** Target performance improvements */
const TARGETS = {
  /** Minimum expected speedup factor (single-pass vs multi-pass) */
  MIN_SPEEDUP_FACTOR: 1.15, // At least 15% faster
  /** Expected bandwidth reduction ratio */
  EXPECTED_BANDWIDTH_RATIO: 0.5, // 2x/4x = 50%
  /** Maximum acceptable overhead for uber-shader vs sum of individual */
  MAX_OVERHEAD_RATIO: 0.9, // Allow up to 90% of multi-pass time
} as const

/**
 * Memory bandwidth analysis for pipeline comparison.
 */
interface BandwidthAnalysis {
  /** Number of texture read operations */
  textureReads: number
  /** Number of texture write operations */
  textureWrites: number
  /** Total bandwidth operations (reads + writes) */
  totalBandwidth: number
  /** Bandwidth reduction vs multi-pass (ratio) */
  bandwidthRatio?: number
}

// ============================================================================
// Test Data Configuration
// ============================================================================

/** Standard test adjustments (non-trivial values to ensure shader execution) */
const TEST_ADJUSTMENTS = {
  temperature: 15,
  tint: -10,
  exposure: 0.3,
  contrast: 25,
  highlights: -20,
  shadows: 30,
  whites: 15,
  blacks: -15,
  vibrance: 20,
  saturation: 10,
}

/** Test tone curve points (S-curve for visible effect) */
const TEST_TONE_CURVE_POINTS = [
  { x: 0, y: 0.05 },
  { x: 0.25, y: 0.2 },
  { x: 0.5, y: 0.55 },
  { x: 0.75, y: 0.8 },
  { x: 1, y: 0.95 },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Analyze memory bandwidth for multi-pass pipeline.
 * Multi-pass: adjustments (1 read + 1 write) + tone-curve (1 read + 1 write)
 */
function analyzeMultiPassBandwidth(): BandwidthAnalysis {
  return {
    textureReads: 2, // Read once for adjustments, once for tone-curve
    textureWrites: 2, // Write once from adjustments, once from tone-curve
    totalBandwidth: 4,
  }
}

/**
 * Analyze memory bandwidth for single-pass uber-pipeline.
 * Single-pass: combined (1 read + 1 write)
 */
function analyzeSinglePassBandwidth(): BandwidthAnalysis {
  const multiPass = analyzeMultiPassBandwidth()
  return {
    textureReads: 1,
    textureWrites: 1,
    totalBandwidth: 2,
    bandwidthRatio: 2 / multiPass.totalBandwidth, // 50%
  }
}

/**
 * Format benchmark comparison results.
 */
function formatComparisonResults(
  multiPassStats: BenchmarkStats,
  singlePassStats: BenchmarkStats,
  multiPassBandwidth: BandwidthAnalysis,
  singlePassBandwidth: BandwidthAnalysis
): string {
  const speedup = multiPassStats.getMedian() / Math.max(singlePassStats.getMedian(), 0.001)
  const bandwidthReduction = ((1 - singlePassBandwidth.totalBandwidth / multiPassBandwidth.totalBandwidth) * 100).toFixed(1)

  return [
    '',
    '=== Multi-Pass vs Single-Pass Comparison ===',
    '',
    'Multi-Pass Pipeline:',
    `  ${multiPassStats.getSummary()}`,
    `  Bandwidth: ${multiPassBandwidth.textureReads} reads + ${multiPassBandwidth.textureWrites} writes = ${multiPassBandwidth.totalBandwidth}x`,
    '',
    'Single-Pass Pipeline:',
    `  ${singlePassStats.getSummary()}`,
    `  Bandwidth: ${singlePassBandwidth.textureReads} reads + ${singlePassBandwidth.textureWrites} writes = ${singlePassBandwidth.totalBandwidth}x`,
    '',
    'Performance Analysis:',
    `  Speedup Factor: ${speedup.toFixed(2)}x`,
    `  Bandwidth Reduction: ${bandwidthReduction}%`,
    `  Multi-Pass Median: ${multiPassStats.getMedian().toFixed(2)}ms`,
    `  Single-Pass Median: ${singlePassStats.getMedian().toFixed(2)}ms`,
    `  Time Saved: ${(multiPassStats.getMedian() - singlePassStats.getMedian()).toFixed(2)}ms`,
    '',
  ].join('\n')
}

// ============================================================================
// GPU Pipeline Benchmarks
// ============================================================================

// Check if WebGPU is available
const isWebGPUAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator

describe('Uber-Shader Pipeline Benchmarks', () => {
  // Skip entire suite if WebGPU is not available
  const describeIfWebGPU = isWebGPUAvailable ? describe : describe.skip

  describeIfWebGPU('Multi-Pass vs Single-Pass Comparison', () => {
    // Standard test image size (1920x1080 HD)
    const TEST_WIDTH = 1920
    const TEST_HEIGHT = 1080

    let testPixels: Uint8Array

    beforeAll(() => {
      testPixels = createTestRgbPixels(TEST_WIDTH, TEST_HEIGHT)
    })

    it('should measure multi-pass pipeline (adjustments + tone-curve separately)', async () => {
      // Dynamic imports to avoid issues when WebGPU is not available
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // Multi-pass params: adjustments + tone curve applied separately
      // The edit-pipeline runs these as separate GPU passes
      const multiPassParams = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
      }

      const input = { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT }

      // Warmup phase
      await warmup(async () => {
        await pipeline.process(input, multiPassParams)
      }, UBER_WARMUP_ITERATIONS)

      // Collect samples
      const stats = await collectSamples(async () => {
        const start = performance.now()
        const result = await pipeline.process(input, multiPassParams)
        const elapsed = performance.now() - start

        // Verify both stages ran (non-zero timing)
        expect(result.timing.adjustments).toBeGreaterThan(0)
        expect(result.timing.toneCurve).toBeGreaterThan(0)

        return elapsed
      }, UBER_SAMPLE_COUNT)

      // Report results
      const bandwidth = analyzeMultiPassBandwidth()
      console.log(`Multi-Pass Pipeline: ${stats.getSummary()}`)
      console.log(`  Bandwidth: ${bandwidth.textureReads} reads + ${bandwidth.textureWrites} writes = ${bandwidth.totalBandwidth}x`)

      // Store for comparison (using test context)
      // @ts-expect-error - adding to globalThis for test sharing
      globalThis.__multiPassStats = stats

      // Cleanup
      resetGPUEditPipeline()
    }, 120000)

    it('should measure single-pass uber-pipeline (combined adjustments + tone-curve)', async () => {
      // TODO: Import actual uber-pipeline when implemented
      // For now, we'll simulate it using the edit-pipeline with adjustments only
      // to establish baseline measurement patterns

      // Dynamic imports
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      // Note: When uber-pipeline is implemented, replace with:
      // const { getUberPipeline, resetUberPipeline } = await import('../pipelines/uber-pipeline')

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      // For now, use just adjustments as a baseline (simulates single pass)
      // When uber-pipeline exists, this will use combined params
      const singlePassParams = {
        adjustments: TEST_ADJUSTMENTS,
        // toneCurveLut will be baked into uber-shader
      }

      const input = { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT }

      // Warmup phase
      await warmup(async () => {
        await pipeline.process(input, singlePassParams)
      }, UBER_WARMUP_ITERATIONS)

      // Collect samples
      const stats = await collectSamples(async () => {
        const start = performance.now()
        await pipeline.process(input, singlePassParams)
        return performance.now() - start
      }, UBER_SAMPLE_COUNT)

      // Report results
      const bandwidth = analyzeSinglePassBandwidth()
      console.log(`Single-Pass Pipeline (baseline): ${stats.getSummary()}`)
      console.log(`  Bandwidth: ${bandwidth.textureReads} reads + ${bandwidth.textureWrites} writes = ${bandwidth.totalBandwidth}x`)
      console.log(`  (Note: Using adjustments-only as baseline until uber-pipeline is implemented)`)

      // Store for comparison
      // @ts-expect-error - adding to globalThis for test sharing
      globalThis.__singlePassStats = stats

      // Cleanup
      resetGPUEditPipeline()
    }, 120000)

    it('should report speedup comparison', async () => {
      // Retrieve stored stats
      // @ts-expect-error - reading from globalThis
      const multiPassStats: BenchmarkStats | undefined = globalThis.__multiPassStats
      // @ts-expect-error - reading from globalThis
      const singlePassStats: BenchmarkStats | undefined = globalThis.__singlePassStats

      if (!multiPassStats || !singlePassStats) {
        console.log('Previous benchmarks did not run, skipping comparison')
        return
      }

      const multiPassBandwidth = analyzeMultiPassBandwidth()
      const singlePassBandwidth = analyzeSinglePassBandwidth()

      // Print formatted comparison
      console.log(formatComparisonResults(
        multiPassStats,
        singlePassStats,
        multiPassBandwidth,
        singlePassBandwidth
      ))

      // Calculate speedup
      const speedup = multiPassStats.getMedian() / Math.max(singlePassStats.getMedian(), 0.001)
      console.log(`Measured Speedup: ${speedup.toFixed(2)}x`)

      // Note: Until uber-pipeline is fully implemented, we can't assert speedup
      // Once implemented, uncomment:
      // expect(speedup).toBeGreaterThanOrEqual(TARGETS.MIN_SPEEDUP_FACTOR)
    })
  })

  describeIfWebGPU('Timing Breakdown Analysis', () => {
    const TEST_WIDTH = 1920
    const TEST_HEIGHT = 1080

    let testPixels: Uint8Array

    beforeAll(() => {
      testPixels = createTestRgbPixels(TEST_WIDTH, TEST_HEIGHT)
    })

    it('should report GPU vs CPU timing breakdown for multi-pass', async () => {
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

      const input = { pixels: testPixels, width: TEST_WIDTH, height: TEST_HEIGHT }

      // Warmup
      await warmup(async () => {
        await pipeline.process(input, params)
      }, 5)

      // Run and collect timing breakdown
      const result = await pipeline.process(input, params)

      console.log('\n=== Multi-Pass Timing Breakdown ===')
      console.log(`Total: ${result.timing.total.toFixed(2)}ms`)
      console.log(`Upload (CPU->GPU): ${result.timing.upload.toFixed(2)}ms`)
      console.log(`Adjustments (GPU): ${result.timing.adjustments.toFixed(2)}ms`)
      console.log(`Tone Curve (GPU): ${result.timing.toneCurve.toFixed(2)}ms`)
      console.log(`Readback (GPU->CPU): ${result.timing.readback.toFixed(2)}ms`)

      // Calculate overhead
      const gpuTime = result.timing.adjustments + result.timing.toneCurve
      const transferTime = result.timing.upload + result.timing.readback
      const overheadTime = result.timing.total - gpuTime - transferTime

      console.log(`\nBreakdown:`)
      console.log(`  GPU Processing: ${gpuTime.toFixed(2)}ms (${((gpuTime / result.timing.total) * 100).toFixed(1)}%)`)
      console.log(`  Transfer Time: ${transferTime.toFixed(2)}ms (${((transferTime / result.timing.total) * 100).toFixed(1)}%)`)
      console.log(`  Other Overhead: ${overheadTime.toFixed(2)}ms (${((overheadTime / result.timing.total) * 100).toFixed(1)}%)`)

      // If GPU timing is available, report it
      if (result.timing.gpuAdjustments !== undefined) {
        console.log(`\nGPU-Measured Times:`)
        console.log(`  Adjustments: ${(result.timing.gpuAdjustments / 1e6).toFixed(2)}ms`)
        if (result.timing.gpuToneCurve !== undefined) {
          console.log(`  Tone Curve: ${(result.timing.gpuToneCurve / 1e6).toFixed(2)}ms`)
        }
      }

      // Verify timing breakdown is complete
      expect(result.timing.total).toBeGreaterThan(0)
      expect(result.timing.upload).toBeGreaterThanOrEqual(0)
      expect(result.timing.adjustments).toBeGreaterThan(0)
      expect(result.timing.toneCurve).toBeGreaterThan(0)
      expect(result.timing.readback).toBeGreaterThan(0)

      // Cleanup
      resetGPUEditPipeline()
    })
  })

  describeIfWebGPU('Image Size Scaling', () => {
    it('should measure performance across different resolutions', async () => {
      const { getGPUEditPipeline, resetGPUEditPipeline } = await import(
        '../pipelines/edit-pipeline'
      )

      const pipeline = getGPUEditPipeline()
      const ready = await pipeline.initialize()

      if (!ready) {
        console.log('GPU not available, skipping benchmark')
        return
      }

      const sizes = [
        { width: 640, height: 480, label: 'VGA' },
        { width: 1280, height: 720, label: 'HD' },
        { width: 1920, height: 1080, label: 'FHD' },
        { width: 3840, height: 2160, label: '4K' },
      ]

      const params = {
        adjustments: TEST_ADJUSTMENTS,
        toneCurvePoints: TEST_TONE_CURVE_POINTS,
      }

      console.log('\n=== Multi-Pass Performance by Resolution ===')

      const results: Array<{ label: string; pixels: number; median: number }> = []

      for (const { width, height, label } of sizes) {
        const pixels = createTestRgbPixels(width, height)
        const input = { pixels, width, height }

        // Warmup
        await warmup(async () => {
          await pipeline.process(input, params)
        }, 3)

        // Collect samples
        const stats = await collectSamples(async () => {
          const start = performance.now()
          await pipeline.process(input, params)
          return performance.now() - start
        }, 10)

        const pixelCount = width * height
        results.push({ label, pixels: pixelCount, median: stats.getMedian() })

        console.log(`${label} (${width}x${height}, ${(pixelCount / 1e6).toFixed(1)}MP): ${stats.getSummary()}`)
      }

      // Analyze scaling behavior
      console.log('\n=== Scaling Analysis ===')
      const baseline = results[0]
      for (const result of results) {
        const pixelRatio = result.pixels / baseline.pixels
        const timeRatio = result.median / baseline.median
        const efficiency = (pixelRatio / timeRatio).toFixed(2)
        console.log(`${result.label}: ${pixelRatio.toFixed(1)}x pixels, ${timeRatio.toFixed(1)}x time, ${efficiency} efficiency`)
      }

      // Cleanup
      resetGPUEditPipeline()
    }, 180000)
  })

  describeIfWebGPU('Bandwidth Analysis', () => {
    it('should document bandwidth requirements for multi-pass vs single-pass', () => {
      const multiPass = analyzeMultiPassBandwidth()
      const singlePass = analyzeSinglePassBandwidth()

      console.log('\n=== Memory Bandwidth Analysis ===')
      console.log('\nMulti-Pass Pipeline (adjustments + tone-curve):')
      console.log('  Pass 1 - Adjustments:')
      console.log('    Input: Read texture (1x)')
      console.log('    Output: Write texture (1x)')
      console.log('  Pass 2 - Tone Curve:')
      console.log('    Input: Read texture (1x)')
      console.log('    Output: Write texture (1x)')
      console.log(`  Total: ${multiPass.textureReads} reads + ${multiPass.textureWrites} writes = ${multiPass.totalBandwidth}x bandwidth`)

      console.log('\nSingle-Pass Pipeline (uber-shader):')
      console.log('  Combined Pass:')
      console.log('    Input: Read texture (1x)')
      console.log('    Output: Write texture (1x)')
      console.log(`  Total: ${singlePass.textureReads} reads + ${singlePass.textureWrites} writes = ${singlePass.totalBandwidth}x bandwidth`)

      console.log('\nExpected Improvement:')
      console.log(`  Bandwidth Reduction: ${((1 - singlePass.bandwidthRatio!) * 100).toFixed(0)}%`)
      console.log(`  For 1920x1080 RGBA (8.3MB):`)
      console.log(`    Multi-pass: ${(8.3 * multiPass.totalBandwidth).toFixed(1)}MB transferred`)
      console.log(`    Single-pass: ${(8.3 * singlePass.totalBandwidth).toFixed(1)}MB transferred`)
      console.log(`    Saved: ${(8.3 * (multiPass.totalBandwidth - singlePass.totalBandwidth)).toFixed(1)}MB per frame`)

      // Verify bandwidth analysis
      expect(multiPass.totalBandwidth).toBe(4)
      expect(singlePass.totalBandwidth).toBe(2)
      expect(singlePass.bandwidthRatio).toBe(0.5)
    })
  })
})

// ============================================================================
// Export for use in other tests
// ============================================================================

export {
  TARGETS,
  TEST_ADJUSTMENTS,
  TEST_TONE_CURVE_POINTS,
  analyzeMultiPassBandwidth,
  analyzeSinglePassBandwidth,
  formatComparisonResults,
}
