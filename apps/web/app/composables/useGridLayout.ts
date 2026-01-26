/**
 * Composable for grid layout calculations.
 *
 * Provides utilities for converting between flat indices and row/column positions
 * in a virtual scrolling grid. Designed for responsive grids where column count
 * can change based on container width.
 */

export interface UseGridLayoutOptions<T> {
  /**
   * Total number of items in the grid.
   */
  totalItems: ComputedRef<number>
  /**
   * Number of columns in the grid.
   */
  columnsCount: ComputedRef<number>
  /**
   * Optional function to get an item by its flat index.
   * If provided, enables getItem() method.
   */
  getItemAtIndex?: (index: number) => T | undefined
}

export interface UseGridLayoutReturn<T> {
  /**
   * Number of rows needed to display all items.
   */
  rowCount: ComputedRef<number>
  /**
   * Convert row and column indices to a flat index.
   */
  getGlobalIndex: (rowIndex: number, colIndex: number) => number
  /**
   * Get the number of columns in a specific row (last row may have fewer).
   */
  columnsInRow: (rowIndex: number) => number
  /**
   * Get the row index for a flat index.
   */
  getRowIndex: (index: number) => number
  /**
   * Get an item at a specific row/column position.
   * Returns undefined if position is out of bounds or getItemAtIndex is not provided.
   */
  getItem: (rowIndex: number, colIndex: number) => T | undefined
}

/**
 * Grid layout calculations for virtual scrolling.
 *
 * @example
 * ```typescript
 * const { rowCount, getGlobalIndex, columnsInRow, getItem } = useGridLayout({
 *   totalItems: computed(() => items.value.length),
 *   columnsCount: computed(() => 4),
 *   getItemAtIndex: (index) => items.value[index],
 * })
 *
 * // In template:
 * // <div v-for="colIndex in columnsInRow(rowIndex)">
 * //   <Item :item="getItem(rowIndex, colIndex - 1)" />
 * // </div>
 * ```
 */
export function useGridLayout<T = unknown>(
  options: UseGridLayoutOptions<T>,
): UseGridLayoutReturn<T> {
  const { totalItems, columnsCount, getItemAtIndex } = options

  const rowCount = computed(() =>
    Math.ceil(totalItems.value / columnsCount.value),
  )

  function getGlobalIndex(rowIndex: number, colIndex: number): number {
    return rowIndex * columnsCount.value + colIndex
  }

  function columnsInRow(rowIndex: number): number {
    const startIndex = rowIndex * columnsCount.value
    const remaining = totalItems.value - startIndex
    return Math.min(columnsCount.value, remaining)
  }

  function getRowIndex(index: number): number {
    return Math.floor(index / columnsCount.value)
  }

  function getItem(rowIndex: number, colIndex: number): T | undefined {
    if (!getItemAtIndex) return undefined
    const globalIndex = getGlobalIndex(rowIndex, colIndex)
    if (globalIndex >= totalItems.value) return undefined
    return getItemAtIndex(globalIndex)
  }

  return {
    rowCount,
    getGlobalIndex,
    columnsInRow,
    getRowIndex,
    getItem,
  }
}
