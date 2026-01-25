/**
 * Time unit thresholds and formatting configuration.
 * Each entry defines: max milliseconds for this unit, divisor, and label (singular form).
 */
const TIME_UNITS: Array<{ max: number, divisor: number, label: string }> = [
  { max: 60000, divisor: 1, label: 'Just now' }, // < 1 minute
  { max: 3600000, divisor: 60000, label: 'minute' }, // < 1 hour
  { max: 86400000, divisor: 3600000, label: 'hour' }, // < 24 hours
  { max: 604800000, divisor: 86400000, label: 'day' }, // < 7 days
]

/**
 * Format a date as a relative time string (e.g., "5 minutes ago", "2 days ago").
 * Falls back to locale date string for dates older than 7 days.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime()

  for (const unit of TIME_UNITS) {
    if (diff < unit.max) {
      // "Just now" case - no calculation needed
      if (unit.divisor === 1) return unit.label

      const value = Math.floor(diff / unit.divisor)
      const plural = value > 1 ? 's' : ''
      return `${value} ${unit.label}${plural} ago`
    }
  }

  // Older than 7 days - show date
  return date.toLocaleDateString()
}
