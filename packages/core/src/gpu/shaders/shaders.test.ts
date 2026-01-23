/**
 * Unit tests for GPU shader sources.
 *
 * These tests validate the WGSL shader source strings to ensure:
 * - Required uniforms and bindings are present
 * - Entry points are defined
 * - Shader structure is correct
 * - No syntax errors in string templates
 */

import { describe, it, expect } from 'vitest'
import {
  TONE_CURVE_SHADER_SOURCE,
  ADJUSTMENTS_SHADER_SOURCE,
} from './index'

// ============================================================================
// Tone Curve Shader Tests
// ============================================================================

describe('TONE_CURVE_SHADER_SOURCE', () => {
  describe('structure', () => {
    it('is a non-empty string', () => {
      expect(typeof TONE_CURVE_SHADER_SOURCE).toBe('string')
      expect(TONE_CURVE_SHADER_SOURCE.length).toBeGreaterThan(0)
    })

    it('contains compute shader entry point', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@compute')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('fn main')
    })

    it('specifies workgroup size', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@workgroup_size')
      expect(TONE_CURVE_SHADER_SOURCE).toMatch(/@workgroup_size\s*\(\s*16\s*,\s*16\s*\)/)
    })
  })

  describe('bindings', () => {
    it('defines input_texture binding', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@binding(0)')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('input_texture')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('texture_2d<f32>')
    })

    it('defines output_texture binding', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@binding(1)')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('output_texture')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('texture_storage_2d')
    })

    it('defines lut_texture binding', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@binding(2)')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('lut_texture')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('texture_1d<f32>')
    })

    it('defines lut_sampler binding', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@binding(3)')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('lut_sampler')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('sampler')
    })

    it('defines dimensions uniform binding', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@binding(4)')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('dims')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('Dimensions')
    })
  })

  describe('uniforms', () => {
    it('defines Dimensions struct', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('struct Dimensions')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('width: u32')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('height: u32')
    })
  })

  describe('functions', () => {
    it('defines sample_lut function', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('fn sample_lut')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('textureSampleLevel')
    })

    it('uses textureLoad for input', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('textureLoad')
    })

    it('uses textureStore for output', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('textureStore')
    })
  })

  describe('bounds checking', () => {
    it('includes bounds check in main function', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('global_id.x >= dims.width')
      expect(TONE_CURVE_SHADER_SOURCE).toContain('global_id.y >= dims.height')
    })
  })

  describe('WGSL syntax validation', () => {
    it('uses proper builtin decorator', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@builtin(global_invocation_id)')
    })

    it('uses proper group decorator', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('@group(0)')
    })

    it('uses vec3<u32> for invocation id', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('vec3<u32>')
    })

    it('uses vec4<f32> for pixel data', () => {
      expect(TONE_CURVE_SHADER_SOURCE).toContain('vec4<f32>')
    })
  })
})

// ============================================================================
// Adjustments Shader Tests
// ============================================================================

describe('ADJUSTMENTS_SHADER_SOURCE', () => {
  describe('structure', () => {
    it('is a non-empty string', () => {
      expect(typeof ADJUSTMENTS_SHADER_SOURCE).toBe('string')
      expect(ADJUSTMENTS_SHADER_SOURCE.length).toBeGreaterThan(0)
    })

    it('contains compute shader entry point', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@compute')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn main')
    })

    it('specifies workgroup size', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@workgroup_size')
      expect(ADJUSTMENTS_SHADER_SOURCE).toMatch(/@workgroup_size\s*\(\s*16\s*,\s*16\s*\)/)
    })
  })

  describe('bindings', () => {
    it('defines input_texture binding', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@binding(0)')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('input_texture')
    })

    it('defines output_texture binding', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@binding(1)')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('output_texture')
    })

    it('defines adjustments uniform binding', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@binding(2)')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('adj')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('Adjustments')
    })

    it('defines dimensions uniform binding', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@binding(3)')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('dims')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('Dimensions')
    })
  })

  describe('Adjustments struct', () => {
    it('defines Adjustments struct', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('struct Adjustments')
    })

    it('includes all 10 adjustment parameters', () => {
      const params = [
        'temperature',
        'tint',
        'exposure',
        'contrast',
        'highlights',
        'shadows',
        'whites',
        'blacks',
        'vibrance',
        'saturation',
      ]

      for (const param of params) {
        expect(ADJUSTMENTS_SHADER_SOURCE).toContain(`${param}: f32`)
      }
    })

    it('includes padding for alignment', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('_padding')
    })
  })

  describe('adjustment functions', () => {
    it('defines exposure function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_exposure')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('pow(2.0, exposure)')
    })

    it('defines contrast function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_contrast')
    })

    it('defines temperature function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_temperature')
    })

    it('defines tint function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_tint')
    })

    it('defines highlights function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_highlights')
    })

    it('defines shadows function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_shadows')
    })

    it('defines whites function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_whites')
    })

    it('defines blacks function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_blacks')
    })

    it('defines saturation function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_saturation')
    })

    it('defines vibrance function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn apply_vibrance')
    })

    it('defines luminance calculation function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn calculate_luminance')
    })

    it('defines smoothstep function', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('fn smoothstep_custom')
    })
  })

  describe('luminance coefficients', () => {
    it('defines ITU-R BT.709 coefficients', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('LUMA_R')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('LUMA_G')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('LUMA_B')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('0.2126')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('0.7152')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('0.0722')
    })
  })

  describe('processing order', () => {
    it('applies adjustments in documented order', () => {
      // The main function should apply adjustments in the correct order
      const mainFunctionStart = ADJUSTMENTS_SHADER_SOURCE.indexOf('fn main')
      const mainFunctionContent = ADJUSTMENTS_SHADER_SOURCE.slice(mainFunctionStart)

      const exposurePos = mainFunctionContent.indexOf('apply_exposure')
      const contrastPos = mainFunctionContent.indexOf('apply_contrast')
      const temperaturePos = mainFunctionContent.indexOf('apply_temperature')
      const tintPos = mainFunctionContent.indexOf('apply_tint')
      const highlightsPos = mainFunctionContent.indexOf('apply_highlights')
      const shadowsPos = mainFunctionContent.indexOf('apply_shadows')
      const whitesPos = mainFunctionContent.indexOf('apply_whites')
      const blacksPos = mainFunctionContent.indexOf('apply_blacks')
      const saturationPos = mainFunctionContent.indexOf('apply_saturation')
      const vibrancePos = mainFunctionContent.indexOf('apply_vibrance')

      // Verify order: exposure < contrast < temperature < tint < highlights < shadows < whites < blacks < saturation < vibrance
      expect(exposurePos).toBeLessThan(contrastPos)
      expect(contrastPos).toBeLessThan(temperaturePos)
      expect(temperaturePos).toBeLessThan(tintPos)
      expect(tintPos).toBeLessThan(highlightsPos)
      expect(highlightsPos).toBeLessThan(shadowsPos)
      expect(shadowsPos).toBeLessThan(whitesPos)
      expect(whitesPos).toBeLessThan(blacksPos)
      expect(blacksPos).toBeLessThan(saturationPos)
      expect(saturationPos).toBeLessThan(vibrancePos)
    })
  })

  describe('output handling', () => {
    it('clamps output values', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('clamp')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('vec3<f32>(0.0, 0.0, 0.0)')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('vec3<f32>(1.0, 1.0, 1.0)')
    })

    it('preserves alpha channel', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('pixel.a')
    })
  })

  describe('early exit optimizations', () => {
    it('checks for zero values in adjustments', () => {
      // Various functions check if value == 0.0 to skip processing
      expect(ADJUSTMENTS_SHADER_SOURCE).toMatch(/if\s*\(\s*\w+\s*==\s*0\.0\s*\)/)
    })
  })

  describe('WGSL syntax validation', () => {
    it('uses proper builtin decorator', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@builtin(global_invocation_id)')
    })

    it('uses proper group decorator', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('@group(0)')
    })

    it('defines var<uniform> for uniforms', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('var<uniform>')
    })

    it('uses proper type casting', () => {
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('i32(')
      expect(ADJUSTMENTS_SHADER_SOURCE).toContain('vec2<i32>')
    })
  })
})

// ============================================================================
// Cross-Shader Consistency Tests
// ============================================================================

describe('shader consistency', () => {
  it('both shaders use same workgroup size', () => {
    const toneCurveMatch = TONE_CURVE_SHADER_SOURCE.match(/@workgroup_size\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/)
    const adjustmentsMatch = ADJUSTMENTS_SHADER_SOURCE.match(/@workgroup_size\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/)

    expect(toneCurveMatch).not.toBeNull()
    expect(adjustmentsMatch).not.toBeNull()

    expect(toneCurveMatch![1]).toBe(adjustmentsMatch![1])
    expect(toneCurveMatch![2]).toBe(adjustmentsMatch![2])
  })

  it('both shaders use same Dimensions struct pattern', () => {
    expect(TONE_CURVE_SHADER_SOURCE).toContain('struct Dimensions')
    expect(ADJUSTMENTS_SHADER_SOURCE).toContain('struct Dimensions')
  })

  it('both shaders use same input/output texture format', () => {
    expect(TONE_CURVE_SHADER_SOURCE).toContain('texture_2d<f32>')
    expect(ADJUSTMENTS_SHADER_SOURCE).toContain('texture_2d<f32>')
    expect(TONE_CURVE_SHADER_SOURCE).toContain('rgba8unorm')
    expect(ADJUSTMENTS_SHADER_SOURCE).toContain('rgba8unorm')
  })

  it('both shaders have bounds checking', () => {
    expect(TONE_CURVE_SHADER_SOURCE).toContain('return;')
    expect(ADJUSTMENTS_SHADER_SOURCE).toContain('return;')
  })
})

// ============================================================================
// String Template Validation
// ============================================================================

describe('shader string templates', () => {
  it('TONE_CURVE_SHADER_SOURCE has no template syntax errors', () => {
    // Check for common template string issues
    expect(TONE_CURVE_SHADER_SOURCE).not.toContain('${')
    expect(TONE_CURVE_SHADER_SOURCE).not.toContain('undefined')
    expect(TONE_CURVE_SHADER_SOURCE).not.toContain('[object Object]')
  })

  it('ADJUSTMENTS_SHADER_SOURCE has no template syntax errors', () => {
    expect(ADJUSTMENTS_SHADER_SOURCE).not.toContain('${')
    expect(ADJUSTMENTS_SHADER_SOURCE).not.toContain('undefined')
    expect(ADJUSTMENTS_SHADER_SOURCE).not.toContain('[object Object]')
  })

  it('shaders are properly terminated', () => {
    // Both should end with a closing brace for the main function
    const toneCurveTrimmed = TONE_CURVE_SHADER_SOURCE.trim()
    const adjustmentsTrimmed = ADJUSTMENTS_SHADER_SOURCE.trim()

    expect(toneCurveTrimmed.endsWith('}')).toBe(true)
    expect(adjustmentsTrimmed.endsWith('}')).toBe(true)
  })
})
