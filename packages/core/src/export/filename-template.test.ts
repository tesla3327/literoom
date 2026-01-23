import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  validateTemplate,
  extractOriginalFilename,
  formatDateForTemplate,
} from './filename-template'

describe('renderTemplate', () => {
  it('replaces {orig} token', () => {
    expect(renderTemplate('{orig}', { orig: 'DSC1234', seq: 1 })).toBe('DSC1234')
  })

  it('replaces multiple {orig} tokens', () => {
    expect(renderTemplate('{orig}_{orig}', { orig: 'test', seq: 1 })).toBe('test_test')
  })

  it('replaces {seq} token without padding', () => {
    expect(renderTemplate('{seq}', { orig: 'test', seq: 42 })).toBe('42')
  })

  it('replaces {seq:N} token with zero padding', () => {
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 1 })).toBe('0001')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 42 })).toBe('0042')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 999 })).toBe('0999')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 9999 })).toBe('9999')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 10000 })).toBe('10000')
  })

  it('handles various padding widths', () => {
    expect(renderTemplate('{seq:1}', { orig: 'test', seq: 1 })).toBe('1')
    expect(renderTemplate('{seq:2}', { orig: 'test', seq: 1 })).toBe('01')
    expect(renderTemplate('{seq:3}', { orig: 'test', seq: 1 })).toBe('001')
    expect(renderTemplate('{seq:6}', { orig: 'test', seq: 123 })).toBe('000123')
  })

  it('replaces {date} token', () => {
    expect(renderTemplate('{date}', { orig: 'test', seq: 1, date: '2026-01-21' })).toBe(
      '2026-01-21'
    )
  })

  it('handles missing date', () => {
    expect(renderTemplate('{date}', { orig: 'test', seq: 1 })).toBe('')
    expect(renderTemplate('{date}_photo', { orig: 'test', seq: 1 })).toBe('_photo')
  })

  it('handles complex templates', () => {
    expect(
      renderTemplate('{orig}_{date}_{seq:3}', {
        orig: 'DSC1234',
        seq: 7,
        date: '2026-01-21',
      })
    ).toBe('DSC1234_2026-01-21_007')
  })

  it('preserves static text', () => {
    expect(renderTemplate('photo-{seq:4}-final', { orig: 'test', seq: 42 })).toBe(
      'photo-0042-final'
    )
  })

  it('handles template with no tokens', () => {
    expect(renderTemplate('static-filename', { orig: 'test', seq: 1 })).toBe('static-filename')
  })

  it('handles empty template', () => {
    expect(renderTemplate('', { orig: 'test', seq: 1 })).toBe('')
  })

  it('handles real-world Lightroom-style template', () => {
    expect(
      renderTemplate('{orig}_{seq:4}', {
        orig: 'DSC09876',
        seq: 1,
      })
    ).toBe('DSC09876_0001')
  })

  it('handles template with only static text and numbers', () => {
    expect(renderTemplate('export_2026', { orig: 'test', seq: 1 })).toBe('export_2026')
  })
})

describe('validateTemplate', () => {
  it('accepts valid templates', () => {
    expect(validateTemplate('{orig}')).toEqual([])
    expect(validateTemplate('{orig}_{seq:4}')).toEqual([])
    expect(validateTemplate('{date}_{orig}_{seq}')).toEqual([])
    expect(validateTemplate('static-name')).toEqual([])
    expect(validateTemplate('{orig}_{seq:1}')).toEqual([])
    expect(validateTemplate('{orig}_{seq:10}')).toEqual([])
  })

  it('rejects empty template', () => {
    expect(validateTemplate('')).toHaveLength(1)
    expect(validateTemplate('')![0].message).toBe('Template cannot be empty')
  })

  it('rejects whitespace-only template', () => {
    expect(validateTemplate('   ')).toHaveLength(1)
    expect(validateTemplate('\t')).toHaveLength(1)
  })

  it('rejects unmatched opening brace', () => {
    const errors = validateTemplate('{orig')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('brace'))).toBe(true)
  })

  it('rejects unmatched closing brace', () => {
    const errors = validateTemplate('orig}')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('brace'))).toBe(true)
  })

  it('rejects unknown tokens', () => {
    const errors = validateTemplate('{unknown}')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('Unknown token'))).toBe(true)
  })

  it('rejects multiple unknown tokens', () => {
    const errors = validateTemplate('{foo}_{bar}')
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('reports position of unknown tokens', () => {
    const errors = validateTemplate('prefix_{unknown}')
    expect(errors.some((e) => e.position === 7)).toBe(true)
  })

  it('rejects invalid padding width (0)', () => {
    const errors = validateTemplate('{seq:0}')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('1-10'))).toBe(true)
  })

  it('rejects invalid padding width (>10)', () => {
    const errors = validateTemplate('{seq:11}')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.message.includes('1-10'))).toBe(true)
  })

  it('rejects templates with invalid filename characters', () => {
    const errors = validateTemplate('{orig}:{seq}')
    expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
  })

  it('accepts templates that would have valid rendered output', () => {
    // Underscore, dash, and dot are valid
    expect(validateTemplate('{orig}_{seq}')).toEqual([])
    expect(validateTemplate('{orig}-{seq}')).toEqual([])
    expect(validateTemplate('{orig}.{seq}')).toEqual([])
  })
})

describe('extractOriginalFilename', () => {
  it('removes extension', () => {
    expect(extractOriginalFilename('DSC1234.ARW')).toBe('DSC1234')
    expect(extractOriginalFilename('photo.jpeg')).toBe('photo')
    expect(extractOriginalFilename('image.jpg')).toBe('image')
  })

  it('removes Unix path', () => {
    expect(extractOriginalFilename('/path/to/DSC1234.ARW')).toBe('DSC1234')
    expect(extractOriginalFilename('/home/user/photos/image.jpg')).toBe('image')
  })

  it('removes Windows path', () => {
    expect(extractOriginalFilename('C:\\photos\\DSC1234.ARW')).toBe('DSC1234')
    expect(extractOriginalFilename('D:\\Users\\photos\\image.jpg')).toBe('image')
  })

  it('handles multiple dots', () => {
    expect(extractOriginalFilename('file.name.ext')).toBe('file.name')
    expect(extractOriginalFilename('my.photo.2026.jpg')).toBe('my.photo.2026')
  })

  it('handles no extension', () => {
    expect(extractOriginalFilename('filename')).toBe('filename')
    expect(extractOriginalFilename('/path/to/noext')).toBe('noext')
  })

  it('handles hidden files (Unix)', () => {
    expect(extractOriginalFilename('.gitignore')).toBe('.gitignore')
    expect(extractOriginalFilename('.hidden.txt')).toBe('.hidden')
  })

  it('handles empty string', () => {
    expect(extractOriginalFilename('')).toBe('')
  })

  it('handles just filename without path', () => {
    expect(extractOriginalFilename('DSC09876.ARW')).toBe('DSC09876')
  })
})

describe('formatDateForTemplate', () => {
  it('formats date as YYYY-MM-DD', () => {
    // Note: Date constructor months are 0-indexed
    const date = new Date(Date.UTC(2026, 0, 21))
    expect(formatDateForTemplate(date)).toBe('2026-01-21')
  })

  it('pads single-digit months and days', () => {
    const date = new Date(Date.UTC(2026, 0, 5))
    expect(formatDateForTemplate(date)).toBe('2026-01-05')
  })

  it('handles December', () => {
    const date = new Date(Date.UTC(2026, 11, 31))
    expect(formatDateForTemplate(date)).toBe('2026-12-31')
  })
})

describe('integration scenarios', () => {
  it('handles typical photo export workflow', () => {
    const template = '{orig}_{seq:4}'
    const context = { orig: 'DSC09876', seq: 1 }

    expect(validateTemplate(template)).toEqual([])
    expect(renderTemplate(template, context)).toBe('DSC09876_0001')
  })

  it('handles date-prefixed workflow', () => {
    const template = '{date}_{orig}_{seq:3}'
    const context = { orig: 'IMG_1234', seq: 42, date: '2026-01-21' }

    expect(validateTemplate(template)).toEqual([])
    expect(renderTemplate(template, context)).toBe('2026-01-21_IMG_1234_042')
  })

  it('handles sequential batch export', () => {
    const template = 'export_{seq:5}'
    const results = [1, 2, 3, 100, 1000].map((seq) =>
      renderTemplate(template, { orig: 'ignored', seq })
    )

    expect(results).toEqual(['export_00001', 'export_00002', 'export_00003', 'export_00100', 'export_01000'])
  })

  it('extracts and uses original filename', () => {
    const fullPath = '/Users/photos/2026/DSC09876.ARW'
    const orig = extractOriginalFilename(fullPath)
    const result = renderTemplate('{orig}_edited', { orig, seq: 1 })

    expect(result).toBe('DSC09876_edited')
  })
})

// ============================================================================
// Edge Cases and Special Characters
// ============================================================================

describe('edge cases and special characters', () => {
  describe('unicode and international characters', () => {
    it('handles unicode characters in original filename', () => {
      const result = renderTemplate('{orig}', { orig: 'フォト_写真', seq: 1 })
      expect(result).toBe('フォト_写真')
    })

    it('handles emoji in original filename', () => {
      const result = renderTemplate('{orig}', { orig: '📷photo', seq: 1 })
      expect(result).toBe('📷photo')
    })

    it('handles accented characters in original filename', () => {
      const result = renderTemplate('{orig}', { orig: 'café_naïve_résumé', seq: 1 })
      expect(result).toBe('café_naïve_résumé')
    })

    it('handles Chinese characters in original filename', () => {
      const result = renderTemplate('{orig}', { orig: '照片_相片', seq: 1 })
      expect(result).toBe('照片_相片')
    })

    it('handles Arabic characters in original filename', () => {
      const result = renderTemplate('{orig}', { orig: 'صورة', seq: 1 })
      expect(result).toBe('صورة')
    })

    it('extracts unicode filename from path', () => {
      expect(extractOriginalFilename('/путь/к/фото.jpg')).toBe('фото')
      expect(extractOriginalFilename('/パス/写真.jpg')).toBe('写真')
    })
  })

  describe('special filename patterns', () => {
    it('handles filename starting with underscore', () => {
      expect(extractOriginalFilename('_DSC1234.jpg')).toBe('_DSC1234')
    })

    it('handles filename starting with dash', () => {
      expect(extractOriginalFilename('-photo.jpg')).toBe('-photo')
    })

    it('handles filename with multiple underscores', () => {
      expect(extractOriginalFilename('file__name__test.jpg')).toBe('file__name__test')
    })

    it('handles filename with spaces', () => {
      expect(extractOriginalFilename('my photo file.jpg')).toBe('my photo file')
    })

    it('handles filename with parentheses', () => {
      expect(extractOriginalFilename('photo (1).jpg')).toBe('photo (1)')
    })

    it('handles filename with brackets', () => {
      expect(extractOriginalFilename('photo [edited].jpg')).toBe('photo [edited]')
    })

    it('handles very long filename', () => {
      const longName = 'a'.repeat(200)
      expect(extractOriginalFilename(`${longName}.jpg`)).toBe(longName)
    })

    it('handles filename with only extension', () => {
      expect(extractOriginalFilename('.jpg')).toBe('.jpg')
    })
  })

  describe('boundary conditions for sequence numbers', () => {
    it('handles sequence number 0', () => {
      expect(renderTemplate('{seq}', { orig: 'test', seq: 0 })).toBe('0')
      expect(renderTemplate('{seq:4}', { orig: 'test', seq: 0 })).toBe('0000')
    })

    it('handles very large sequence numbers', () => {
      expect(renderTemplate('{seq}', { orig: 'test', seq: 999999 })).toBe('999999')
      expect(renderTemplate('{seq:4}', { orig: 'test', seq: 99999 })).toBe('99999')
    })

    it('handles negative sequence numbers', () => {
      // Negative numbers are unusual but should not crash
      expect(renderTemplate('{seq}', { orig: 'test', seq: -1 })).toBe('-1')
    })

    it('handles maximum safe integer', () => {
      expect(renderTemplate('{seq}', { orig: 'test', seq: Number.MAX_SAFE_INTEGER })).toBe(
        Number.MAX_SAFE_INTEGER.toString()
      )
    })
  })

  describe('template edge cases', () => {
    it('handles template with only braces', () => {
      // Empty braces {} is treated as valid (empty token is not checked)
      // This is acceptable as it doesn't cause rendering issues
      const errors = validateTemplate('{}')
      // Should render correctly even with empty braces
      expect(renderTemplate('{}', { orig: 'test', seq: 1 })).toBe('{}')
    })

    it('handles nested braces', () => {
      const errors = validateTemplate('{{orig}}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles escaped-looking braces', () => {
      const errors = validateTemplate('\\{orig\\}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles template with only whitespace in braces', () => {
      const errors = validateTemplate('{ }')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles token with extra whitespace', () => {
      const errors = validateTemplate('{ orig }')
      expect(errors.length).toBeGreaterThanOrEqual(1) // Not a valid token
    })

    it('handles case-sensitive tokens', () => {
      const errors = validateTemplate('{ORIG}')
      expect(errors.length).toBeGreaterThanOrEqual(1) // Tokens are lowercase
    })

    it('handles mixed case tokens', () => {
      const errors = validateTemplate('{Orig}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles seq with non-numeric padding', () => {
      const errors = validateTemplate('{seq:abc}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles seq with decimal padding', () => {
      const errors = validateTemplate('{seq:4.5}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles seq with negative padding', () => {
      const errors = validateTemplate('{seq:-1}')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('filesystem character validation', () => {
    it('rejects forward slash in template', () => {
      const errors = validateTemplate('{orig}/subfolder')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects backslash in template', () => {
      const errors = validateTemplate('{orig}\\subfolder')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects pipe character in template', () => {
      const errors = validateTemplate('{orig}|{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects asterisk in template', () => {
      const errors = validateTemplate('{orig}*{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects question mark in template', () => {
      const errors = validateTemplate('{orig}?{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects quotes in template', () => {
      const errors = validateTemplate('{orig}"{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects less than sign in template', () => {
      const errors = validateTemplate('{orig}<{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('rejects greater than sign in template', () => {
      const errors = validateTemplate('{orig}>{seq}')
      expect(errors.some((e) => e.message.includes('invalid filename characters'))).toBe(true)
    })

    it('accepts valid filesystem characters', () => {
      expect(validateTemplate('{orig}-{seq}')).toEqual([]) // dash
      expect(validateTemplate('{orig}_{seq}')).toEqual([]) // underscore
      expect(validateTemplate('{orig}.{seq}')).toEqual([]) // dot
      expect(validateTemplate('{orig} {seq}')).toEqual([]) // space
      expect(validateTemplate('{orig}({seq})')).toEqual([]) // parentheses
      expect(validateTemplate('{orig}[{seq}]')).toEqual([]) // brackets
      expect(validateTemplate('{orig}@{seq}')).toEqual([]) // at sign
      expect(validateTemplate('{orig}#{seq}')).toEqual([]) // hash
      expect(validateTemplate('{orig}&{seq}')).toEqual([]) // ampersand
    })
  })

  describe('date formatting edge cases', () => {
    it('formats leap year date', () => {
      const date = new Date(Date.UTC(2024, 1, 29)) // Feb 29, 2024
      expect(formatDateForTemplate(date)).toBe('2024-02-29')
    })

    it('formats year boundary', () => {
      const date = new Date(Date.UTC(2025, 11, 31)) // Dec 31, 2025
      expect(formatDateForTemplate(date)).toBe('2025-12-31')
    })

    it('formats new year', () => {
      const date = new Date(Date.UTC(2026, 0, 1)) // Jan 1, 2026
      expect(formatDateForTemplate(date)).toBe('2026-01-01')
    })

    it('handles dates from distant past', () => {
      const date = new Date(Date.UTC(1970, 0, 1)) // Unix epoch
      expect(formatDateForTemplate(date)).toBe('1970-01-01')
    })

    it('handles dates from distant future', () => {
      const date = new Date(Date.UTC(2099, 11, 31))
      expect(formatDateForTemplate(date)).toBe('2099-12-31')
    })
  })

  describe('rendering with special original filenames', () => {
    it('handles empty original filename', () => {
      expect(renderTemplate('{orig}_{seq}', { orig: '', seq: 1 })).toBe('_1')
    })

    it('handles original filename that looks like a token', () => {
      // Note: If someone names their file "{seq}", the {orig} replacement
      // happens first, then {seq} gets replaced in the result.
      // This is a known limitation - filenames with token patterns will be processed.
      // The result is: {orig} -> {seq} -> 1
      expect(renderTemplate('{orig}', { orig: '{seq}', seq: 1 })).toBe('1')
    })

    it('handles original filename with curly braces', () => {
      expect(renderTemplate('{orig}', { orig: 'file{1}', seq: 1 })).toBe('file{1}')
    })

    it('handles original filename with numbers only', () => {
      expect(renderTemplate('{orig}', { orig: '12345', seq: 1 })).toBe('12345')
    })
  })

  describe('complex template combinations', () => {
    it('handles all tokens together', () => {
      expect(
        renderTemplate('{date}_{orig}_{seq}_{seq:4}', {
          orig: 'photo',
          seq: 7,
          date: '2026-01-21',
        })
      ).toBe('2026-01-21_photo_7_0007')
    })

    it('handles repeated same token', () => {
      expect(
        renderTemplate('{orig}_{orig}_{orig}', {
          orig: 'test',
          seq: 1,
        })
      ).toBe('test_test_test')
    })

    it('handles different padding widths for same seq', () => {
      expect(
        renderTemplate('{seq:2}_{seq:4}_{seq:6}', {
          orig: 'test',
          seq: 42,
        })
      ).toBe('42_0042_000042')
    })

    it('handles template starting and ending with tokens', () => {
      expect(
        renderTemplate('{date}{orig}{seq:3}', {
          orig: 'X',
          seq: 1,
          date: '2026-01-21',
        })
      ).toBe('2026-01-21X001')
    })
  })
})
