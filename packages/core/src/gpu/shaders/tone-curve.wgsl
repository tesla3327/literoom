// Tone curve application compute shader
// Applies a pre-computed 256-entry LUT to each RGB channel
//
// The LUT is stored as a 1D texture (256x1) and sampled with linear filtering
// for smooth interpolation between values.

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
}

// Bindings
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var lut_texture: texture_1d<f32>;
@group(0) @binding(3) var lut_sampler: sampler;
@group(0) @binding(4) var<uniform> dims: Dimensions;

// Sample LUT for a single channel value
// Input: value in [0, 1] range
// Output: mapped value in [0, 1] range
fn sample_lut(value: f32) -> f32 {
    // LUT texture is 256 pixels wide, with values stored in the red channel
    // Map [0, 1] to [0.5/256, 255.5/256] for proper texel center sampling
    let coord = clamp(value, 0.0, 1.0);
    return textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).r;
}

// Main compute shader entry point
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // Bounds check
    if (global_id.x >= dims.width || global_id.y >= dims.height) {
        return;
    }

    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    // Load pixel from input texture
    let pixel = textureLoad(input_texture, coords, 0);

    // Apply LUT to each channel independently
    let r = sample_lut(pixel.r);
    let g = sample_lut(pixel.g);
    let b = sample_lut(pixel.b);

    // Write result, preserving alpha
    textureStore(output_texture, coords, vec4<f32>(r, g, b, pixel.a));
}
