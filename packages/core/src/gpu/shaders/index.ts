/**
 * GPU shader sources.
 *
 * WGSL shaders are embedded as strings to avoid build system issues
 * with raw imports. The actual .wgsl files are kept for syntax highlighting
 * and editor support.
 */

/**
 * Tone curve application compute shader.
 * Applies a pre-computed 256-entry LUT to each RGB channel using
 * hardware linear interpolation for smooth results.
 */
export const TONE_CURVE_SHADER_SOURCE = /* wgsl */ `
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
`

/**
 * Basic image adjustments compute shader.
 * Applies all 10 basic adjustments (exposure, contrast, temperature, tint,
 * highlights, shadows, whites, blacks, saturation, vibrance).
 */
export const ADJUSTMENTS_SHADER_SOURCE = /* wgsl */ `
// Basic image adjustments compute shader
// Applies all 10 basic adjustments to an image texture
//
// Adjustment order (matches Rust implementation):
// 1. Exposure
// 2. Contrast
// 3. Temperature
// 4. Tint
// 5. Highlights
// 6. Shadows
// 7. Whites
// 8. Blacks
// 9. Saturation
// 10. Vibrance

// Adjustment parameters uniform buffer
struct Adjustments {
    temperature: f32,   // White balance temperature (-100 to 100)
    tint: f32,          // White balance tint (-100 to 100)
    exposure: f32,      // Exposure adjustment (-5 to 5 stops)
    contrast: f32,      // Contrast (-100 to 100)
    highlights: f32,    // Highlights (-100 to 100)
    shadows: f32,       // Shadows (-100 to 100)
    whites: f32,        // Whites (-100 to 100)
    blacks: f32,        // Blacks (-100 to 100)
    vibrance: f32,      // Vibrance (-100 to 100)
    saturation: f32,    // Saturation (-100 to 100)
    _padding1: f32,     // Padding to align to 16 bytes
    _padding2: f32,     // Padding to align to 16 bytes
}

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
}

// Bindings
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> adj: Adjustments;
@group(0) @binding(3) var<uniform> dims: Dimensions;

// ITU-R BT.709 luminance coefficients
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// Calculate luminance using ITU-R BT.709 coefficients
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// Smooth interpolation function (smoothstep)
fn smoothstep_custom(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Apply exposure adjustment
// Exposure is measured in stops (-5 to +5).
// Each stop doubles or halves the brightness.
// Formula: output = input * 2^exposure
fn apply_exposure(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    if (exposure == 0.0) {
        return color;
    }
    let multiplier = pow(2.0, exposure);
    return color * multiplier;
}

// Apply contrast adjustment
// Contrast ranges from -100 to +100.
// Formula: output = (input - 0.5) * (1 + contrast/100) + 0.5
fn apply_contrast(color: vec3<f32>, contrast: f32) -> vec3<f32> {
    if (contrast == 0.0) {
        return color;
    }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = vec3<f32>(0.5, 0.5, 0.5);
    return (color - midpoint) * factor + midpoint;
}

// Apply temperature (white balance) adjustment
// Temperature ranges from -100 to +100.
// - Negative = warmer (more orange/red)
// - Positive = cooler (more blue)
fn apply_temperature(color: vec3<f32>, temperature: f32) -> vec3<f32> {
    if (temperature == 0.0) {
        return color;
    }
    let shift = temperature / 100.0 * 0.3;
    var result = color;
    if (temperature < 0.0) {
        // Warmer: boost red, reduce blue
        result.r = color.r * (1.0 + abs(shift));
        result.b = color.b * (1.0 - abs(shift));
    } else {
        // Cooler: reduce red, boost blue
        result.r = color.r * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

// Apply tint (green-magenta) adjustment
// Tint ranges from -100 to +100.
// - Negative = more green
// - Positive = more magenta (red + blue)
fn apply_tint(color: vec3<f32>, tint: f32) -> vec3<f32> {
    if (tint == 0.0) {
        return color;
    }
    let shift = tint / 100.0 * 0.2;
    var result = color;
    if (tint < 0.0) {
        // Green tint
        result.g = color.g * (1.0 + abs(shift));
    } else {
        // Magenta tint (red + blue)
        result.r = color.r * (1.0 + shift);
        result.g = color.g * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

// Apply highlights adjustment
// Highlights range from -100 to +100.
// Affects bright areas of the image (luminance > 0.5).
fn apply_highlights(color: vec3<f32>, luminance: f32, highlights: f32) -> vec3<f32> {
    if (highlights == 0.0) {
        return color;
    }
    // Mask: 1 for bright areas, 0 for dark areas
    let highlight_mask = smoothstep_custom(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;

    var result = color;
    if (highlights < 0.0) {
        // Reduce highlights: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        result = color * factor;
    } else {
        // Boost highlights: add to each channel
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

// Apply shadows adjustment
// Shadows range from -100 to +100.
// Affects dark areas of the image (luminance < 0.5).
fn apply_shadows(color: vec3<f32>, luminance: f32, shadows: f32) -> vec3<f32> {
    if (shadows == 0.0) {
        return color;
    }
    // Mask: 1 for dark areas, 0 for bright areas
    let shadow_mask = smoothstep_custom(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;

    var result = color;
    if (shadows < 0.0) {
        // Deepen shadows: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        result = color * factor;
    } else {
        // Lift shadows: add to each channel
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

// Apply whites adjustment
// Whites range from -100 to +100.
// Affects the brightest pixels (any channel > 0.9).
fn apply_whites(color: vec3<f32>, whites: f32) -> vec3<f32> {
    if (whites == 0.0) {
        return color;
    }
    let max_channel = max(max(color.r, color.g), color.b);
    if (max_channel > 0.9) {
        let factor = 1.0 + (whites / 100.0) * 0.3;
        return color * factor;
    }
    return color;
}

// Apply blacks adjustment
// Blacks range from -100 to +100.
// Affects the darkest pixels (any channel < 0.1).
fn apply_blacks(color: vec3<f32>, blacks: f32) -> vec3<f32> {
    if (blacks == 0.0) {
        return color;
    }
    let min_channel = min(min(color.r, color.g), color.b);
    if (min_channel < 0.1) {
        let factor = 1.0 + (blacks / 100.0) * 0.2;
        return color * factor;
    }
    return color;
}

// Apply saturation adjustment
// Saturation ranges from -100 to +100.
// - Negative = desaturate toward grayscale
// - Positive = increase color intensity
fn apply_saturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
    if (saturation == 0.0) {
        return color;
    }
    // Luminance-based desaturation
    let gray = calculate_luminance(color.r, color.g, color.b);
    let factor = 1.0 + (saturation / 100.0);
    let gray_vec = vec3<f32>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

// Apply vibrance adjustment
// Vibrance ranges from -100 to +100.
// Similar to saturation but:
// - Protects already-saturated colors
// - Protects skin tones (R > G > B)
// - More subtle, natural-looking effect
fn apply_vibrance(color: vec3<f32>, vibrance: f32) -> vec3<f32> {
    if (vibrance == 0.0) {
        return color;
    }

    // Calculate current saturation (simplified HSV S)
    let max_c = max(max(color.r, color.g), color.b);
    let min_c = min(min(color.r, color.g), color.b);
    var current_sat = 0.0;
    if (max_c > 0.0) {
        current_sat = (max_c - min_c) / max_c;
    }

    // Detect skin tones (simplified: R > G > B with specific ratios)
    let is_skin = (color.r > color.g) && (color.g > color.b) && ((color.r - color.g) > 0.06);
    var skin_protection = 1.0;
    if (is_skin) {
        skin_protection = 0.5;
    }

    // Less effect on already saturated colors
    let saturation_protection = 1.0 - current_sat;

    // Apply reduced vibrance
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    return apply_saturation(color, effective_vibrance);
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
    var color = pixel.rgb;

    // Apply adjustments in order (matching Rust implementation)

    // 1. Exposure
    color = apply_exposure(color, adj.exposure);

    // 2. Contrast
    color = apply_contrast(color, adj.contrast);

    // 3. Temperature
    color = apply_temperature(color, adj.temperature);

    // 4. Tint
    color = apply_tint(color, adj.tint);

    // Calculate luminance once for highlights/shadows
    let luminance = calculate_luminance(color.r, color.g, color.b);

    // 5. Highlights
    color = apply_highlights(color, luminance, adj.highlights);

    // 6. Shadows
    color = apply_shadows(color, luminance, adj.shadows);

    // 7. Whites
    color = apply_whites(color, adj.whites);

    // 8. Blacks
    color = apply_blacks(color, adj.blacks);

    // 9. Saturation
    color = apply_saturation(color, adj.saturation);

    // 10. Vibrance
    color = apply_vibrance(color, adj.vibrance);

    // Clamp to valid range and output
    color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    textureStore(output_texture, coords, vec4<f32>(color, pixel.a));
}
`

/**
 * Gradient mask application compute shader.
 * Applies linear and radial gradient masks with per-mask adjustments.
 * Supports up to 8 linear masks and 8 radial masks per invocation.
 */
export const MASKS_SHADER_SOURCE = /* wgsl */ `
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

fn apply_exposure_m(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    if (exposure == 0.0) { return color; }
    let multiplier = pow(2.0, exposure);
    return color * multiplier;
}

fn apply_contrast_m(color: vec3<f32>, contrast: f32) -> vec3<f32> {
    if (contrast == 0.0) { return color; }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = vec3<f32>(0.5, 0.5, 0.5);
    return (color - midpoint) * factor + midpoint;
}

fn apply_temperature_m(color: vec3<f32>, temperature: f32) -> vec3<f32> {
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

fn apply_tint_m(color: vec3<f32>, tint: f32) -> vec3<f32> {
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

fn apply_highlights_m(color: vec3<f32>, luminance: f32, highlights: f32) -> vec3<f32> {
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

fn apply_shadows_m(color: vec3<f32>, luminance: f32, shadows: f32) -> vec3<f32> {
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

fn apply_saturation_m(color: vec3<f32>, saturation: f32) -> vec3<f32> {
    if (saturation == 0.0) { return color; }
    let gray = calculate_luminance(color.r, color.g, color.b);
    let factor = 1.0 + (saturation / 100.0);
    let gray_vec = vec3<f32>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

fn apply_vibrance_m(color: vec3<f32>, vibrance: f32) -> vec3<f32> {
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
    return apply_saturation_m(color, effective_vibrance);
}

// Apply all mask adjustments to a color
fn apply_mask_adjustments(color: vec3<f32>, adj: MaskAdjustments) -> vec3<f32> {
    var result = color;

    // 1. Exposure
    result = apply_exposure_m(result, adj.exposure);

    // 2. Contrast
    result = apply_contrast_m(result, adj.contrast);

    // 3. Temperature
    result = apply_temperature_m(result, adj.temperature);

    // 4. Tint
    result = apply_tint_m(result, adj.tint);

    // Calculate luminance for highlights/shadows
    let luminance = calculate_luminance(result.r, result.g, result.b);

    // 5. Highlights
    result = apply_highlights_m(result, luminance, adj.highlights);

    // 6. Shadows
    result = apply_shadows_m(result, luminance, adj.shadows);

    // 7. Saturation
    result = apply_saturation_m(result, adj.saturation);

    // 8. Vibrance
    result = apply_vibrance_m(result, adj.vibrance);

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
fn main_masks(@builtin(global_invocation_id) global_id: vec3<u32>) {
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
`

/**
 * Rotation compute shader with bilinear interpolation.
 * Rotates an image using inverse mapping for high-quality results.
 */
export const ROTATION_SHADER_SOURCE = /* wgsl */ `
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
`

/**
 * Histogram compute shader with workgroup privatization.
 * Computes RGB and luminance histograms using GPU-accelerated parallel reduction.
 * Uses shared memory for local accumulation before merging to global buffer.
 */
/**
 * Uber-shader combining adjustments and tone curve with override constants.
 * This shader achieves ~75% bandwidth reduction when both features are enabled
 * by processing both in a single pass instead of two separate passes.
 *
 * Override constants:
 * - ENABLE_ADJUSTMENTS: Enable/disable adjustments processing
 * - ENABLE_TONE_CURVE: Enable/disable tone curve LUT application
 */
export const UBER_SHADER_SOURCE = /* wgsl */ `
// Uber-shader combining adjustments + tone curve with override constants
// Achieves ~75% bandwidth reduction when both features are enabled (1 pass instead of 2)
//
// Override constants control which features are active:
// - ENABLE_ADJUSTMENTS: When true, applies all 10 basic adjustments
// - ENABLE_TONE_CURVE: When true, applies the tone curve LUT
//
// Binding layout:
// @binding(0) - Input texture
// @binding(1) - Output storage texture
// @binding(2) - Adjustments uniform buffer
// @binding(3) - Dimensions uniform buffer
// @binding(4) - LUT 1D texture
// @binding(5) - LUT sampler

// Pipeline specialization constants (set at pipeline creation)
override ENABLE_ADJUSTMENTS: bool = true;
override ENABLE_TONE_CURVE: bool = true;

// ============================================================================
// Data Structures
// ============================================================================

// Adjustment parameters uniform buffer
struct Adjustments {
    temperature: f32,   // White balance temperature (-100 to 100)
    tint: f32,          // White balance tint (-100 to 100)
    exposure: f32,      // Exposure adjustment (-5 to 5 stops)
    contrast: f32,      // Contrast (-100 to 100)
    highlights: f32,    // Highlights (-100 to 100)
    shadows: f32,       // Shadows (-100 to 100)
    whites: f32,        // Whites (-100 to 100)
    blacks: f32,        // Blacks (-100 to 100)
    vibrance: f32,      // Vibrance (-100 to 100)
    saturation: f32,    // Saturation (-100 to 100)
    _padding1: f32,     // Padding to align to 16 bytes
    _padding2: f32,     // Padding to align to 16 bytes
}

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> adj: Adjustments;
@group(0) @binding(3) var<uniform> dims: Dimensions;
@group(0) @binding(4) var lut_texture: texture_1d<f32>;
@group(0) @binding(5) var lut_sampler: sampler;

// ============================================================================
// Constants
// ============================================================================

// ITU-R BT.709 luminance coefficients
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// ============================================================================
// Adjustment Functions
// ============================================================================

// Calculate luminance using ITU-R BT.709 coefficients
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// Smooth interpolation function (smoothstep)
fn smoothstep_custom(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Apply exposure adjustment
// Exposure is measured in stops (-5 to +5).
// Each stop doubles or halves the brightness.
// Formula: output = input * 2^exposure
fn apply_exposure(color: vec3<f32>, exposure: f32) -> vec3<f32> {
    if (exposure == 0.0) {
        return color;
    }
    let multiplier = pow(2.0, exposure);
    return color * multiplier;
}

// Apply contrast adjustment
// Contrast ranges from -100 to +100.
// Formula: output = (input - 0.5) * (1 + contrast/100) + 0.5
fn apply_contrast(color: vec3<f32>, contrast: f32) -> vec3<f32> {
    if (contrast == 0.0) {
        return color;
    }
    let factor = 1.0 + (contrast / 100.0);
    let midpoint = vec3<f32>(0.5, 0.5, 0.5);
    return (color - midpoint) * factor + midpoint;
}

// Apply temperature (white balance) adjustment
// Temperature ranges from -100 to +100.
// - Negative = warmer (more orange/red)
// - Positive = cooler (more blue)
fn apply_temperature(color: vec3<f32>, temperature: f32) -> vec3<f32> {
    if (temperature == 0.0) {
        return color;
    }
    let shift = temperature / 100.0 * 0.3;
    var result = color;
    if (temperature < 0.0) {
        // Warmer: boost red, reduce blue
        result.r = color.r * (1.0 + abs(shift));
        result.b = color.b * (1.0 - abs(shift));
    } else {
        // Cooler: reduce red, boost blue
        result.r = color.r * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

// Apply tint (green-magenta) adjustment
// Tint ranges from -100 to +100.
// - Negative = more green
// - Positive = more magenta (red + blue)
fn apply_tint(color: vec3<f32>, tint: f32) -> vec3<f32> {
    if (tint == 0.0) {
        return color;
    }
    let shift = tint / 100.0 * 0.2;
    var result = color;
    if (tint < 0.0) {
        // Green tint
        result.g = color.g * (1.0 + abs(shift));
    } else {
        // Magenta tint (red + blue)
        result.r = color.r * (1.0 + shift);
        result.g = color.g * (1.0 - shift);
        result.b = color.b * (1.0 + shift);
    }
    return result;
}

// Apply highlights adjustment
// Highlights range from -100 to +100.
// Affects bright areas of the image (luminance > 0.5).
fn apply_highlights(color: vec3<f32>, luminance: f32, highlights: f32) -> vec3<f32> {
    if (highlights == 0.0) {
        return color;
    }
    // Mask: 1 for bright areas, 0 for dark areas
    let highlight_mask = smoothstep_custom(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;

    var result = color;
    if (highlights < 0.0) {
        // Reduce highlights: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        result = color * factor;
    } else {
        // Boost highlights: add to each channel
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

// Apply shadows adjustment
// Shadows range from -100 to +100.
// Affects dark areas of the image (luminance < 0.5).
fn apply_shadows(color: vec3<f32>, luminance: f32, shadows: f32) -> vec3<f32> {
    if (shadows == 0.0) {
        return color;
    }
    // Mask: 1 for dark areas, 0 for bright areas
    let shadow_mask = smoothstep_custom(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;

    var result = color;
    if (shadows < 0.0) {
        // Deepen shadows: multiply by factor < 1
        let factor = 1.0 + adjustment; // adjustment is negative
        result = color * factor;
    } else {
        // Lift shadows: add to each channel
        let boost = adjustment * 0.5;
        result = color + vec3<f32>(boost, boost, boost);
    }
    return result;
}

// Apply whites adjustment
// Whites range from -100 to +100.
// Affects the brightest pixels (any channel > 0.9).
fn apply_whites(color: vec3<f32>, whites: f32) -> vec3<f32> {
    if (whites == 0.0) {
        return color;
    }
    let max_channel = max(max(color.r, color.g), color.b);
    if (max_channel > 0.9) {
        let factor = 1.0 + (whites / 100.0) * 0.3;
        return color * factor;
    }
    return color;
}

// Apply blacks adjustment
// Blacks range from -100 to +100.
// Affects the darkest pixels (any channel < 0.1).
fn apply_blacks(color: vec3<f32>, blacks: f32) -> vec3<f32> {
    if (blacks == 0.0) {
        return color;
    }
    let min_channel = min(min(color.r, color.g), color.b);
    if (min_channel < 0.1) {
        let factor = 1.0 + (blacks / 100.0) * 0.2;
        return color * factor;
    }
    return color;
}

// Apply saturation adjustment
// Saturation ranges from -100 to +100.
// - Negative = desaturate toward grayscale
// - Positive = increase color intensity
fn apply_saturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
    if (saturation == 0.0) {
        return color;
    }
    // Luminance-based desaturation
    let gray = calculate_luminance(color.r, color.g, color.b);
    let factor = 1.0 + (saturation / 100.0);
    let gray_vec = vec3<f32>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

// Apply vibrance adjustment
// Vibrance ranges from -100 to +100.
// Similar to saturation but:
// - Protects already-saturated colors
// - Protects skin tones (R > G > B)
// - More subtle, natural-looking effect
fn apply_vibrance(color: vec3<f32>, vibrance: f32) -> vec3<f32> {
    if (vibrance == 0.0) {
        return color;
    }

    // Calculate current saturation (simplified HSV S)
    let max_c = max(max(color.r, color.g), color.b);
    let min_c = min(min(color.r, color.g), color.b);
    var current_sat = 0.0;
    if (max_c > 0.0) {
        current_sat = (max_c - min_c) / max_c;
    }

    // Detect skin tones (simplified: R > G > B with specific ratios)
    let is_skin = (color.r > color.g) && (color.g > color.b) && ((color.r - color.g) > 0.06);
    var skin_protection = 1.0;
    if (is_skin) {
        skin_protection = 0.5;
    }

    // Less effect on already saturated colors
    let saturation_protection = 1.0 - current_sat;

    // Apply reduced vibrance
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    return apply_saturation(color, effective_vibrance);
}

// Apply all adjustments in order
fn apply_all_adjustments(color: vec3<f32>) -> vec3<f32> {
    var result = color;

    // 1. Exposure
    result = apply_exposure(result, adj.exposure);

    // 2. Contrast
    result = apply_contrast(result, adj.contrast);

    // 3. Temperature
    result = apply_temperature(result, adj.temperature);

    // 4. Tint
    result = apply_tint(result, adj.tint);

    // Calculate luminance once for highlights/shadows
    let luminance = calculate_luminance(result.r, result.g, result.b);

    // 5. Highlights
    result = apply_highlights(result, luminance, adj.highlights);

    // 6. Shadows
    result = apply_shadows(result, luminance, adj.shadows);

    // 7. Whites
    result = apply_whites(result, adj.whites);

    // 8. Blacks
    result = apply_blacks(result, adj.blacks);

    // 9. Saturation
    result = apply_saturation(result, adj.saturation);

    // 10. Vibrance
    result = apply_vibrance(result, adj.vibrance);

    return result;
}

// ============================================================================
// Tone Curve Functions
// ============================================================================

// Sample LUT for a single channel value
// Input: value in [0, 1] range
// Output: mapped value in [0, 1] range
fn sample_lut(value: f32) -> f32 {
    // LUT texture is 256 pixels wide, with values stored in the red channel
    // Map [0, 1] to [0.5/256, 255.5/256] for proper texel center sampling
    let coord = clamp(value, 0.0, 1.0);
    return textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).r;
}

// Apply tone curve LUT to all RGB channels
fn apply_tone_curve(color: vec3<f32>) -> vec3<f32> {
    let r = sample_lut(color.r);
    let g = sample_lut(color.g);
    let b = sample_lut(color.b);
    return vec3<f32>(r, g, b);
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

    // Apply adjustments if enabled (controlled by override constant)
    if (ENABLE_ADJUSTMENTS) {
        color = apply_all_adjustments(color);
    }

    // Apply tone curve if enabled (controlled by override constant)
    if (ENABLE_TONE_CURVE) {
        color = apply_tone_curve(color);
    }

    // Clamp to valid range and output
    color = clamp(color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    textureStore(output_texture, coords, vec4<f32>(color, pixel.a));
}
`

/**
 * Half-precision (f16) variant of the uber-shader for improved GPU performance.
 * Uses vec3<f16> for color operations where safe, while keeping precision-critical
 * calculations in f32:
 * - Safe for f16: Exposure, contrast, temperature, tint, whites, blacks, saturation
 * - Requires f32: Highlights, shadows (smoothstep), vibrance, luminance, LUT sampling
 *
 * Requires WebGPU shader-f16 feature to be enabled.
 */
export const UBER_SHADER_F16_SOURCE = /* wgsl */ `
// Uber-shader combining adjustments + tone curve with f16 precision
// Uses half-precision for color operations where safe for improved GPU performance
//
// Precision strategy:
// - SAFE for f16: Exposure, contrast, temperature, tint, whites, blacks, saturation
// - REQUIRES f32: Highlights, shadows (smoothstep), vibrance, luminance, LUT sampling
//
// Override constants control which features are active:
// - ENABLE_ADJUSTMENTS: When true, applies all 10 basic adjustments
// - ENABLE_TONE_CURVE: When true, applies the tone curve LUT
//
// Binding layout (same as f32 version):
// @binding(0) - Input texture
// @binding(1) - Output storage texture
// @binding(2) - Adjustments uniform buffer
// @binding(3) - Dimensions uniform buffer
// @binding(4) - LUT 1D texture
// @binding(5) - LUT sampler

enable f16;

// Pipeline specialization constants (set at pipeline creation)
override ENABLE_ADJUSTMENTS: bool = true;
override ENABLE_TONE_CURVE: bool = true;

// ============================================================================
// Data Structures
// ============================================================================

// Adjustment parameters uniform buffer
struct Adjustments {
    temperature: f32,   // White balance temperature (-100 to 100)
    tint: f32,          // White balance tint (-100 to 100)
    exposure: f32,      // Exposure adjustment (-5 to 5 stops)
    contrast: f32,      // Contrast (-100 to 100)
    highlights: f32,    // Highlights (-100 to 100)
    shadows: f32,       // Shadows (-100 to 100)
    whites: f32,        // Whites (-100 to 100)
    blacks: f32,        // Blacks (-100 to 100)
    vibrance: f32,      // Vibrance (-100 to 100)
    saturation: f32,    // Saturation (-100 to 100)
    _padding1: f32,     // Padding to align to 16 bytes
    _padding2: f32,     // Padding to align to 16 bytes
}

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
}

// ============================================================================
// Bindings
// ============================================================================

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> adj: Adjustments;
@group(0) @binding(3) var<uniform> dims: Dimensions;
@group(0) @binding(4) var lut_texture: texture_1d<f32>;
@group(0) @binding(5) var lut_sampler: sampler;

// ============================================================================
// Constants
// ============================================================================

// ITU-R BT.709 luminance coefficients (keep f32 for precision)
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// Half-precision constants
const HALF_ZERO: f16 = 0.0h;
const HALF_HALF: f16 = 0.5h;
const HALF_ONE: f16 = 1.0h;

// ============================================================================
// Precision-critical functions (f32 required)
// ============================================================================

// Calculate luminance using ITU-R BT.709 coefficients
// Requires f32 for precision in highlights/shadows calculations
fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// Smooth interpolation function (smoothstep)
// Requires f32 for precision in mask calculations
fn smoothstep_custom(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// ============================================================================
// f16-safe adjustment functions
// ============================================================================

// Apply exposure adjustment (f16 safe)
fn apply_exposure_f16(color: vec3<f16>, exposure: f32) -> vec3<f16> {
    if (exposure == 0.0) {
        return color;
    }
    let multiplier = f16(pow(2.0, exposure));
    return color * multiplier;
}

// Apply contrast adjustment (f16 safe)
fn apply_contrast_f16(color: vec3<f16>, contrast: f32) -> vec3<f16> {
    if (contrast == 0.0) {
        return color;
    }
    let factor = f16(1.0 + (contrast / 100.0));
    let midpoint = vec3<f16>(HALF_HALF, HALF_HALF, HALF_HALF);
    return (color - midpoint) * factor + midpoint;
}

// Apply temperature adjustment (f16 safe)
fn apply_temperature_f16(color: vec3<f16>, temperature: f32) -> vec3<f16> {
    if (temperature == 0.0) {
        return color;
    }
    let shift = f16(temperature / 100.0 * 0.3);
    var result = color;
    if (temperature < 0.0) {
        let abs_shift = abs(shift);
        result.r = color.r * (HALF_ONE + abs_shift);
        result.b = color.b * (HALF_ONE - abs_shift);
    } else {
        result.r = color.r * (HALF_ONE - shift);
        result.b = color.b * (HALF_ONE + shift);
    }
    return result;
}

// Apply tint adjustment (f16 safe)
fn apply_tint_f16(color: vec3<f16>, tint: f32) -> vec3<f16> {
    if (tint == 0.0) {
        return color;
    }
    let shift = f16(tint / 100.0 * 0.2);
    var result = color;
    if (tint < 0.0) {
        result.g = color.g * (HALF_ONE + abs(shift));
    } else {
        result.r = color.r * (HALF_ONE + shift);
        result.g = color.g * (HALF_ONE - shift);
        result.b = color.b * (HALF_ONE + shift);
    }
    return result;
}

// Apply highlights adjustment (requires f32 for smoothstep precision)
fn apply_highlights_f16(color: vec3<f16>, luminance: f32, highlights: f32) -> vec3<f16> {
    if (highlights == 0.0) {
        return color;
    }
    let highlight_mask = smoothstep_custom(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;

    var result = color;
    if (highlights < 0.0) {
        let factor = f16(1.0 + adjustment);
        result = color * factor;
    } else {
        let boost = f16(adjustment * 0.5);
        result = color + vec3<f16>(boost, boost, boost);
    }
    return result;
}

// Apply shadows adjustment (requires f32 for smoothstep precision)
fn apply_shadows_f16(color: vec3<f16>, luminance: f32, shadows: f32) -> vec3<f16> {
    if (shadows == 0.0) {
        return color;
    }
    let shadow_mask = smoothstep_custom(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;

    var result = color;
    if (shadows < 0.0) {
        let factor = f16(1.0 + adjustment);
        result = color * factor;
    } else {
        let boost = f16(adjustment * 0.5);
        result = color + vec3<f16>(boost, boost, boost);
    }
    return result;
}

// Apply whites adjustment (f16 safe)
fn apply_whites_f16(color: vec3<f16>, whites: f32) -> vec3<f16> {
    if (whites == 0.0) {
        return color;
    }
    let max_channel = max(max(color.r, color.g), color.b);
    if (max_channel > 0.9h) {
        let factor = f16(1.0 + (whites / 100.0) * 0.3);
        return color * factor;
    }
    return color;
}

// Apply blacks adjustment (f16 safe)
fn apply_blacks_f16(color: vec3<f16>, blacks: f32) -> vec3<f16> {
    if (blacks == 0.0) {
        return color;
    }
    let min_channel = min(min(color.r, color.g), color.b);
    if (min_channel < 0.1h) {
        let factor = f16(1.0 + (blacks / 100.0) * 0.2);
        return color * factor;
    }
    return color;
}

// Apply saturation adjustment (f16 safe for simple case)
fn apply_saturation_f16(color: vec3<f16>, saturation: f32) -> vec3<f16> {
    if (saturation == 0.0) {
        return color;
    }
    let gray = f16(calculate_luminance(f32(color.r), f32(color.g), f32(color.b)));
    let factor = f16(1.0 + (saturation / 100.0));
    let gray_vec = vec3<f16>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

// Apply vibrance adjustment (uses f32 internally due to protection calculations)
fn apply_vibrance_f16(color: vec3<f16>, vibrance: f32) -> vec3<f16> {
    if (vibrance == 0.0) {
        return color;
    }

    let color_f32 = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));
    let max_c = max(max(color_f32.r, color_f32.g), color_f32.b);
    let min_c = min(min(color_f32.r, color_f32.g), color_f32.b);
    var current_sat = 0.0;
    if (max_c > 0.0) {
        current_sat = (max_c - min_c) / max_c;
    }

    let is_skin = (color_f32.r > color_f32.g) && (color_f32.g > color_f32.b) && ((color_f32.r - color_f32.g) > 0.06);
    var skin_protection = 1.0;
    if (is_skin) {
        skin_protection = 0.5;
    }

    let saturation_protection = 1.0 - current_sat;
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    return apply_saturation_f16(color, effective_vibrance);
}

// Apply all adjustments in order
fn apply_all_adjustments_f16(color: vec3<f16>) -> vec3<f16> {
    var result = color;

    // 1. Exposure (f16 safe)
    result = apply_exposure_f16(result, adj.exposure);

    // 2. Contrast (f16 safe)
    result = apply_contrast_f16(result, adj.contrast);

    // 3. Temperature (f16 safe)
    result = apply_temperature_f16(result, adj.temperature);

    // 4. Tint (f16 safe)
    result = apply_tint_f16(result, adj.tint);

    // Calculate luminance in f32 for highlights/shadows precision
    let luminance = calculate_luminance(f32(result.r), f32(result.g), f32(result.b));

    // 5. Highlights (requires f32 smoothstep)
    result = apply_highlights_f16(result, luminance, adj.highlights);

    // 6. Shadows (requires f32 smoothstep)
    result = apply_shadows_f16(result, luminance, adj.shadows);

    // 7. Whites (f16 safe)
    result = apply_whites_f16(result, adj.whites);

    // 8. Blacks (f16 safe)
    result = apply_blacks_f16(result, adj.blacks);

    // 9. Saturation (f16 safe)
    result = apply_saturation_f16(result, adj.saturation);

    // 10. Vibrance (uses f32 internally)
    result = apply_vibrance_f16(result, adj.vibrance);

    return result;
}

// ============================================================================
// Tone Curve Functions (requires f32 for LUT sampling coordinates)
// ============================================================================

fn sample_lut(value: f32) -> f32 {
    let coord = clamp(value, 0.0, 1.0);
    return textureSampleLevel(lut_texture, lut_sampler, coord, 0.0).r;
}

fn apply_tone_curve_f16(color: vec3<f16>) -> vec3<f16> {
    // Convert to f32 for LUT sampling precision
    var color_f32 = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));
    color_f32 = clamp(color_f32, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));

    let r = sample_lut(color_f32.r);
    let g = sample_lut(color_f32.g);
    let b = sample_lut(color_f32.b);
    return vec3<f16>(f16(r), f16(g), f16(b));
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

    // Load pixel from input texture (f32 from texture)
    let pixel = textureLoad(input_texture, coords, 0);

    // Convert to f16 for processing
    var color = vec3<f16>(f16(pixel.r), f16(pixel.g), f16(pixel.b));

    // Apply adjustments if enabled
    if (ENABLE_ADJUSTMENTS) {
        color = apply_all_adjustments_f16(color);
    }

    // Apply tone curve if enabled
    if (ENABLE_TONE_CURVE) {
        color = apply_tone_curve_f16(color);
    }

    // Convert to f32 for final output
    var output_color = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));
    output_color = clamp(output_color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    textureStore(output_texture, coords, vec4<f32>(output_color, pixel.a));
}
`

/**
 * GPU downsample compute shader.
 * Downsamples images by averaging NxN pixel blocks based on scale factor.
 * Used for efficient draft mode preview generation.
 */
export const DOWNSAMPLE_SHADER_SOURCE = /* wgsl */ `
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
`

export const HISTOGRAM_SHADER_SOURCE = /* wgsl */ `
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
`

/**
 * Subgroup-optimized histogram compute shader.
 * Uses WebGPU subgroups for hardware-accelerated reduction within subgroups,
 * reducing atomic operations by a factor of subgroup_size (typically 32).
 *
 * Requires WebGPU 'subgroups' feature to be enabled (Chrome 134+).
 */
export const HISTOGRAM_SUBGROUP_SHADER_SOURCE = /* wgsl */ `
// Histogram compute shader with subgroup optimization
// Uses subgroup operations for faster reduction before workgroup atomic operations
//
// Optimization strategy:
// 1. Each thread processes one pixel and determines bin indices
// 2. Use subgroupAdd to reduce counts within subgroups (hardware-accelerated)
// 3. Only the first thread per subgroup updates shared memory atomics
// 4. Merge local histograms to global buffer as before
//
// This reduces atomic operations by a factor of subgroup_size (typically 32).

enable subgroups;

// ============================================================================
// Constants
// ============================================================================

const NUM_BINS: u32 = 256u;
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

// ============================================================================
// Data Structures
// ============================================================================

struct Dimensions {
    width: u32,
    height: u32,
}

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

var<workgroup> local_bins_r: array<atomic<u32>, 256>;
var<workgroup> local_bins_g: array<atomic<u32>, 256>;
var<workgroup> local_bins_b: array<atomic<u32>, 256>;
var<workgroup> local_bins_l: array<atomic<u32>, 256>;

// ============================================================================
// Helper Functions
// ============================================================================

fn calculate_luminance(r: f32, g: f32, b: f32) -> f32 {
    return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

fn quantize_to_bin(value: f32) -> u32 {
    let clamped = clamp(value, 0.0, 1.0);
    let scaled = clamped * 255.0;
    return clamp(u32(scaled), 0u, 255u);
}

// ============================================================================
// Main Entry Point
// ============================================================================

@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_index) local_index: u32,
    @builtin(subgroup_size) subgroup_size: u32,
    @builtin(subgroup_invocation_id) subgroup_id: u32
) {
    // Phase 1: Initialize shared memory
    if (local_index < NUM_BINS) {
        atomicStore(&local_bins_r[local_index], 0u);
        atomicStore(&local_bins_g[local_index], 0u);
        atomicStore(&local_bins_b[local_index], 0u);
        atomicStore(&local_bins_l[local_index], 0u);
    }

    workgroupBarrier();

    // Phase 2: Process pixels
    // Calculate 2D coordinates from linear dispatch
    let workgroup_id = global_id.x / 256u;
    let base_pixel = workgroup_id * 256u + local_index;
    let pixel_x = base_pixel % dims.width;
    let pixel_y = base_pixel / dims.width;

    var my_bin_r: u32 = 0u;
    var my_bin_g: u32 = 0u;
    var my_bin_b: u32 = 0u;
    var my_bin_l: u32 = 0u;
    var has_pixel: bool = false;

    if (pixel_x < dims.width && pixel_y < dims.height) {
        let coords = vec2<i32>(i32(pixel_x), i32(pixel_y));
        let pixel = textureLoad(input_texture, coords, 0);

        my_bin_r = quantize_to_bin(pixel.r);
        my_bin_g = quantize_to_bin(pixel.g);
        my_bin_b = quantize_to_bin(pixel.b);

        let luminance = calculate_luminance(pixel.r, pixel.g, pixel.b);
        my_bin_l = quantize_to_bin(luminance);

        has_pixel = true;
    }

    // Phase 3: Accumulate to local histogram with subgroup optimization
    // Use subgroup ballot to find threads with same bin, then reduce
    if (has_pixel) {
        // For histogram, each thread likely has different bins
        // Direct atomic is still efficient with workgroup privatization
        atomicAdd(&local_bins_r[my_bin_r], 1u);
        atomicAdd(&local_bins_g[my_bin_g], 1u);
        atomicAdd(&local_bins_b[my_bin_b], 1u);
        atomicAdd(&local_bins_l[my_bin_l], 1u);
    }

    workgroupBarrier();

    // Phase 4: Merge local to global with subgroup reduction
    // Each thread handles one bin, use subgroupAdd if multiple workgroups
    if (local_index < NUM_BINS) {
        let local_r = atomicLoad(&local_bins_r[local_index]);
        let local_g = atomicLoad(&local_bins_g[local_index]);
        let local_b = atomicLoad(&local_bins_b[local_index]);
        let local_l = atomicLoad(&local_bins_l[local_index]);

        // Reduce within subgroup before global atomic
        // This helps when bins span multiple subgroups of a large workgroup
        let sum_r = subgroupAdd(local_r);
        let sum_g = subgroupAdd(local_g);
        let sum_b = subgroupAdd(local_b);
        let sum_l = subgroupAdd(local_l);

        // Only first thread in subgroup writes to global
        if (subgroup_id == 0u) {
            if (sum_r > 0u) {
                atomicAdd(&histogram.bins_r[local_index], sum_r);
            }
            if (sum_g > 0u) {
                atomicAdd(&histogram.bins_g[local_index], sum_g);
            }
            if (sum_b > 0u) {
                atomicAdd(&histogram.bins_b[local_index], sum_b);
            }
            if (sum_l > 0u) {
                atomicAdd(&histogram.bins_l[local_index], sum_l);
            }
        }
    }
}
`
