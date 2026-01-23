// Gradient mask application compute shader
// Applies linear and radial gradient masks with per-mask adjustments
//
// Supports up to 8 linear masks and 8 radial masks per invocation.
// Each mask has its own adjustment parameters and enabled state.
// Masks are applied sequentially with blending.
//
// Algorithm for each mask:
// 1. Evaluate mask strength at pixel coordinates (0.0 to 1.0)
// 2. If mask strength > 0 and mask is enabled, apply adjustments
// 3. Blend: output = original * (1 - mask) + adjusted * mask

// Maximum masks supported (must match TypeScript)
const MAX_MASKS: u32 = 8u;

// Small epsilon for floating point comparisons
const EPSILON: f32 = 0.001;

// ITU-R BT.709 luminance coefficients
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// Per-mask adjustment parameters
// 32 bytes total (8 f32)
struct MaskAdjustments {
    exposure: f32,      // Exposure adjustment (-5 to 5 stops)
    contrast: f32,      // Contrast (-100 to 100)
    temperature: f32,   // White balance temperature (-100 to 100)
    tint: f32,          // White balance tint (-100 to 100)
    highlights: f32,    // Highlights (-100 to 100)
    shadows: f32,       // Shadows (-100 to 100)
    saturation: f32,    // Saturation (-100 to 100)
    vibrance: f32,      // Vibrance (-100 to 100)
}

// Linear gradient mask definition
// 48 bytes total (12 f32)
struct LinearMask {
    start_x: f32,       // Start point X (normalized 0-1)
    start_y: f32,       // Start point Y (normalized 0-1)
    end_x: f32,         // End point X (normalized 0-1)
    end_y: f32,         // End point Y (normalized 0-1)
    feather: f32,       // Feather amount (0.0 = hard, 1.0 = full gradient)
    enabled: u32,       // 0 = disabled, 1 = enabled
    _padding1: f32,     // Alignment padding
    _padding2: f32,     // Alignment padding
    adj: MaskAdjustments, // Per-mask adjustments (32 bytes)
}

// Radial gradient mask definition
// 64 bytes total (16 f32)
struct RadialMask {
    center_x: f32,      // Center X (normalized 0-1)
    center_y: f32,      // Center Y (normalized 0-1)
    radius_x: f32,      // Horizontal radius (normalized)
    radius_y: f32,      // Vertical radius (normalized)
    rotation: f32,      // Rotation angle in radians
    feather: f32,       // Feather amount (0.0 = hard, 1.0 = full gradient)
    invert: u32,        // 0 = normal, 1 = inverted
    enabled: u32,       // 0 = disabled, 1 = enabled
    adj: MaskAdjustments, // Per-mask adjustments (32 bytes)
}

// Mask stack parameters
struct MaskParams {
    linear_masks: array<LinearMask, 8>,   // 48 * 8 = 384 bytes
    radial_masks: array<RadialMask, 8>,   // 64 * 8 = 512 bytes
    linear_count: u32,                     // Number of active linear masks
    radial_count: u32,                     // Number of active radial masks
    _padding1: u32,                        // Alignment
    _padding2: u32,                        // Alignment
}

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
}

// Bindings
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> masks: MaskParams;
@group(0) @binding(3) var<uniform> dims: Dimensions;

// Ken Perlin's smootherstep (5th order polynomial)
// This is different from WGSL's built-in smoothstep (3rd order Hermite)
// Must match Rust implementation exactly
fn smootherstep(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    // 6x^5 - 15x^4 + 10x^3
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

// Calculate luminance using ITU-R BT.709 coefficients
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// Smooth interpolation function (Hermite cubic, 3rd order)
fn smoothstep_custom(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// ============================================================================
// Adjustment Functions (subset - exposure, contrast, temp, tint, sat, vib)
// ============================================================================

fn apply_exposure(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    if (exposure == 0.0) { return color; }
    let multiplier = pow(2.0, exposure);
    return color * multiplier;
}

fn apply_contrast(color: vec3<f32>, contrast: f32) -> vec3<f32> {
    if (contrast == 0.0) { return color; }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = vec3<f32>(0.5, 0.5, 0.5);
    return (color - midpoint) * factor + midpoint;
}

fn apply_temperature(color: vec3<f32>, temperature: f32) -> vec3<f32> {
    if (temperature == 0.0) { return color; }
    let shift = temperature / 100.0 * 0.3;
    var result = color;
    if (temperature < 0.0) {
        result.r = color.r * (1.0 + abs(shift));
        result.b = color.b * (1.0 - abs(shift));
    } else {
        result.r = color.r * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

fn apply_tint(color: vec3<f32>, tint: f32) -> vec3<f32> {
    if (tint == 0.0) { return color; }
    let shift = tint / 100.0 * 0.2;
    var result = color;
    if (tint < 0.0) {
        result.g = color.g * (1.0 + abs(shift));
    } else {
        result.r = color.r * (1.0 + shift);
        result.g = color.g * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

fn apply_highlights(color: vec3<f32>, luminance: f32, highlights: f32) -> vec3<f32> {
    if (highlights == 0.0) { return color; }
    let highlight_mask = smoothstep_custom(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;
    var result = color;
    if (highlights < 0.0) {
        let factor = 1.0 + adjustment;
        result = color * factor;
    } else {
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

fn apply_shadows(color: vec3<f32>, luminance: f32, shadows: f32) -> vec3<f32> {
    if (shadows == 0.0) { return color; }
    let shadow_mask = smoothstep_custom(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;
    var result = color;
    if (shadows < 0.0) {
        let factor = 1.0 + adjustment;
        result = color * factor;
    } else {
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

fn apply_saturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
    if (saturation == 0.0) { return color; }
    let gray = calculate_luminance(color.r, color.g, color.b);
    let factor = 1.0 + (saturation / 100.0);
    let gray_vec = vec3<f32>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

fn apply_vibrance(color: vec3<f32>, vibrance: f32) -> vec3<f32> {
    if (vibrance == 0.0) { return color; }

    let max_c = max(max(color.r, color.g), color.b);
    let min_c = min(min(color.r, color.g), color.b);
    var current_sat = 0.0;
    if (max_c > 0.0) {
        current_sat = (max_c - min_c) / max_c;
    }

    let is_skin = (color.r > color.g) && (color.g > color.b) && ((color.r - color.g) > 0.06);
    var skin_protection = 1.0;
    if (is_skin) { skin_protection = 0.5; }

    let saturation_protection = 1.0 - current_sat;
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    return apply_saturation(color, effective_vibrance);
}

// Apply all mask adjustments to a color
fn apply_mask_adjustments(color: vec3<f32>, adj: MaskAdjustments) -> vec3<f32> {
    var result = color;

    // 1. Exposure
    result = apply_exposure(result, adj.exposure);

    // 2. Contrast
    result = apply_contrast(result, adj.contrast);

    // 3. Temperature
    result = apply_temperature(result, adj.temperature);

    // 4. Tint
    result = apply_tint(result, adj.tint);

    // Calculate luminance for highlights/shadows
    let luminance = calculate_luminance(result.r, result.g, result.b);

    // 5. Highlights
    result = apply_highlights(result, luminance, adj.highlights);

    // 6. Shadows
    result = apply_shadows(result, luminance, adj.shadows);

    // 7. Saturation
    result = apply_saturation(result, adj.saturation);

    // 8. Vibrance
    result = apply_vibrance(result, adj.vibrance);

    return result;
}

// Check if all adjustments are default (zero)
fn is_adjustment_default(adj: MaskAdjustments) -> bool {
    return adj.exposure == 0.0 &&
           adj.contrast == 0.0 &&
           adj.temperature == 0.0 &&
           adj.tint == 0.0 &&
           adj.highlights == 0.0 &&
           adj.shadows == 0.0 &&
           adj.saturation == 0.0 &&
           adj.vibrance == 0.0;
}

// ============================================================================
// Mask Evaluation Functions
// ============================================================================

// Evaluate linear gradient mask at a given normalized coordinate
// Returns a value from 0.0 (no effect) to 1.0 (full effect)
// Algorithm matches Rust implementation in mask/linear.rs
fn evaluate_linear_mask(x: f32, y: f32, mask: LinearMask) -> f32 {
    if (mask.enabled == 0u) {
        return 0.0; // Disabled masks have no effect
    }

    // Direction vector from start to end
    let dx = mask.end_x - mask.start_x;
    let dy = mask.end_y - mask.start_y;
    let len_sq = dx * dx + dy * dy;

    // Degenerate case: start and end are the same point
    if (len_sq < 1e-6) {
        return 0.5;
    }

    // Project point onto gradient line to get position t (0 = start, 1 = end)
    let t = ((x - mask.start_x) * dx + (y - mask.start_y) * dy) / len_sq;

    // Apply feathering centered at midpoint (t = 0.5)
    let feather_zone = 0.5 * clamp(mask.feather, 0.0, 1.0);
    let center = 0.5;

    if (t <= center - feather_zone) {
        // Before the transition zone: full effect
        return 1.0;
    } else if (t >= center + feather_zone) {
        // After the transition zone: no effect
        return 0.0;
    } else {
        // In the transition zone: interpolate with smootherstep
        let local_t = (t - (center - feather_zone)) / max(2.0 * feather_zone, 0.001);
        return 1.0 - smootherstep(local_t);
    }
}

// Evaluate radial gradient mask at a given normalized coordinate
// Returns a value from 0.0 (no effect) to 1.0 (full effect)
// Algorithm matches Rust implementation in mask/radial.rs
fn evaluate_radial_mask(x: f32, y: f32, mask: RadialMask) -> f32 {
    if (mask.enabled == 0u) {
        return 0.0; // Disabled masks have no effect
    }

    // Translate to center
    let dx = x - mask.center_x;
    let dy = y - mask.center_y;

    // Rotate to local coordinate space (inverse rotation)
    let cos_r = cos(mask.rotation);
    let sin_r = sin(mask.rotation);
    let local_x = dx * cos_r + dy * sin_r;
    let local_y = -dx * sin_r + dy * cos_r;

    // Avoid division by zero
    let rx = max(mask.radius_x, 0.001);
    let ry = max(mask.radius_y, 0.001);

    // Normalized distance from center (1.0 = on ellipse edge)
    let norm_dist = sqrt((local_x / rx) * (local_x / rx) + (local_y / ry) * (local_y / ry));

    // Calculate inner boundary based on feather
    // feather = 0: inner = 1.0 (hard edge at ellipse boundary)
    // feather = 1: inner = 0.0 (full gradient from center to edge)
    let inner = 1.0 - clamp(mask.feather, 0.0, 1.0);

    var value = 1.0;
    if (norm_dist <= inner) {
        // Inside inner boundary: full effect
        value = 1.0;
    } else if (norm_dist >= 1.0) {
        // Outside ellipse: no effect
        value = 0.0;
    } else {
        // In feathered region: interpolate
        let t = (norm_dist - inner) / max(1.0 - inner, 0.001);
        value = 1.0 - smootherstep(t);
    }

    // Optionally invert: outside gets effect, inside doesn't
    if (mask.invert > 0u) {
        value = 1.0 - value;
    }

    return value;
}

// ============================================================================
// Main Entry Point
// ============================================================================

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // Bounds check
    if (global_id.x >= dims.width || global_id.y >= dims.height) {
        return;
    }

    let coords = vec2<i32>(i32(global_id.x), i32(global_id.y));

    // Load pixel from input texture
    let pixel = textureLoad(input_texture, coords, 0);
    var color = pixel.rgb;

    // Calculate normalized coordinates (0-1), centered on pixel
    let x = (f32(global_id.x) + 0.5) / f32(dims.width);
    let y = (f32(global_id.y) + 0.5) / f32(dims.height);

    // Apply each linear mask
    for (var i = 0u; i < masks.linear_count && i < MAX_MASKS; i = i + 1u) {
        let mask = masks.linear_masks[i];
        let mask_val = evaluate_linear_mask(x, y, mask);

        // Skip if mask has no effect at this pixel
        if (mask_val < EPSILON) {
            continue;
        }

        // Skip if adjustments are all default
        if (is_adjustment_default(mask.adj)) {
            continue;
        }

        // Apply adjustments to get target color
        let adjusted = apply_mask_adjustments(color, mask.adj);

        // Blend based on mask value
        color = color * (1.0 - mask_val) + adjusted * mask_val;
    }

    // Apply each radial mask
    for (var i = 0u; i < masks.radial_count && i < MAX_MASKS; i = i + 1u) {
        let mask = masks.radial_masks[i];
        let mask_val = evaluate_radial_mask(x, y, mask);

        // Skip if mask has no effect at this pixel
        if (mask_val < EPSILON) {
            continue;
        }

        // Skip if adjustments are all default
        if (is_adjustment_default(mask.adj)) {
            continue;
        }

        // Apply adjustments to get target color
        let adjusted = apply_mask_adjustments(color, mask.adj);

        // Blend based on mask value
        color = color * (1.0 - mask_val) + adjusted * mask_val;
    }

    // Clamp to valid range and output
    color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    textureStore(output_texture, coords, vec4<f32>(color, pixel.a));
}
