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
