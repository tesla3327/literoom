import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '~/utils/formatRelativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2025-01-25T12:00:00.000Z')

  it('returns "Just now" for times less than 1 minute ago', () => {
    const date = new Date('2025-01-25T11:59:30.000Z') // 30 seconds ago
    expect(formatRelativeTime(date, now)).toBe('Just now')
  })

  it('returns "Just now" at exactly 0 difference', () => {
    expect(formatRelativeTime(now, now)).toBe('Just now')
  })

  describe('minutes', () => {
    it('returns "1 minute ago" for 1 minute', () => {
      const date = new Date('2025-01-25T11:59:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('1 minute ago')
    })

    it('returns "30 minutes ago" for 30 minutes', () => {
      const date = new Date('2025-01-25T11:30:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('30 minutes ago')
    })

    it('returns "59 minutes ago" for 59 minutes', () => {
      const date = new Date('2025-01-25T11:01:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('59 minutes ago')
    })
  })

  describe('hours', () => {
    it('returns "1 hour ago" for 1 hour', () => {
      const date = new Date('2025-01-25T11:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('1 hour ago')
    })

    it('returns "12 hours ago" for 12 hours', () => {
      const date = new Date('2025-01-25T00:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('12 hours ago')
    })

    it('returns "23 hours ago" for 23 hours', () => {
      const date = new Date('2025-01-24T13:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('23 hours ago')
    })
  })

  describe('days', () => {
    it('returns "1 day ago" for 1 day', () => {
      const date = new Date('2025-01-24T12:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('1 day ago')
    })

    it('returns "3 days ago" for 3 days', () => {
      const date = new Date('2025-01-22T12:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('3 days ago')
    })

    it('returns "6 days ago" for 6 days', () => {
      const date = new Date('2025-01-19T12:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe('6 days ago')
    })
  })

  describe('older dates', () => {
    it('returns locale date string for dates 7+ days old', () => {
      const date = new Date('2025-01-18T12:00:00.000Z') // 7 days ago
      expect(formatRelativeTime(date, now)).toBe(date.toLocaleDateString())
    })

    it('returns locale date string for dates 30 days old', () => {
      const date = new Date('2024-12-26T12:00:00.000Z')
      expect(formatRelativeTime(date, now)).toBe(date.toLocaleDateString())
    })
  })

  it('uses current time by default when no now parameter provided', () => {
    const recentDate = new Date(Date.now() - 30000) // 30 seconds ago
    expect(formatRelativeTime(recentDate)).toBe('Just now')
  })
})
