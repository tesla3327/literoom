/**
 * Priority queue for thumbnail generation requests.
 *
 * Uses a min-heap to ensure items with higher priority (lower numeric value)
 * are processed first. This enables viewport-aware thumbnail generation where
 * visible thumbnails are generated before off-screen ones.
 */

import type { EditedThumbnailEditState } from '../decode/worker-messages'
import { ThumbnailPriority, type ThumbnailQueueItem } from './types'

// ============================================================================
// Extended Queue Item with Edit State
// ============================================================================

/**
 * Queue item with optional edit state for regenerating edited thumbnails.
 */
export interface ThumbnailQueueItemWithEditState extends ThumbnailQueueItem {
  /** Edit state to apply when generating the thumbnail */
  editState?: EditedThumbnailEditState
  /** Generation number for stale result detection */
  generation?: number
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of items in the queue to prevent unbounded growth */
const DEFAULT_MAX_SIZE = 200

// ============================================================================
// Internal Types
// ============================================================================

interface QueueEntry extends ThumbnailQueueItem {
  /** Timestamp when the item was added (for FIFO within same priority) */
  addedAt: number
}

// ============================================================================
// ThumbnailQueue Implementation
// ============================================================================

/**
 * Priority queue for managing thumbnail generation requests.
 *
 * Features:
 * - Min-heap based priority ordering (lower priority value = higher priority)
 * - FIFO ordering within same priority level
 * - Maximum size limit with eviction of lowest priority items
 * - O(log n) enqueue/dequeue, O(n) priority update and removal
 *
 * Usage:
 * ```typescript
 * const queue = new ThumbnailQueue()
 *
 * queue.enqueue({
 *   assetId: 'abc123',
 *   priority: ThumbnailPriority.VISIBLE,
 *   getBytes: () => fetchImageBytes()
 * })
 *
 * const item = queue.dequeue()
 * if (item) {
 *   const bytes = await item.getBytes()
 *   // Generate thumbnail...
 * }
 * ```
 */
export class ThumbnailQueue {
  private heap: QueueEntry[] = []
  private readonly maxSize: number
  /** Map of assetId to heap index for O(1) lookup */
  private indexMap: Map<string, number> = new Map()

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize
  }

  /**
   * Add an item to the queue.
   *
   * If the item already exists, its priority is updated instead.
   * If the queue is at max capacity, the lowest priority item is evicted.
   */
  enqueue(item: ThumbnailQueueItem): void {
    // Check if item already exists
    if (this.indexMap.has(item.assetId)) {
      this.updatePriority(item.assetId, item.priority)
      return
    }

    // Evict lowest priority item if at capacity
    if (this.heap.length >= this.maxSize) {
      this.evictLowest()
    }

    // Add new item
    const entry: QueueEntry = {
      ...item,
      addedAt: Date.now(),
    }

    const index = this.heap.length
    this.heap.push(entry)
    this.indexMap.set(item.assetId, index)
    this.bubbleUp(index)
  }

  /**
   * Remove and return the highest priority item.
   * Returns undefined if the queue is empty.
   */
  dequeue(): ThumbnailQueueItem | undefined {
    if (this.heap.length === 0) {
      return undefined
    }

    const top = this.heap[0]
    this.indexMap.delete(top.assetId)

    if (this.heap.length === 1) {
      this.heap.pop()
      return top
    }

    // Move last item to top and bubble down
    const last = this.heap.pop()!
    this.heap[0] = last
    this.indexMap.set(last.assetId, 0)
    this.bubbleDown(0)

    return top
  }

  /**
   * Peek at the highest priority item without removing it.
   */
  peek(): ThumbnailQueueItem | undefined {
    return this.heap[0]
  }

  /**
   * Update the priority of an existing item.
   * Does nothing if the item is not in the queue.
   */
  updatePriority(assetId: string, priority: ThumbnailPriority): void {
    const index = this.indexMap.get(assetId)
    if (index === undefined) {
      return
    }

    const oldPriority = this.heap[index].priority
    this.heap[index].priority = priority

    // Re-heapify based on priority change
    if (priority < oldPriority) {
      this.bubbleUp(index)
    } else if (priority > oldPriority) {
      this.bubbleDown(index)
    }
  }

  /**
   * Remove an item from the queue.
   * Does nothing if the item is not in the queue.
   */
  remove(assetId: string): void {
    const index = this.indexMap.get(assetId)
    if (index === undefined) {
      return
    }

    this.indexMap.delete(assetId)

    if (index === this.heap.length - 1) {
      this.heap.pop()
      return
    }

    // Move last item to the removed position
    const last = this.heap.pop()!
    this.heap[index] = last
    this.indexMap.set(last.assetId, index)

    // Re-heapify
    const parent = Math.floor((index - 1) / 2)
    if (index > 0 && this.compare(this.heap[index], this.heap[parent]) < 0) {
      this.bubbleUp(index)
    } else {
      this.bubbleDown(index)
    }
  }

  /**
   * Check if an item is in the queue.
   */
  has(assetId: string): boolean {
    return this.indexMap.has(assetId)
  }

  /**
   * Get the current priority of an item.
   * Returns undefined if the item is not in the queue.
   */
  getPriority(assetId: string): ThumbnailPriority | undefined {
    const index = this.indexMap.get(assetId)
    if (index === undefined) {
      return undefined
    }
    return this.heap[index].priority
  }

  /**
   * Clear all items from the queue.
   */
  clear(): void {
    this.heap = []
    this.indexMap.clear()
  }

  /**
   * Get the current number of items in the queue.
   */
  get size(): number {
    return this.heap.length
  }

  /**
   * Check if the queue is empty.
   */
  get isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Get all items in the queue (for debugging/testing).
   * Items are returned in no particular order.
   */
  getAll(): ThumbnailQueueItem[] {
    return [...this.heap]
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Compare two entries for heap ordering.
   * Returns negative if a should come before b.
   */
  private compare(a: QueueEntry, b: QueueEntry): number {
    // First compare by priority (lower = higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority
    }
    // Then by timestamp (earlier = higher priority, FIFO)
    return a.addedAt - b.addedAt
  }

  /**
   * Move an item up the heap to restore heap property.
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) {
        break
      }
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  /**
   * Move an item down the heap to restore heap property.
   */
  private bubbleDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < this.heap.length && this.compare(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild
      }

      if (rightChild < this.heap.length && this.compare(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild
      }

      if (smallest === index) {
        break
      }

      this.swap(index, smallest)
      index = smallest
    }
  }

  /**
   * Swap two items in the heap and update the index map.
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i]
    this.heap[i] = this.heap[j]
    this.heap[j] = temp
    this.indexMap.set(this.heap[i].assetId, i)
    this.indexMap.set(this.heap[j].assetId, j)
  }

  /**
   * Find and remove the lowest priority item.
   * Used when queue is at capacity.
   */
  private evictLowest(): void {
    if (this.heap.length === 0) {
      return
    }

    // Find the item with lowest priority (highest priority value)
    // In a min-heap, lowest priority items are in the leaves
    const startIdx = Math.floor(this.heap.length / 2)
    let lowestIdx = startIdx
    let lowest = this.heap[startIdx]

    for (let i = startIdx + 1; i < this.heap.length; i++) {
      if (this.compare(this.heap[i], lowest) > 0) {
        lowest = this.heap[i]
        lowestIdx = i
      }
    }

    this.remove(lowest.assetId)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ThumbnailQueue instance.
 */
export function createThumbnailQueue(maxSize?: number): ThumbnailQueue {
  return new ThumbnailQueue(maxSize)
}
