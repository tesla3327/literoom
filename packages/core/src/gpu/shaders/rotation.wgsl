// Rotation compute shader with bilinear interpolation
// Rotates an image using inverse mapping for high-quality results
//
// Uses inverse mapping: for each pixel in the output image, calculate which
// source pixel(s) contribute to it and interpolate their values.
//
// For rotation by angle theta, the inverse transform is:
// src_x = (dst_x - dst_cx) * cos(-theta) - (dst_y - dst_cy) * sin(-theta) + src_cx
// src_y = (dst_x - dst_cx) * sin(-theta) + (dst_y - dst_cy) * cos(-theta) + src_cy
//
// The shader receives pre-computed cos/sin values to avoid GPU trigonometry.

// ============================================================================
// Data Structures
// ============================================================================

// Rotation parameters (pre-computed on CPU for efficiency)
struct RotationParams {
    cos_angle: f32,     // cos(-angle) for inverse rotation
    sin_angle: f32,     // sin(-angle) for inverse rotation
    src_cx: f32,        // source center X
    src_cy: f32,        // source center Y
    dst_cx: f32,        // destination center X
    dst_cy: f32,        // destination center Y
    src_width: u32,     // source image width
    src_height: u32,    // source image height
}

// Output image dimensions
struct Dimensions {
    width: u32,         // output width
    height: u32,        // output height
    _padding1: u32,     // alignment padding
    _padding2: u32,     // alignment padding
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: RotationParams;
@group(0) @binding(3) var<uniform> dims: Dimensions;

// ============================================================================
// Helper Functions
// ============================================================================

// Sample a pixel using bilinear interpolation
// Returns vec4(0, 0, 0, 1) for out-of-bounds coordinates
fn sample_bilinear(x: f32, y: f32) -> vec4<f32> {
    let src_w = f32(params.src_width);
    let src_h = f32(params.src_height);

    // Check bounds - return black for out-of-bounds
    // We need x0, y0, x1, y1 all within bounds for bilinear
    if (x < 0.0 || x >= src_w - 1.0 || y < 0.0 || y >= src_h - 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    // Get integer coordinates for the 4 corner pixels
    let x0 = i32(floor(x));
    let y0 = i32(floor(y));
    let x1 = x0 + 1;
    let y1 = y0 + 1;

    // Fractional distances for interpolation weights
    let fx = x - f32(x0);
    let fy = y - f32(y0);

    // Load the four corner pixels
    let p00 = textureLoad(input_texture, vec2<i32>(x0, y0), 0);
    let p10 = textureLoad(input_texture, vec2<i32>(x1, y0), 0);
    let p01 = textureLoad(input_texture, vec2<i32>(x0, y1), 0);
    let p11 = textureLoad(input_texture, vec2<i32>(x1, y1), 0);

    // Bilinear interpolation using mix()
    // First interpolate along x for top and bottom rows
    let top = mix(p00, p10, fx);
    let bottom = mix(p01, p11, fx);

    // Then interpolate along y between the two rows
    return mix(top, bottom, fy);
}

// ============================================================================
// Main Entry Point
// ============================================================================

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // Bounds check for output dimensions
    if (global_id.x >= dims.width || global_id.y >= dims.height) {
        return;
    }

    // Destination pixel coordinates (center of pixel)
    let dst_x = f32(global_id.x) + 0.5;
    let dst_y = f32(global_id.y) + 0.5;

    // Translate destination point to origin at destination center
    let dx = dst_x - params.dst_cx;
    let dy = dst_y - params.dst_cy;

    // Apply inverse rotation to find source coordinates
    // src = R^(-1) * (dst - dst_center) + src_center
    // where R^(-1) uses cos(-angle) and sin(-angle)
    let src_x = dx * params.cos_angle - dy * params.sin_angle + params.src_cx;
    let src_y = dx * params.sin_angle + dy * params.cos_angle + params.src_cy;

    // Sample using bilinear interpolation
    let color = sample_bilinear(src_x, src_y);

    // Write to output texture
    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));
    textureStore(output_texture, coords, color);
}
