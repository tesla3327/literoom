// Histogram compute shader with workgroup privatization
// Computes RGB and luminance histograms using GPU-accelerated parallel reduction
//
// Uses workgroup privatization pattern for efficient atomic operations:
// 1. Each workgroup maintains a local histogram in shared memory
// 2. Threads accumulate to local histogram (fast shared memory atomics)
// 3. Local histograms are merged to global buffer (fewer global atomics)
//
// This reduces global memory contention significantly compared to
// having all threads write directly to global memory.

// ============================================================================
// Constants
// ============================================================================

// Number of histogram bins (0-255 for 8-bit values)
const NUM_BINS: u32 = 256u;

// ITU-R BT.709 luminance coefficients
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// ============================================================================
// Data Structures
// ============================================================================

// Image dimensions uniform
struct Dimensions {
    width: u32,
    height: u32,
}

// Global histogram buffer with atomic bins for each channel
// Total size: 4 channels * 256 bins * 4 bytes = 4096 bytes
struct HistogramBuffer {
    bins_r: array<atomic<u32>, 256>,
    bins_g: array<atomic<u32>, 256>,
    bins_b: array<atomic<u32>, 256>,
    bins_l: array<atomic<u32>, 256>,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram: HistogramBuffer;
@group(0) @binding(2) var<uniform> dims: Dimensions;

// ============================================================================
// Workgroup Shared Memory
// ============================================================================

// Local histogram for this workgroup (non-atomic for faster accumulation)
// Each workgroup has its own copy to reduce contention
// Note: WGSL requires explicit size for workgroup arrays
var<workgroup> local_bins_r: array<atomic<u32>, 256>;
var<workgroup> local_bins_g: array<atomic<u32>, 256>;
var<workgroup> local_bins_b: array<atomic<u32>, 256>;
var<workgroup> local_bins_l: array<atomic<u32>, 256>;

// ============================================================================
// Helper Functions
// ============================================================================

// Calculate luminance using ITU-R BT.709 coefficients
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// Quantize a floating point color value [0, 1] to a bin index [0, 255]
fn quantize_to_bin(value: f32) -> u32 {
    // Clamp to valid range and scale to 0-255
    let clamped = clamp(value, 0.0, 1.0);
    let scaled = clamped * 255.0;
    // Use floor and clamp to ensure we stay in bounds
    return clamp(u32(scaled), 0u, 255u);
}

// ============================================================================
// Main Entry Point
// ============================================================================

@compute @workgroup_size(16, 16)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(local_invocation_index) local_index: u32
) {
    // ========================================================================
    // Phase 1: Initialize shared memory
    // ========================================================================
    // Each thread in the workgroup (256 threads) initializes one bin
    // local_index ranges from 0 to 255 for a 16x16 workgroup

    if (local_index < NUM_BINS) {
        atomicStore(&local_bins_r[local_index], 0u);
        atomicStore(&local_bins_g[local_index], 0u);
        atomicStore(&local_bins_b[local_index], 0u);
        atomicStore(&local_bins_l[local_index], 0u);
    }

    // Synchronize to ensure all shared memory is initialized
    workgroupBarrier();

    // ========================================================================
    // Phase 2: Accumulate pixel values to local histogram
    // ========================================================================
    // Each thread processes one pixel (if within bounds)

    if (global_id.x < dims.width && global_id.y < dims.height) {
        let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

        // Load pixel from input texture
        let pixel = textureLoad(input_texture, coords, 0);

        // Quantize RGB channels to bin indices
        let bin_r = quantize_to_bin(pixel.r);
        let bin_g = quantize_to_bin(pixel.g);
        let bin_b = quantize_to_bin(pixel.b);

        // Calculate and quantize luminance
        let luminance = calculate_luminance(pixel.r, pixel.g, pixel.b);
        let bin_l = quantize_to_bin(luminance);

        // Increment local histogram bins atomically
        atomicAdd(&local_bins_r[bin_r], 1u);
        atomicAdd(&local_bins_g[bin_g], 1u);
        atomicAdd(&local_bins_b[bin_b], 1u);
        atomicAdd(&local_bins_l[bin_l], 1u);
    }

    // Synchronize to ensure all threads have finished accumulating
    workgroupBarrier();

    // ========================================================================
    // Phase 3: Merge local histogram to global buffer
    // ========================================================================
    // Each thread merges one bin from local to global
    // This reduces global atomic operations from (pixels) to (workgroups * 256)

    if (local_index < NUM_BINS) {
        let local_count_r = atomicLoad(&local_bins_r[local_index]);
        let local_count_g = atomicLoad(&local_bins_g[local_index]);
        let local_count_b = atomicLoad(&local_bins_b[local_index]);
        let local_count_l = atomicLoad(&local_bins_l[local_index]);

        // Only add to global if we have non-zero counts
        // This reduces unnecessary atomic operations
        if (local_count_r > 0u) {
            atomicAdd(&histogram.bins_r[local_index], local_count_r);
        }
        if (local_count_g > 0u) {
            atomicAdd(&histogram.bins_g[local_index], local_count_g);
        }
        if (local_count_b > 0u) {
            atomicAdd(&histogram.bins_b[local_index], local_count_b);
        }
        if (local_count_l > 0u) {
            atomicAdd(&histogram.bins_l[local_index], local_count_l);
        }
    }
}
