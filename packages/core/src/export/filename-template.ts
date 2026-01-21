/**
 * Filename template parser for export
 *
 * Supports tokens:
 * - {orig} - Original filename without extension
 * - {seq} - Sequence number (no padding)
 * - {seq:N} - Sequence number with N-digit zero padding (e.g., {seq:4} -> 0001)
 * - {date} - Capture date in YYYY-MM-DD format
 */

export interface TemplateContext {
  /** Original filename without extension */
  orig: string
  /** Sequence number (1-based) */
  seq: number
  /** Capture date in YYYY-MM-DD format */
  date?: string
}

export interface TemplateError {
  message: string
  position?: number
}

/**
 * Render a filename template with the given context
 *
 * @example
 * renderTemplate('{orig}_{seq:4}', { orig: 'DSC1234', seq: 1 })
 * // Returns: 'DSC1234_0001'
 *
 * @example
 * renderTemplate('{date}_{orig}_{seq:3}', { orig: 'photo', seq: 7, date: '2026-01-21' })
 * // Returns: '2026-01-21_photo_007'
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  let result = template

  // Replace {orig}
  result = result.replace(/\{orig\}/g, context.orig)

  // Replace {seq:N} with zero-padded number
  result = result.replace(/\{seq:(\d+)\}/g, (_, padWidth) => {
    const width = parseInt(padWidth, 10)
    return context.seq.toString().padStart(width, '0')
  })

  // Replace {seq} without padding
  result = result.replace(/\{seq\}/g, context.seq.toString())

  // Replace {date}
  if (context.date) {
    result = result.replace(/\{date\}/g, context.date)
  } else {
    result = result.replace(/\{date\}/g, '')
  }

  return result
}

/**
 * Validate a filename template
 *
 * @returns Array of validation errors (empty if valid)
 */
export function validateTemplate(template: string): TemplateError[] {
  const errors: TemplateError[] = []

  // Check for empty template
  if (!template.trim()) {
    errors.push({ message: 'Template cannot be empty' })
    return errors
  }

  // Check for unmatched braces
  const openBraces = (template.match(/\{/g) || []).length
  const closeBraces = (template.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    errors.push({ message: 'Unmatched braces in template' })
  }

  // Check for unknown tokens
  const tokenRegex = /\{([^}]+)\}/g
  let match
  while ((match = tokenRegex.exec(template)) !== null) {
    const token = match[1]
    if (token !== 'orig' && token !== 'date' && !token.match(/^seq(:\d+)?$/)) {
      errors.push({
        message: `Unknown token: {${token}}`,
        position: match.index,
      })
    }
  }

  // Validate {seq:N} padding width (1-10)
  const seqPadRegex = /\{seq:(\d+)\}/g
  while ((match = seqPadRegex.exec(template)) !== null) {
    const width = parseInt(match[1], 10)
    if (width < 1 || width > 10) {
      errors.push({
        message: `Sequence padding must be 1-10 digits, got ${width}`,
        position: match.index,
      })
    }
  }

  // Check for invalid filename characters in static parts
  // (tokens will be replaced, so we check the rendered result)
  const rendered = renderTemplate(template, { orig: 'test', seq: 1, date: '2026-01-21' })
  const invalidChars = /[<>:"/\\|?*]/
  if (invalidChars.test(rendered)) {
    errors.push({ message: 'Template contains invalid filename characters' })
  }

  return errors
}

/**
 * Extract the original filename from a full path/filename
 *
 * @example
 * extractOriginalFilename('/path/to/DSC1234.ARW')
 * // Returns: 'DSC1234'
 */
export function extractOriginalFilename(filename: string): string {
  // Remove path (handle both Unix and Windows paths)
  const basename = filename.split(/[/\\]/).pop() || filename
  // Remove extension
  const lastDot = basename.lastIndexOf('.')
  return lastDot > 0 ? basename.substring(0, lastDot) : basename
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDateForTemplate(date: Date): string {
  return date.toISOString().split('T')[0]
}
