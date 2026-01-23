/**
 * Unit tests for the ThumbnailQueue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThumbnailQueue, createThumbnailQueue, type ThumbnailQueueItemWithEditState } from './thumbnail-queue'
import { ThumbnailPriority } from './types'
import type { EditedThumbnailEditState } from '../decode/worker-messages'

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockItem(
  assetId: string,
  priority: ThumbnailPriority = ThumbnailPriority.BACKGROUND
) {
  return {
    assetId,
    priority,
    getBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  }
}

function createMockItemWithEditState(
  assetId: string,
  priority: ThumbnailPriority = ThumbnailPriority.BACKGROUND,
  editState?: EditedThumbnailEditState,
  generation?: number
): ThumbnailQueueItemWithEditState {
  return {
    assetId,
    priority,
    getBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    editState,
    generation,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ThumbnailQueue', () => {
  let queue: ThumbnailQueue

  beforeEach(() => {
    queue = new ThumbnailQueue()
  })

  describe('enqueue', () => {
    it('should add items to the queue', () => {
      queue.enqueue(createMockItem('asset1'))
      queue.enqueue(createMockItem('asset2'))

      expect(queue.size).toBe(2)
    })

    it('should update priority if item already exists', () => {
      queue.enqueue(createMockItem('asset1', ThumbnailPriority.BACKGROUND))

      expect(queue.getPriority('asset1')).toBe(ThumbnailPriority.BACKGROUND)

      queue.enqueue(createMockItem('asset1', ThumbnailPriority.VISIBLE))

      expect(queue.size).toBe(1)
      expect(queue.getPriority('asset1')).toBe(ThumbnailPriority.VISIBLE)
    })

    it('should evict lowest priority item when at capacity', () => {
      const maxSize = 3
      queue = new ThumbnailQueue(maxSize)

      queue.enqueue(createMockItem('asset1', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('asset2', ThumbnailPriority.NEAR_VISIBLE))
      queue.enqueue(createMockItem('asset3', ThumbnailPriority.BACKGROUND))

      expect(queue.size).toBe(3)

      // Add a high priority item - should evict BACKGROUND
      queue.enqueue(createMockItem('asset4', ThumbnailPriority.VISIBLE))

      expect(queue.size).toBe(3)
      expect(queue.has('asset3')).toBe(false)
      expect(queue.has('asset4')).toBe(true)
    })
  })

  describe('dequeue', () => {
    it('should return undefined for empty queue', () => {
      expect(queue.dequeue()).toBeUndefined()
    })

    it('should return highest priority item (lowest numeric value)', () => {
      queue.enqueue(createMockItem('low', ThumbnailPriority.BACKGROUND))
      queue.enqueue(createMockItem('high', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('medium', ThumbnailPriority.NEAR_VISIBLE))

      const item = queue.dequeue()

      expect(item?.assetId).toBe('high')
      expect(queue.size).toBe(2)
    })

    it('should maintain FIFO order for same priority', async () => {
      // Use setTimeout to ensure different timestamps
      queue.enqueue(createMockItem('first', ThumbnailPriority.VISIBLE))
      await new Promise((r) => setTimeout(r, 5))
      queue.enqueue(createMockItem('second', ThumbnailPriority.VISIBLE))

      expect(queue.dequeue()?.assetId).toBe('first')
      expect(queue.dequeue()?.assetId).toBe('second')
    })

    it('should process all items in priority order', () => {
      queue.enqueue(createMockItem('bg1', ThumbnailPriority.BACKGROUND))
      queue.enqueue(createMockItem('vis1', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('near1', ThumbnailPriority.NEAR_VISIBLE))
      queue.enqueue(createMockItem('vis2', ThumbnailPriority.VISIBLE))

      const order = []
      while (!queue.isEmpty) {
        order.push(queue.dequeue()?.assetId)
      }

      // VISIBLE items first, then NEAR_VISIBLE, then BACKGROUND
      expect(order[0]).toMatch(/^vis/)
      expect(order[1]).toMatch(/^vis/)
      expect(order[2]).toBe('near1')
      expect(order[3]).toBe('bg1')
    })
  })

  describe('peek', () => {
    it('should return undefined for empty queue', () => {
      expect(queue.peek()).toBeUndefined()
    })

    it('should return highest priority item without removing it', () => {
      queue.enqueue(createMockItem('low', ThumbnailPriority.BACKGROUND))
      queue.enqueue(createMockItem('high', ThumbnailPriority.VISIBLE))

      const peeked = queue.peek()
      expect(peeked?.assetId).toBe('high')
      expect(queue.size).toBe(2)

      // Peek again should return the same item
      expect(queue.peek()?.assetId).toBe('high')
    })
  })

  describe('updatePriority', () => {
    it('should do nothing for non-existent item', () => {
      queue.updatePriority('nonexistent', ThumbnailPriority.VISIBLE)
      expect(queue.size).toBe(0)
    })

    it('should increase priority (lower numeric value)', () => {
      queue.enqueue(createMockItem('low', ThumbnailPriority.BACKGROUND))
      queue.enqueue(createMockItem('other', ThumbnailPriority.NEAR_VISIBLE))

      queue.updatePriority('low', ThumbnailPriority.VISIBLE)

      // Now 'low' should be dequeued first
      expect(queue.dequeue()?.assetId).toBe('low')
    })

    it('should decrease priority (higher numeric value)', () => {
      queue.enqueue(createMockItem('high', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('other', ThumbnailPriority.NEAR_VISIBLE))

      queue.updatePriority('high', ThumbnailPriority.BACKGROUND)

      // Now 'other' should be dequeued first
      expect(queue.dequeue()?.assetId).toBe('other')
    })
  })

  describe('remove', () => {
    it('should do nothing for non-existent item', () => {
      queue.enqueue(createMockItem('asset1'))
      queue.remove('nonexistent')
      expect(queue.size).toBe(1)
    })

    it('should remove item from queue', () => {
      queue.enqueue(createMockItem('asset1'))
      queue.enqueue(createMockItem('asset2'))
      queue.enqueue(createMockItem('asset3'))

      queue.remove('asset2')

      expect(queue.size).toBe(2)
      expect(queue.has('asset2')).toBe(false)
    })

    it('should maintain heap property after removal', () => {
      queue.enqueue(createMockItem('bg1', ThumbnailPriority.BACKGROUND))
      queue.enqueue(createMockItem('vis1', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('near1', ThumbnailPriority.NEAR_VISIBLE))
      queue.enqueue(createMockItem('bg2', ThumbnailPriority.BACKGROUND))

      queue.remove('vis1')

      // Next highest priority should now be NEAR_VISIBLE
      expect(queue.dequeue()?.assetId).toBe('near1')
    })
  })

  describe('has', () => {
    it('should return false for empty queue', () => {
      expect(queue.has('asset1')).toBe(false)
    })

    it('should return true for existing item', () => {
      queue.enqueue(createMockItem('asset1'))
      expect(queue.has('asset1')).toBe(true)
    })

    it('should return false after dequeue', () => {
      queue.enqueue(createMockItem('asset1'))
      queue.dequeue()
      expect(queue.has('asset1')).toBe(false)
    })
  })

  describe('getPriority', () => {
    it('should return undefined for non-existent item', () => {
      expect(queue.getPriority('nonexistent')).toBeUndefined()
    })

    it('should return correct priority', () => {
      queue.enqueue(createMockItem('asset1', ThumbnailPriority.NEAR_VISIBLE))
      expect(queue.getPriority('asset1')).toBe(ThumbnailPriority.NEAR_VISIBLE)
    })
  })

  describe('clear', () => {
    it('should remove all items', () => {
      queue.enqueue(createMockItem('asset1'))
      queue.enqueue(createMockItem('asset2'))
      queue.enqueue(createMockItem('asset3'))

      queue.clear()

      expect(queue.size).toBe(0)
      expect(queue.isEmpty).toBe(true)
    })
  })

  describe('size and isEmpty', () => {
    it('should track size correctly', () => {
      expect(queue.size).toBe(0)
      expect(queue.isEmpty).toBe(true)

      queue.enqueue(createMockItem('asset1'))
      expect(queue.size).toBe(1)
      expect(queue.isEmpty).toBe(false)

      queue.enqueue(createMockItem('asset2'))
      expect(queue.size).toBe(2)

      queue.dequeue()
      expect(queue.size).toBe(1)

      queue.dequeue()
      expect(queue.size).toBe(0)
      expect(queue.isEmpty).toBe(true)
    })
  })

  describe('getAll', () => {
    it('should return all items', () => {
      queue.enqueue(createMockItem('asset1', ThumbnailPriority.VISIBLE))
      queue.enqueue(createMockItem('asset2', ThumbnailPriority.BACKGROUND))

      const all = queue.getAll()

      expect(all).toHaveLength(2)
      expect(all.map((i) => i.assetId)).toContain('asset1')
      expect(all.map((i) => i.assetId)).toContain('asset2')
    })
  })

  describe('createThumbnailQueue', () => {
    it('should create a new queue with default max size', () => {
      const q = createThumbnailQueue()
      expect(q).toBeInstanceOf(ThumbnailQueue)
    })

    it('should create a new queue with custom max size', () => {
      const q = createThumbnailQueue(50)

      // Fill to capacity
      for (let i = 0; i < 55; i++) {
        q.enqueue(createMockItem(`asset${i}`))
      }

      // Should be capped at 50
      expect(q.size).toBe(50)
    })
  })

  describe('ThumbnailQueueItemWithEditState', () => {
    it('should accept items with editState', () => {
      const editState: EditedThumbnailEditState = {
        adjustments: {
          exposure: 1,
          contrast: 10,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      expect(queue.size).toBe(1)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState).toBeDefined()
      expect(dequeued.editState?.adjustments?.exposure).toBe(1)
    })

    it('should accept items with generation number', () => {
      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, undefined, 5)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.generation).toBe(5)
    })

    it('should accept items with both editState and generation', () => {
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 45, straighten: 0 },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState, 3)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.rotation?.angle).toBe(45)
      expect(dequeued.generation).toBe(3)
    })

    it('should preserve editState through priority ordering', async () => {
      const editState1: EditedThumbnailEditState = { adjustments: { exposure: 1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0 } }
      const editState2: EditedThumbnailEditState = { adjustments: { exposure: 2, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0 } }

      // Add low priority first
      queue.enqueue(createMockItemWithEditState('low', ThumbnailPriority.BACKGROUND, editState1, 1))
      await new Promise((r) => setTimeout(r, 5))
      // Add high priority second
      queue.enqueue(createMockItemWithEditState('high', ThumbnailPriority.VISIBLE, editState2, 2))

      // High priority should come first
      const first = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(first.assetId).toBe('high')
      expect(first.editState?.adjustments?.exposure).toBe(2)
      expect(first.generation).toBe(2)

      const second = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(second.assetId).toBe('low')
      expect(second.editState?.adjustments?.exposure).toBe(1)
      expect(second.generation).toBe(1)
    })

    it('should work with items without editState (backward compatible)', () => {
      // Standard item without editState
      queue.enqueue(createMockItem('asset1', ThumbnailPriority.VISIBLE))

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState).toBeUndefined()
      expect(dequeued.generation).toBeUndefined()
    })

    it('should handle full edit state with all parameters', () => {
      const fullEditState: EditedThumbnailEditState = {
        adjustments: {
          exposure: 0.5,
          contrast: 20,
          highlights: -10,
          shadows: 10,
          whites: 5,
          blacks: -5,
          temperature: 10,
          tint: 5,
          vibrance: 15,
          saturation: 10,
        },
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        },
        crop: {
          left: 0.1,
          top: 0.1,
          width: 0.8,
          height: 0.8,
        },
        rotation: {
          angle: 15,
          straighten: 2,
        },
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: -0.5 },
            },
          ],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: true,
              adjustments: { contrast: 15 },
            },
          ],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, fullEditState, 10)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState

      // Verify all properties are preserved
      expect(dequeued.editState?.adjustments?.exposure).toBe(0.5)
      expect(dequeued.editState?.toneCurve?.points).toHaveLength(3)
      expect(dequeued.editState?.crop?.left).toBe(0.1)
      expect(dequeued.editState?.rotation?.angle).toBe(15)
      expect(dequeued.editState?.masks?.linearMasks).toHaveLength(1)
      expect(dequeued.editState?.masks?.radialMasks).toHaveLength(1)
      expect(dequeued.generation).toBe(10)
    })

    it('should handle null crop value', () => {
      const editState: EditedThumbnailEditState = {
        crop: null,
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.crop).toBeNull()
    })

    it('should handle empty masks arrays', () => {
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [],
          radialMasks: [],
        },
      }

      const item = createMockItemWithEditState('asset1', ThumbnailPriority.VISIBLE, editState)
      queue.enqueue(item)

      const dequeued = queue.dequeue() as ThumbnailQueueItemWithEditState
      expect(dequeued.editState?.masks?.linearMasks).toHaveLength(0)
      expect(dequeued.editState?.masks?.radialMasks).toHaveLength(0)
    })
  })
})
