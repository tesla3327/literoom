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
