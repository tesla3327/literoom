import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { useGridLayout } from '~/composables/useGridLayout'

describe('useGridLayout', () => {
  describe('rowCount', () => {
    it('calculates correct row count for exact division', () => {
      const { rowCount } = useGridLayout({
        totalItems: computed(() => 12),
        columnsCount: computed(() => 4),
      })
      expect(rowCount.value).toBe(3)
    })

    it('rounds up for partial rows', () => {
      const { rowCount } = useGridLayout({
        totalItems: computed(() => 10),
        columnsCount: computed(() => 4),
      })
      expect(rowCount.value).toBe(3)
    })

    it('returns 0 for empty grid', () => {
      const { rowCount } = useGridLayout({
        totalItems: computed(() => 0),
        columnsCount: computed(() => 4),
      })
      expect(rowCount.value).toBe(0)
    })

    it('returns 1 for single item', () => {
      const { rowCount } = useGridLayout({
        totalItems: computed(() => 1),
        columnsCount: computed(() => 4),
      })
      expect(rowCount.value).toBe(1)
    })
  })

  describe('getGlobalIndex', () => {
    it('converts row and column to global index', () => {
      const { getGlobalIndex } = useGridLayout({
        totalItems: computed(() => 20),
        columnsCount: computed(() => 5),
      })
      expect(getGlobalIndex(0, 0)).toBe(0)
      expect(getGlobalIndex(0, 4)).toBe(4)
      expect(getGlobalIndex(1, 0)).toBe(5)
      expect(getGlobalIndex(2, 3)).toBe(13)
    })

    it('works with different column counts', () => {
      const { getGlobalIndex } = useGridLayout({
        totalItems: computed(() => 20),
        columnsCount: computed(() => 3),
      })
      expect(getGlobalIndex(0, 0)).toBe(0)
      expect(getGlobalIndex(0, 2)).toBe(2)
      expect(getGlobalIndex(1, 0)).toBe(3)
      expect(getGlobalIndex(2, 1)).toBe(7)
    })
  })

  describe('columnsInRow', () => {
    it('returns full column count for complete rows', () => {
      const { columnsInRow } = useGridLayout({
        totalItems: computed(() => 20),
        columnsCount: computed(() => 5),
      })
      expect(columnsInRow(0)).toBe(5)
      expect(columnsInRow(1)).toBe(5)
      expect(columnsInRow(2)).toBe(5)
    })

    it('returns partial count for last row', () => {
      const { columnsInRow } = useGridLayout({
        totalItems: computed(() => 13),
        columnsCount: computed(() => 5),
      })
      expect(columnsInRow(0)).toBe(5)
      expect(columnsInRow(1)).toBe(5)
      expect(columnsInRow(2)).toBe(3)
    })

    it('returns correct count for single item grid', () => {
      const { columnsInRow } = useGridLayout({
        totalItems: computed(() => 1),
        columnsCount: computed(() => 5),
      })
      expect(columnsInRow(0)).toBe(1)
    })

    it('returns 0 for empty grid', () => {
      const { columnsInRow } = useGridLayout({
        totalItems: computed(() => 0),
        columnsCount: computed(() => 5),
      })
      expect(columnsInRow(0)).toBe(0)
    })
  })

  describe('getRowIndex', () => {
    it('converts flat index to row index', () => {
      const { getRowIndex } = useGridLayout({
        totalItems: computed(() => 20),
        columnsCount: computed(() => 5),
      })
      expect(getRowIndex(0)).toBe(0)
      expect(getRowIndex(4)).toBe(0)
      expect(getRowIndex(5)).toBe(1)
      expect(getRowIndex(14)).toBe(2)
    })

    it('works with different column counts', () => {
      const { getRowIndex } = useGridLayout({
        totalItems: computed(() => 20),
        columnsCount: computed(() => 3),
      })
      expect(getRowIndex(0)).toBe(0)
      expect(getRowIndex(2)).toBe(0)
      expect(getRowIndex(3)).toBe(1)
      expect(getRowIndex(8)).toBe(2)
    })
  })

  describe('getItem', () => {
    it('returns item at position when getItemAtIndex is provided', () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f']
      const { getItem } = useGridLayout({
        totalItems: computed(() => items.length),
        columnsCount: computed(() => 3),
        getItemAtIndex: index => items[index],
      })
      expect(getItem(0, 0)).toBe('a')
      expect(getItem(0, 2)).toBe('c')
      expect(getItem(1, 0)).toBe('d')
      expect(getItem(1, 2)).toBe('f')
    })

    it('returns undefined for out of bounds positions', () => {
      const items = ['a', 'b', 'c']
      const { getItem } = useGridLayout({
        totalItems: computed(() => items.length),
        columnsCount: computed(() => 3),
        getItemAtIndex: index => items[index],
      })
      expect(getItem(1, 0)).toBeUndefined()
    })

    it('returns undefined when getItemAtIndex is not provided', () => {
      const { getItem } = useGridLayout({
        totalItems: computed(() => 10),
        columnsCount: computed(() => 3),
      })
      expect(getItem(0, 0)).toBeUndefined()
    })

    it('passes through undefined from getItemAtIndex', () => {
      const { getItem } = useGridLayout({
        totalItems: computed(() => 10),
        columnsCount: computed(() => 3),
        getItemAtIndex: () => undefined,
      })
      expect(getItem(0, 0)).toBeUndefined()
    })
  })

  describe('reactive updates', () => {
    it('rowCount updates when totalItems changes', () => {
      const totalItems = ref(10)
      const { rowCount } = useGridLayout({
        totalItems: computed(() => totalItems.value),
        columnsCount: computed(() => 4),
      })
      expect(rowCount.value).toBe(3)
      totalItems.value = 20
      expect(rowCount.value).toBe(5)
    })

    it('rowCount updates when columnsCount changes', () => {
      const columnsCount = ref(4)
      const { rowCount } = useGridLayout({
        totalItems: computed(() => 12),
        columnsCount: computed(() => columnsCount.value),
      })
      expect(rowCount.value).toBe(3)
      columnsCount.value = 3
      expect(rowCount.value).toBe(4)
    })
  })
})
