// GPU downsample compute shader
// Downsamples an input texture by averaging NxN pixel blocks
//
// Each output pixel is computed by averaging a block of input pixels.
// The block size is determined by the scale factor:
// - scale = 0.5 means 2x2 blocks (half resolution)
// - scale = 0.25 means 4x4 blocks (quarter resolution)
// - scale = 0.125 means 8x8 blocks (eighth resolution)
//
// Uses area averaging (box filter) for high-quality downsampling.

// ============================================================================
// Data Structures
// ============================================================================

// Downsample parameters
struct DownsampleParams {
    input_width: u32,       // Input texture width
    input_height: u32,      // Input texture height
    output_width: u32,      // Output texture width
    output_height: u32,     // Output texture height
    scale: f32,             // Scale factor (output/input, e.g., 0.5 for 2x downsample)
    _padding1: f32,         // Alignment padding
    _padding2: f32,         // Alignment padding
    _padding3: f32,         // Alignment padding
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: DownsampleParams;

// ============================================================================
// Main Entry Point
// ============================================================================

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // Bounds check for output dimensions
    if (global_id.x >= params.output_width || global_id.y >= params.output_height) {
        return;
    }

    // Calculate the block size (inverse of scale)
    // scale = 0.5 -> block_size = 2
    // scale = 0.25 -> block_size = 4
    let block_size = u32(round(1.0 / params.scale));

    // Calculate the starting position in the input texture
    // Each output pixel corresponds to a block_size x block_size region in input
    let input_start_x = global_id.x * block_size;
    let input_start_y = global_id.y * block_size;

    // Accumulate color values from the input block
    var color_sum = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    var sample_count = 0u;

    // Iterate over the NxN block in the input texture
    for (var dy = 0u; dy < block_size; dy = dy + 1u) {
        for (var dx = 0u; dx < block_size; dx = dx + 1u) {
            let sample_x = input_start_x + dx;
            let sample_y = input_start_y + dy;

            // Only sample if within input bounds
            if (sample_x < params.input_width && sample_y < params.input_height) {
                let coords = vec2<i32>(i32(sample_x), i32(sample_y));
                let pixel = textureLoad(input_texture, coords, 0);
                color_sum = color_sum + pixel;
                sample_count = sample_count + 1u;
            }
        }
    }

    // Average the accumulated values
    var final_color = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if (sample_count > 0u) {
        final_color = color_sum / f32(sample_count);
    }

    // Write to output texture
    let output_coords = vec2<i32>(i32(global_id.x), i32(global_id.y));
    textureStore(output_texture, output_coords, final_color);
}
