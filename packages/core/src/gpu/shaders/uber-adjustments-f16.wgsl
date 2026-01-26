// Combined uber-shader for adjustments + tone curve (f16 variant)
// Uses half-precision (f16) for color operations where safe for improved GPU performance.
//
// Precision strategy:
// - SAFE for f16: Exposure, contrast, temperature, tint, whites, blacks, saturation
// - REQUIRES f32: Highlights, shadows (smoothstep accumulation), vibrance (calls saturation multiple times),
//                 luminance calculations for highlights/shadows, LUT sampling coordinates
//
// Feature flags (override constants):
// - ENABLE_ADJUSTMENTS: Apply all 10 basic adjustments
// - ENABLE_TONE_CURVE: Apply tone curve LUT mapping
//
// Adjustment order (when ENABLE_ADJUSTMENTS is true):
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

enable f16;

// Feature flags - can be overridden at pipeline creation time
override ENABLE_ADJUSTMENTS: bool = true;
override ENABLE_TONE_CURVE: bool = true;

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
@group(0) @binding(4) var lut_texture: texture_1d<f32>;
@group(0) @binding(5) var lut_sampler: sampler;

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
// Exposure is measured in stops (-5 to +5).
// Each stop doubles or halves the brightness.
// Formula: output = input * 2^exposure
fn apply_exposure_f16(color: vec3<f16>, exposure: f32) -> vec3<f16> {
    if (exposure == 0.0) {
        return color;
    }
    // Calculate multiplier in f32, convert to f16 for application
    let multiplier = f16(pow(2.0, exposure));
    return color * multiplier;
}

// Apply contrast adjustment (f16 safe)
// Contrast ranges from -100 to +100.
// Formula: output = (input - 0.5) * (1 + contrast/100) + 0.5
fn apply_contrast_f16(color: vec3<f16>, contrast: f32) -> vec3<f16> {
    if (contrast == 0.0) {
        return color;
    }
    let factor = f16(1.0 + (contrast / 100.0));
    let midpoint = vec3<f16>(HALF_HALF, HALF_HALF, HALF_HALF);
    return (color - midpoint) * factor + midpoint;
}

// Apply temperature (white balance) adjustment (f16 safe)
// Temperature ranges from -100 to +100.
// - Negative = warmer (more orange/red)
// - Positive = cooler (more blue)
fn apply_temperature_f16(color: vec3<f16>, temperature: f32) -> vec3<f16> {
    if (temperature == 0.0) {
        return color;
    }
    let shift = f16(temperature / 100.0 * 0.3);
    var result = color;
    if (temperature < 0.0) {
        // Warmer: boost red, reduce blue
        let abs_shift = abs(shift);
        result.r = color.r * (HALF_ONE + abs_shift);
        result.b = color.b * (HALF_ONE - abs_shift);
    } else {
        // Cooler: reduce red, boost blue
        result.r = color.r * (HALF_ONE - shift);
        result.b = color.b * (HALF_ONE + shift);
    }
    return result;
}

// Apply tint (green-magenta) adjustment (f16 safe)
// Tint ranges from -100 to +100.
// - Negative = more green
// - Positive = more magenta (red + blue)
fn apply_tint_f16(color: vec3<f16>, tint: f32) -> vec3<f16> {
    if (tint == 0.0) {
        return color;
    }
    let shift = f16(tint / 100.0 * 0.2);
    var result = color;
    if (tint < 0.0) {
        // Green tint
        result.g = color.g * (HALF_ONE + abs(shift));
    } else {
        // Magenta tint (red + blue)
        result.r = color.r * (HALF_ONE + shift);
        result.g = color.g * (HALF_ONE - shift);
        result.b = color.b * (HALF_ONE + shift);
    }
    return result;
}

// Apply highlights adjustment (requires f32 for smoothstep precision)
// Highlights range from -100 to +100.
// Affects bright areas of the image (luminance > 0.5).
fn apply_highlights_f16(color: vec3<f16>, luminance: f32, highlights: f32) -> vec3<f16> {
    if (highlights == 0.0) {
        return color;
    }
    // Mask calculation requires f32 precision for smoothstep
    let highlight_mask = smoothstep_custom(0.5, 1.0, luminance);
    let adjustment = (highlights / 100.0) * highlight_mask;

    var result = color;
    if (highlights < 0.0) {
        // Reduce highlights: multiply by factor < 1
        let factor = f16(1.0 + adjustment); // adjustment is negative
        result = color * factor;
    } else {
        // Boost highlights: add to each channel
        let boost = f16(adjustment * 0.5);
        result = color + vec3<f16>(boost, boost, boost);
    }
    return result;
}

// Apply shadows adjustment (requires f32 for smoothstep precision)
// Shadows range from -100 to +100.
// Affects dark areas of the image (luminance < 0.5).
fn apply_shadows_f16(color: vec3<f16>, luminance: f32, shadows: f32) -> vec3<f16> {
    if (shadows == 0.0) {
        return color;
    }
    // Mask calculation requires f32 precision for smoothstep
    let shadow_mask = smoothstep_custom(0.5, 0.0, luminance);
    let adjustment = (shadows / 100.0) * shadow_mask;

    var result = color;
    if (shadows < 0.0) {
        // Deepen shadows: multiply by factor < 1
        let factor = f16(1.0 + adjustment); // adjustment is negative
        result = color * factor;
    } else {
        // Lift shadows: add to each channel
        let boost = f16(adjustment * 0.5);
        result = color + vec3<f16>(boost, boost, boost);
    }
    return result;
}

// Apply whites adjustment (f16 safe)
// Whites range from -100 to +100.
// Affects the brightest pixels (any channel > 0.9).
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
// Blacks range from -100 to +100.
// Affects the darkest pixels (any channel < 0.1).
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
// Saturation ranges from -100 to +100.
// - Negative = desaturate toward grayscale
// - Positive = increase color intensity
fn apply_saturation_f16(color: vec3<f16>, saturation: f32) -> vec3<f16> {
    if (saturation == 0.0) {
        return color;
    }
    // Luminance calculation in f32 for precision
    let gray = f16(calculate_luminance(f32(color.r), f32(color.g), f32(color.b)));
    let factor = f16(1.0 + (saturation / 100.0));
    let gray_vec = vec3<f16>(gray, gray, gray);
    return gray_vec + (color - gray_vec) * factor;
}

// Apply vibrance adjustment (uses f32 internally due to multiple saturation calls)
// Vibrance ranges from -100 to +100.
// Similar to saturation but:
// - Protects already-saturated colors
// - Protects skin tones (R > G > B)
// - More subtle, natural-looking effect
fn apply_vibrance_f16(color: vec3<f16>, vibrance: f32) -> vec3<f16> {
    if (vibrance == 0.0) {
        return color;
    }

    // Calculate current saturation using f32 for precision (multiple operations)
    let color_f32 = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));
    let max_c = max(max(color_f32.r, color_f32.g), color_f32.b);
    let min_c = min(min(color_f32.r, color_f32.g), color_f32.b);
    var current_sat = 0.0;
    if (max_c > 0.0) {
        current_sat = (max_c - min_c) / max_c;
    }

    // Detect skin tones (simplified: R > G > B with specific ratios)
    let is_skin = (color_f32.r > color_f32.g) && (color_f32.g > color_f32.b) && ((color_f32.r - color_f32.g) > 0.06);
    var skin_protection = 1.0;
    if (is_skin) {
        skin_protection = 0.5;
    }

    // Less effect on already saturated colors
    let saturation_protection = 1.0 - current_sat;

    // Apply reduced vibrance using f16-safe saturation function
    let effective_vibrance = vibrance * skin_protection * saturation_protection;
    return apply_saturation_f16(color, effective_vibrance);
}

// ============================================================================
// Tone curve functions (requires f32 for LUT sampling coordinates)
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

// ============================================================================
// Main compute shader entry point
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

    // ========================================================================
    // Phase 1: Apply adjustments (if enabled)
    // ========================================================================
    if (ENABLE_ADJUSTMENTS) {
        // 1. Exposure (f16 safe)
        color = apply_exposure_f16(color, adj.exposure);

        // 2. Contrast (f16 safe)
        color = apply_contrast_f16(color, adj.contrast);

        // 3. Temperature (f16 safe)
        color = apply_temperature_f16(color, adj.temperature);

        // 4. Tint (f16 safe)
        color = apply_tint_f16(color, adj.tint);

        // Calculate luminance in f32 for highlights/shadows precision
        let luminance = calculate_luminance(f32(color.r), f32(color.g), f32(color.b));

        // 5. Highlights (requires f32 smoothstep)
        color = apply_highlights_f16(color, luminance, adj.highlights);

        // 6. Shadows (requires f32 smoothstep)
        color = apply_shadows_f16(color, luminance, adj.shadows);

        // 7. Whites (f16 safe)
        color = apply_whites_f16(color, adj.whites);

        // 8. Blacks (f16 safe)
        color = apply_blacks_f16(color, adj.blacks);

        // 9. Saturation (f16 safe)
        color = apply_saturation_f16(color, adj.saturation);

        // 10. Vibrance (uses f32 internally for protection calculations)
        color = apply_vibrance_f16(color, adj.vibrance);
    }

    // ========================================================================
    // Phase 2: Apply tone curve LUT (if enabled)
    // ========================================================================
    if (ENABLE_TONE_CURVE) {
        // Convert to f32 for LUT sampling (coordinates need precision)
        var color_f32 = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));

        // Clamp before LUT sampling to ensure valid input range
        color_f32 = clamp(color_f32, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));

        // Apply LUT to each channel independently (f32 for sampling precision)
        color_f32.r = sample_lut(color_f32.r);
        color_f32.g = sample_lut(color_f32.g);
        color_f32.b = sample_lut(color_f32.b);

        // Convert back to f16
        color = vec3<f16>(f16(color_f32.r), f16(color_f32.g), f16(color_f32.b));
    }

    // ========================================================================
    // Final output
    // ========================================================================
    // Convert to f32 for final clamp and store (texture requires f32)
    var output_color = vec3<f32>(f32(color.r), f32(color.g), f32(color.b));
    output_color = clamp(output_color, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0));
    textureStore(output_texture, coords, vec4<f32>(output_color, pixel.a));
}
